// Piece catalog is fetched at runtime (see public/data/strategy-marbles/pieces.json)
// for the same reason round maps are - editable without a rebuild. GameScene
// loads it via Phaser's loader; this plain-fetch path exists for non-Phaser
// consumers (e.g. the hub's Lobby, if it ever needs piece info).

export const PIECES_URL = '/data/strategy-marbles/pieces.json';

export interface PieceDef {
  id: number;
  name: string;
  radius: number;
  color: string; // "#rrggbb"
  // Not wired up to a texture loader yet - round maps can already reference a
  // piece by id, so once art exists this fills in without a schema change.
  image: string | null;
}

export async function fetchPieces(): Promise<PieceDef[]> {
  const res = await fetch(PIECES_URL);
  if (!res.ok) throw new Error(`Failed to load piece catalog: HTTP ${res.status}`);
  return (await res.json()) as PieceDef[];
}

export function pieceColorNumber(piece: PieceDef): number {
  return parseInt(piece.color.replace('#', ''), 16);
}
