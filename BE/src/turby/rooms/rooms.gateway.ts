import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import { BattleService } from '../battle/battle.service';
import { RoomError } from './types';
import type { Room } from './types';

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
  ) {}

  onModuleInit() {
    this.rooms.events.on('room:state', (room: Room) => {
      this.server.to(this.rooms.roomChannel(room.code)).emit('room:state', this.rooms.toState(room));
    });
    this.rooms.events.on('wild:changed', (room: Room, wild: { index: number; state: string }) => {
      this.server.to(this.rooms.mapChannel(room)).emit('wild:changed', { index: wild.index, state: wild.state });
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
        returnToVillage: res.returnToVillage, // v15: 오프닝 미완료로 남은 탐험 세션을 닫았다 — 클라이언트는 마을로
        players: res.room && inMap ? this.rooms.snapshotOf(res.room, res.playerId) : [],
        wilds: res.room && inMap ? this.rooms.wildsOf(res.room) : [],
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
  enter(@ConnectedSocket() client: Socket, @MessageBody() body: { x?: unknown; y?: unknown; dir?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      await this.rooms.requireOpening(playerId);
      const { room, self, others, wilds } = this.rooms.enterMap(playerId, body?.x, body?.y, body?.dir);
      await client.join(this.rooms.mapChannel(room));
      // 전투 후 복귀처럼 이미 맵에 있던 사람의 재입장도 joined로 알린다 — 클라이언트는 playerId 기준으로 갱신(upsert)한다
      client.to(this.rooms.mapChannel(room)).emit('map:joined', { player: self });
      return { ok: true as const, self, players: others, wilds };
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
        client.emit('map:correct', { x: result.x, y: result.y });
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
