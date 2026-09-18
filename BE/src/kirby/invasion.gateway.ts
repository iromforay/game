import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { InvasionService } from './invasion.service';
import { PlayerService } from './player.service';
import { canInvade } from './baseAccess';

function baseRoom(targetPlayerId: string) {
  return `kirby-base:${targetPlayerId}`;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class InvasionGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly invasions: InvasionService,
    private readonly players: PlayerService,
  ) {}

  async handleDisconnect(client: Socket) {
    const result = this.invasions.unregisterSocket(client.id);
    if (!result) return;
    const { playerId } = result;

    // 이 플레이어가 침입자(viewer)로 진행 중이던 침입은 연결 종료로 실패 처리(붙잡을 사람이 사라졌으므로 안전하게 반환)
    for (const invasion of this.invasions.findInvasionsInvolving(playerId)) {
      if (invasion.viewerPlayerId === playerId) {
        await this.players.resetStolenStatus(invasion.instanceId);
        this.invasions.endInvasion(invasion.instanceId);
        this.server.to(baseRoom(invasion.ownerPlayerId)).emit('invasion:resolved', {
          instanceId: invasion.instanceId,
          result: 'failed',
          reason: 'viewer-disconnected',
        });
      }
      // 소유자(owner) 연결 종료는 실패 처리하지 않음 — 4.4/4.5 확정대로, 탈출 시점에 그때의
      // 오프라인+운영설정 상태로 다시 판정하면 되므로 여기서 특별 취급할 필요가 없음.
    }
  }

  // Codex QA 지적(2026-09-18, to_claude_v2_C.md §3-3) 반영: 임의 playerId를 무조건 등록해주지 않고,
  // identify() 때 발급한 세션 토큰과 일치할 때만 그 playerId로 소켓을 등록한다.
  @SubscribeMessage('presence:hello')
  async handleHello(@ConnectedSocket() client: Socket, @MessageBody() body: { playerId: string; sessionToken?: string }) {
    const valid = await this.players.verifySessionToken(body.playerId, body.sessionToken);
    if (!valid) return { ok: false, reason: 'invalid-session' };
    this.invasions.registerSocket(body.playerId, client.id);
    // 버그 수정(2026-09-18, 사용자 지적): 지금까지 "자기 기지 room"에 join하는 곳이 base:enter(=남의
    // 기지에 들어갈 때)뿐이라, 정작 소유자 본인은 자기 기지 room에 한 번도 들어가지 않는 상태였음.
    // 그 결과 invasion:started/position/hit/resolved가 전부 baseRoom(ownerPlayerId)로 브로드캐스트
    // 되는데 소유자 소켓이 그 room 멤버가 아니라서 하나도 못 받고 있었음(침입자 움직임이 전혀 안 보이고,
    // 명중해도 카운터가 안 올라가는 문제의 원인). 접속하는 순간 항상 자기 기지 room에 상주하도록 수정.
    await client.join(baseRoom(body.playerId));
    return { ok: true };
  }

  // 화면 재설계로 "다른 기지 목록"류 UI가 생길 때 바로 쓸 수 있도록 준비해둔 조회 —
  // 접속 중인 다른 플레이어 ID 목록만 우선 반환(닉네임/기지 미리보기 등은 UI 확정 후 확장)
  @SubscribeMessage('base:listOnline')
  handleListOnline(@MessageBody() body: { excludingPlayerId?: string }) {
    return { ok: true, playerIds: this.invasions.listOnlinePlayerIds(body?.excludingPlayerId) };
  }

  // Codex QA 지적(2026-09-18) 반영: 요청 본문이 자기 자신이라고 주장하는 값이 아니라, 이 소켓이
  // presence:hello로 실제 등록된 신원인지 확인한다. 미등록 소켓의 행동은 전부 거부.
  private requireSocketIdentity(client: Socket): string | null {
    return this.invasions.getPlayerIdBySocket(client.id) ?? null;
  }

  // 5.1-0 진입 게이트: ①기지 존재(4.5) → ②잠금 상태(4.4) 순서로 판정
  @SubscribeMessage('base:enter')
  async handleEnter(@ConnectedSocket() client: Socket, @MessageBody() body: { viewerPlayerId: string; targetPlayerId: string }) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId || actorId !== body.viewerPlayerId) return { ok: false, reason: 'identity-mismatch' };

    const access = await this.players.getBaseAccess(body.targetPlayerId);
    const ownerOnline = this.invasions.isOnline(body.targetPlayerId);
    if (!canInvade(access, ownerOnline, actorId)) {
      return { ok: false, reason: ownerOnline || access.offlineOperationEnabled ? 'locked' : 'not-exist' };
    }

    await client.join(baseRoom(body.targetPlayerId));
    const state = await this.players.getPlayerState(body.targetPlayerId);
    return { ok: true, access, ownerOnline, kirbies: state.kirbies };
  }

  @SubscribeMessage('base:leave')
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() body: { targetPlayerId: string }) {
    client.leave(baseRoom(body.targetPlayerId));
    return { ok: true };
  }

  // 5.1-①: 대상 커비 선택 = PvP 침입 시작 트리거. 5.1-②: 소유자 화면에도 실시간 노출.
  @SubscribeMessage('invasion:select')
  async handleSelect(@ConnectedSocket() client: Socket, @MessageBody() body: { viewerPlayerId: string; targetPlayerId: string; instanceId: string }) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId || actorId !== body.viewerPlayerId) return { ok: false, reason: 'identity-mismatch' };

    const instance = await this.players.findInstance(body.instanceId);
    if (instance.owner_player_id.toString() !== body.targetPlayerId) {
      return { ok: false, reason: 'not-owned-by-target' };
    }
    if (instance.status !== 'idle') {
      return { ok: false, reason: 'already-targeted' };
    }

    await this.players.markStolenInTransit(body.instanceId);
    this.invasions.startInvasion(body.instanceId, body.targetPlayerId, actorId);

    this.server.to(baseRoom(body.targetPlayerId)).emit('invasion:started', {
      instanceId: body.instanceId,
      viewerPlayerId: actorId,
      characterName: instance.kirby_character.name,
    });
    return { ok: true };
  }

  // 3.5.4류 위치 브로드캐스트 — 서버는 그대로 중계하되, 명중 판정(attack)에서는 이 값을 서버가 직접 사용해 재검증함.
  // Codex QA 지적(2026-09-18): playerId는 더 이상 요청 본문을 신뢰하지 않고 소켓 신원으로 대체, 해당
  // 침입의 owner/viewer 본인만 자기 위치를 보고할 수 있게 제한, 좌표 자체도 updatePosition에서 검증.
  @SubscribeMessage('invasion:move')
  handleMove(@ConnectedSocket() client: Socket, @MessageBody() body: { instanceId: string; targetPlayerId: string; x: number; y: number }) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId) return { ok: false, reason: 'identity-mismatch' };
    const invasion = this.invasions.getInvasion(body.instanceId);
    if (!invasion || (actorId !== invasion.ownerPlayerId && actorId !== invasion.viewerPlayerId)) {
      return { ok: false, reason: 'not-authorized' };
    }

    const accepted = this.invasions.updatePosition(body.instanceId, actorId, body.x, body.y);
    if (!accepted) return { ok: false, reason: 'invalid-position' };

    client.to(baseRoom(invasion.ownerPlayerId)).emit('invasion:position', {
      instanceId: body.instanceId,
      playerId: actorId,
      x: body.x,
      y: body.y,
    });
    return { ok: true };
  }

  // 4.2/6번 확정: 방망이 근접 콜리전 판정은 서버가 마지막으로 받은 두 좌표로 직접 계산(클라이언트 자기신고 불신).
  // Codex QA 지적(2026-09-18): 공격 주체도 소켓 신원으로 검증 — 이 침입의 실제 소유자만 타격 가능.
  @SubscribeMessage('invasion:attack')
  async handleAttack(@ConnectedSocket() client: Socket, @MessageBody() body: { instanceId: string; targetPlayerId: string }) {
    const actorId = this.requireSocketIdentity(client);
    const invasion = this.invasions.getInvasion(body.instanceId);
    if (!actorId || !invasion || actorId !== invasion.ownerPlayerId) {
      return { ok: false, reason: 'not-authorized' };
    }

    const result = this.invasions.tryAttack(body.instanceId);
    if (!result) return { ok: false, reason: 'no-active-invasion' };

    if (result.hit) {
      if (result.captured) {
        await this.players.resetStolenStatus(body.instanceId);
        this.invasions.endInvasion(body.instanceId);
        this.server.to(baseRoom(invasion.ownerPlayerId)).emit('invasion:resolved', {
          instanceId: body.instanceId,
          result: 'failed',
          reason: 'captured',
        });
      } else {
        this.server.to(baseRoom(invasion.ownerPlayerId)).emit('invasion:hit', {
          instanceId: body.instanceId,
          hitCount: result.hitCount,
        });
      }
    }
    return { ok: true, hit: result.hit, hitCount: result.hitCount };
  }

  // 5.1-⑤ 탈출 게이트: 그 시점의 기지 상태(4.4/4.5)로 다시 판정 — 진입 때와 완전히 동일한 규칙 재사용.
  // Codex QA 지적(2026-09-18): 소유권 이전 대상은 요청 본문의 viewerPlayerId가 아니라, 이 침입에
  // 실제로 등록된 viewerPlayerId와 소켓 신원이 일치하는 경우에만 인정한다.
  @SubscribeMessage('invasion:exit')
  async handleExit(@ConnectedSocket() client: Socket, @MessageBody() body: { viewerPlayerId: string; targetPlayerId: string; instanceId: string }) {
    const actorId = this.requireSocketIdentity(client);
    const invasion = this.invasions.getInvasion(body.instanceId);
    if (!invasion) return { ok: false, reason: 'no-active-invasion' };
    if (!actorId || actorId !== invasion.viewerPlayerId) return { ok: false, reason: 'not-authorized' };

    // 서버 권위 탈출 판정(QA 지적 반영) — 출입문 Zone에 실제로 도달했는지 좌표로 재검증.
    // 아직 도달 전이면 침입 상태를 끝내지 않고 그대로 두어 계속 이동해서 재시도할 수 있게 함.
    if (!this.invasions.isNearExit(body.instanceId, actorId)) {
      return { ok: false, reason: 'not-at-exit' };
    }

    // Codex QA 지적(2026-09-18, §3-5) 반영: 잠금상태를 조회할 기지는 요청 본문의 targetPlayerId가
    // 아니라 이 침입에 실제로 등록된 ownerPlayerId여야 함 — 그렇지 않으면 자기 소유의 항상 열린
    // 기지 ID를 targetPlayerId로 흘려보내 실제 소유자의 잠금 상태를 우회할 수 있었음.
    const realOwnerId = invasion.ownerPlayerId;
    const access = await this.players.getBaseAccess(realOwnerId);
    const ownerOnline = this.invasions.isOnline(realOwnerId);
    const allowed = canInvade(access, ownerOnline, actorId);

    this.invasions.endInvasion(body.instanceId);

    if (allowed) {
      await this.players.transferOwnership(body.instanceId, BigInt(actorId));
      this.server.to(baseRoom(realOwnerId)).emit('invasion:resolved', {
        instanceId: body.instanceId,
        result: 'success',
        newOwnerId: actorId,
      });
      client.leave(baseRoom(realOwnerId));
      return { ok: true, result: 'success' };
    }

    await this.players.resetStolenStatus(body.instanceId);
    this.server.to(baseRoom(realOwnerId)).emit('invasion:resolved', {
      instanceId: body.instanceId,
      result: 'failed',
      reason: 'exit-blocked',
    });
    return { ok: true, result: 'failed', reason: 'exit-blocked' };
  }
}
