// Piece catalog is fetched at runtime (see public/data/strategy-marbles/pieces.json)
// for the same reason round maps are - editable without a rebuild. GameScene
// loads it via Phaser's loader; this plain-fetch path exists for non-Phaser
// consumers (e.g. the hub's Lobby, if it ever needs piece info).

export const PIECES_URL = '/data/strategy-marbles/pieces.json';

// Every icon file any piece in the catalog might reference. GameScene
// preloads all of these up front (small, fixed set) rather than trying to
// dynamically load images after pieces.json (which is itself runtime-fetched)
// resolves.
export const PIECE_ICON_FILES = ['rock', 'tree', 'car'] as const;

export interface PieceDef {
  id: number;
  name: string;
  radius: number;
  color: string; // "#rrggbb" - fallback fill when a piece has no image
  image: string | null; // e.g. "/data/strategy-marbles/icons/rock.svg"
}

// GameScene preloads each of these once (see preload()) and reuses the
// texture at whatever size a given piece's radius calls for, rather than
// loading a fresh image per placement.
export function pieceTextureKey(imagePath: string): string {
  const file = imagePath.split('/').pop() ?? imagePath;
  return `piece-icon-${file.replace(/\.[^.]+$/, '')}`;
}

export async function fetchPieces(): Promise<PieceDef[]> {
  const res = await fetch(PIECES_URL);
  if (!res.ok) throw new Error(`Failed to load piece catalog: HTTP ${res.status}`);
  return (await res.json()) as PieceDef[];
}

export function pieceColorNumber(piece: PieceDef): number {
  return parseInt(piece.color.replace('#', ''), 16);
}
