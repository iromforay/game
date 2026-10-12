// 전체 지도 이름표 규칙(10-12 v4) — Phaser 없는 순수 계산. 렌더 코드(MiniMap)는 이 결과만 따른다.
// 반복 대상(실가루·야생 터비·완료/비활성 이야기 지점)은 아이콘만, 활성 이야기 목표는 이름표를 최대 1개만 보여 준다.
import type { MarkerType } from './screenStates';

export interface LabelMarker {
  id: string;
  type: MarkerType;
  active?: boolean; // 이야기 지점: 지금 진행 가능한가(생략하면 활성). 완료·비활성은 false
  order?: number; // 이야기 진행 순서(작을수록 먼저). 생략하면 맨 뒤
}

export interface LabelSelection {
  labelId: string | null; // 이름표를 보여 줄 마커(최대 1개)
  iconOnlyIds: string[]; // 아이콘만 보여 줄 마커(입력 순서와 무관하게 id 정렬)
}

// 이름표를 이 규칙으로 정하는 종류(반복 대상). 집·장터·출구 같은 고정 장소는 이 규칙의 대상이 아니다
export const REPEATING_TYPES: readonly MarkerType[] = ['dust', 'wild', 'story'];

// 안정적인 우선순위: 명시적 목표(targetId·target 종류) → 이야기 진행 순서 → id 정렬. 입력 순서와 무관하다
export function selectMapLabels(markers: readonly LabelMarker[], opts: { targetId?: string | null } = {}): LabelSelection {
  const candidates = markers.filter((m) => (m.type === 'story' || m.type === 'target') && m.active !== false);
  const rank = (m: LabelMarker) => (opts.targetId && m.id === opts.targetId ? 0 : m.type === 'target' ? 1 : 2);
  const sorted = [...candidates].sort((a, b) => rank(a) - rank(b) || (a.order ?? Infinity) - (b.order ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const labelId = sorted[0]?.id ?? null;
  const iconOnlyIds = markers.filter((m) => m.id !== labelId).map((m) => m.id).sort();
  return { labelId, iconOnlyIds };
}

export interface Rect { x: number; y: number; width: number; height: number }

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export const containedIn = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

// 이름표 위치(왼쪽 위). 후보 순서: 마커 아래 → 위 → 오른쪽 → 왼쪽. 지도 안에 완전히 포함되고, 마커 중심과 다른 마커(avoid)를 덮지 않는 첫 후보를 쓴다.
// 모든 후보가 막히면 지도 안에 고정한 아래 후보를 쓴다(마커 중심은 덮지 않는다).
export function placeMapLabel(anchor: { x: number; y: number }, markerSize: number, label: { width: number; height: number }, bounds: Rect, gap = 8, avoid: readonly Rect[] = []): { x: number; y: number } {
  const margin = 2;
  const clampX = (x: number) => Math.min(Math.max(x, bounds.x + margin), bounds.x + bounds.width - label.width - margin);
  const clampY = (y: number) => Math.min(Math.max(y, bounds.y + margin), bounds.y + bounds.height - label.height - margin);
  const half = markerSize / 2;
  const candidates = [
    { x: clampX(anchor.x - label.width / 2), y: anchor.y + half + gap }, // 아래
    { x: clampX(anchor.x - label.width / 2), y: anchor.y - half - gap - label.height }, // 위
    { x: anchor.x + half + gap, y: clampY(anchor.y - label.height / 2) }, // 오른쪽
    { x: anchor.x - half - gap - label.width, y: clampY(anchor.y - label.height / 2) }, // 왼쪽
  ];
  const center = { x: anchor.x - 1, y: anchor.y - 1, width: 2, height: 2 };
  for (const c of candidates) {
    const r = { x: c.x, y: c.y, width: label.width, height: label.height };
    if (!containedIn(r, { x: bounds.x + margin, y: bounds.y + margin, width: bounds.width - margin * 2, height: bounds.height - margin * 2 })) continue;
    if (intersectionArea(r, center) > 0) continue;
    if (avoid.some((a) => intersectionArea(r, a) > 0)) continue;
    return c;
  }
  const below = candidates[0];
  return { x: below.x, y: Math.min(Math.max(below.y, bounds.y + margin), bounds.y + bounds.height - label.height - margin) };
}
