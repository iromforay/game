import type { GridPoint } from '../map';

export interface StageDef {
  id: number;
  name: string;
  // Map shape for this round - independent of tower-defense's normal-mode
  // map, so each round can eventually have its own layout.
  pathGrid: GridPoint[];
  seedTowerTile: { col: number; row: number }; // where the AI's forced starting tower sits
  heroZoneTile: { col: number; row: number }; // hero-unlock checkpoint tile
  heroUnlockSegmentIndex: number; // pathGrid index a unit must reach to unlock the hero
  goalBreakthroughs: number; // non-hero unit breakthroughs needed to clear
  background?: string; // optional background image URL, drawn behind the board
}
