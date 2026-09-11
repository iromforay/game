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
  phase: 'aiming' | 'waiting' | 'resolving' | 'ended';
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
} as const;
