import { Injectable } from '@nestjs/common';
import type { PlayerInfo, RoomState, RoomVisibility, TurnActionPayload } from './types';

export interface InternalRoom extends RoomState {
  pendingActions: Map<string, TurnActionPayload>;
  turnNumber: number;
}

// Ambiguous characters (0/O, 1/I) left out so a room code is easy to read aloud.
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9;
const DEFAULT_PLAYERS = 4;

@Injectable()
export class RoomsService {
  private rooms = new Map<string, InternalRoom>();
  private playerRoom = new Map<string, string>(); // socketId -> roomCode

  createRoom(
    hostId: string,
    hostName: string,
    maxPlayers?: number,
    visibility: RoomVisibility = 'private',
    roundId = 1,
  ): RoomState {
    const roomCode = this.generateRoomCode();
    const room: InternalRoom = {
      roomCode,
      players: [{ id: hostId, name: hostName, isHost: true }],
      maxPlayers: this.clampMaxPlayers(maxPlayers),
      status: 'waiting',
      roundId,
      visibility,
      pendingActions: new Map(),
      turnNumber: 1,
    };
    this.rooms.set(roomCode, room);
    this.playerRoom.set(hostId, roomCode);
    return this.toState(room);
  }

  private clampMaxPlayers(value?: number): number {
    if (value === undefined || Number.isNaN(value)) return DEFAULT_PLAYERS;
    return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(value)));
  }

  // Public, still-joinable rooms - for the lobby's browsable room list.
  listPublicRooms(): RoomState[] {
    return [...this.rooms.values()]
      .filter((room) => room.visibility === 'public' && room.status === 'waiting')
      .map((room) => this.toState(room));
  }

  joinRoom(roomCode: string, playerId: string, playerName: string): RoomState {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('방을 찾을 수 없습니다.');
    if (room.status !== 'waiting') throw new Error('이미 시작된 게임입니다.');
    if (room.players.some((p) => p.id === playerId)) return this.toState(room);
    if (room.players.length >= room.maxPlayers) throw new Error('방이 가득 찼습니다.');

    room.players.push({ id: playerId, name: playerName, isHost: false });
    this.playerRoom.set(playerId, roomCode);
    return this.toState(room);
  }

  leaveRoom(playerId: string): RoomState | null {
    const roomCode = this.playerRoom.get(playerId);
    if (!roomCode) return null;
    const room = this.rooms.get(roomCode);
    this.playerRoom.delete(playerId);
    if (!room) return null;

    room.players = room.players.filter((p) => p.id !== playerId);
    room.pendingActions.delete(playerId);

    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      return null;
    }
    if (!room.players.some((p) => p.isHost)) {
      room.players[0].isHost = true;
    }
    return this.toState(room);
  }

  getRoomByPlayer(playerId: string): InternalRoom | undefined {
    const roomCode = this.playerRoom.get(playerId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  startGame(playerId: string, roundId?: number): RoomState {
    const room = this.requireRoomAsHost(playerId);
    room.status = 'playing';
    room.turnNumber = 1;
    room.pendingActions.clear();
    if (roundId !== undefined) room.roundId = roundId;
    return this.toState(room);
  }

  submitAction(playerId: string, action: TurnActionPayload): { room: InternalRoom; resolved: boolean } {
    const room = this.getRoomByPlayer(playerId);
    if (!room) throw new Error('참가 중인 방이 없습니다.');
    if (room.status !== 'playing') throw new Error('게임이 진행 중이 아닙니다.');

    room.pendingActions.set(playerId, action);
    const resolved = room.pendingActions.size >= room.players.length;
    return { room, resolved };
  }

  // Drains the pending actions for a turn once every player has submitted,
  // returning what should be broadcast so every client resolves identically.
  consumeTurn(room: InternalRoom): { turn: number; actions: Record<string, TurnActionPayload> } {
    const actions = Object.fromEntries(room.pendingActions);
    const turn = room.turnNumber;
    room.pendingActions.clear();
    room.turnNumber += 1;
    return { turn, actions };
  }

  private requireRoomAsHost(playerId: string): InternalRoom {
    const room = this.getRoomByPlayer(playerId);
    if (!room) throw new Error('참가 중인 방이 없습니다.');
    const player = room.players.find((p) => p.id === playerId);
    if (!player?.isHost) throw new Error('방장만 게임을 시작할 수 있습니다.');
    return room;
  }

  private generateRoomCode(): string {
    let code: string;
    do {
      code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)],
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  private toState(room: InternalRoom): RoomState {
    return {
      roomCode: room.roomCode,
      players: room.players,
      maxPlayers: room.maxPlayers,
      status: room.status,
      roundId: room.roundId,
      visibility: room.visibility,
    };
  }
}

export type { PlayerInfo };
