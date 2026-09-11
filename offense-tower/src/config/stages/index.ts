import { ROUND_1 } from './round1';

export type { StageDef } from './types';

// Add a new round by creating its own file (see round1.ts) and listing it here.
export const STAGES = [ROUND_1];

export function getStage(id: number) {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
