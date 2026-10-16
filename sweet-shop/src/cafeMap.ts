export const TILE_SIZE = 72;
export const MAP_COLUMNS = 18;
export const MAP_ROWS = 24;
export const MAP_WIDTH = MAP_COLUMNS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

export interface TilePoint { x: number; y: number; }
export interface CafeFacility {
  id: string;
  name: string;
  icon: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  access: TilePoint;
}

export const CAFE_FACILITIES: readonly CafeFacility[] = [
  { id: 'order-board', name: '재료 주문 게시판', icon: '📋', description: '필요한 재료를 골드로 주문합니다.', x: 2, y: 2, width: 3, height: 2, access: { x: 3, y: 4 } },
  { id: 'ingredient-storage', name: '재료 보관함', icon: '🧊', description: '보유 중인 재료와 보관 슬롯을 확인합니다.', x: 7, y: 2, width: 3, height: 2, access: { x: 8, y: 4 } },
  { id: 'recipe-book', name: '레시피북', icon: '📖', description: '버터 쿠키 레시피를 보유하고 있습니다.', x: 13, y: 2, width: 2, height: 2, access: { x: 13, y: 4 } },
  { id: 'cooking-counter', name: '조리대', icon: '🥣', description: '레시피를 골라 달콤한 디저트를 만듭니다.', x: 2, y: 9, width: 4, height: 3, access: { x: 4, y: 12 } },
  { id: 'dessert-box', name: '디저트 상자', icon: '🧁', description: '아직 완성된 디저트가 없습니다.', x: 13, y: 9, width: 3, height: 3, access: { x: 14, y: 12 } },
  { id: 'display-stand', name: '판매대', icon: '🍰', description: '판매대 3칸이 비어 있습니다.', x: 6, y: 16, width: 6, height: 2, access: { x: 9, y: 15 } },
  { id: 'notice-board', name: '알림노트 광고판', icon: '💌', description: '판매할 디저트가 생기면 손님에게 카페를 알릴 수 있습니다.', x: 2, y: 20, width: 3, height: 2, access: { x: 4, y: 19 } },
  { id: 'cafe-door', name: '카페 출입문', icon: '🚪', description: '영업 준비를 마치면 카페 거리로 나갈 수 있습니다.', x: 8, y: 21, width: 3, height: 2, access: { x: 9, y: 20 } },
] as const;

const key = ({ x, y }: TilePoint) => `${x},${y}`;
const blocked = new Set<string>();

for (let x = 0; x < MAP_COLUMNS; x += 1) {
  blocked.add(key({ x, y: 0 }));
  blocked.add(key({ x, y: MAP_ROWS - 1 }));
}
for (let y = 0; y < MAP_ROWS; y += 1) {
  blocked.add(key({ x: 0, y }));
  blocked.add(key({ x: MAP_COLUMNS - 1, y }));
}
for (const facility of CAFE_FACILITIES) {
  for (let y = facility.y; y < facility.y + facility.height; y += 1) {
    for (let x = facility.x; x < facility.x + facility.width; x += 1) blocked.add(key({ x, y }));
  }
}

export function isWalkable(point: TilePoint) {
  return point.x > 0 && point.y > 0 && point.x < MAP_COLUMNS - 1 && point.y < MAP_ROWS - 1 && !blocked.has(key(point));
}

export function worldToTile(x: number, y: number): TilePoint {
  return { x: Math.max(0, Math.min(MAP_COLUMNS - 1, Math.floor(x / TILE_SIZE))), y: Math.max(0, Math.min(MAP_ROWS - 1, Math.floor(y / TILE_SIZE))) };
}

export function tileCenter(point: TilePoint) {
  return { x: (point.x + 0.5) * TILE_SIZE, y: (point.y + 0.5) * TILE_SIZE };
}

export function nearestWalkable(target: TilePoint): TilePoint | null {
  if (isWalkable(target)) return target;
  const seen = new Set([key(target)]);
  const queue = [target];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of neighbors(current)) {
      const nextKey = key(next);
      if (seen.has(nextKey)) continue;
      if (isWalkable(next)) return next;
      seen.add(nextKey);
      queue.push(next);
    }
  }
  return null;
}

function neighbors(point: TilePoint) {
  return [
    { x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 },
  ].filter((next) => next.x >= 0 && next.y >= 0 && next.x < MAP_COLUMNS && next.y < MAP_ROWS);
}

export function findPath(start: TilePoint, goal: TilePoint): TilePoint[] {
  if (!isWalkable(start) || !isWalkable(goal)) return [];
  const open = [start];
  const cameFrom = new Map<string, TilePoint>();
  const gScore = new Map([[key(start), 0]]);
  const fScore = new Map([[key(start), distance(start, goal)]]);

  while (open.length) {
    open.sort((a, b) => (fScore.get(key(a)) ?? Infinity) - (fScore.get(key(b)) ?? Infinity));
    const current = open.shift()!;
    if (current.x === goal.x && current.y === goal.y) {
      const path = [current];
      let cursor = current;
      while (cameFrom.has(key(cursor))) { cursor = cameFrom.get(key(cursor))!; path.unshift(cursor); }
      return path.slice(1);
    }
    for (const next of neighbors(current).filter(isWalkable)) {
      const tentative = (gScore.get(key(current)) ?? Infinity) + 1;
      if (tentative >= (gScore.get(key(next)) ?? Infinity)) continue;
      cameFrom.set(key(next), current);
      gScore.set(key(next), tentative);
      fScore.set(key(next), tentative + distance(next, goal));
      if (!open.some((candidate) => candidate.x === next.x && candidate.y === next.y)) open.push(next);
    }
  }
  return [];
}

function distance(a: TilePoint, b: TilePoint) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
