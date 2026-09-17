import type { StageDef } from './types';

// 1차맵 "숲(소파 속 먼지숲)" — backgrounds.json의 "forest" 항목(3200x2400)과 동일 크기.
// 2.1: 기본 등급(헌실/무명실)이 흔하다는 세계관 설정 반영 — 스폰 좌표는 임시 배치(밸런싱 전, 5.3 참고)
export const STAGE_FOREST: StageDef = {
  code: 'forest',
  name: '숲 (소파 속 먼지숲)',
  width: 3200,
  height: 2400,
  wildSpawns: [
    { x: 500, y: 400, characterCode: 'nubi' },
    { x: 900, y: 700, characterCode: 'bopuli' },
    { x: 1600, y: 300, characterCode: 'nubi' },
    { x: 2100, y: 900, characterCode: 'bopuli' },
    { x: 700, y: 1500, characterCode: 'nubi' },
    { x: 1400, y: 1800, characterCode: 'bopuli' },
    { x: 2500, y: 1600, characterCode: 'nubi' },
    { x: 2800, y: 2100, characterCode: 'bopuli' },
  ],
};
