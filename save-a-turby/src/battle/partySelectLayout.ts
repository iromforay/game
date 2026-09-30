// 파티 선택 화면 배치(v3 §1·§5) — 순수 계산(test/partySelectLayout.test.ts).
// 카드(자동 참가 누비 + 고를 터비)를 가운데 크게 놓고, 바로 아래 한 줄에 "선택 n/m"과 완료 버튼을 둬 한 시선 흐름으로 만든다.
import { fontPx, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX, type LayoutMode } from '../ui/responsive.ts';
import type { Rect } from '../inventory/inventoryView.ts';

export interface PartySelectLayout {
  mode: LayoutMode;
  titleY: number;
  infoY: number;
  cards: Rect[]; // 한 페이지의 카드 자리(pageSize개 이하)
  pageSize: number;
  pages: number;
  prev: Rect | null; // 여러 페이지일 때만
  next: Rect | null;
  count: Rect; // "선택 n/m" 글자 영역
  button: Rect; // 선택 완료
  leave: { x: number; y: number };
  font: { title: number; body: number; small: number; button: number };
}

export function partySelectLayout(scale: number, cardCount: number): PartySelectLayout {
  const mode = layoutModeOf(scale);
  const font = { title: fontPx(scale, 28, 16), body: fontPx(scale, 17, MIN_BODY_PX), small: fontPx(scale, 14, MIN_BODY_PX), button: fontPx(scale, 22, MIN_BUTTON_PX) };
  const titleY = 20 + font.title / 2;
  const infoY = titleY + font.title / 2 + 12 + font.body / 2;
  const cardsTop = infoY + font.body + 24;
  const buttonH = mode === 'compact' ? 92 : 64;
  const footerGap = 20;
  const bottomLimit = 720 - 16 - Math.max(buttonH, font.small * 2); // 나가기 버튼 줄
  const gap = mode === 'compact' ? 20 : 18;

  // 카드 크기: 기본 크기에서 시작해, 줄 수와 발밑 버튼 줄까지 화면에 들어올 때까지 줄인다(최소 크기 제한)
  let cardW = mode === 'compact' ? 250 : 240;
  let cardH = Math.round(cardW * 1.2);
  const minW = mode === 'compact' ? 170 : 140;
  let perRow = 1;
  let rows = 1;
  const fits = (r: number) => cardsTop + r * cardH + (r - 1) * gap + footerGap + buttonH <= bottomLimit;
  for (;;) {
    perRow = Math.max(1, Math.floor((1280 - 64 + gap) / (cardW + gap)));
    rows = Math.max(1, Math.ceil(cardCount / perRow));
    if (fits(rows) || cardW <= minW) break;
    cardW -= 10;
    cardH = Math.round(cardW * 1.2);
  }
  // 최소 크기로도 넘치면 카드를 더 줄이지 않고 페이지로 나눈다(한 페이지 = 화면에 들어가는 줄 수)
  let maxRows = rows;
  while (maxRows > 1 && !fits(maxRows)) maxRows--;
  const pageSize = Math.min(cardCount, perRow * maxRows);
  const pages = Math.max(1, Math.ceil(cardCount / Math.max(1, pageSize)));
  rows = Math.max(1, Math.ceil(pageSize / perRow));
  const cards: Rect[] = [];
  for (let i = 0; i < pageSize; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, pageSize - row * perRow);
    const rowW = inRow * cardW + (inRow - 1) * gap;
    const x0 = (1280 - rowW) / 2;
    cards.push({ x: x0 + (i % perRow) * (cardW + gap), y: cardsTop + row * (cardH + gap), w: cardW, h: cardH });
  }
  // 카드와 발밑 줄을 한 묶음으로 남는 세로 공간 가운데에 둔다(위에 몰리고 아래가 비지 않게)
  const blockH = rows * cardH + (rows - 1) * gap + footerGap + buttonH;
  const shift = Math.max(0, Math.floor((bottomLimit - cardsTop - blockH) / 2));
  for (const c of cards) c.y += shift;
  const cardsBottom = cardsTop + shift + rows * cardH + (rows - 1) * gap;
  const footerY = Math.min(cardsBottom + footerGap, bottomLimit - buttonH);
  const buttonW = mode === 'compact' ? 340 : 240;
  const countW = font.body * 9;
  const pagerW = pages > 1 ? buttonH : 0;
  const rowW = (pages > 1 ? pagerW * 2 + 24 : 0) + countW + 24 + buttonW;
  const x0 = (1280 - rowW) / 2;
  const cx0 = x0 + (pages > 1 ? pagerW * 2 + 24 : 0);
  return {
    mode,
    titleY,
    infoY,
    cards,
    pageSize,
    pages,
    prev: pages > 1 ? { x: x0, y: footerY, w: pagerW, h: buttonH } : null,
    next: pages > 1 ? { x: x0 + pagerW + 12, y: footerY, w: pagerW, h: buttonH } : null,
    count: { x: cx0, y: footerY, w: countW, h: buttonH },
    button: { x: cx0 + countW + 24, y: footerY, w: buttonW, h: buttonH },
    leave: { x: 16, y: 720 - 16 },
    font,
  };
}
