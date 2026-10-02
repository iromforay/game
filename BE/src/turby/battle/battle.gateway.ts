import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { RoomsService } from '../rooms/rooms.service';
import { RoomError } from '../rooms/types';
import { BattleService } from './battle.service';
import type { BattleResponse } from './battle.service';
import { BattleError } from './battle-types';
import type { BattleState } from './battle-types';
import { toSnapshot } from './battle-engine';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string; reason?: string; snapshot?: unknown };

// 4-B: 서버 전투 게이트웨이. 클라이언트는 의도(start/party/action)만 보내고 서버가 만든 상태(snapshot·events)를 그린다.
// 같은 turby-be 프로세스(3002)의 소켓 서버를 RoomsGateway와 공유한다.
@WebSocketGateway({ cors: { origin: '*' } })
export class BattleGateway implements OnModuleInit {
  @WebSocketServer()
  server!: Server;
  private readonly log = new Logger(BattleGateway.name);

  constructor(
    private readonly battles: BattleService,
    private readonly rooms: RoomsService,
  ) {}

  onModuleInit() {
    // 초대: 같은 방에서 맵에 있는 사람들에게 조우 소식과 현재 전투 상태를 보낸다
    this.battles.events.on('battle:invite', (state: BattleState, inviteeIds: string[]) => {
      for (const id of inviteeIds) {
        const socketId = this.rooms.socketIdOf(id);
        if (socketId) this.server.to(socketId).emit('battle:invite', { battleId: state.battleId, snapshot: toSnapshot(state) });
      }
    });
    // 참전자에게 상태 변화를 알린다. 요청한 본인은 ack로 이미 받으므로 제외(서버가 스스로 일으킨 변화는 전원에게).
    this.battles.events.on('battle:update', (state: BattleState, response: BattleResponse, actorPlayerId: string | null) => {
      for (const p of state.participants) {
        if (p.playerId === actorPlayerId) continue;
        // 빠진 사람(거절·시간 초과·이탈)에게는 자기가 빠졌다는 알림까지만 보낸다
        const droppedNow = response.events.some((e) => e.type === 'participant_left' && e.playerId === p.playerId);
        if (!p.active && !droppedNow) continue;
        const socketId = this.rooms.socketIdOf(p.playerId);
        if (socketId) this.server.to(socketId).emit('battle:update', { battleId: state.battleId, ...response });
      }
    });
  }

  @SubscribeMessage('battle:start')
  start(@ConnectedSocket() client: Socket, @MessageBody() body: { spawnIndex?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, snapshot: await this.battles.start(playerId, body?.spawnIndex) };
    });
  }

  // M4-B: 스토리 전투 시작(탐험 세션 안). 시작 가능 여부·이야기 누비는 서버가 확인한다
  @SubscribeMessage('battle:story:start')
  startStory(@ConnectedSocket() client: Socket, @MessageBody() body: { encounterKey?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, snapshot: await this.battles.startStory(playerId, body?.encounterKey) };
    });
  }

  @SubscribeMessage('battle:respond')
  respond(@ConnectedSocket() client: Socket, @MessageBody() body: { battleId?: unknown; join?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, ...(await this.battles.respond(playerId, body?.battleId, body?.join)) };
    });
  }

  @SubscribeMessage('battle:party')
  party(@ConnectedSocket() client: Socket, @MessageBody() body: { battleId?: unknown; turbyIds?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, ...(await this.battles.party(playerId, body?.battleId, body?.turbyIds)) };
    });
  }

  @SubscribeMessage('battle:action')
  action(@ConnectedSocket() client: Socket, @MessageBody() body: Record<string, unknown>) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, ...(await this.battles.action(playerId, body ?? {})) };
    });
  }

  @SubscribeMessage('battle:leave')
  leave(@ConnectedSocket() client: Socket, @MessageBody() body: { battleId?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, ...(await this.battles.leave(playerId, body?.battleId)) };
    });
  }

  @SubscribeMessage('battle:snapshot')
  snapshot(@ConnectedSocket() client: Socket, @MessageBody() body: { battleId?: unknown }) {
    return this.guard(async () => {
      const playerId = this.rooms.playerOf(client.id);
      return { ok: true as const, ...(await this.battles.snapshot(playerId, body?.battleId)) };
    });
  }

  private async guard(run: () => Promise<Ack>): Promise<Ack> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof BattleError) return { ok: false, code: err.code, message: err.message, ...(err.reason ? { reason: err.reason } : {}), ...(err.snapshot ? { snapshot: err.snapshot } : {}) };
      if (err instanceof RoomError) return { ok: false, code: err.code, message: err.message };
      this.log.error(err);
      return { ok: false, code: 'INTERNAL', message: '서버 오류가 발생했습니다.' };
    }
  }
}
