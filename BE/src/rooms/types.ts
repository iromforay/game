export interface PlayerInfo {
  id: string; // socket id
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
  roundId: number; // selected strategy-marbles round map
  visibility: RoomVisibility;
}

// One player's flick for the current turn cycle - mirrors strategy-marbles'
// GameScene.onPointerUp payload (egg + launch velocity).
export interface TurnActionPayload {
  eggIndex: number; // index into the sender's own alive-egg list
  velocityX: number;
  velocityY: number;
}

// The host client's physics/collision resolution for a turn - BE never reads
// this, it just relays host -> everyone else in the room (see
// RoomsGateway.handleReportTurnOutcome). Shape mirrors strategy-marbles'
// TurnOutcomePayload (src/network.ts) exactly.
export interface TurnOutcomePayload {
  turn: number;
  scores: Record<string, number>; // playerId -> authoritative total score
  eggs: Array<{ playerIndex: number; eggIndex: number; x: number; y: number; eliminated: boolean }>;
}
