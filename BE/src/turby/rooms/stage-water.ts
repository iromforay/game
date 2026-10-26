// 지역의 물 규칙(10-13 C2-2 물풀 미로) — 얕은 물·깊은 물·물살·안전 앵커. 순수 모듈(DB·소켓·시계를 모른다: 시각 now는 호출 쪽이 넘긴다).
// 판정은 모두 서버가 한다: 클라이언트는 위치만 보고하고, 물살의 ID·방향·거리·목적지를 보낼 수 없다.
//   - 깊은 물: 승인된 위치가 깊은 물 안이면 그 플레이어의 마지막 안전 앵커로 되돌린다(진행·아이템 손실 없음). 되돌린 뒤 1,500ms는 물살을 적용하지 않는다.
//   - 물살: 승인된 위치가 물살 구역 안이면 지역 데이터의 방향·거리만큼 서버가 위치를 옮긴다. 같은 물살은 cooldownMs 동안, 연속 2회까지만.
//   - 목적지가 벽·닫힌 문·깊은 물(몸 반지름 + 12px 여유)·지도 밖이면 밀림 선분을 따라 되돌아오며 가장 가까운 통행 가능 지점으로 보정한다.
// 플레이어별 상태(WaterMemberState)는 서로 공유하지 않는다.
import { bodyBlocked, inBounds, insideRect, SERVER_BODY_HALF, segmentBlocked } from 'turby-stage-geometry';
import type { Point, Rect, StageGeometry } from 'turby-stage-geometry';

export const DEEP_MARGIN_PX = 12; // 깊은 물 경계 여유: 몸 반지름 + 12px
export const MAX_CONSECUTIVE_PUSHES = 2; // 연속 적용 상한
export const SAFE_RETURN_PROTECT_MS = 1500; // 안전 복귀 뒤 물살 보호

export interface WaterArea extends Rect {
  id: string;
  kind: 'shallow' | 'deep';
}
export interface CurrentField extends Rect {
  id: string;
  direction: Point; // 단위 벡터(지역 데이터의 값을 정규화한 것)
  pushDistancePx: number;
  cooldownMs: number;
  requires: string[];
  unless: string[];
}
export interface SafeAnchor {
  id: string;
  x: number;
  y: number;
  radius: number;
  requires: string[]; // 이 사건이 모두 기록된 플레이어만 쓸 수 있다(문 너머의 앵커 — 10-14 C2-7B). 비면 항상
}
// 검은 실 덫(10-13 C2-3): 구조 전까지 그 자리에 있다. 밟으면(반경 안으로 들어서면) slowMs 동안 이동 속도가 slowFactor배로 제한되고,
// 그 상태에서 물살을 맞으면 그 1회 밀림만 extraPushPx 늘어난 뒤 속박·추가 밀림이 함께 풀린다. 구조 사건(rescueEvent)이 기록되면 사라져 다시 발동하지 않는다
export interface BlackThreadTrap {
  id: string;
  x: number;
  y: number;
  radius: number;
  rescueEvent: string;
  slowMs: number;
  slowFactor: number;
  extraPushPx: number;
}
// 서리 구역(10-23 C4-1 4장 냉장고): 승인된 위치가 이 안이면 이동 속도 상한이 slowFactor배가 된다(감각 둔화). 위치를 옮기지 않는다
// 10-26 C5-1: 5장 뜨거운 모래도 같은 규칙(kind heat — 화면 가장자리 연출·안내 문구만 다르다)
export interface FrostZone extends Rect {
  id: string;
  slowFactor: number;
  kind: 'frost' | 'heat';
}
// 아지랑이(10-26 C5-1 5장 사막): 서버 시각 주기로 가짜 길 그림이 보였다 사라진다. 판정 없음(충돌·위치와 무관) — 화면이 같은 시계로 그리도록 수치만 검증해 내려 준다
export interface MirageField extends Rect {
  id: string;
  periodMs: number;
  showMs: number;
  offsetMs: number;
}
// 바늘 칸(10-23 C4-1): 서버 시각으로 도는 주기(periodMs) — 시작부터 warnMs 동안 예고, 이어서 strikeMs 동안 내려찍기, 나머지는 쉼.
// 내려찍는 동안 몸이 칸 안에 있으면 마지막 안전 앵커로 돌아간다(피해·진행 손실 없음, 깊은 물과 같은 복귀). offsetMs로 칸마다 순서를 어긋나게 한다
export interface NeedleField extends Rect {
  id: string;
  periodMs: number;
  warnMs: number;
  strikeMs: number;
  offsetMs: number;
  requires: string[];
  unless: string[];
}
export interface StageWater {
  areas: WaterArea[];
  currents: CurrentField[];
  anchors: SafeAnchor[];
  traps: BlackThreadTrap[];
  frost: FrostZone[];
  needles: NeedleField[];
  mirages: MirageField[];
}

// 지역 JSON 원본(StageStoryData의 같은 이름 필드)
export interface RawWater {
  waterAreas?: unknown;
  currentFields?: unknown;
  safeAnchors?: unknown;
  blackThreadTraps?: unknown;
  frostZones?: unknown;
  needleFields?: unknown;
  mirages?: unknown;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

const deepOf = (w: StageWater) => w.areas.filter((a) => a.kind === 'deep');

// 지역 데이터 → 계약. 없으면 null(물 규칙이 없는 지역). 잘못되면 Error — 서버는 시작 단계에서 멈춘다(geometry 계약과 같은 원칙)
export function parseStageWater(raw: RawWater, geo: StageGeometry, stageCode: string): StageWater | null {
  if (raw.waterAreas === undefined && raw.currentFields === undefined && raw.safeAnchors === undefined && raw.blackThreadTraps === undefined && raw.frostZones === undefined && raw.needleFields === undefined && raw.mirages === undefined) return null;
  const bad: string[] = [];
  const ids = new Set<string>();
  const idOf = (r: Raw, at: string) => {
    if (typeof r.id !== 'string' || r.id.length === 0) bad.push(`${at}: id가 없다`);
    else if (ids.has(r.id)) bad.push(`${at}: id가 겹친다`);
    else ids.add(r.id);
    return String(r.id);
  };
  const rect = (r: Raw, at: string): Rect | null => {
    if (!num(r.x) || !num(r.y) || !num(r.width) || !num(r.height) || r.width <= 0 || r.height <= 0) {
      bad.push(`${at}: x·y·width·height는 숫자(너비·높이는 0보다 큼)`);
      return null;
    }
    if (r.x < 0 || r.y < 0 || r.x + r.width > geo.width || r.y + r.height > geo.height) bad.push(`${at}: 지도 밖으로 나간다`);
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const list = (v: unknown, where: string): Raw[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      bad.push(`${where}: 배열이 아니다`);
      return [];
    }
    return v.filter((x, i) => (obj(x) ? true : (bad.push(`${where}[${i}]: 객체가 아니다`), false))) as Raw[];
  };

  const areas: WaterArea[] = [];
  list(raw.waterAreas, 'waterAreas').forEach((r, i) => {
    const at = `waterAreas[${i}]`;
    const id = idOf(r, at);
    if (r.kind !== 'shallow' && r.kind !== 'deep') bad.push(`${at}(${id}): kind는 shallow 또는 deep`);
    const b = rect(r, `${at}(${id})`);
    if (b && (r.kind === 'shallow' || r.kind === 'deep')) areas.push({ id, kind: r.kind, ...b });
  });

  const currents: CurrentField[] = [];
  list(raw.currentFields, 'currentFields').forEach((r, i) => {
    const at = `currentFields[${i}]`;
    const id = idOf(r, at);
    const b = rect(r, `${at}(${id})`);
    const d = obj(r.direction) && num(r.direction.x) && num(r.direction.y) ? { x: r.direction.x, y: r.direction.y } : null;
    const len = d ? Math.hypot(d.x, d.y) : 0;
    if (!d || len === 0) bad.push(`${at}(${id}): direction은 영벡터가 아닌 {x, y}`);
    if (!num(r.pushDistancePx) || r.pushDistancePx <= 0 || r.pushDistancePx > 200) bad.push(`${at}(${id}): pushDistancePx는 0 초과 200 이하`);
    if (!num(r.cooldownMs) || r.cooldownMs < 300 || r.cooldownMs > 10_000) bad.push(`${at}(${id}): cooldownMs는 300~10000`);
    if (r.requires !== undefined && !strs(r.requires)) bad.push(`${at}(${id}): requires는 이벤트 이름 배열`);
    if (r.unless !== undefined && !strs(r.unless)) bad.push(`${at}(${id}): unless는 이벤트 이름 배열`);
    if (b && d && len > 0 && num(r.pushDistancePx) && num(r.cooldownMs)) {
      const unit = { x: d.x / len, y: d.y / len };
      // 목적지(밀림 끝)도 지도 안: 구역의 네 모서리에서 거리만큼 밀어도 안이어야 한다
      for (const c of [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }]) {
        if (!inBounds(geo, { x: c.x + unit.x * r.pushDistancePx, y: c.y + unit.y * r.pushDistancePx })) {
          bad.push(`${at}(${id}): 밀림 목적지가 지도 밖`);
          break;
        }
      }
      currents.push({ id, ...b, direction: unit, pushDistancePx: r.pushDistancePx, cooldownMs: r.cooldownMs, requires: (r.requires as string[] | undefined) ?? [], unless: (r.unless as string[] | undefined) ?? [] });
    }
  });

  const anchors: SafeAnchor[] = [];
  list(raw.safeAnchors, 'safeAnchors').forEach((r, i) => {
    const at = `safeAnchors[${i}]`;
    const id = idOf(r, at);
    if (!num(r.x) || !num(r.y) || !num(r.radius) || r.radius <= 0 || r.radius > 400) return void bad.push(`${at}(${id}): x·y·radius는 숫자(radius 0 초과 400 이하)`);
    const p = { x: r.x, y: r.y };
    if (!inBounds(geo, p)) return void bad.push(`${at}(${id}): 지도 밖`);
    anchors.push({ id, x: r.x, y: r.y, radius: r.radius, requires: Array.isArray(r.requires) ? (r.requires as unknown[]).filter((e): e is string => typeof e === 'string') : [] });
  });
  // 앵커는 벽·문·깊은 물 위에 있으면 안 된다(되돌아갈 자리는 언제나 서 있을 수 있어야 한다). 문은 닫힌 상태 기준으로 본다
  const fixed: Rect[] = [...geo.blockers, ...geo.gates];
  for (const a of anchors) {
    if (bodyBlocked(fixed, a, SERVER_BODY_HALF)) bad.push(`safeAnchors(${a.id}): 막힌 곳·문과 겹친다`);
    if (areas.some((w) => w.kind === 'deep' && insideRect(w, a, SERVER_BODY_HALF + DEEP_MARGIN_PX))) bad.push(`safeAnchors(${a.id}): 깊은 물과 겹친다`);
  }
  if (areas.some((w) => w.kind === 'deep') && anchors.length === 0) bad.push('깊은 물이 있는데 safeAnchors가 없다');
  const traps: BlackThreadTrap[] = [];
  list(raw.blackThreadTraps, 'blackThreadTraps').forEach((r, i) => {
    const at = `blackThreadTraps[${i}]`;
    const id = idOf(r, at);
    if (!num(r.x) || !num(r.y) || !num(r.radius) || r.radius <= 0 || r.radius > 200) return void bad.push(`${at}(${id}): x·y·radius는 숫자(radius 0 초과 200 이하)`);
    if (typeof r.rescueEvent !== 'string' || r.rescueEvent.length === 0) return void bad.push(`${at}(${id}): rescueEvent가 없다`);
    const slowMs = r.slowMs ?? 1200;
    const slowFactor = r.slowFactor ?? 0.5;
    const extraPushPx = r.extraPushPx ?? 32;
    if (!num(slowMs) || slowMs < 100 || slowMs > 5000) return void bad.push(`${at}(${id}): slowMs는 100~5000`);
    if (!num(slowFactor) || slowFactor <= 0 || slowFactor > 1) return void bad.push(`${at}(${id}): slowFactor는 0 초과 1 이하`);
    if (!num(extraPushPx) || extraPushPx < 0 || extraPushPx > 100) return void bad.push(`${at}(${id}): extraPushPx는 0~100`);
    const p = { x: r.x, y: r.y };
    if (!inBounds(geo, p)) return void bad.push(`${at}(${id}): 지도 밖`);
    if (bodyBlocked(fixed, p, SERVER_BODY_HALF)) bad.push(`${at}(${id}): 막힌 곳·문과 겹친다`);
    if (areas.some((w) => w.kind === 'deep' && insideRect(w, p, SERVER_BODY_HALF + DEEP_MARGIN_PX))) bad.push(`${at}(${id}): 깊은 물과 겹친다`);
    traps.push({ id, x: r.x, y: r.y, radius: r.radius, rescueEvent: r.rescueEvent, slowMs, slowFactor, extraPushPx });
  });
  const frost: FrostZone[] = [];
  list(raw.frostZones, 'frostZones').forEach((r, i) => {
    const at = `frostZones[${i}]`;
    const id = idOf(r, at);
    const b = rect(r, `${at}(${id})`);
    if (!num(r.slowFactor) || r.slowFactor < 0.3 || r.slowFactor > 1) return void bad.push(`${at}(${id}): slowFactor는 0.3~1`);
    const kind = r.kind ?? 'frost';
    if (kind !== 'frost' && kind !== 'heat') return void bad.push(`${at}(${id}): kind는 frost 또는 heat`);
    if (b) frost.push({ id, ...b, slowFactor: r.slowFactor, kind });
  });
  const needles: NeedleField[] = [];
  list(raw.needleFields, 'needleFields').forEach((r, i) => {
    const at = `needleFields[${i}]`;
    const id = idOf(r, at);
    const b = rect(r, `${at}(${id})`);
    if (!num(r.periodMs) || r.periodMs < 1000 || r.periodMs > 10_000) return void bad.push(`${at}(${id}): periodMs는 1000~10000`);
    if (!num(r.warnMs) || r.warnMs < 300) return void bad.push(`${at}(${id}): warnMs는 300 이상(예고 없이 내려찍지 않는다)`);
    if (!num(r.strikeMs) || r.strikeMs < 100) return void bad.push(`${at}(${id}): strikeMs는 100 이상`);
    if (r.warnMs + r.strikeMs >= r.periodMs) return void bad.push(`${at}(${id}): warnMs + strikeMs는 periodMs보다 작다(쉬는 틈이 있어야 지나갈 수 있다)`);
    const offsetMs = r.offsetMs ?? 0;
    if (!num(offsetMs) || offsetMs < 0 || offsetMs >= r.periodMs) return void bad.push(`${at}(${id}): offsetMs는 0 이상 periodMs 미만`);
    if (r.requires !== undefined && !strs(r.requires)) bad.push(`${at}(${id}): requires는 이벤트 이름 배열`);
    if (r.unless !== undefined && !strs(r.unless)) bad.push(`${at}(${id}): unless는 이벤트 이름 배열`);
    if (b) needles.push({ id, ...b, periodMs: r.periodMs, warnMs: r.warnMs, strikeMs: r.strikeMs, offsetMs, requires: (r.requires as string[] | undefined) ?? [], unless: (r.unless as string[] | undefined) ?? [] });
  });
  const mirages: MirageField[] = [];
  list(raw.mirages, 'mirages').forEach((r, i) => {
    const at = `mirages[${i}]`;
    const id = idOf(r, at);
    const b = rect(r, `${at}(${id})`);
    if (!num(r.periodMs) || r.periodMs < 1000 || r.periodMs > 10_000) return void bad.push(`${at}(${id}): periodMs는 1000~10000`);
    if (!num(r.showMs) || r.showMs < 300 || r.showMs >= r.periodMs) return void bad.push(`${at}(${id}): showMs는 300 이상 periodMs 미만`);
    const offsetMs = r.offsetMs ?? 0;
    if (!num(offsetMs) || offsetMs < 0 || offsetMs >= r.periodMs) return void bad.push(`${at}(${id}): offsetMs는 0 이상 periodMs 미만`);
    if (b) mirages.push({ id, ...b, periodMs: r.periodMs, showMs: r.showMs, offsetMs });
  });
  if (needles.length > 0 && anchors.length === 0) bad.push('바늘 칸이 있는데 safeAnchors가 없다');
  for (const a of anchors) if (needles.some((f) => insideRect(f, a, SERVER_BODY_HALF))) bad.push(`safeAnchors(${a.id}): 바늘 칸과 겹친다`);
  if (bad.length > 0) throw new Error(`지역 데이터(${stageCode}) 물 규칙 검증 실패: ${bad.join(' / ')}`);
  return { areas, currents, anchors, traps, frost, needles, mirages };
}

// ---------- 플레이어별 상태 ----------

export interface WaterMemberState {
  anchorId: string | null; // 마지막으로 확정한(앵커 반경 안에 승인된 위치가 있었던) 안전 앵커
  consecutive: number; // 연속 적용 횟수(물살 밖으로 나가면 0)
  appliedAt: Record<string, number>; // 물살 ID → 마지막 적용 시각(ms)
  protectUntil: number; // 이 시각 전에는 물살을 적용하지 않는다
  trapUntil: number; // 이 시각 전까지 덫에 발이 묶여 이동 속도가 제한된다(전투의 wet_bind와는 별개 상태 — 저장·공유하지 않는다)
  trapSlowFactor: number; // trapUntil 동안의 속도 배율
  trapExtraPush: number; // 이 상태에서 물살을 맞을 때 1회 더해지는 밀림(px)
  insideTraps: Record<string, boolean>; // 덫 반경 안에 있는가 — 들어서는 순간 한 번만 발동한다
}
export const newWaterState = (): WaterMemberState => ({ anchorId: null, consecutive: 0, appliedAt: {}, protectUntil: 0, trapUntil: 0, trapSlowFactor: 1, trapExtraPush: 0, insideTraps: {} });

// 지금 이 플레이어의 이동 속도 배율: 덫에 묶인 동안, 그리고 마지막 승인 위치가 서리 구역 안이면 1 미만(둘 다면 곱)
export const speedFactor = (state: WaterMemberState, now: number, water: StageWater | null = null, at: Point | null = null): number =>
  (now < state.trapUntil ? state.trapSlowFactor : 1) * (water && at ? frostFactor(water, at) : 1);
export const frostFactor = (water: StageWater, p: Point): number => water.frost.find((z) => insideRect(z, p, 0))?.slowFactor ?? 1;

// 바늘 칸의 지금 단계(서버 시각 기준). 클라이언트는 같은 식으로 예고·내려찍기를 그린다(판정은 서버)
export function needlePhase(f: NeedleField, now: number): 'warn' | 'strike' | 'idle' {
  const t = (((now + f.offsetMs) % f.periodMs) + f.periodMs) % f.periodMs;
  return t < f.warnMs ? 'warn' : t < f.warnMs + f.strikeMs ? 'strike' : 'idle';
}
const needleActive = (f: NeedleField, events: ReadonlySet<string>) => f.requires.every((e) => events.has(e)) && !(f.unless.length > 0 && f.unless.every((e) => events.has(e)));
// 몸 가운데가 내려찍는 바늘 칸 안인가(가장자리를 스친 정도는 봐준다 — 저학년 기준, 10-23 Codex 의견 P-03 취지)
export const struckBy = (water: StageWater, events: ReadonlySet<string>, p: Point, now: number): NeedleField | null =>
  water.needles.find((f) => needleActive(f, events) && needlePhase(f, now) === 'strike' && insideRect(f, p, 0)) ?? null;

export type WaterOutcome =
  | { kind: 'none' }
  | { kind: 'pushed'; x: number; y: number; currentFieldId: string; trapBonus: number }
  | { kind: 'trapped'; x: number; y: number; trapId: string; until: number } // 덫에 걸렸다 — 위치는 그대로, 속도만 제한
  | { kind: 'returned'; x: number; y: number; anchorId: string | null; cause: 'deep' | 'needle'; needleId?: string };

const eligible = (f: CurrentField, events: ReadonlySet<string>) => f.requires.every((e) => events.has(e)) && !(f.unless.length > 0 && f.unless.every((e) => events.has(e)));

const nearestAnchor = (anchors: SafeAnchor[], p: Point, usable: (a: SafeAnchor) => boolean): SafeAnchor | null => {
  let best: { a: SafeAnchor; d: number } | null = null;
  for (const a of anchors) {
    if (!usable(a)) continue;
    const d = Math.hypot(a.x - p.x, a.y - p.y);
    if (!best || d < best.d) best = { a, d };
  }
  return best?.a ?? null;
};

// 되돌아갈 앵커: 이 플레이어가 마지막으로 확정한 앵커(지금도 서 있을 수 있는 곳이면), 아니면 현재 위치에서 가장 가까운 유효 앵커,
// 그것도 없으면 시작 지점. 이 플레이어의 상태만 본다
export function returnTarget(water: StageWater | null, geo: StageGeometry, solids: Rect[], state: WaterMemberState, from: Point, events: ReadonlySet<string> = new Set()): { x: number; y: number; anchorId: string | null } {
  const usable = (a: SafeAnchor) => !bodyBlocked(solids, a, SERVER_BODY_HALF) && a.requires.every((e) => events.has(e));
  const remembered = water?.anchors.find((a) => a.id === state.anchorId);
  const a = remembered && usable(remembered) ? remembered : water ? nearestAnchor(water.anchors, from, usable) : null;
  return a ? { x: a.x, y: a.y, anchorId: a.id } : { x: geo.spawn.x, y: geo.spawn.y, anchorId: null };
}

export const inDeepWater = (water: StageWater | null, p: Point): boolean => !!water && deepOf(water).some((w) => insideRect(w, p, 0));

// 밀림 선분을 따라 목적지에서 출발점 쪽으로 되돌아오며(4px 간격) 처음 통행 가능한 지점을 찾는다 = 목적지에 가장 가까운 통행 가능 지점
function pushDestination(water: StageWater, geo: StageGeometry, solids: Rect[], locked: Rect[], from: Point, f: CurrentField): Point {
  const deepGuard = deepOf(water);
  const passable = (p: Point) =>
    inBounds(geo, p) &&
    !bodyBlocked(solids, p, SERVER_BODY_HALF) &&
    !segmentBlocked(solids, from, p) &&
    !locked.some((z) => insideRect(z, p, 0)) &&
    !deepGuard.some((w) => insideRect(w, p, SERVER_BODY_HALF + DEEP_MARGIN_PX));
  const steps = Math.max(1, Math.ceil(f.pushDistancePx / 4));
  for (let i = steps; i >= 1; i--) {
    const t = (i / steps) * f.pushDistancePx;
    const p = { x: from.x + f.direction.x * t, y: from.y + f.direction.y * t };
    if (passable(p)) return p;
  }
  return from;
}

// 승인된 위치 `to`에 대한 물 규칙. state는 호출 쪽(방 멤버)이 가진 이 플레이어의 상태이며 여기서 갱신한다
export function resolveWater(water: StageWater | null, geo: StageGeometry, solids: Rect[], locked: Rect[], events: ReadonlySet<string>, state: WaterMemberState, to: Point, now: number): WaterOutcome {
  if (!water) return { kind: 'none' };
  // 덫: 반경 안으로 들어서는 순간 한 번 발동(이미 묶여 있으면 중첩하지 않는다). 구조한 지점의 덫은 없다
  let trapped: { trapId: string; until: number } | null = null;
  for (const t of water.traps) {
    const inside = !events.has(t.rescueEvent) && Math.hypot(to.x - t.x, to.y - t.y) <= t.radius;
    const was = state.insideTraps[t.id] === true;
    state.insideTraps[t.id] = inside;
    if (inside && !was && now >= state.trapUntil) {
      state.trapUntil = now + t.slowMs;
      state.trapSlowFactor = t.slowFactor;
      state.trapExtraPush = t.extraPushPx;
      trapped = { trapId: t.id, until: state.trapUntil };
    }
  }
  if (inDeepWater(water, to)) {
    const back = returnTarget(water, geo, solids, state, to, events);
    state.consecutive = 0;
    state.protectUntil = now + SAFE_RETURN_PROTECT_MS;
    return { kind: 'returned', x: back.x, y: back.y, anchorId: back.anchorId, cause: 'deep' };
  }
  // 바늘: 내려찍는 칸 안이면 마지막 안전 앵커로(복귀 직후 보호 시간에는 다시 맞지 않는다)
  const needle = now >= state.protectUntil ? struckBy(water, events, to, now) : null;
  if (needle) {
    const back = returnTarget(water, geo, solids, state, to, events);
    state.consecutive = 0;
    state.protectUntil = now + SAFE_RETURN_PROTECT_MS;
    return { kind: 'returned', x: back.x, y: back.y, anchorId: back.anchorId, cause: 'needle', needleId: needle.id };
  }
  const touch = (p: Point) => {
    const a = nearestAnchor(water.anchors, p, (x) => Math.hypot(x.x - p.x, x.y - p.y) <= x.radius && x.requires.every((e) => events.has(e)));
    if (a) state.anchorId = a.id;
  };
  touch(to);
  const field = water.currents.find((f) => insideRect(f, to, 0) && eligible(f, events));
  const trapResult: WaterOutcome = trapped ? { kind: 'trapped', x: to.x, y: to.y, ...trapped } : { kind: 'none' };
  if (!field) {
    state.consecutive = 0;
    return trapResult;
  }
  if (now < state.protectUntil) return trapResult;
  if (state.consecutive >= MAX_CONSECUTIVE_PUSHES) return trapResult;
  if (now - (state.appliedAt[field.id] ?? -Infinity) < field.cooldownMs) return trapResult;
  // 덫에 묶인 채 맞는 1회 밀림만 더 멀리 — 적용 뒤 속박과 추가 밀림은 함께 풀린다(중첩·재적용 없음)
  const bonus = now < state.trapUntil ? state.trapExtraPush : 0;
  const dest = pushDestination(water, geo, solids, locked, to, bonus > 0 ? { ...field, pushDistancePx: field.pushDistancePx + bonus } : field);
  if (dest.x === to.x && dest.y === to.y) return trapResult; // 밀 자리가 없다 — 적용 횟수를 쓰지 않는다
  state.appliedAt[field.id] = now;
  state.consecutive += 1;
  if (bonus > 0) {
    state.trapUntil = 0;
    state.trapExtraPush = 0;
  }
  touch(dest);
  return { kind: 'pushed', x: dest.x, y: dest.y, currentFieldId: field.id, trapBonus: bonus };
}
