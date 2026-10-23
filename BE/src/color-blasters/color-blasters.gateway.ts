import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ColorBlastersService } from './color-blasters.service';
import { COLOR_BLASTERS_EVENTS, type BattlePosition, type BattleVector3 } from './color-blasters.types';

@WebSocketGateway({ cors: { origin: '*' } })
export class ColorBlastersGateway implements OnGatewayDisconnect {
  @WebSocketServer() private server!: Server;

  constructor(private readonly battles: ColorBlastersService) {}

  @SubscribeMessage(COLOR_BLASTERS_EVENTS.queueJoin)
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { playerId?: unknown }) {
    const playerId = typeof body?.playerId === 'string' ? body.playerId.trim().slice(0, 40) : '';
    if (!playerId) return { ok: false, error: 'PLAYER_ID_REQUIRED' };
    const result = this.battles.joinQueue(playerId, client.id);
    if (result.status === 'matched') {
      for (const player of result.match.players) {
        const socket = this.server.sockets.sockets.get(player.socketId);
        await socket?.join(result.match.matchId);
        socket?.emit(COLOR_BLASTERS_EVENTS.matchFound, result.match);
      }
    }
    return { ok: true, status: result.status };
  }

  @SubscribeMessage(COLOR_BLASTERS_EVENTS.move)
  move(@ConnectedSocket() client: Socket, @MessageBody() body: BattlePosition) {
    return this.run(client, () => {
      const state = this.battles.move(client.id, body);
      client.to(state.matchId).emit(COLOR_BLASTERS_EVENTS.state, state);
      return { ok: true };
    });
  }

  @SubscribeMessage(COLOR_BLASTERS_EVENTS.fire)
  fire(@ConnectedSocket() client: Socket, @MessageBody() body: { origin: BattleVector3; direction: BattleVector3 }) {
    return this.run(client, () => {
      const update = this.battles.fire(client.id, body?.origin, body?.direction);
      this.server.to(update.state.matchId).emit(COLOR_BLASTERS_EVENTS.state, update.state);
      if (update.result) this.server.to(update.state.matchId).emit(COLOR_BLASTERS_EVENTS.result, update.result);
      return { ok: true };
    });
  }

  @SubscribeMessage(COLOR_BLASTERS_EVENTS.queueLeave)
  leave(@ConnectedSocket() client: Socket) {
    this.disconnect(client.id);
    return { ok: true };
  }

  handleDisconnect(client: Socket) { this.disconnect(client.id); }

  private disconnect(socketId: string) {
    const result = this.battles.leave(socketId);
    if (result) this.server.to(result.survivorSocketId).emit(COLOR_BLASTERS_EVENTS.result, { winnerId: result.winnerId, reason: 'opponent-left' });
  }

  private run(client: Socket, action: () => { ok: true }) {
    try {
      return action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      client.emit(COLOR_BLASTERS_EVENTS.error, { message });
      return { ok: false, error: message };
    }
  }
}
