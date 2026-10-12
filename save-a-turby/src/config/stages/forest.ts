import type { StageDef } from './types';

// 1차맵 "숲(소파 속 먼지숲)" — backgrounds.json의 "forest" 항목(3200x2400)과 동일 크기.
// 2.1: 기본 등급(헌실/무명실)이 흔하다는 세계관 설정 반영
export const STAGE_FOREST: StageDef = {
  code: 'forest',
  name: '숲 (소파 속 먼지숲)',
  width: 3200,
  height: 2400,
};
