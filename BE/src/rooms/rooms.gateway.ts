import { ConnectedSocket, MessageBody, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RoomsService } from './rooms.service';
import type { RoomVisibility, TurnActionPayload, TurnOutcomePayload } from './types';

@WebSocketGateway({ cors: { origin: '*' } })
export class RoomsGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly rooms: RoomsService) {}

  handleDisconnect(client: Socket) {
    const state = this.rooms.leaveRoom(client.id);
    if (state) {
      this.server.to(state.roomCode).emit('roomUpdated', state);
    }
    this.broadcastPublicRooms();
  }

  @SubscribeMessage('listPublicRooms')
  handleListPublicRooms() {
    return { ok: true, rooms: this.rooms.listPublicRooms() };
  }

  @SubscribeMessage('createRoom')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { name: string; maxPlayers?: number; visibility?: RoomVisibility; roundId?: number },
  ) {
    const state = this.rooms.createRoom(client.id, body.name, body.maxPlayers, body.visibility, body.roundId);
    // With the Redis adapter, join() registers the subscription over Redis
    // and returns a Promise - awaiting it matters, otherwise a later
    // room-scoped broadcast (e.g. startGame) can race ahead of the
    // subscription actually being live and never reach this socket.
    await client.join(state.roomCode);
    this.broadcastPublicRooms();
    return { ok: true, state };
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { roomCode: string; name: string }) {
    try {
      const state = this.rooms.joinRoom(body.roomCode.toUpperCase(), client.id, body.name);
      await client.join(state.roomCode);
      this.server.to(state.roomCode).emit('roomUpdated', state);
      this.broadcastPublicRooms();
      return { ok: true, state };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    const state = this.rooms.leaveRoom(client.id);
    if (state) {
      client.to(state.roomCode).emit('roomUpdated', state);
    }
    for (const room of client.rooms) {
      client.leave(room);
    }
    this.broadcastPublicRooms();
    return { ok: true };
  }

  @SubscribeMessage('startGame')
  handleStartGame(@ConnectedSocket() client: Socket, @MessageBody() body?: { roundId?: number }) {
    try {
      const state = this.rooms.startGame(client.id, body?.roundId);
      this.server.to(state.roomCode).emit('gameStarted', state);
      this.broadcastPublicRooms();
      return { ok: true, state };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private broadcastPublicRooms() {
    this.server.emit('publicRoomsUpdated', this.rooms.listPublicRooms());
  }

  @SubscribeMessage('submitAction')
  handleSubmitAction(@ConnectedSocket() client: Socket, @MessageBody() body: TurnActionPayload) {
    try {
      const { room, resolved } = this.rooms.submitAction(client.id, body);
      this.server.to(room.roomCode).emit('actionReceived', {
        playerId: client.id,
        count: room.pendingActions.size,
        total: room.activePlayers.size,
      });
      if (resolved) {
        const { turn, actions } = this.rooms.consumeTurn(room);
        this.server.to(room.roomCode).emit('turnResolved', { turn, actions });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // Pure relay: the host client resolves collisions/scores itself and hands
  // the result here so every other client in the room can adopt it as the
  // single source of truth instead of trusting their own local physics.
  // This is also the room's only "player got eliminated" signal - the host
  // reports activePlayerIds every turn, and BE narrows room.activePlayers
  // from it so submitAction() stops waiting on eliminated players.
  @SubscribeMessage('reportTurnOutcome')
  handleReportTurnOutcome(@ConnectedSocket() client: Socket, @MessageBody() body: TurnOutcomePayload) {
    const room = this.rooms.getRoomByPlayer(client.id);
    if (!room) return { ok: false, error: '참가 중인 방이 없습니다.' };
    this.rooms.setActivePlayers(room, body.activePlayerIds);
    this.server.to(room.roomCode).emit('turnOutcome', body);
    return { ok: true };
  }
}
