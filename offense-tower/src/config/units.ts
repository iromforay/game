import type { EnemyDef, TowerType } from 'tower-defense';

export type UnitType = 'swarm' | 'tank' | 'speed';

export interface UnitDef extends EnemyDef {
  id: UnitType;
  name: string;
  spawnCooldown: number; // ms between spawns of this unit type
  resistantTo: TowerType; // takes reduced damage from this tower type
  vulnerableTo: TowerType; // takes increased damage from this tower type
}

// Rock-paper-scissors triangle vs tower types:
//   swarm(물량형) resists basic, weak to splash
//   tank(탱커형)  resists splash, weak to slow
//   speed(스피드형) resists slow, weak to basic
export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  swarm: {
    id: 'swarm',
    name: '물량형',
    hp: 34,
    speed: 68,
    reward: 9,
    color: 0xdd8844,
    radius: 12,
    spawnCooldown: 550,
    resistantTo: 'basic',
    vulnerableTo: 'splash',
  },
  tank: {
    id: 'tank',
    name: '탱커형',
    hp: 150,
    speed: 40,
    reward: 20,
    color: 0x4488dd,
    radius: 18,
    spawnCooldown: 1400,
    resistantTo: 'splash',
    vulnerableTo: 'slow',
  },
  speed: {
    id: 'speed',
    name: '스피드형',
    hp: 22,
    speed: 130,
    reward: 7,
    color: 0x44dd88,
    radius: 10,
    spawnCooldown: 450,
    resistantTo: 'slow',
    vulnerableTo: 'basic',
  },
};

const RESISTANT_MULTIPLIER = 0.5;
const VULNERABLE_MULTIPLIER = 1.5;

export function damageMultiplier(unit: UnitDef, towerType: TowerType): number {
  if (towerType === unit.resistantTo) return RESISTANT_MULTIPLIER;
  if (towerType === unit.vulnerableTo) return VULNERABLE_MULTIPLIER;
  return 1;
}
