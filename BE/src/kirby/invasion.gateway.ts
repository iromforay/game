import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DEFENSE_MS, InvasionService } from './invasion.service';
import { PlayerService } from './player.service';
import { canInvade } from './baseAccess';

function baseRoom(targetPlayerId: string) {
  return `kirby-base:${targetPlayerId}`;
}

// 마을(로비) 앰비언트 프레즌스 — 사용자 지적(2026-09-18) 반영: 로비에 같이 있는 다른 접속자의
// 캐릭터가 실시간으로 안 보이던 것(기존엔 아예 구현이 없었음)을 위한 전용 room.
const LOBBY_ROOM = 'kirby-lobby';

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
    const { playerId, wentOffline } = result;
    // 코덱스 지적(2026-09-21): 같은 플레이어가 다른 탭/기기로 소켓을 여러 개 열어둔 상태에서 그중
    // 하나만 닫혀도 이 핸들러가 호출됨 — wentOffline(모든 소켓이 닫혔을 때만 true)을 무시하고 무조건
    // 오프라인 처리하면, 다른 탭은 계속 켜져 있는데 로비 아바타가 지워지거나 진행 중이던 침입이
    // "뷰어가 끊겼다"고 오판되어 잘못 실패 처리되는 문제가 있었음.
    if (!wentOffline) return;

    // 로비에 있던 상태로 연결이 끊기면 다른 사람 화면에서도 캐릭터가 사라져야 함
    this.invasions.removeLobbyPosition(playerId);
    this.invasions.clearEmoteState(playerId);
    this.server.to(LOBBY_ROOM).emit('lobby:left', { playerId });

    // 이 플레이어가 침입자(viewer)로 진행 중이던 침입은 연결 종료로 실패 처리(붙잡을 사람이 사라졌으므로 안전하게 반환)
    for (const invasion of this.invasions.findInvasionsInvolving(playerId)) {
      if (invasion.viewerPlayerId === playerId) {
        // 후처리 실패가 게이트웨이 전체(프로세스)를 죽이지 않도록 방어 — 침입 정리는 반드시 끝까지 진행
        await this.players.resetStolenStatus(invasion.instanceId).catch(() => undefined);
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
  // 사용자 요청(2026-09-28): 로비 기지 이름표를 "#playerId" 대신 "닉네임의 기지"로 — 닉네임을 함께 내려준다
  // (예전 클라이언트 호환을 위해 playerIds는 유지하고 players를 추가)
  @SubscribeMessage('base:listOnline')
  async handleListOnline(@MessageBody() body: { excludingPlayerId?: string }) {
    const playerIds = this.invasions.listOnlinePlayerIds(body?.excludingPlayerId);
    const nicknames = await this.players.getNicknames(playerIds).catch(() => new Map<string, string>());
    return { ok: true, playerIds, players: playerIds.map((playerId) => ({ playerId, nickname: nicknames.get(playerId) ?? null })) };
  }

  // 마을(로비) 앰비언트 프레즌스 — 사용자 지적(2026-09-18): 로비에서 다른 접속자의 캐릭터가
  // 안 보이던 문제. LobbyScene 진입 시 호출 — room에 join하고, 이미 로비에 있던 사람들 좌표를 즉시 돌려줌.
  @SubscribeMessage('lobby:enter')
  async handleLobbyEnter(@ConnectedSocket() client: Socket, @MessageBody() body: { x?: number; y?: number }) {
    try {
      const actorId = this.requireSocketIdentity(client);
      if (!actorId) return { ok: false, reason: 'identity-mismatch' };
      const x = Number.isFinite(body?.x) ? body.x! : 640;
      const y = Number.isFinite(body?.y) ? body.y! : 620;
      const players = this.invasions.listLobbyPositions(actorId);
      await client.join(LOBBY_ROOM);
      this.invasions.setLobbyPosition(actorId, x, y);
      // 기존 접속자는 후발 접속자가 움직이기 전에도 즉시 생성한다.
      client.to(LOBBY_ROOM).emit('lobby:position', { playerId: actorId, x, y });
      return { ok: true, players };
    } catch (err) {
      // 사용자 지적(2026-09-23): 실제 브라우저 클라이언트에서 이 이벤트의 ack가 전혀 안 오는
      // 현상 진단용 — 원인 불문 항상 ack는 나가게 하고 에러 내용을 그대로 클라이언트에 노출한다.
      return { ok: false, reason: 'exception', message: err instanceof Error ? err.message : String(err) };
    }
  }

  // LobbyScene이 다른 씬으로 전환될 때(shutdown) 호출 — 다른 사람 화면에서 캐릭터를 지워줌
  @SubscribeMessage('lobby:leave')
  handleLobbyLeave(@ConnectedSocket() client: Socket) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId) return { ok: false, reason: 'identity-mismatch' };
    this.invasions.removeLobbyPosition(actorId);
    client.leave(LOBBY_ROOM);
    client.to(LOBBY_ROOM).emit('lobby:left', { playerId: actorId });
    return { ok: true };
  }

  // 로비 이동 브로드캐스트 — 침입 중 위치(invasion:move)와 달리 순수 연출용이라 속도/범위 검증은
  // 최소한(유한수인지)만 하고, 명중판정처럼 서버 권위가 필요한 값이 아니므로 그대로 중계한다.
  @SubscribeMessage('lobby:move')
  handleLobbyMove(@ConnectedSocket() client: Socket, @MessageBody() body: { x: number; y: number }) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId) return { ok: false, reason: 'identity-mismatch' };
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) return { ok: false, reason: 'invalid-position' };

    this.invasions.setLobbyPosition(actorId, body.x, body.y);
    client.to(LOBBY_ROOM).emit('lobby:position', { playerId: actorId, x: body.x, y: body.y });
    return { ok: true };
  }

  // 로비 이모트 — 발신자는 소켓 신원으로만 확정(본문 playerId 불신), 로비 room 소속일 때만 허용, 종류는 화이트리스트, 빈도 제한.
  // 저장·과거 재생 없이 현재 로비에 있는 다른 접속자에게만 1회 전달한다.
  @SubscribeMessage('lobby:emote')
  handleLobbyEmote(@ConnectedSocket() client: Socket, @MessageBody() body: { emote?: string }) {
    const actorId = this.requireSocketIdentity(client);
    if (!actorId) return { ok: false, reason: 'identity-mismatch' };
    if (!client.rooms.has(LOBBY_ROOM)) return { ok: false, reason: 'not-in-lobby' };
    if (body?.emote !== 'happy') return { ok: false, reason: 'invalid-emote' };
    if (!this.invasions.tryEmote(actorId)) return { ok: false, reason: 'rate-limited' };

    client.to(LOBBY_ROOM).emit('lobby:emote', { playerId: actorId, emote: 'happy' });
    return { ok: true };
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
      defenseRemainingMs: DEFENSE_MS,
    });
    return { ok: true, defenseRemainingMs: DEFENSE_MS };
  }

  // 방어 카운트다운(2026-09-28) — 방어/도주 화면이 열릴 때 남은 방어 시간을 묻는다(방어자가 나중에 들어와도 맞게).
  // 서버 기준 남은 ms를 돌려주고 클라이언트는 자기 시계로 카운트다운(시계 차이 영향 없음). 이 침입의 당사자만 조회 가능.
  @SubscribeMessage('invasion:status')
  handleStatus(@ConnectedSocket() client: Socket, @MessageBody() body: { instanceId: string }) {
    const actorId = this.requireSocketIdentity(client);
    const invasion = this.invasions.getInvasion(body?.instanceId);
    if (!actorId || !invasion || (actorId !== invasion.ownerPlayerId && actorId !== invasion.viewerPlayerId)) {
      return { ok: false, reason: 'not-authorized' };
    }
    return { ok: true, defenseRemainingMs: this.invasions.defenseRemainingMs(body.instanceId) };
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
    // 방어가 풀린 뒤에는 공격 불가(사용자 결정 2026-09-28)
    if (this.invasions.defenseRemainingMs(body.instanceId) === 0) return { ok: false, reason: 'defense-over' };

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
    if (!this.invasions.isEscapeReady(body.instanceId, actorId)) {
      return { ok: false, reason: 'escape-not-ready' };
    }

    // Codex QA 지적(2026-09-18, §3-5) 반영: 잠금상태를 조회할 기지는 요청 본문의 targetPlayerId가
    // 아니라 이 침입에 실제로 등록된 ownerPlayerId여야 함 — 그렇지 않으면 자기 소유의 항상 열린
    // 기지 ID를 targetPlayerId로 흘려보내 실제 소유자의 잠금 상태를 우회할 수 있었음.
    const realOwnerId = invasion.ownerPlayerId;
    const access = await this.players.getBaseAccess(realOwnerId);
    const ownerOnline = this.invasions.isOnline(realOwnerId);
    const allowed = canInvade(access, ownerOnline, actorId);

    if (allowed) {
      this.invasions.endInvasion(body.instanceId);
      await this.players.transferOwnership(body.instanceId, BigInt(actorId));
      this.server.to(baseRoom(realOwnerId)).emit('invasion:resolved', {
        instanceId: body.instanceId,
        result: 'success',
        newOwnerId: actorId,
      });
      client.leave(baseRoom(realOwnerId));
      return { ok: true, result: 'success' };
    }

    // 침입 뒤 문이 잠긴 경우 일반 방문자는 나갈 수 있지만, 커비를 든 침입자는 탈출할 수 없다.
    // 침입/운반 상태는 유지해 문이 다시 열리거나 방어자에게 붙잡힐 때까지 계속 진행한다.
    return { ok: false, reason: 'locked' };
  }

  // 도주 중 로비 이동을 선택하면 훔치기를 포기한 것으로 처리한다. 클라이언트 화면만
  // 바꾸지 않고 서버의 운반 상태까지 끝내 원소유자의 커비가 즉시 복구되게 한다.
  @SubscribeMessage('invasion:cancel')
  async handleCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { viewerPlayerId: string; targetPlayerId: string; instanceId: string },
  ) {
    const actorId = this.requireSocketIdentity(client);
    const invasion = this.invasions.getInvasion(body.instanceId);
    if (!actorId || !invasion || actorId !== invasion.viewerPlayerId) {
      return { ok: false, reason: 'not-authorized' };
    }

    await this.players.resetStolenStatus(body.instanceId);
    this.invasions.endInvasion(body.instanceId);
    this.server.to(baseRoom(invasion.ownerPlayerId)).emit('invasion:resolved', {
      instanceId: body.instanceId,
      result: 'failed',
      reason: 'abandoned',
    });
    client.leave(baseRoom(invasion.ownerPlayerId));
    return { ok: true };
  }
}
