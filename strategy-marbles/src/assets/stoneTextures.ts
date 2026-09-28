import hiddenUrl from './stones/hidden.png?url';
import lightUrl from './stones/light.png?url';
import mediumUrl from './stones/medium.png?url';
import heavyUrl from './stones/heavy.png?url';
import opponentAnvilUrl from './stones/opponent-anvil.png?url';
import opponentShieldUrl from './stones/opponent-shield.png?url';
import opponentWingUrl from './stones/opponent-wing.png?url';
import type { WeightTier } from '../config/weights';

export const HIDDEN_STONE_TEXTURE_KEY = 'egg-stone-hidden';

export const WEIGHT_STONE_TEXTURE_KEYS: Record<WeightTier, string> = {
  light: 'egg-stone-light',
  medium: 'egg-stone-medium',
  heavy: 'egg-stone-heavy',
};

// Assigned by opponent order on each client's screen. These textures share
// identical materials and dimensions; only the center emblem differs.
export const OPPONENT_STONE_TEXTURE_KEYS = [
  HIDDEN_STONE_TEXTURE_KEY,
  'egg-opponent-anvil',
  'egg-opponent-shield',
  'egg-opponent-wing',
] as const;

export const STONE_TEXTURE_URLS = {
  [HIDDEN_STONE_TEXTURE_KEY]: hiddenUrl,
  [WEIGHT_STONE_TEXTURE_KEYS.light]: lightUrl,
  [WEIGHT_STONE_TEXTURE_KEYS.medium]: mediumUrl,
  [WEIGHT_STONE_TEXTURE_KEYS.heavy]: heavyUrl,
  [OPPONENT_STONE_TEXTURE_KEYS[1]]: opponentAnvilUrl,
  [OPPONENT_STONE_TEXTURE_KEYS[2]]: opponentShieldUrl,
  [OPPONENT_STONE_TEXTURE_KEYS[3]]: opponentWingUrl,
};
