import type { StageDef } from './types';

// 2.1: 혹한 속에서 극도로 가늘게 정제된 극세사(가느리)가 대표 — 스폰 좌표는 임시 배치(밸런싱 전)
export const STAGE_ICE: StageDef = {
  code: 'ice',
  name: '얼음 (냉장고 속)',
  width: 5600,
  height: 4200,
  wildSpawns: [
    { x: 800, y: 700, characterCode: 'ganeuri' },
    { x: 1800, y: 1300, characterCode: 'pokshini' },
    { x: 3000, y: 600, characterCode: 'ganeuri' },
    { x: 4200, y: 1500, characterCode: 'muldeuli' },
    { x: 1200, y: 2600, characterCode: 'ganeuri' },
    { x: 2800, y: 3200, characterCode: 'pokshini' },
    { x: 4400, y: 2800, characterCode: 'ganeuri' },
    { x: 5000, y: 3700, characterCode: 'muldeuli' },
  ],
};
