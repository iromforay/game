// 4장 냉장고 속 지도 위험 요소의 화면 쪽 계산(10-23 C4-1). 판정은 서버(BE rooms/stage-water.ts)가 하고, 화면은 같은 식으로 그리기·예측만 한다.
// 10-26 C5-1: 5장 뜨거운 모래(서리 구역과 같은 규칙, kind heat)·아지랑이 가짜 길(판정 없는 표시 주기)도 여기서 계산한다.
//   - 서리 구역: 아바타가 안에 있으면 이동 속도 배율(서버도 같은 배율로 상한을 낮춘다)
//   - 바늘 칸: 서버 시각 기준 주기(예고 → 내려찍기 → 쉼). 화면은 roomClient.now()(서버 시각 보정)로 단계를 그린다
import type { StageView } from './storyStage';

type Layout = NonNullable<StageView['layout']>;
export type FrostZone = NonNullable<Layout['frost']>[number];
export type NeedleField = NonNullable<Layout['needles']>[number];
export type MirageField = NonNullable<Layout['mirages']>[number];
export type NeedlePhase = 'warn' | 'strike' | 'idle';

const inside = (r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

// 서리 구역 속도 배율(밖이면 1)
export function frostFactorAt(zones: FrostZone[] | undefined, p: { x: number; y: number }): number {
  return zones?.find((z) => inside(z, p))?.slowFactor ?? 1;
}

// 아바타가 서 있는 느려지는 구역의 종류(밖이면 null) — 화면 가장자리 연출·안내 문구를 고른다
export function slowZoneKindAt(zones: FrostZone[] | undefined, p: { x: number; y: number }): 'frost' | 'heat' | null {
  const z = zones?.find((x) => inside(x, p));
  return z ? (z.kind ?? 'frost') : null;
}

// 아지랑이 가짜 길의 지금 불투명도(0~1): 주기 시작부터 showMs 동안 서서히 떠올랐다 사라진다(사인 반주기), 나머지는 0
export function mirageAlphaAt(m: MirageField, now: number): number {
  const t = (((now + m.offsetMs) % m.periodMs) + m.periodMs) % m.periodMs;
  return t < m.showMs ? Math.sin((Math.PI * t) / m.showMs) : 0;
}

// 바늘 칸의 지금 단계(서버 needlePhase와 같은 식)
export function needlePhaseAt(f: NeedleField, now: number): NeedlePhase {
  const t = (((now + f.offsetMs) % f.periodMs) + f.periodMs) % f.periodMs;
  return t < f.warnMs ? 'warn' : t < f.warnMs + f.strikeMs ? 'strike' : 'idle';
}

// 아바타 가운데가 들어 있는 바늘 칸(서버와 같이 가장자리는 바깥)
export function needleUnder(needles: NeedleField[] | undefined, p: { x: number; y: number }): NeedleField | null {
  return needles?.find((f) => inside(f, p)) ?? null;
}
