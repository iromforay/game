import { TILE, COLS, ROWS } from 'tower-defense';

// Grid coordinates (col, row) a unit's path bends through. Off-grid columns
// (-1, COLS) are the spawn/exit points just outside the visible playfield -
// same convention as tower-defense's own map.
export type GridPoint = [number, number];

export interface PixelPoint {
  x: number;
  y: number;
}

function gridToPixel(col: number, row: number): PixelPoint {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

export function computePathPoints(pathGrid: GridPoint[]): PixelPoint[] {
  return pathGrid.map(([c, r]) => gridToPixel(c, r));
}

export function computePathTiles(pathGrid: GridPoint[]): Set<string> {
  const tiles = new Set<string>();
  for (let i = 0; i < pathGrid.length - 1; i++) {
    const [c1, r1] = pathGrid[i];
    const [c2, r2] = pathGrid[i + 1];
    if (r1 === r2) {
      const start = Math.min(c1, c2);
      const end = Math.max(c1, c2);
      for (let c = start; c <= end; c++) tiles.add(`${c},${r1}`);
    } else {
      const start = Math.min(r1, r2);
      const end = Math.max(r1, r2);
      for (let r = start; r <= end; r++) tiles.add(`${c1},${r}`);
    }
  }
  return tiles;
}

export function isBuildable(col: number, row: number, pathTiles: Set<string>): boolean {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  return !pathTiles.has(`${col},${row}`);
}
