// Structural subset of socket.io-client's Socket - strategy-marbles stays
// decoupled from that library and just accepts anything shaped like this
// (the hub hands in its real socket.io Socket instance, which satisfies it).
export interface NetworkSocket {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener?: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

// One player's flick for the current turn cycle - mirrors BE's
// TurnActionPayload (BE/src/rooms/types.ts) exactly, since it's relayed
// through the server untouched.
export interface TurnActionPayload {
  eggIndex: number;
  velocityX: number;
  velocityY: number;
}

// The host client's authoritative collision/elimination/score resolution for
// a turn, broadcast to every other client so they don't rely on their own
// (potentially slightly divergent) local physics for scoring - only for the
// visual motion. eggIndex is positional, against each player's alive-egg
// list as it stood entering this turn (before this turn's eliminations).
export interface EggOutcome {
  playerIndex: number;
  eggIndex: number;
  x: number;
  y: number;
  eliminated: boolean;
}

export interface TurnOutcomePayload {
  turn: number;
  scores: Record<string, number>; // playerId -> authoritative total score
  eggs: EggOutcome[];
}

export interface NetworkOptions {
  socket: NetworkSocket;
  selfId: string;
  // Ordered by join order (host first) - index into this array is the local
  // player index used throughout GameScene.
  playerIds: string[];
  roomCode: string;
  // Only the room's host resolves collisions/scores authoritatively and
  // reports the outcome; everyone else adopts it instead of trusting their
  // own local physics for anything but the between-submit animation.
  isHost: boolean;
}
