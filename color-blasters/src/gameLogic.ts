export const PAINT_ZONES = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;

export type PaintZone = (typeof PAINT_ZONES)[number];

export const ZONE_LABELS: Record<PaintZone, string> = {
  head: '헬멧',
  torso: '몸통',
  leftArm: '왼팔',
  rightArm: '오른팔',
  leftLeg: '왼다리',
  rightLeg: '오른다리',
};

export const ROUND_SECONDS = 90;
export const REQUIRED_PAINTED_ZONES = 4;
export const MAX_PAINT = 18;

export type TuningStat = 'accuracy' | 'fireRate' | 'projectileSpeed' | 'capacity';
export type WeaponTuning = Record<TuningStat, number>;

export const TUNING_STATS: TuningStat[] = ['accuracy', 'fireRate', 'projectileSpeed', 'capacity'];
export const TUNING_LABELS: Record<TuningStat, string> = {
  accuracy: '정밀도',
  fireRate: '연사력',
  projectileSpeed: '탄속',
  capacity: '용량',
};
export const MAX_TUNING_LEVEL = 3;
export const TUNING_POINT_BUDGET = 6;
export const DEFAULT_TUNING: WeaponTuning = { accuracy: 0, fireRate: 0, projectileSpeed: 0, capacity: 0 };

export function spentTuningPoints(tuning: WeaponTuning) {
  return TUNING_STATS.reduce((total, stat) => total + tuning[stat], 0);
}

export function changeTuning(tuning: WeaponTuning, stat: TuningStat, delta: -1 | 1): WeaponTuning {
  const nextLevel = tuning[stat] + delta;
  if (nextLevel < 0 || nextLevel > MAX_TUNING_LEVEL) return tuning;
  if (delta > 0 && spentTuningPoints(tuning) >= TUNING_POINT_BUDGET) return tuning;
  return { ...tuning, [stat]: nextLevel };
}

export function resolveWeaponStats(tuning: WeaponTuning) {
  return {
    spread: 0.018 * (1 - tuning.accuracy * 0.22),
    fireInterval: 0.22 * (1 - tuning.fireRate * 0.12),
    projectileSpeed: 20 * (1 + tuning.projectileSpeed * 0.12),
    maxPaint: MAX_PAINT + tuning.capacity * 3,
  };
}

export function addPaintedZone(current: ReadonlySet<PaintZone>, zone: PaintZone) {
  if (current.has(zone)) return current;
  const next = new Set(current);
  next.add(zone);
  return next;
}

export function hasWon(painted: ReadonlySet<PaintZone>) {
  return painted.size >= REQUIRED_PAINTED_ZONES;
}

export function chooseUnpaintedZone(painted: ReadonlySet<PaintZone>, random = Math.random): PaintZone {
  const candidates = PAINT_ZONES.filter((zone) => !painted.has(zone));
  const pool = candidates.length > 0 ? candidates : [...PAINT_ZONES];
  return pool[Math.floor(random() * pool.length)]!;
}
