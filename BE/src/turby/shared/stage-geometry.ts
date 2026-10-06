// 지역 geometry 계약 — 서버와 클라이언트가 이 파일 하나를 같이 쓴다(10-02 v6 §2).
//   서버: 권위 판정(이동 승인·위치 증거·재입장 보정). rooms/stage-collision.ts가 이 파일을 다시 내보낸다.
//   클라이언트: 예측 충돌(막힌 곳에서 멈춤·미끄러짐)과 표시만. save-a-turby/src/story/storyStage.ts가 이 파일을 가져다 쓴다.
// 그래서 타입·검증 규칙·경계 포함 여부·문 개방과 구역 잠금의 해석·몸 반지름이 한 곳에서만 정해진다.
// 순수 모듈이다: 다른 파일을 불러오지 않고(브라우저 번들과 서버 빌드 양쪽에 그대로 들어간다) DB·소켓·시간을 모른다.
//
// 좌표 규칙
//   - 사각형은 왼쪽 위 (x, y)와 width·height. 경계선 위의 점은 "바깥"이다(벽에 딱 붙어 서는 것은 겹침이 아니다).
//   - 몸은 중심에서 사방으로 half만큼 뻗은 정사각형으로 본다. 겹침 = 사각형을 half만큼 부풀린 영역의 "안쪽"에 중심이 있다.
//   - 지도 경계는 포함한다: 0 ≤ x ≤ width, 0 ≤ y ≤ height.
// 모양 규칙
//   - 지금은 축에 나란한 사각형(shape: 'rect', 생략 가능)만 받는다. 다각형은 구현하지 않았다.
//     나중에 'polygon'을 더할 때는 ShapeKind와 parseStageGeometry의 모양 검사, 아래 판정 함수 세 개(insideRect·segmentCrosses·bodyBlocked)만 넓히면 된다.

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ShapeKind = 'rect';
export interface StageSolid extends Rect {
  id: string;
  shape?: ShapeKind;
}
export interface StageGate extends StageSolid {
  openEvent: string; // 이 이벤트가 기록되면 열린다(그 전에는 통과 불가)
}
export interface StageLockedZone extends StageSolid {
  accessAfter: string; // 이 이벤트 전에는 들어갈 수 없는 구역(닫힌 문 너머)
}
export interface StageGeometry {
  width: number;
  height: number;
  spawn: Point; // 서버 권위 시작 지점이자, 허용되지 않는 위치에서의 안전한 복귀 지점
  blockers: StageSolid[];
  gates: StageGate[];
  zones: StageLockedZone[];
}

// ---------- 몸 반지름 ----------
// 서버와 클라이언트가 일부러 다른 값을 쓴다.
//   CLIENT_BODY_HALF(16): 화면의 아바타가 벽에 파묻혀 보이지 않게 하는 예측 충돌용.
//   SERVER_BODY_HALF(8) : 승인 판정용. 클라이언트보다 작아서, 클라이언트가 걸어서 갈 수 있는 자리는 서버가 언제나 승인한다
//                         (좌표 반올림·전송 간격 때문에 정상 이동이 거절되는 일을 막는다).
// 허용 차이 BODY_HALF_TOLERANCE(8px): 변조한 클라이언트는 벽 쪽으로 이만큼 더 붙을 수 있지만 벽 안으로 들어가거나 넘어갈 수는 없다
// (선분 검사가 따로 막는다). 이 관계(서버 ≤ 클라이언트)는 테스트로 고정한다.
export const CLIENT_BODY_HALF = 16;
export const SERVER_BODY_HALF = 8;
export const BODY_HALF_TOLERANCE = CLIENT_BODY_HALF - SERVER_BODY_HALF;

// ---------- 검증(지역 JSON → 계약) ----------

export class StageGeometryError extends Error {
  readonly problems: string[];
  constructor(stageCode: string, problems: string[]) {
    super(`지역 데이터(${stageCode})가 geometry 계약에 맞지 않습니다: ${problems.join(' / ')}`);
    this.problems = problems;
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
type Raw = Record<string, unknown>;
const obj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

// 지역 데이터가 없는 지역: 지도 한가운데에서 시작하고 막힌 곳이 없다
export function openGeometry(width: number, height: number): StageGeometry {
  return { width, height, spawn: { x: Math.round(width / 2), y: Math.round(height / 2) }, blockers: [], gates: [], zones: [] };
}

// 지역 JSON(story-data/stages/<stage>.json)을 계약으로 바꾼다. 맞지 않으면 StageGeometryError — 서버는 시작·로드 단계에서 이 오류로 멈춘다.
// fallback: JSON에 size가 없을 때 쓰는 지도 크기(지역 표의 값)
export function parseStageGeometry(raw: unknown, fallback: { width: number; height: number }, stageCode = '?'): StageGeometry {
  if (raw === null || raw === undefined) return openGeometry(fallback.width, fallback.height);
  const bad: string[] = [];
  if (!obj(raw)) throw new StageGeometryError(stageCode, ['지역 데이터가 객체가 아니다']);

  let width = fallback.width;
  let height = fallback.height;
  if (raw.size !== undefined) {
    if (obj(raw.size) && num(raw.size.width) && num(raw.size.height) && raw.size.width > 0 && raw.size.height > 0) ({ width, height } = raw.size as { width: number; height: number });
    else bad.push('size: width·height는 0보다 큰 숫자');
  }
  if (!num(width) || !num(height) || width <= 0 || height <= 0) bad.push('지도 크기가 없다');

  const ids = new Set<string>();
  const rects = (list: unknown, where: string, extra?: (r: Raw, at: string) => void): Raw[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) {
      bad.push(`${where}: 배열이 아니다`);
      return [];
    }
    const out: Raw[] = [];
    list.forEach((r, i) => {
      const at = `${where}[${i}]${obj(r) && str(r.id) ? `(${r.id})` : ''}`;
      if (!obj(r)) return void bad.push(`${at}: 객체가 아니다`);
      if (!str(r.id)) bad.push(`${at}: id가 없다`);
      else if (ids.has(r.id)) bad.push(`${at}: id가 겹친다`);
      else ids.add(r.id);
      if (r.shape !== undefined && r.shape !== 'rect') return void bad.push(`${at}: 지원하지 않는 shape '${String(r.shape)}'(지금은 rect만)`);
      if (!num(r.x) || !num(r.y) || !num(r.width) || !num(r.height)) return void bad.push(`${at}: x·y·width·height는 숫자`);
      if (r.width <= 0 || r.height <= 0) return void bad.push(`${at}: width·height는 0보다 커야 한다`);
      if (r.x < 0 || r.y < 0 || r.x + r.width > width || r.y + r.height > height) bad.push(`${at}: 지도 밖으로 나간다`);
      extra?.(r, at);
      out.push(r);
    });
    return out;
  };

  const layout = raw.layout;
  if (layout !== undefined && !obj(layout)) bad.push('layout: 객체가 아니다');
  const L: Raw = obj(layout) ? layout : {};
  const solid = (r: Raw): StageSolid => ({ id: r.id as string, x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number });
  const blockers = rects(L.blockers, 'layout.blockers').map(solid);
  const gates = rects(L.gates, 'layout.gates', (r, at) => {
    if (!str(r.openEvent)) bad.push(`${at}: openEvent가 없다`);
  }).map((r) => ({ ...solid(r), openEvent: r.openEvent as string }));
  const zones = rects(L.zones, 'layout.zones', (r, at) => {
    if (r.visibleAfter !== undefined && !str(r.visibleAfter)) bad.push(`${at}: visibleAfter는 이벤트 이름`);
  })
    .filter((r) => str(r.visibleAfter))
    .map((r) => ({ ...solid(r), accessAfter: r.visibleAfter as string }));

  let spawn: Point = { x: Math.round(width / 2), y: Math.round(height / 2) };
  if (raw.spawnPoint !== undefined) {
    if (obj(raw.spawnPoint) && num(raw.spawnPoint.x) && num(raw.spawnPoint.y)) spawn = { x: raw.spawnPoint.x, y: raw.spawnPoint.y };
    else bad.push('spawnPoint: x·y는 숫자');
  }
  const geometry: StageGeometry = { width, height, spawn, blockers, gates, zones };
  if (bad.length === 0) {
    // 시작 지점은 아무 이벤트도 없는 플레이어에게도 안전해야 한다(보정의 복귀 지점이므로). 클라이언트 몸 크기로 본다
    const none = new Set<string>();
    if (!inBounds(geometry, spawn)) bad.push('spawnPoint: 지도 밖');
    else if (bodyBlocked(solidsFor(geometry, none), spawn, CLIENT_BODY_HALF)) bad.push('spawnPoint: 막힌 곳·닫힌 문과 겹친다');
    else if (lockedZonesFor(geometry, none).some((z) => insideRect(z, spawn, 0))) bad.push('spawnPoint: 잠긴 구역 안');
  }
  if (bad.length > 0) throw new StageGeometryError(stageCode, bad);
  return geometry;
}

// ---------- 문·구역 상태(스토리 이벤트 기준) ----------

export const gateOpen = (gate: { openEvent: string }, events: ReadonlySet<string>) => events.has(gate.openEvent);
export const zoneLocked = (zone: { accessAfter: string }, events: ReadonlySet<string>) => !events.has(zone.accessAfter);

// 이 플레이어에게 지금 통과 불가인 사각형: 막힌 곳 + 아직 열리지 않은 문
export function solidsFor(g: StageGeometry, events: ReadonlySet<string>): Rect[] {
  return [...g.blockers, ...g.gates.filter((x) => !gateOpen(x, events))];
}

// 아직 들어갈 수 없는 구역
export function lockedZonesFor(g: StageGeometry, events: ReadonlySet<string>): Rect[] {
  return g.zones.filter((z) => zoneLocked(z, events));
}

// 서버가 문 상태를 풀어서 내려 준 화면 데이터(막힌 곳 + 문마다 open)에서 통과 불가 사각형 — 클라이언트 예측용.
// open은 서버가 gateOpen으로 정한 값이라 해석이 한 곳뿐이다
export function solidsOfView<B extends Rect, G extends Rect & { open: boolean }>(blockers: B[], gates: G[]): (B | G)[] {
  return [...blockers, ...gates.filter((x) => !x.open)];
}

// ---------- 판정 ----------

export function inBounds(g: { width: number; height: number }, p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= g.width && p.y <= g.height;
}

// 점이 사각형을 pad만큼 부풀린 영역의 안쪽에 있는가(경계선 위는 바깥)
export function insideRect(r: Rect, p: Point, pad: number): boolean {
  return p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
}

// 몸(반지름 half)이 통과 불가 사각형에 겹치는가
export function bodyBlocked(solids: Rect[], p: Point, half: number): boolean {
  return solids.some((r) => insideRect(r, p, half));
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

// 마지막 승인 위치 from에서 to로의 이동을 승인할 수 있는가(속도·시간 검증은 호출 쪽이 따로 한다) — 서버 판정
export function checkMove(g: StageGeometry, solids: Rect[], locked: Rect[], from: Point, to: Point, half = SERVER_BODY_HALF): MoveVerdict {
  if (!inBounds(g, to)) return 'out_of_bounds';
  if (bodyBlocked(solids, to, half)) return 'blocked';
  if (segmentBlocked(solids, from, to)) return 'tunnel';
  if (locked.some((z) => insideRect(z, to, 0))) return 'locked_zone';
  return 'ok';
}

// 저장돼 있던 위치를 다시 쓸 수 있는가(재접속·재입장). 지도 밖·벽 안·닫힌 문 너머면 시작 지점으로 보정한다 — 서버 판정
export function safePosition(g: StageGeometry, solids: Rect[], locked: Rect[], p: Point, half = SERVER_BODY_HALF): { x: number; y: number; corrected: boolean } {
  const ok = inBounds(g, p) && !bodyBlocked(solids, p, half) && !locked.some((z) => insideRect(z, p, 0));
  return ok ? { x: p.x, y: p.y, corrected: false } : { x: g.spawn.x, y: g.spawn.y, corrected: true };
}

// 대상(수집 오브젝트·이야기 지점·야생 터비·스토리 전투 지점)에 닿을 수 있는가 — 서버의 모든 "거기 있었는가" 판정이 이 함수 하나를 쓴다.
// 거리 한도는 행동마다 다르므로 호출 쪽이 따로 본다. 여기서는 벽·닫힌 문과 잠긴 구역만 판정한다.
//   locked_zone = 대상이 아직 열리지 않은 구역 안에 있다(플레이어가 그 구역 밖에 있어야 정상이므로 닿을 수 없다)
//   blocked     = 선분이 막힌 곳·닫힌 문 내부를 지난다
export type ReachVerdict = 'ok' | 'blocked' | 'locked_zone';
export function reachVerdict(solids: Rect[], locked: Rect[], from: Point, target: Point): ReachVerdict {
  if (locked.some((z) => insideRect(z, target, 0))) return 'locked_zone';
  if (segmentBlocked(solids, from, target)) return 'blocked';
  return 'ok';
}

// 한 걸음(클라이언트 예측): 가로·세로를 따로 시험해 벽을 따라 미끄러진다
export function stepWithSolids(solids: Rect[], from: Point, to: Point, half = CLIENT_BODY_HALF): Point {
  const x = bodyBlocked(solids, { x: to.x, y: from.y }, half) ? from.x : to.x;
  const y = bodyBlocked(solids, { x, y: to.y }, half) ? from.y : to.y;
  return { x, y };
}
