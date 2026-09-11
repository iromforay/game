export type WeightTier = 'light' | 'medium' | 'heavy';

export interface WeightDef {
  tier: WeightTier;
  label: string;
  mass: number;
  // Multiplies the round map's floor friction - heavier eggs feel the floor
  // more, lighter eggs glide more easily, independent of the map itself.
  frictionMultiplier: number;
  radius: number;
}

export const WEIGHT_DEFS: Record<WeightTier, WeightDef> = {
  light: { tier: 'light', label: '경량', mass: 0.7, frictionMultiplier: 0.6, radius: 15 },
  medium: { tier: 'medium', label: '중량', mass: 1.0, frictionMultiplier: 1.0, radius: 17 },
  heavy: { tier: 'heavy', label: '중장량', mass: 1.5, frictionMultiplier: 1.6, radius: 19 },
};

const TIERS: WeightTier[] = ['light', 'medium', 'heavy'];

export function randomWeightTier(rng: () => number = Math.random): WeightTier {
  return TIERS[Math.floor(rng() * TIERS.length)];
}
