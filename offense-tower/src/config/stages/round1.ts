import { COLS } from 'tower-defense';
import type { StageDef } from './types';

export const ROUND_1: StageDef = {
  id: 1,
  name: '라운드 1',
  pathGrid: [
    [-1, 1],
    [9, 1],
    [9, 3],
    [2, 3],
    [2, 5],
    [11, 5],
    [11, 7],
    [COLS, 7],
  ],
  seedTowerTile: { col: 8, row: 2 },
  heroZoneTile: { col: 9, row: 3 },
  heroUnlockSegmentIndex: 2,
  goalBreakthroughs: 10,
};
