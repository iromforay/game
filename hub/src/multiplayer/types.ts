// Mirrors BE/src/rooms/types.ts - no shared package between the two yet, so
// keep these two definitions in sync by hand until that's worth extracting.
export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

export type RoomStatus = 'waiting' | 'playing';
export type RoomVisibility = 'public' | 'private';

export interface RoomState {
  roomCode: string;
  players: PlayerInfo[];
  maxPlayers: number;
  status: RoomStatus;
  roundId: number;
  visibility: RoomVisibility;
}

export interface AckResponse {
  ok: boolean;
  state?: RoomState;
  error?: string;
}

export interface ListRoomsResponse {
  ok: boolean;
  rooms?: RoomState[];
}
