// 지역 이동 충돌 — 순수 함수(DB·소켓·시간을 모른다). 좌표와 영역은 story-data/stages/<stage>.json에서 온다(10-02 v4 §2).
// 서버는 "마지막으로 승인한 위치 → 새로 보고된 위치" 선분을 검사한다: 끝점만이 아니라 선분이 벽·닫힌 문을 지나는지도 본다(터널링 방지).
// 최종 지도로 바꿔도 이 계약은 그대로다: 지도 크기, 시작 지점, 통과 불가 사각형, 문(열리는 이벤트), 접근 조건이 있는 구역.
import type { StageStoryData } from '../story/story-content.service';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface StageCollision {
  width: number;
  height: number;
  spawn: Point; // 서버 권위 시작 지점이자, 허용되지 않는 위치에서의 안전한 복귀 지점
  blockers: Rect[];
  gates: (Rect & { id: string; openEvent: string })[];
  zones: (Rect & { id: string; accessAfter: string })[]; // 이 이벤트 전에는 들어갈 수 없는 구역(닫힌 문 너머)
}

// 끝점 판정에 쓰는 몸 반지름. 클라이언트(16px)보다 작게 둬 정상 이동을 거절하지 않는다(벽에 붙어 걷는 위치는 항상 통과)
export const SERVER_BODY_HALF = 8;

// 지역 데이터가 없는 지역: 지도 한가운데에서 시작하고 막힌 곳이 없다
export function collisionOf(data: StageStoryData | null, mapWidth: number, mapHeight: number): StageCollision {
  const width = data?.size?.width ?? mapWidth;
  const height = data?.size?.height ?? mapHeight;
  const layout = data?.layout;
  return {
    width,
    height,
    spawn: data?.spawnPoint ?? { x: Math.round(width / 2), y: Math.round(height / 2) },
    blockers: layout?.blockers ?? [],
    gates: layout?.gates ?? [],
    zones: (layout?.zones ?? []).filter((z) => !!z.visibleAfter).map((z) => ({ id: z.id, x: z.x, y: z.y, width: z.width, height: z.height, accessAfter: z.visibleAfter! })),
  };
}

// 이 플레이어에게 지금 통과 불가인 사각형: 막힌 곳 + 아직 열리지 않은 문(문 개방은 서버 스토리 이벤트 기준)
export function solidsFor(c: StageCollision, events: ReadonlySet<string>): Rect[] {
  return [...c.blockers, ...c.gates.filter((g) => !events.has(g.openEvent))];
}

// 아직 들어갈 수 없는 구역
export function lockedZonesFor(c: StageCollision, events: ReadonlySet<string>): Rect[] {
  return c.zones.filter((z) => !events.has(z.accessAfter));
}

export function inBounds(c: StageCollision, p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= c.width && p.y <= c.height;
}

const inside = (r: Rect, p: Point, pad: number) => p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;

// 몸(반지름 half)이 통과 불가 사각형에 겹치는가
export function pointBlocked(solids: Rect[], p: Point, half = SERVER_BODY_HALF): boolean {
  return solids.some((r) => inside(r, p, half));
}

// 선분 a→b가 사각형 내부를 지나는가(Liang–Barsky). 가장자리를 스치기만 하는 것은 지나는 것으로 보지 않는다
export function segmentCrosses(r: Rect, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0; // 평행: 그 축에서 안쪽에 있어야 한다(경계 위는 바깥)
    const t = q / p;
    if (p < 0) {
      if (t >= t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t <= t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.width - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.height - a.y) && t0 < t1;
}

export function segmentBlocked(solids: Rect[], a: Point, b: Point): boolean {
  return solids.some((r) => segmentCrosses(r, a, b));
}

export type MoveVerdict = 'ok' | 'out_of_bounds' | 'blocked' | 'tunnel' | 'locked_zone';

// 마지막 승인 위치 from에서 to로의 이동을 승인할 수 있는가(속도·시간 검증은 호출 쪽이 따로 한다)
export function checkMove(c: StageCollision, solids: Rect[], locked: Rect[], from: Point, to: Point): MoveVerdict {
  if (!inBounds(c, to)) return 'out_of_bounds';
  if (pointBlocked(solids, to)) return 'blocked';
  if (segmentBlocked(solids, from, to)) return 'tunnel';
  if (locked.some((z) => inside(z, to, 0))) return 'locked_zone';
  return 'ok';
}

// 저장돼 있던 위치를 다시 쓸 수 있는가(재접속·재입장). 지도 밖·벽 안·닫힌 문 너머면 시작 지점으로 보정한다
export function safePosition(c: StageCollision, solids: Rect[], locked: Rect[], p: Point): { x: number; y: number; corrected: boolean } {
  const ok = inBounds(c, p) && !pointBlocked(solids, p) && !locked.some((z) => inside(z, p, 0));
  return ok ? { x: p.x, y: p.y, corrected: false } : { x: c.spawn.x, y: c.spawn.y, corrected: true };
}

// 위치 증거: 서 있는 자리에서 대상까지 벽·닫힌 문이 가로막고 있지 않은가(벽 반대편에서 가까운 것은 닿지 않는다)
export function reachable(solids: Rect[], from: Point, target: Point): boolean {
  return !segmentBlocked(solids, from, target);
}
