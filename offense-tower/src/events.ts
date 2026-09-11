import Phaser from 'phaser';

// Own event bus, independent of tower-defense's, so the two games never
// cross-talk when both are bundled together inside hub.
export const gameEvents = new Phaser.Events.EventEmitter();

export interface ScoreInfo {
  kills: number;
  breakthroughs: number;
  unitBreakthroughs: number; // excludes the hero - this is what counts toward the clear goal
  goal: number;
  roundName: string;
  aiGold: number;
}

export interface ClearInfo {
  reward: number;
  totalCoins: number;
}

export const Events = {
  ScoreChanged: 'score-changed',
  CooldownsChanged: 'cooldowns-changed', // Record<UnitType, number> ms remaining
  HeroStateChanged: 'hero-state-changed', // HeroState
  HeroInfoChanged: 'hero-info-changed', // HeroInfo - the resolved hero's display data (loaded async, so UI starts with a placeholder)
  GameCleared: 'game-cleared', // ClearInfo
  RequestSpawn: 'request-spawn', // UI -> Game (UnitType)
  RequestSpawnHero: 'request-spawn-hero', // UI -> Game
} as const;

export interface HeroState {
  // locked: no unit has reached the unlock checkpoint yet
  // used: the one-time summon has already been spent
  locked: boolean;
  used: boolean;
}

export interface HeroInfo {
  name: string;
  color: number;
}
