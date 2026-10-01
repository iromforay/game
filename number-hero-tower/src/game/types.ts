export type RouteWidth = 'wide' | 'tight' | 'general';
export type RunPhase = 'traveling' | 'choosing' | 'battling' | 'revealing' | 'dragon' | 'cleared' | 'failed';

export interface StageConfig {
  id: number;
  title: string;
  theme: string;
  bossName: string;
  bossKind: 'block' | 'robot' | 'snack';
  startPower: number;
  floorCount: number;
  bossAttack: number;
  bossReward: number;
  rewardMin: number;
  rewardMax: number;
  attackBase: number;
  attackStep: number;
  seed: number;
  accent: string;
}

export interface EnemyChoice {
  id: string;
  attack: number;
  reward: number;
  routeWidth: RouteWidth;
  nextChoiceCount: number;
  archetype: 'block' | 'robot' | 'snack';
}

export type PublicEnemyChoice = Omit<EnemyChoice, 'reward' | 'nextChoiceCount'>;

export interface HistoryEntry {
  floor: number;
  attack: number;
  reward: number;
  routeWidth: RouteWidth;
  heroPowerAfter: number;
}

export interface ScoreUpdate {
  stageId: number;
  currentScore: number;
  floorsCleared: number;
  cleared: boolean;
}
