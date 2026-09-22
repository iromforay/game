import type { StageDef } from './types';

// 2.1: 물에 오래 잠겨 색이 물든 터비(물들이)가 대표 — 스폰 좌표는 임시 배치(밸런싱 전)
export const STAGE_LAKE: StageDef = {
  code: 'lake',
  name: '호수 (어항 속)',
  width: 4000,
  height: 3000,
  wildSpawns: [
    { x: 600, y: 500, characterCode: 'muldeuli' },
    { x: 1200, y: 900, characterCode: 'nubi' },
    { x: 2000, y: 400, characterCode: 'muldeuli' },
    { x: 2600, y: 1100, characterCode: 'bopuli' },
    { x: 900, y: 1800, characterCode: 'muldeuli' },
    { x: 1800, y: 2200, characterCode: 'nubi' },
    { x: 3200, y: 1700, characterCode: 'muldeuli' },
    { x: 3400, y: 2500, characterCode: 'bopuli' },
  ],
};
