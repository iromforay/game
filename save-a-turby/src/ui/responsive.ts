// 실제 표시 크기에 맞춘 레이아웃(v3 §5). 캔버스는 1280×720을 화면에 맞춰 줄여 보이므로(FIT), 작은 화면에서는
// 캔버스 좌표의 글자도 함께 줄어든다. 화면 전체를 키우지 않고, 표시 배율을 읽어 "작은 화면용 배치"와 글자 크기를 고른다.
// 순수 계산 — Phaser 없이 테스트한다(test/responsive.test.ts).

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

// 최종 화면 기준 최소 글자(px): 본문 12, 주요 버튼 14 (v3 §5)
export const MIN_BODY_PX = 12;
export const MIN_BUTTON_PX = 14;

export type LayoutMode = 'regular' | 'compact';

// 표시 배율(화면에 보이는 캔버스 폭 ÷ 1280). 0이나 비정상 값이면 1
export function displayScaleOf(displayWidth: number): number {
  return displayWidth > 0 && Number.isFinite(displayWidth) ? displayWidth / CANVAS_W : 1;
}

// 표시 폭이 960px(0.75배) 미만이면 작은 화면용 배치
export function layoutModeOf(scale: number): LayoutMode {
  return scale < 0.75 ? 'compact' : 'regular';
}

// 캔버스 글자 크기: 기본값과 "최종 화면 minPx 이상이 되는 크기" 중 큰 값
export function fontPx(scale: number, basePx: number, minFinalPx: number): number {
  return Math.max(basePx, Math.ceil(minFinalPx / Math.max(0.1, scale)));
}

// 최종 화면에서 보이는 글자 크기
export const finalPx = (canvasPx: number, scale: number) => canvasPx * scale;

// 배치 기준 키: 모드와 글자 크기 계산(fontPx)이 달라지는 배율 구간이 같으면 같은 키.
// 화면 크기가 바뀌어도 이 키가 그대로면 다시 배치할 필요가 없다(v5 §4 — resize 때 불필요한 재시작 방지)
// (모든 호출에서 기본 크기 ≥ 최소 크기라 배율 1 이상은 글자가 바뀌지 않는다 — 한 키로 묶는다)
export function layoutKey(scale: number): string {
  if (scale >= 1) return 'regular:base';
  const s = Math.max(0.1, scale);
  return `${layoutModeOf(scale)}:${[12, 13, 14, 15, 16, 20].map((m) => Math.ceil(m / s)).join(',')}`;
}
