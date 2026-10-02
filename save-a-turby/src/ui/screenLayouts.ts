// 지역 선택·상점·기지·장비 창·이름 입력의 배치(10-01 v1 §2). 캔버스 1280×720 좌표, 실제 표시 배율로 보통/작은 화면용을 고른다.
// 순수 계산 — Phaser 없이 테스트한다(test/screenLayouts.test.ts). 작은 화면은 글자·터치 영역을 키우고, 넘치면 페이지로 나눈다.
import { fontPx, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX, type LayoutMode } from './responsive.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pager {
  pages: number;
  perPage: number;
  prev: Rect;
  next: Rect;
  label: { x: number; y: number };
}
const W = 1280;
const H = 720;
// 최종 화면에서 40px 이상인 터치 높이(작은 화면만 키운다)
const touchH = (scale: number, base: number) => Math.max(base, Math.ceil(40 / Math.max(0.1, scale)));
export const pageOf = <T>(items: T[], page: number, perPage: number): T[] => items.slice(page * perPage, (page + 1) * perPage);
export const clampPage = (page: number, pages: number) => Math.min(Math.max(0, page), Math.max(1, pages) - 1);

// 아래 줄: [◀] [가운데 버튼] [▶] — 페이지가 하나면 가운데 버튼만
function bottomBar(scale: number, font: number, centerW: number, pages: number, perPage: number): { center: Rect; pager: Pager | null } {
  const h = touchH(scale, 64);
  const y = H - 8 - h;
  const center = { x: W / 2 - centerW / 2, y, w: centerW, h };
  if (pages <= 1) return { center, pager: null };
  const pw = Math.round(h * 1.4);
  const labelW = Math.round(font * 4);
  const prev = { x: center.x - 16 - labelW - pw, y, w: pw, h };
  const next = { x: center.x + center.w + 16 + labelW, y, w: pw, h };
  return { center, pager: { pages, perPage, prev, next, label: { x: center.x - 16 - labelW / 2, y: y + h / 2 } } };
}

// ---------- 지역 선택 ----------
export interface StageSelectLayout {
  mode: LayoutMode;
  font: { header: number; title: number; name: number; small: number; badge: number; button: number };
  header: Rect;
  cards: Rect[]; // 한 페이지의 카드 자리
  back: Rect;
  pager: Pager | null;
  // 카드 안쪽(카드 왼쪽 위 기준)
  inner: { pad: number; titleY: number; preview: Rect; nameY: number; nameH: number; rep: { y: number; size: number }; hintY: number; hintLines: number; badge: Rect };
  toastY: number;
}
export function stageSelectLayout(scale: number, count: number): StageSelectLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = {
    header: fontPx(scale, 30, 16),
    title: fontPx(scale, 20, 14),
    name: fontPx(scale, 17, 13),
    small: fontPx(scale, 13, MIN_BODY_PX),
    badge: fontPx(scale, 16, 13),
    button: fontPx(scale, 20, MIN_BUTTON_PX),
  };
  const header = compact ? { x: W / 2 - 260, y: 6, w: 520, h: 64 } : { x: W / 2 - 220, y: 10, w: 440, h: 72 };
  const gap = compact ? 20 : 16;
  const cardW = compact ? 384 : 216;
  const perPage = Math.max(1, Math.min(count || 1, Math.floor((W - 64 + gap) / (cardW + gap))));
  const pages = Math.max(1, Math.ceil(count / perPage));
  const bar = bottomBar(scale, font.button, compact ? 400 : 240, pages, perPage);
  const top = header.y + header.h + (compact ? 10 : 22);
  const cardH = compact ? bar.center.y - 10 - top : 452;
  const n = Math.min(perPage, Math.max(1, count));
  const x0 = (W - (n * cardW + (n - 1) * gap)) / 2;
  const cards = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cardW + gap), y: top, w: cardW, h: cardH }));
  // 카드 테두리 그림(로프)은 카드 폭에 맞춰 늘어난다 — 안쪽 여백도 그 두께만큼(보통 24, 작은 화면은 폭 384라 약 2배)
  const pad = compact ? 60 : 24;
  const iw = cardW - pad * 2;
  const badgeH = compact ? touchH(scale, 46) : 46;
  const badge = { x: pad, y: cardH - (compact ? 40 : 15) - badgeH, w: iw, h: badgeH };
  const titleY = compact ? 44 + font.title / 2 : 36;
  const previewY = titleY + font.title / 2 + (compact ? 6 : 12);
  const previewH = compact ? 56 : Math.round((iw * 126) / 196); // 작은 화면은 그림을 줄여 잠금 이유 5줄 자리를 낸다
  const nameY = previewY + previewH + (compact ? 6 : 32);
  const repSize = compact ? 52 : 64;
  const repY = nameY + font.name * 2.4 + 4; // 지역 이름 두 줄 자리(긴 이름은 글자를 줄여 두 줄 안에 — 자르지 않는다)
  const hintY = repY + repSize + (compact ? 4 : 6);
  const hintLines = Math.max(1, Math.floor((badge.y - 6 - hintY) / (font.small * 1.2)));
  return {
    mode,
    font,
    header,
    cards,
    back: bar.center,
    pager: bar.pager,
    inner: { pad, titleY, preview: { x: pad, y: previewY, w: iw, h: previewH }, nameY, nameH: repY - 4 - nameY, rep: { y: repY, size: repSize }, hintY, hintLines, badge },
    toastY: bar.center.y - 44,
  };
}

// ---------- 상점 ----------
export interface MarketLayout {
  mode: LayoutMode;
  font: { header: number; tare: number; name: number; chip: number; body: number; button: number };
  header: Rect;
  tare: Rect;
  cards: Rect[];
  back: Rect;
  pager: Pager | null;
  inner: { icon: Rect; textX: number; textW: number; nameY: number; chip: Rect; descY: number; descLines: number; statY: number; statW: number; owned: { x: number; y: number }; buy: Rect };
  toastY: number;
}
export function marketLayout(scale: number, count: number): MarketLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = {
    header: fontPx(scale, 28, 16),
    tare: fontPx(scale, 22, 14),
    name: fontPx(scale, 21, 14),
    chip: fontPx(scale, 13, MIN_BODY_PX),
    body: fontPx(scale, 13, MIN_BODY_PX),
    button: fontPx(scale, 16, MIN_BUTTON_PX),
  };
  const header = compact ? { x: W / 2 - 220, y: 4, w: 440, h: 64 } : { x: W / 2 - 240, y: 4, w: 480, h: 76 };
  const tare = compact ? { x: 16, y: 6, w: 300, h: 60 } : { x: 28, y: 22, w: 260, h: 72 };
  const cols = compact ? 2 : 3;
  const gap = 20;
  const cardW = compact ? Math.floor((W - 48 - gap) / 2) : 370;
  const top = compact ? 78 : 104;
  const rows = 2;
  const perPage = cols * rows;
  const pages = Math.max(1, Math.ceil(count / perPage));
  const bar = bottomBar(scale, font.button, compact ? 400 : 240, pages, perPage);
  const cardH = compact ? Math.floor((bar.center.y - 12 - top - gap) / 2) : 190;
  const x0 = (W - (cols * cardW + (cols - 1) * gap)) / 2;
  const n = Math.min(perPage, Math.max(0, count));
  const cards = Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * (cardW + gap), y: top + Math.floor(i / cols) * (cardH + gap), w: cardW, h: cardH }));
  const iconSize = compact ? 120 : 104;
  const textX = 16 + iconSize + 12;
  const padR = compact ? 30 : 24; // 오른쪽 테두리 안쪽
  const buyH = compact ? touchH(scale, 44) : 44;
  const buyW = compact ? 230 : 176; // "150 타레 · 부족"이 들어가는 폭
  const buy = { x: cardW - padR - buyW, y: cardH - (compact ? 24 : 18) - buyH, w: buyW, h: buyH };
  const nameY = compact ? 46 : 34; // 위쪽 테두리(로프) 아래에서 시작
  const chipH = Math.round(font.chip * (compact ? 1.5 : 1.8));
  const chip = { x: textX, y: nameY + font.name * 1.25 + 4, w: Math.round(font.chip * 6.5), h: chipH };
  const descY = chip.y + chipH + 4;
  // 능력치: 보통 화면은 구매 버튼 위 줄, 작은 화면은 구매 버튼과 같은 줄의 왼쪽(세로 공간 절약)
  const statY = compact ? buy.y + (buyH - font.body * 1.25) / 2 : buy.y - 4 - font.body * 1.25;
  const descBottom = compact ? buy.y - 2 : statY - 2;
  const descLines = Math.max(1, Math.min(2, Math.floor((descBottom - descY) / (font.body * 1.2))));
  return {
    mode,
    font,
    header,
    tare,
    cards,
    back: bar.center,
    pager: bar.pager,
    inner: { icon: { x: 16, y: 16, w: iconSize, h: iconSize }, textX, textW: cardW - textX - padR, nameY, chip, descY, descLines, statY, statW: compact ? buy.x - 10 - textX : cardW - textX - padR, owned: { x: chip.x + chip.w + 10, y: chip.y + chipH / 2 }, buy },
    toastY: bar.center.y - 44,
  };
}

// ---------- 기지(가방·선반) ----------
export interface HomeLayout {
  mode: LayoutMode;
  font: { title: number; section: number; name: number; button: number; small: number };
  titleY: number;
  tare: { x: number; y: number };
  sections: { title: { x: number; y: number }; cells: Rect[]; pager: { prev: Rect; next: Rect; label: { x: number; y: number } } }[]; // 0 = 가방, 1 = 선반
  perRow: number;
  cell: { image: number; nameY: number; move: Rect; equip: Rect };
  exit: Rect;
  toastY: number;
}
export function homeLayout(scale: number): HomeLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = { title: fontPx(scale, 26, 16), section: fontPx(scale, 16, 13), name: fontPx(scale, 13, MIN_BODY_PX), button: fontPx(scale, 14, MIN_BUTTON_PX), small: fontPx(scale, 12, MIN_BODY_PX) };
  const titleY = compact ? 26 : 30;
  const exitH = touchH(scale, 56);
  const exit = { x: W / 2 - (compact ? 200 : 130), y: H - 8 - exitH, w: compact ? 400 : 260, h: exitH };
  const top = titleY + font.title / 2 + (compact ? 6 : 14);
  const sectionH = Math.floor((exit.y - 8 - top) / 2);
  const image = compact ? 64 : 64;
  const btnH = compact ? Math.max(Math.round(font.button * 1.5), 44) : Math.round(font.button * 1.9);
  const cellW = compact ? 190 : 124;
  const pagerW = compact ? 84 : 56;
  const gap = compact ? 10 : 12;
  const perRow = Math.max(1, Math.floor((W - 32 - 2 * (pagerW + 12) + gap) / (cellW + gap)));
  const titleH = Math.round(font.section * 1.4);
  const nameY = image + 4;
  const moveY = nameY + Math.round(font.name * 1.3) + 4;
  const cellH = moveY + btnH + 4 + btnH;
  const sections = [0, 1].map((i) => {
    const y = top + i * sectionH;
    const cy = y + titleH + 4;
    const x0 = 16 + pagerW + 12;
    const cells = Array.from({ length: perRow }, (_, k) => ({ x: x0 + k * (cellW + gap), y: cy, w: cellW, h: cellH }));
    const py = cy + cellH / 2 - exitH / 2;
    return { title: { x: 16, y }, cells, pager: { prev: { x: 16, y: py, w: pagerW, h: exitH }, next: { x: W - 16 - pagerW, y: py, w: pagerW, h: exitH }, label: { x: W - 16, y: y + titleH / 2 } } };
  });
  return {
    mode,
    font,
    titleY,
    tare: { x: 16, y: compact ? 6 : 16 },
    sections,
    perRow,
    cell: { image, nameY, move: { x: 4, y: moveY, w: cellW - 8, h: btnH }, equip: { x: 4, y: moveY + btnH + 4, w: cellW - 8, h: btnH } },
    exit,
    toastY: exit.y - 40,
  };
}

// ---------- 장비 창 ----------
export interface EquipPanelLayout {
  mode: LayoutMode;
  font: { header: number; label: number; value: number; row: number; note: number; button: number };
  panel: Rect;
  header: Rect;
  close: Rect;
  summary: Rect;
  summaryImage: number;
  statPill: { x: number; y0: number; w: number; h: number; gap: number };
  rows: Rect[]; // 일반 슬롯 줄 + (있으면) 이야기 슬롯 줄
  row: { icon: number; nameX: number; chip: number; action: Rect; noteW: number };
  messageY: number;
}
export function equipPanelLayout(scale: number, rowCount: number): EquipPanelLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = { header: fontPx(scale, 28, 16), label: fontPx(scale, 15, MIN_BODY_PX), value: fontPx(scale, 20, 14), row: fontPx(scale, 16, 13), note: fontPx(scale, 14, MIN_BODY_PX), button: fontPx(scale, 16, MIN_BUTTON_PX) };
  const rowH = compact ? 126 : 116;
  const rowGap = compact ? 6 : 12;
  const headerH = compact ? 72 : 76;
  const n = Math.max(1, rowCount);
  const rowsH = n * rowH + (n - 1) * rowGap;
  const messageH = Math.round(font.note * 1.6);
  const padTop = compact ? 12 : 20;
  const padBottom = compact ? 20 : 28; // 창 테두리 그림의 아래쪽 로프 두께
  const wantH = padTop + headerH + 12 + Math.max(rowsH, compact ? 0 : 372) + 8 + messageH + padBottom;
  const panelH = Math.min(H - 16, Math.max(compact ? 0 : 500, wantH));
  const panel = compact ? { x: 12, y: Math.round((H - panelH) / 2), w: W - 24, h: panelH } : { x: 180, y: Math.round((H - panelH) / 2), w: 920, h: panelH };
  const inX = panel.x + (compact ? 16 : 28);
  const inW = panel.w - (compact ? 32 : 56);
  const header = { x: inX, y: panel.y + padTop, w: inW, h: headerH };
  const closeW = compact ? Math.max(96, touchH(scale, 60)) : 72;
  const close = { x: header.x + header.w - 8 - closeW, y: header.y + (headerH - Math.min(headerH - 12, touchH(scale, 60))) / 2, w: closeW, h: Math.min(headerH - 12, touchH(scale, 60)) };
  const bodyY = header.y + headerH + 12;
  const summaryW = compact ? 230 : 190;
  const summary = { x: inX, y: bodyY, w: summaryW, h: Math.max(rowsH, compact ? 0 : 372) };
  const listX = inX + summaryW + (compact ? 12 : 22);
  const listW = inX + inW - listX;
  const rows = Array.from({ length: n }, (_, i) => ({ x: listX, y: bodyY + i * (rowH + rowGap), w: listW, h: rowH }));
  const pillH = compact ? 52 : 48;
  const summaryImage = compact ? Math.max(48, Math.min(100, summary.h - 4 * (pillH + 6) - 20)) : 100;
  const actionH = compact ? touchH(scale, 48) : 48;
  const actionW = compact ? 190 : 132;
  return {
    mode,
    font,
    panel,
    header,
    close,
    summary,
    summaryImage,
    statPill: { x: summary.x + 12, y0: summary.y + summaryImage + 16, w: summaryW - 24, h: pillH, gap: compact ? 6 : 10 },
    rows,
    row: { icon: compact ? 76 : 84, nameX: (compact ? 76 : 84) + 30, chip: compact ? 72 : 68, action: { x: listW - 16 - actionW, y: (rowH - actionH) / 2, w: actionW, h: actionH }, noteW: listW - ((compact ? 76 : 84) + 30) - actionW - 28 },
    messageY: panel.y + panel.h - padBottom - messageH / 2,
  };
}

// ---------- 이름 입력(오프닝) ----------
// 가상 키보드가 화면 아래쪽 절반 가까이를 가려도 입력창·규칙·오류 문구·확인 버튼이 보이도록 모두 화면 위쪽 절반 안에 둔다.
export interface NameInputLayout {
  panel: Rect;
  promptY: number;
  input: Rect; // 가운데 기준이 아니라 왼쪽 위 기준
  ruleY: number;
  errorY: number;
  button: Rect;
  font: { prompt: number; input: number; rule: number; button: number };
  visibleBottom: number; // 이 높이 위쪽에 모든 요소가 있다
}
export function nameInputLayout(scale: number): NameInputLayout {
  const font = { prompt: fontPx(scale, 28, 16), input: 36, rule: fontPx(scale, 20, MIN_BODY_PX), button: fontPx(scale, 20, MIN_BUTTON_PX) };
  const panel = { x: 160, y: 8, w: 960, h: 344 };
  const promptY = panel.y + 14 + font.prompt * 0.6;
  const inputW = 440;
  const inputH = 80;
  const rowY = promptY + font.prompt * 0.6 + 14;
  const buttonW = 240;
  const total = inputW + 16 + buttonW;
  const input = { x: W / 2 - total / 2, y: rowY, w: inputW, h: inputH };
  const button = { x: input.x + inputW + 16, y: rowY, w: buttonW, h: inputH };
  const ruleY = rowY + inputH + 12 + font.rule * 0.6;
  const errorY = ruleY + font.rule * 1.3 + 4;
  return { panel, promptY, input, ruleY, errorY, button, font, visibleBottom: panel.y + panel.h };
}

// 토스트 글자(작은 화면에서도 읽히게)
export const toastFont = (scale: number) => fontPx(scale, 16, 13);

// ---------- 마을·탐험 HUD ----------
// 왼쪽 위: 재화 → 그 아래 인벤토리 버튼 / 가운데 위: 지역 이름 / 오른쪽 위: 미니맵(지름 144 + 지도 열기 아이콘). 서로 겹치지 않는다.
export interface VillageHudLayout {
  mode: LayoutMode;
  font: { coin: number; title: number; button: number; prompt: number };
  coin: Rect;
  title: Rect;
  inventory: Rect;
  miniMap: Rect; // 미니맵이 차지하는 영역(고정)
  prompt: { w: number; h: number; lift: number }; // 상호작용 안내 버튼(아바타 머리 위)
}
export function villageHudLayout(scale: number): VillageHudLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = { coin: fontPx(scale, 20, 13), title: fontPx(scale, 22, 13), button: fontPx(scale, 18, MIN_BUTTON_PX), prompt: fontPx(scale, 19, MIN_BUTTON_PX) };
  const coin = compact ? { x: 16, y: 12, w: 264, h: 72 } : { x: 16, y: 16, w: 192, h: 58 };
  const title = compact ? { x: W / 2 - 150, y: 12, w: 300, h: 64 } : { x: W / 2 - 120, y: 16, w: 240, h: 48 };
  const invH = Math.round(font.button * 1.25 + 12);
  const inventory = { x: 16, y: coin.y + coin.h + 8, w: Math.round(font.button * 4 + 24), h: invH };
  const miniMap = miniMapLayout(scale).mini.rect;
  const prompt = compact ? { w: 320, h: touchH(scale, 64), lift: 96 } : { w: 190, h: 64, lift: 84 };
  return { mode, font, coin, title, inventory, miniMap, prompt };
}

// ---------- 미니맵·전체 지도(10-01 v2 §4) ----------
// 작은 화면: 미니맵과 마커·글자·닫기 버튼을 키우고, 지도 위 이름표는 겹치므로 빼고 오른쪽 정보 영역의 범례(접기/펼치기)로 옮긴다.
export interface MiniMapLayout {
  mode: LayoutMode;
  mini: { diameter: number; cx: number; cy: number; marker: number; target: number; player: number; open: { x: number; y: number; size: number }; rect: Rect };
  full: {
    map: Rect;
    info: Rect;
    close: Rect;
    legendToggle: Rect | null; // 작은 화면만: 범례 접기/펼치기
    font: { title: number; infoTitle: number; body: number; label: number; hint: number };
    marker: number;
    target: number;
    player: number;
    peer: number;
    labelsOnMap: boolean; // 지도 위 마커 이름표(보통 화면만)
    legendAlways: boolean; // 보통 화면: 정보 영역 아래에 범례를 늘 보여 준다
    legendRow: number;
  };
}
export function miniMapLayout(scale: number): MiniMapLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const d = compact ? 200 : 144;
  const margin = compact ? 12 : 16;
  const cx = W - margin - d / 2;
  const cy = margin + d / 2;
  const openSize = compact ? Math.max(60, touchH(scale, 60) - 16) : 38;
  const open = { x: cx + d * 0.375, y: cy + d * 0.375, size: openSize };
  const rect = { x: W - margin - d, y: margin, w: d, h: Math.ceil(open.y + openSize / 2 - margin) };
  const font = { title: fontPx(scale, 22, 13), infoTitle: fontPx(scale, 22, 14), body: fontPx(scale, 16, MIN_BODY_PX), label: fontPx(scale, 14, MIN_BODY_PX), hint: fontPx(scale, 13, MIN_BODY_PX) };
  const map = compact ? { x: 24, y: 24, w: 730, h: 672 } : { x: 60, y: 110, w: 800, h: 450 };
  const info = compact ? { x: 778, y: 24, w: 478, h: 672 } : { x: 890, y: 110, w: 330, h: 450 };
  const closeSize = compact ? touchH(scale, 48) : 48;
  const close = { x: info.x + info.w - 10 - closeSize, y: info.y + 10 - (compact ? 0 : 14), w: closeSize, h: closeSize };
  const toggleH = compact ? touchH(scale, 48) : 0;
  const legendToggle = compact ? { x: info.x + 16, y: info.y + info.h - 16 - toggleH, w: info.w - 32, h: toggleH } : null;
  return {
    mode,
    mini: { diameter: d, cx, cy, marker: compact ? 30 : 20, target: compact ? 38 : 26, player: compact ? 24 : 16, open, rect },
    full: { map, info, close, legendToggle, font, marker: compact ? 68 : 44, target: compact ? 76 : 48, player: compact ? 52 : 34, peer: compact ? 48 : 32, labelsOnMap: !compact, legendAlways: !compact, legendRow: Math.round(font.label * 1.9) },
  };
}

// ---------- 탐험 맵 HUD(10-01 v2 §3) ----------
// 왼쪽 위: 지역 이름 → 포획 수 → 마을로 → 방 상태 / 가운데 위: 스토리 목표(있을 때만) / 오른쪽 위: 미니맵 → 인벤토리·터비 버튼.
// HUD는 모두 화면 위쪽 띠 안에 두고, 아래쪽(조이스틱 조작 영역)은 비운다.
export interface MapHudLayout {
  mode: LayoutMode;
  font: { area: number; label: number; button: number; goal: number; room: number };
  area: Rect;
  captured: Rect;
  home: Rect;
  room: Rect;
  goal: Rect; // 목표 패널이 쓸 수 있는 영역(높이는 최대 — 글이 길면 이 안에서 줄바꿈)
  miniMap: Rect;
  inventory: Rect;
  turbys: Rect;
  joystickZone: Rect; // 이 영역에는 누를 수 있는 HUD를 두지 않는다
  interact: Rect; // 수집·이야기 지점 상호작용 버튼(가까이 갔을 때만 보임) — 목표 패널 바로 아래 가운데(화면 가운데의 캐릭터와 조이스틱 영역을 가리지 않는다)
  toastY: number;
}
export function mapHudLayout(scale: number): MapHudLayout {
  const mode = layoutModeOf(scale);
  const compact = mode === 'compact';
  const font = { area: fontPx(scale, 16, 13), label: fontPx(scale, 18, 13), button: fontPx(scale, 16, MIN_BUTTON_PX), goal: fontPx(scale, 17, 13), room: fontPx(scale, 12, MIN_BODY_PX) };
  const mini = miniMapLayout(scale).mini.rect;
  const leftW = compact ? 300 : 220;
  const lineH = (f: number) => Math.round(f * 1.25 + 8);
  const area = { x: 16, y: compact ? 8 : 12, w: leftW, h: lineH(font.area) };
  const captured = { x: 16, y: area.y + area.h + 4, w: leftW, h: lineH(font.label) };
  const btnH = compact ? touchH(scale, 44) : Math.round(font.button * 1.25 + 12);
  const home = { x: 16, y: captured.y + captured.h + 6, w: compact ? 200 : 110, h: btnH };
  const room = { x: 16, y: home.y + home.h + 6, w: leftW, h: lineH(font.room) };
  const goalX = 16 + leftW + 16;
  const goal = { x: goalX, y: 8, w: mini.x - 16 - goalX, h: Math.round(font.goal * 1.3 * 3 + 20) };
  const btnW = compact ? 200 : 120;
  const inventory = { x: W - 16 - btnW, y: mini.y + mini.h + 8, w: btnW, h: btnH };
  const turbys = { x: W - 16 - btnW, y: inventory.y + btnH + 8, w: btnW, h: btnH };
  const hudBottom = Math.max(room.y + room.h, turbys.y + turbys.h, goal.y + goal.h);
  const zoneY = Math.max(H / 2, hudBottom + 8);
  // 상호작용 버튼: 왼쪽 HUD 열과 오른쪽 버튼 열 사이, 목표 패널 바로 아래
  const interactH = Math.max(touchH(scale, compact ? 48 : 44), Math.round(font.button * 1.25 + 20)); // 어느 배율에서도 실제 화면 40px 이상
  const interactW = compact ? 420 : 280;
  const interact = { x: Math.round(W / 2 - interactW / 2), y: goal.y + goal.h + 8, w: interactW, h: interactH };
  return { mode, font, area, captured, home, room, goal, miniMap: mini, inventory, turbys, joystickZone: { x: 0, y: zoneY, w: W, h: H - zoneY }, interact, toastY: H - 60 };
}

// 가상 키보드 대응(10-01 v2 §5): 입력 줄(위·아래, 화면 px)이 보이는 영역(visualViewport) 아래로 가려지면 위로 올릴 양(px).
// 줄이 이미 보이면 0. 줄의 위쪽이 보이는 영역 위로 나가지 않는 만큼만 올린다.
export function keyboardShift(rowTop: number, rowBottom: number, visibleTop: number, visibleBottom: number, margin = 6): number {
  if (!(visibleBottom > visibleTop)) return 0;
  if (rowBottom + margin <= visibleBottom) return 0;
  const want = rowBottom + margin - visibleBottom;
  const room = Math.max(0, rowTop - visibleTop - margin);
  return Math.round(Math.min(want, room));
}
