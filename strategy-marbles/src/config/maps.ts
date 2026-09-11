// Round maps are fetched at runtime from /data/strategy-marbles/maps/ (see
// public/data/strategy-marbles/maps) instead of being bundled at build time,
// so a designer can tweak a map's JSON and see it on next page load with no
// rebuild. GameScene loads these via Phaser's own loader (this.load.json) so
// this module only handles the Lobby's plain-fetch use case.

const MAPS_BASE = '/data/strategy-marbles/maps';

export interface TerrainPlacementDef {
  pieceId: number; // references config/pieces.json - radius/name/image live there
  dx: number;
  dy: number;
  bounce: number; // 0 (absorbs everything) - 10 (billiard-ball elastic), placement-specific
}

export interface ZoneMapDef {
  dx: number;
  dy: number;
  radius: number;
  friction: number; // 0 (frictionless) - 10 (nearly immovable), overrides floorFriction while inside
}

export interface RoundMapDef {
  id: number;
  name: string;
  floorFriction: number; // 0 (frictionless) - 10 (nearly immovable)
  terrain: TerrainPlacementDef[];
  zones: ZoneMapDef[];
}

export function mapUrl(id: number): string {
  return `${MAPS_BASE}/round${id}.json`;
}

export async function fetchRoundMap(id: number): Promise<RoundMapDef> {
  const res = await fetch(mapUrl(id));
  if (!res.ok) throw new Error(`Failed to load round map ${id}: HTTP ${res.status}`);
  return (await res.json()) as RoundMapDef;
}

export async function fetchAllRoundMaps(): Promise<RoundMapDef[]> {
  const res = await fetch(`${MAPS_BASE}/index.json`);
  if (!res.ok) throw new Error(`Failed to load round map index: HTTP ${res.status}`);
  const ids = (await res.json()) as number[];
  return Promise.all(ids.map(fetchRoundMap));
}
