export type TowerType = 'basic' | 'splash' | 'slow' | 'storm';

export interface TowerDef {
  id: TowerType;
  name: string;
  description: string;
  cost: number;
  range: number;
  damage: number;
  fireRate: number; // ms between shots
  projectileSpeed: number;
  color: number;
  projectileColor: number;
  splashRadius?: number;
  slowFactor?: number; // fraction of speed retained (0-1)
  slowDuration?: number; // ms
}

export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  basic: {
    id: 'basic',
    name: '기본 타워',
    description: '단일 대상, 균형 잡힌 화력',
    cost: 50,
    range: 150,
    damage: 22,
    fireRate: 550,
    projectileSpeed: 600,
    color: 0x4f9dde,
    projectileColor: 0xffffff,
  },
  splash: {
    id: 'splash',
    name: '스플래시 타워',
    description: '범위 피해, 적이 몰려있을 때 강력',
    cost: 90,
    range: 120,
    damage: 16,
    fireRate: 1100,
    projectileSpeed: 420,
    color: 0xde8f4f,
    projectileColor: 0xffcc66,
    splashRadius: 65,
  },
  slow: {
    id: 'slow',
    name: '슬로우 타워',
    description: '피해는 약하지만 적을 둔화시킴',
    cost: 70,
    range: 140,
    damage: 6,
    fireRate: 900,
    projectileSpeed: 480,
    color: 0x8f4fde,
    projectileColor: 0xccaaff,
    slowFactor: 0.45,
    slowDuration: 1500,
  },
  storm: {
    id: 'storm',
    name: '폭풍 타워',
    description: '고화력·초고속 공격과 소형 범위 피해',
    cost: 160,
    range: 105,
    damage: 30,
    fireRate: 320,
    projectileSpeed: 760,
    color: 0xf6c945,
    projectileColor: 0xeaffff,
    splashRadius: 52,
  },
};

export const MAX_TOWER_LEVEL = 2;

export function upgradeCost(def: TowerDef, currentLevel: number): number {
  return Math.round(def.cost * 0.8 * currentLevel);
}

export function statMultiplier(level: number): number {
  // level 1 = base, level 2 = +60% damage/range
  return 1 + (level - 1) * 0.6;
}

export function sellValue(def: TowerDef, level: number): number {
  let spent = def.cost;
  for (let l = 1; l < level; l++) spent += upgradeCost(def, l);
  return Math.round(spent * 0.6);
}
