// 4장 냉장고 속 지도 위험 요소의 화면 쪽 계산(10-23 C4-1). 판정은 서버(BE rooms/stage-water.ts)가 하고, 화면은 같은 식으로 그리기·예측만 한다.
//   - 서리 구역: 아바타가 안에 있으면 이동 속도 배율(서버도 같은 배율로 상한을 낮춘다)
//   - 바늘 칸: 서버 시각 기준 주기(예고 → 내려찍기 → 쉼). 화면은 roomClient.now()(서버 시각 보정)로 단계를 그린다
import type { StageView } from './storyStage';

type Layout = NonNullable<StageView['layout']>;
export type FrostZone = NonNullable<Layout['frost']>[number];
export type NeedleField = NonNullable<Layout['needles']>[number];
export type NeedlePhase = 'warn' | 'strike' | 'idle';

const inside = (r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

// 서리 구역 속도 배율(밖이면 1)
export function frostFactorAt(zones: FrostZone[] | undefined, p: { x: number; y: number }): number {
  return zones?.find((z) => inside(z, p))?.slowFactor ?? 1;
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
