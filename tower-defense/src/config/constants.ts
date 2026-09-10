export const TILE = 64;
export const COLS = 14;
export const ROWS = 8;
export const HUD_HEIGHT = 150;

export const GAME_WIDTH = COLS * TILE; // 896
export const GAME_HEIGHT = ROWS * TILE; // 512
export const CANVAS_WIDTH = GAME_WIDTH;
export const CANVAS_HEIGHT = GAME_HEIGHT + HUD_HEIGHT;

export const STARTING_GOLD = 150;
export const STARTING_LIVES = 20;

// Waypoints in grid units (col, row). Off-grid columns (-1, COLS) are the
// spawn/exit points just outside the visible playfield.
export const PATH_GRID: [number, number][] = [
  [-1, 1],
  [9, 1],
  [9, 3],
  [2, 3],
  [2, 5],
  [11, 5],
  [11, 7],
  [COLS, 7],
];

function gridToPixel(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

export const PATH_POINTS: { x: number; y: number }[] = PATH_GRID.map(([c, r]) => gridToPixel(c, r));

export function computePathTiles(): Set<string> {
  const tiles = new Set<string>();
  for (let i = 0; i < PATH_GRID.length - 1; i++) {
    const [c1, r1] = PATH_GRID[i];
    const [c2, r2] = PATH_GRID[i + 1];
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

export const PATH_TILES = computePathTiles();

export function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function isBuildable(col: number, row: number): boolean {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  return !PATH_TILES.has(tileKey(col, row));
}
