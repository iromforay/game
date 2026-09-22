import type { StageDef } from './types';

// 2.1: 열기에 금빛으로 그을린 금실(금빛이)이 대표 — 스폰 좌표는 임시 배치(밸런싱 전)
export const STAGE_DESERT: StageDef = {
  code: 'desert',
  name: '사막 (보일러/라디에이터 옆)',
  width: 6400,
  height: 4800,
  wildSpawns: [
    { x: 900, y: 800, characterCode: 'geumbiti' },
    { x: 2000, y: 1500, characterCode: 'ganeuri' },
    { x: 3400, y: 700, characterCode: 'geumbiti' },
    { x: 4800, y: 1600, characterCode: 'pokshini' },
    { x: 1400, y: 3000, characterCode: 'geumbiti' },
    { x: 3000, y: 3700, characterCode: 'ganeuri' },
    { x: 5000, y: 3200, characterCode: 'geumbiti' },
    { x: 5600, y: 4300, characterCode: 'pokshini' },
  ],
};
