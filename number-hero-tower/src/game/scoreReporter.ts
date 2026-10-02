import type { ScoreUpdate } from './types';

export const GAME_RESULT_EVENT = 'bomul:game-result';

export function reportScoreUpdate(runId: string, stats: ScoreUpdate, final = false) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GAME_RESULT_EVENT, {
    detail: { game: 'number_hero_tower', runId, final, stats },
  }));
}
