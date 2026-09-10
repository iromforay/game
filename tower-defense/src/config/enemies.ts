export type EnemyType = 'grunt' | 'fast' | 'tank' | 'boss';

export interface EnemyDef {
  // string (not EnemyType) so sibling packages can define their own unit
  // types that still satisfy this shape (e.g. offense-tower's UnitDef).
  id: string;
  hp: number;
  speed: number; // px/sec
  reward: number;
  color: number;
  radius: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  grunt: { id: 'grunt', hp: 60, speed: 62, reward: 10, color: 0xdd4444, radius: 14 },
  fast: { id: 'fast', hp: 32, speed: 115, reward: 8, color: 0xdddd44, radius: 11 },
  tank: { id: 'tank', hp: 230, speed: 34, reward: 26, color: 0x8844dd, radius: 19 },
  boss: { id: 'boss', hp: 2000, speed: 40, reward: 250, color: 0x222222, radius: 30 },
};

export interface WaveEnemySpawn {
  type: EnemyType;
  count: number;
  interval: number; // ms between spawns within this group
}

export interface WaveDef {
  groups: WaveEnemySpawn[];
}

export const WAVES: WaveDef[] = [
  { groups: [{ type: 'grunt', count: 8, interval: 800 }] },
  { groups: [{ type: 'grunt', count: 10, interval: 700 }, { type: 'fast', count: 4, interval: 500 }] },
  { groups: [{ type: 'grunt', count: 10, interval: 650 }, { type: 'tank', count: 3, interval: 1000 }] },
  { groups: [{ type: 'fast', count: 10, interval: 450 }, { type: 'grunt', count: 6, interval: 600 }] },
  { groups: [{ type: 'tank', count: 6, interval: 900 }, { type: 'fast', count: 8, interval: 450 }] },
  { groups: [{ type: 'grunt', count: 14, interval: 550 }, { type: 'fast', count: 8, interval: 450 }, { type: 'tank', count: 4, interval: 900 }] },
  { groups: [{ type: 'fast', count: 14, interval: 400 }, { type: 'tank', count: 6, interval: 850 }] },
  { groups: [{ type: 'tank', count: 10, interval: 800 }, { type: 'fast', count: 10, interval: 400 }, { type: 'grunt', count: 10, interval: 550 }] },
  { groups: [{ type: 'grunt', count: 16, interval: 450 }, { type: 'fast', count: 16, interval: 380 }, { type: 'tank', count: 8, interval: 750 }] },
  { groups: [{ type: 'grunt', count: 10, interval: 500 }, { type: 'boss', count: 1, interval: 1000 }] },
];
