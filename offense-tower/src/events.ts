import Phaser from 'phaser';

// Own event bus, independent of tower-defense's, so the two games never
// cross-talk when both are bundled together inside hub.
export const gameEvents = new Phaser.Events.EventEmitter();

export interface ScoreInfo {
  kills: number;
  breakthroughs: number;
  aiGold: number;
}

export const Events = {
  ScoreChanged: 'score-changed',
  CooldownsChanged: 'cooldowns-changed', // Record<UnitType, number> ms remaining
  RequestSpawn: 'request-spawn', // UI -> Game (UnitType)
} as const;
