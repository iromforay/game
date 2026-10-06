import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import { BattleService } from '../battle/battle.service';
import { StoryService } from '../story/story.service';
import { RoomError } from './types';
import type { Room, WildRuntime } from './types';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string };

// 4-A: 방·맵 위치 동기화 게이트웨이. 기존 REST 컨트롤러와 같은 turby-be 프로세스(3002)에서 동작하고,
// 알까기 rooms 게이트웨이와는 별도 프로세스라 서로 영향이 없다(3.5.3).
@WebSocketGateway({ cors: { origin: '*' } })
export class RoomsGateway implements OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;
  private readonly log = new Logger(RoomsGateway.name);

  constructor(
    private readonly rooms: RoomsService,
    private readonly battles: BattleService,
    private readonly story: StoryService,
  ) {}

  onModuleInit() {
    this.rooms.events.on('room:state', (room: Room) => {
      this.server.to(this.rooms.roomChannel(room.code)).emit('room:state', this.rooms.toState(room));
    });
    // 상태 갱신도 같은 마커 ID·서버 좌표를 싣는다. 플레이어마다 공개 여부가 달라서 맵 안의 사람에게 따로 보낸다(숨겨진 야생은 보내지 않는다 — 10-06 v1 §2)
    this.rooms.events.on('wild:changed', (room: Room, wild: WildRuntime) => {
      for (const m of room.members) {
        if (m.inMap && m.socketId && this.rooms.wildVisibleTo(room, m.playerId, wild)) this.server.to(m.socketId).emit('wild:changed', this.rooms.toWildDto(wild));
      }
    });
    // 구역이 열려 새로 보이게 된 야생: 같은 이벤트로 알린다(클라이언트는 모르는 마커면 새로 만든다)
    this.rooms.events.on('wild:revealed', (room: Room, playerId: string, wild: WildRuntime) => {
      const m = room.members.find((x) => x.playerId === playerId);
      if (m?.inMap && m.socketId) this.server.to(m.socketId).emit('wild:changed', this.rooms.toWildDto(wild));
    });
    // 이탈(퇴장·재접속 유예 만료)은 같은 맵에 있던 사람들에게 유령이 남지 않도록 알린다
    this.rooms.events.on('member:removed', (room: Room, playerId: string, wasInMap: boolean, reason: string) => {
      if (wasInMap) this.server.to(this.rooms.mapChannel(room)).emit('map:left', { playerId, reason });
    });
  }

  handleDisconnect(client: Socket) {
    this.rooms.disconnect(client.id);
  }

  @SubscribeMessage('presence:hello')
  hello(@ConnectedSocket() client: Socket, @MessageBody() body: { deviceUuid?: unknown; sessionToken?: unknown }) {
    return this.guard(async () => {
      const res = await this.rooms.identify(client.id, body?.deviceUuid, body?.sessionToken);
      if (res.previousSocketId) {
        // 같은 플레이어가 다른 탭/기기로 다시 접속 — 이전 소켓은 밀어낸다(방 세션은 새 소켓이 이어받음)
        const old = this.server.sockets.sockets.get(res.previousSocketId);
        old?.emit('presence:replaced');
        old?.disconnect(true);
      }
      let inMap = false;
      if (res.room) {
        await client.join(this.rooms.roomChannel(res.room.code));
        inMap = this.rooms.isInMap(res.room, res.playerId);
        if (inMap) await client.join(this.rooms.mapChannel(res.room));
      }
      return {
        ok: true as const,
        playerId: res.playerId,
        nickname: res.nickname,
        room: res.room ? this.rooms.toState(res.room) : null,
        inMap, // 10-02 v5: 이어받은 탐험 세션에서 맵 안에 있었는가(새로고침한 클라이언트가 Map 화면으로 복원할 근거)
        returnToVillage: res.returnToVillage, // v15: 오프닝 미완료로 남은 탐험 세션을 닫았다 — 클라이언트는 마을로
        returnReason: res.returnReason, // 차단 사유 코드(OPENING_REQUIRED)로 통일
        players: res.room && inMap ? this.rooms.snapshotOf(res.room, res.playerId) : [],
        wilds: res.room && inMap ? this.rooms.wildsFor(res.room, res.playerId) : [],
        encounterRadiusPx: this.rooms.encounterRadiusPx(), // 10-06 v1 §3: 조우 반경의 유일한 출처(서버 설정). 클라이언트는 이 값으로 자동 조우를 요청한다
        battle: await this.battles.activeSnapshotOf(res.playerId), // 새로고침·재접속 시 진행 중 전투를 이어받는다
      };
    });
  }

  @SubscribeMessage('room:create')
  create(@ConnectedSocket() client: Socket, @MessageBody() body: { stageCode?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      const room = await this.rooms.createRoom(playerId, body?.stageCode);
      await client.join(this.rooms.roomChannel(room.code));
      return { ok: true as const, room: this.rooms.toState(room) };
    });
  }

  @SubscribeMessage('room:leave')
  leave(@ConnectedSocket() client: Socket) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      const room = this.rooms.roomOf(playerId);
      this.rooms.leaveRoom(playerId);
      if (room) {
        await client.leave(this.rooms.roomChannel(room.code));
        await client.leave(this.rooms.mapChannel(room));
      }
      return { ok: true as const };
    });
  }

  @SubscribeMessage('room:start')
  start(@ConnectedSocket() client: Socket) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      await this.rooms.requireOpening(playerId);
      const room = this.rooms.startRoom(playerId);
      return { ok: true as const, room: this.rooms.toState(room) };
    });
  }

  @SubscribeMessage('map:enter')
  enter(@ConnectedSocket() client: Socket, @MessageBody() body: { dir?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      await this.rooms.requireOpening(playerId);
      // 위치는 서버가 정한다(요청의 x·y는 읽지 않는다). self = 서버가 확정한 위치, corrected = 저장돼 있던 위치를 시작 지점으로 보정했는가
      const { room, self, corrected, others, wilds, encounterRadiusPx } = await this.rooms.enterMap(playerId, body?.dir);
      await client.join(this.rooms.mapChannel(room));
      // 전투 후 복귀처럼 이미 맵에 있던 사람의 재입장도 joined로 알린다 — 클라이언트는 playerId 기준으로 갱신(upsert)한다
      client.to(this.rooms.mapChannel(room)).emit('map:joined', { player: self });
      // M4-C: 지역 진입 트리거(숲 첫 진입 → 1장 시작 기록)와 재생할 이야기 구간. 이야기 처리 실패가 맵 입장을 막지는 않는다
      const story = await this.story.onStageEntered(BigInt(playerId), room.stageCode).catch((err: unknown) => {
        this.log.warn(`story trigger on map:enter failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      return { ok: true as const, self, corrected, players: others, wilds, encounterRadiusPx, story: story ? { play: story.play, delivery: story.story.delivery } : null };
    });
  }

  @SubscribeMessage('map:move')
  move(@ConnectedSocket() client: Socket, @MessageBody() body: { x?: unknown; y?: unknown; dir?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      const { room, result } = this.rooms.move(playerId, body?.x, body?.y, body?.dir);
      if (result.kind === 'ok') {
        client.to(this.rooms.mapChannel(room)).emit('map:moved', { playerId, x: result.x, y: result.y, dir: result.dir });
      } else if (result.kind === 'corrected') {
        client.emit('map:correct', { x: result.x, y: result.y, reason: result.reason });
      }
      return undefined; // 이동은 빈도가 높아 성공 시 응답을 보내지 않는다
    });
  }

  private async guard(run: () => Promise<Ack | undefined>): Promise<Ack | undefined> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof RoomError) return { ok: false, code: err.code, message: err.message };
      this.log.error(err);
      return { ok: false, code: 'INTERNAL', message: '서버 오류가 발생했습니다.' };
    }
  }
}
