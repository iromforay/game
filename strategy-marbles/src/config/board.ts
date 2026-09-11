import { BOARD_CENTER_X, BOARD_CENTER_Y, BOARD_RADIUS } from './constants';

// Lays out each player's eggs in a small arc near their own edge of the board,
// facing the center. Returns one array of {x, y} per player.
export function createStartingPositions(playerCount: number, eggsPerPlayer: number): { x: number; y: number }[][] {
  const layoutRadius = BOARD_RADIUS * 0.72;
  const spreadAngle = Math.min(0.9, (Math.PI / playerCount) * 0.8);

  const positions: { x: number; y: number }[][] = [];
  for (let p = 0; p < playerCount; p++) {
    const baseAngle = (2 * Math.PI * p) / playerCount;
    const eggs: { x: number; y: number }[] = [];
    for (let e = 0; e < eggsPerPlayer; e++) {
      const t = eggsPerPlayer === 1 ? 0 : e / (eggsPerPlayer - 1) - 0.5;
      const angle = baseAngle + t * spreadAngle;
      eggs.push({
        x: BOARD_CENTER_X + layoutRadius * Math.cos(angle),
        y: BOARD_CENTER_Y + layoutRadius * Math.sin(angle),
      });
    }
    positions.push(eggs);
  }
  return positions;
}
