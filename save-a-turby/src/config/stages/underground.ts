import type { StageDef } from './types';

// 2.1: 오랜 세월 눌리고 숙성된 벨벳실(폭신이)이 대표 — 스폰 좌표는 임시 배치(밸런싱 전)
export const STAGE_UNDERGROUND: StageDef = {
  code: 'underground',
  name: '지하 (마루바닥 밑)',
  width: 4800,
  height: 3600,
  wildSpawns: [
    { x: 700, y: 600, characterCode: 'pokshini' },
    { x: 1500, y: 1100, characterCode: 'muldeuli' },
    { x: 2400, y: 500, characterCode: 'pokshini' },
    { x: 3300, y: 1200, characterCode: 'bopuli' },
    { x: 1000, y: 2200, characterCode: 'pokshini' },
    { x: 2200, y: 2800, characterCode: 'muldeuli' },
    { x: 3800, y: 2100, characterCode: 'pokshini' },
    { x: 4100, y: 3100, characterCode: 'bopuli' },
  ],
};
