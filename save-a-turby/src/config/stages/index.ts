import { STAGE_FOREST } from './forest';
import { STAGE_LAKE } from './lake';
import { STAGE_UNDERGROUND } from './underground';
import { STAGE_ICE } from './ice';
import { STAGE_DESERT } from './desert';

export type { StageDef, WildSpawn } from './types';

// 새 테마맵 추가 시: forest.ts처럼 파일 하나 추가 + 여기 등록(3.5.1). 장 순서와 잠금은 data/story.json이 결정한다.
export const STAGES = [STAGE_FOREST, STAGE_LAKE, STAGE_UNDERGROUND, STAGE_ICE, STAGE_DESERT];

export function getStage(code: string) {
  return STAGES.find((s) => s.code === code) ?? STAGES[0];
}
