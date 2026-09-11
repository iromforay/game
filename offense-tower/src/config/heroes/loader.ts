import type { HeroDef, HeroId, HeroJson } from './types';

export const HERO_IDS: HeroId[] = ['vanguard'];
export const DEFAULT_HERO: HeroId = 'vanguard';

// Loaded from a local JSON file per hero today. Swapping this out for a real
// backend later is meant to be a one-line change here (replace the dynamic
// import with `fetch(...).then(r => r.json())`) - loadHero/loadAllHeroes and
// everywhere that calls them stay the same.
async function fetchHeroJson(id: HeroId): Promise<HeroJson> {
  switch (id) {
    case 'vanguard':
      return (await import('./vanguard.json')) as unknown as HeroJson;
  }
}

function toHeroDef(json: HeroJson): HeroDef {
  return { ...json, color: Number.parseInt(json.color.replace('#', ''), 16) };
}

export async function loadHero(id: HeroId): Promise<HeroDef> {
  return toHeroDef(await fetchHeroJson(id));
}

export async function loadAllHeroes(): Promise<HeroDef[]> {
  return Promise.all(HERO_IDS.map(loadHero));
}
