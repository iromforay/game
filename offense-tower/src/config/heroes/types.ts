import type { EnemyDef } from 'tower-defense';

export type HeroId = 'vanguard';

// Runtime shape used by game code - color is a resolved 0xRRGGBB number,
// ready for Phaser.
export interface HeroDef extends EnemyDef {
  id: HeroId;
  name: string;
  description: string;
  resistance: number; // flat damage multiplier vs every tower type (no rock-paper-scissors weakness)
  attackRange: number; // px - towers within this range get attacked as the hero walks past
  attackDamage: number;
  attackRate: number; // ms between hero attacks
}

// On-disk/wire shape - color is a "#rrggbb" string so the JSON stays human
// editable. The loader converts this to HeroDef.
export interface HeroJson extends Omit<HeroDef, 'color'> {
  color: string;
}
