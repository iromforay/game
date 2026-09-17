import { STAGE_FOREST } from './forest';

export type { StageDef, WildSpawn } from './types';

// 새 테마맵 추가 시: forest.ts처럼 파일 하나 추가 + 여기 등록(3.5.1)
export const STAGES = [STAGE_FOREST];

export function getStage(code: string) {
  return STAGES.find((s) => s.code === code) ?? STAGES[0];
}
