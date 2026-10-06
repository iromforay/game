import { hasStoredToken, request } from './account/accountClient';

export type MergeUpgrade = 'attack' | 'startCoin' | 'summonDiscount';

export interface MergeProfile {
  silver: number;
  attackLevel: number;
  warriorUnlocked: number;
  archerUnlocked: number;
  spellbladeUnlocked: number;
  spellbladeRecipeUnlocked: boolean;
  startCoinLevel: number;
  summonDiscountLevel: number;
}

const STORAGE_KEY = 'merge-defense:profile';
export const EMPTY_MERGE_PROFILE: MergeProfile = { silver: 0, attackLevel: 0, warriorUnlocked: 1, archerUnlocked: 1, spellbladeUnlocked: 0, spellbladeRecipeUnlocked: false, startCoinLevel: 0, summonDiscountLevel: 0 };

function readLocal(): MergeProfile {
  try { return { ...EMPTY_MERGE_PROFILE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }; } catch { return EMPTY_MERGE_PROFILE; }
}

function saveLocal(profile: MergeProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function normalizeProfile(profile: Partial<MergeProfile>): MergeProfile {
  return { ...EMPTY_MERGE_PROFILE, ...profile };
}

export async function fetchMergeProfile() {
  if (!hasStoredToken()) return readLocal();
  return normalizeProfile(await request<MergeProfile>('/scoreboard/merge-defense/profile'));
}

export async function collectSilver(runId: string, stageId: number, silver: number, kills: number, unlocked: { warrior: number; archer: number; spellblade: number }) {
  if (!hasStoredToken()) {
    const profile = readLocal();
    return saveLocal({ ...profile, silver: profile.silver + silver, warriorUnlocked: Math.max(profile.warriorUnlocked, unlocked.warrior), archerUnlocked: Math.max(profile.archerUnlocked, unlocked.archer), spellbladeUnlocked: Math.max(profile.spellbladeUnlocked, unlocked.spellblade) });
  }
  return normalizeProfile(await request<MergeProfile & { added: number }>('/scoreboard/merge-defense/collect', {
    method: 'POST', body: JSON.stringify({ runId, stageId, silver, kills, warriorUnlocked: unlocked.warrior, archerUnlocked: unlocked.archer, spellbladeUnlocked: unlocked.spellblade }),
  }));
}

export async function saveHeroDiscovery(heroClass: 'warrior' | 'archer' | 'spellblade', grade: number) {
  if (hasStoredToken()) return normalizeProfile(await request<MergeProfile>('/scoreboard/merge-defense/discover', { method: 'POST', body: JSON.stringify({ heroClass, grade }) }));
  const next = { ...readLocal() };
  if (heroClass === 'warrior') next.warriorUnlocked = Math.max(next.warriorUnlocked, grade);
  else if (heroClass === 'archer') next.archerUnlocked = Math.max(next.archerUnlocked, grade);
  else next.spellbladeUnlocked = Math.max(next.spellbladeUnlocked, grade);
  return saveLocal(next);
}

export async function unlockSpellbladeRecipe() {
  if (hasStoredToken()) return normalizeProfile(await request<MergeProfile>('/scoreboard/merge-defense/unlock-spellblade', { method: 'POST' }));
  return saveLocal({ ...readLocal(), spellbladeRecipeUnlocked: true });
}

const COSTS: Record<MergeUpgrade, number[]> = {
  attack: [50, 100, 200, 400, 800, 1200, 1800, 2500],
  startCoin: [100, 250, 500, 900, 1500],
  summonDiscount: [200, 450, 900, 1600, 2600],
};

export function upgradeCost(profile: MergeProfile, upgrade: MergeUpgrade) {
  const level = upgrade === 'attack' ? profile.attackLevel : upgrade === 'startCoin' ? profile.startCoinLevel : profile.summonDiscountLevel;
  return COSTS[upgrade][level] ?? null;
}

export async function purchaseMergeUpgrade(profile: MergeProfile, upgrade: MergeUpgrade) {
  if (hasStoredToken()) return normalizeProfile(await request<MergeProfile>('/scoreboard/merge-defense/purchase', { method: 'POST', body: JSON.stringify({ upgrade }) }));
  const cost = upgradeCost(profile, upgrade);
  if (cost === null) throw new Error('최대 단계입니다');
  if (profile.silver < cost) throw new Error('은화가 부족합니다');
  const next = { ...profile, silver: profile.silver - cost };
  if (upgrade === 'attack') next.attackLevel += 1;
  else if (upgrade === 'startCoin') next.startCoinLevel += 1;
  else next.summonDiscountLevel += 1;
  return saveLocal(next);
}
