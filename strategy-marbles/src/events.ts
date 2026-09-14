import Phaser from 'phaser';

// Shared event bus so GameScene and UIScene can talk without tight coupling.
export const gameEvents = new Phaser.Events.EventEmitter();

export interface ScoreEntry {
  playerIndex: number;
  score: number;
  eggsAlive: number;
}

export interface TurnInfo {
  turn: number;
  maxTurns: number;
  activePlayerIndex: number | null;
  // 'waiting' = network mode only: this client already submitted its flick
  // for the turn and is waiting on the other players' submissions.
  // 'eliminated' = network mode only: this client's own eggs are all gone;
  // it just spectates the rest of the match instead of being prompted.
  phase: 'aiming' | 'waiting' | 'resolving' | 'ended' | 'eliminated';
}

export interface GameOverInfo {
  scores: ScoreEntry[];
  winnerIndexes: number[];
}

export interface MapInfo {
  name: string;
  floorFriction: number;
}

export const Events = {
  TurnChanged: 'turn-changed', // Game -> UI (TurnInfo)
  TimerTick: 'timer-tick', // Game -> UI (secondsLeft: number)
  ScoreChanged: 'score-changed', // Game -> UI (ScoreEntry[])
  MapChanged: 'map-changed', // Game -> UI (MapInfo)
  GameOver: 'game-over', // Game -> UI (GameOverInfo)
  RequestRestart: 'request-restart', // UI -> Game
  // Player nicknames, index = playerIndex; emitted once at game start so the
  // UI can show real names instead of "Player N" (local hotseat mode never
  // fires this, so the UI must fall back to "Player N" until it does).
  PlayersChanged: 'players-changed', // Game -> UI (string[])
} as const;
