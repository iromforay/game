// MMORPG형 인벤토리 판정·배치(v3 §2·§3) — Phaser와 분리된 순수 모듈(test/inventoryView.test.ts).
// 수량·잠금·장착 가능 여부는 서버가 정본이다. 여기서는 서버 응답을 탭·칸·상세·배치로 옮기기만 한다.
import { fontPx, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX, type LayoutMode } from '../ui/responsive.ts';

export type InventoryTab = 'equipment' | 'consumable' | 'material' | 'story';
export type TabFilter = 'all' | InventoryTab;

export interface InventoryItem {
  recordId: string;
  itemDefinitionId: number;
  itemCode: string;
  iconKey: string;
  name: string;
  description: string;
  tab: InventoryTab;
  tabLabel: string;
  category: string;
  storySlot: string | null;
  quantity: number;
  maxStack: number;
  stacks: number[];
  slotsUsed: number;
  equipped: number;
  equippedOnStoryNubi: boolean;
  isNew: boolean;
  isLocked: boolean;
  usedAt: string | null;
  firstAcquiredAt: string | null;
  lastAcquiredAt: string | null;
  permissions: { sell: boolean; discard: boolean; trade: boolean; consume: boolean; unequip: boolean };
  lockReason: string | null;
  storyAction: { kind: 'equip_story_nubi'; label: string; available: boolean; reason: string | null } | null;
}

export interface InventoryList {
  bag: { capacity: number; used: number };
  overflowCount: number;
  items: InventoryItem[];
}

export const TABS: { key: TabFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'material', label: '재료' },
  { key: 'consumable', label: '소비' },
  { key: 'equipment', label: '장비' },
  { key: 'story', label: '스토리' },
];

// 탭 필터 + 정렬(최근 획득 → 이름). 신규 여부로 정렬하지 않는다 — 상세를 열어 신규가 풀릴 때 칸이 옮겨 가지 않게(신규는 N 배지로)
export function filterItems(items: InventoryItem[], tab: TabFilter): InventoryItem[] {
  return items
    .filter((i) => tab === 'all' || i.tab === tab)
    .slice()
    .sort((a, b) => (b.lastAcquiredAt ?? '').localeCompare(a.lastAcquiredAt ?? '') || a.name.localeCompare(b.name));
}

// 격자 칸: 서버가 나눈 묶음(max_stack 단위)마다 한 칸. 수량 배지는 2개 이상일 때만
export interface GridCell {
  item: InventoryItem;
  stackIndex: number;
  count: number;
  badge: string | null;
}
export function gridCells(items: InventoryItem[]): GridCell[] {
  return items.flatMap((item) => item.stacks.map((count, stackIndex) => ({ item, stackIndex, count, badge: count > 1 ? String(count) : null })));
}

export const EMPTY_TEXT: Record<TabFilter, string> = {
  all: '아직 모은 아이템이 없어요',
  material: '재료가 없어요',
  consumable: '소비 아이템이 없어요',
  equipment: '장비가 없어요',
  story: '이야기 물건이 없어요',
};

// 상세 패널 문구와 행동
// 상세 패널(v5 §5.2): 1 이름·상태 배지 → 2 설명 → 3 수량·분류 → 4 잠금 이유 → 5 누비 슬롯·가능한 행동 순으로 나눠 그린다.
// 문구는 서버·기존 문구 그대로(배지는 이미 쓰던 짧은 표기).
export interface DetailView {
  title: string;
  badges: string[]; // 이름 옆 상태: 신규·잠김·장착됨
  description: string | null;
  meta: string[]; // 수량·분류(·최근 획득)
  lines: string[]; // 설명 + meta(이전 형식, 호환용)
  equip: { label: string; enabled: boolean; note: string | null } | null;
  equippedLabel: string | null;
  lockNote: string | null;
}
// 이야기 유물(category relic)은 탭 이름(스토리) 대신 정본 분류명으로 보이고, 잠금 이유 앞에 전용 표기를 붙인다(10-14 C2-5B)
export const RELIC_CATEGORY_LABEL = '이야기 유물';
export const RELIC_LOCK_LABEL = '이야기 동료 전용';

// 인벤토리 아이콘 후보 키(item-<코드> → items/** 에셋의 kebab 파일명). 앞에서부터 있는 것을 쓴다
export function itemIconCandidates(iconKey: string): string[] {
  return [`item-${iconKey}`, iconKey.replace(/_/g, '-')];
}

export function detailOf(item: InventoryItem): DetailView {
  const meta = [`수량: ${item.quantity}${item.maxStack > 1 ? ` (한 칸 최대 ${item.maxStack})` : ''}`, `분류: ${item.category === 'relic' ? RELIC_CATEGORY_LABEL : item.tabLabel}`];
  if (item.lastAcquiredAt) meta.push(`최근 획득: ${item.lastAcquiredAt.slice(0, 10)}`);
  const badges = [item.isNew ? '신규' : null, item.isLocked ? '잠김' : null, item.equippedOnStoryNubi ? '장착됨' : null].filter((b): b is string => b !== null);
  return {
    title: item.name,
    badges,
    description: item.description ?? null,
    meta,
    lines: [...(item.description ? [item.description] : []), ...meta],
    equip: item.storyAction ? { label: item.storyAction.label, enabled: item.storyAction.available, note: item.storyAction.available ? null : item.storyAction.reason } : null,
    equippedLabel: item.equippedOnStoryNubi ? '누비에게 장착됨' : null,
    lockNote: item.isLocked ? (item.category === 'relic' ? `${RELIC_LOCK_LABEL} · ${item.lockReason ?? '잠긴 아이템이에요'}` : (item.lockReason ?? '잠긴 아이템이에요')) : null,
  };
}

// 이야기 누비 슬롯: 장착된 유물 + 가지고 있지만 아직 장착하지 않은 유물의 빈 슬롯(가진 적 없는 유물 슬롯은 스포일러라 보이지 않음)
export interface NubiSlot {
  slotKey: string;
  label: string; // 슬롯 이름(유물 이름)
  equipped: boolean;
  status: string;
}
export function nubiSlots(storyNubi: { slots: { slotKey: string; itemCode: string; name: string }[] } | null | undefined, items: InventoryItem[]): NubiSlot[] {
  const out = new Map<string, NubiSlot>();
  for (const s of storyNubi?.slots ?? []) out.set(s.slotKey, { slotKey: s.slotKey, label: s.name, equipped: true, status: '장착됨' });
  for (const i of items) if (i.storySlot && !out.has(i.storySlot)) out.set(i.storySlot, { slotKey: i.storySlot, label: i.name, equipped: false, status: '빈 슬롯' });
  return [...out.values()].sort((a, b) => a.slotKey.localeCompare(b.slotKey));
}
export const NUBI_FIXED_NOTE = '누비는 이야기의 고정 동료예요. 이야기 유물은 팔거나 버리거나 해제할 수 없어요.';

// ---------- 배치(캔버스 1280×720 좌표) ----------
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface InventoryLayout {
  mode: LayoutMode;
  window: Rect;
  header: Rect;
  tabs: Rect[];
  grid: Rect;
  cols: number;
  cell: number;
  detail: Rect;
  font: { title: number; body: number; button: number; badge: number };
}

export function inventoryLayout(scale: number): InventoryLayout {
  const mode = layoutModeOf(scale);
  const font = {
    title: fontPx(scale, 26, 16),
    body: fontPx(scale, 16, MIN_BODY_PX),
    button: fontPx(scale, 18, MIN_BUTTON_PX),
    badge: fontPx(scale, 14, MIN_BODY_PX),
  };
  // 작은 화면: 창이 화면 전체를 쓰고 칸을 키운다. 보통 화면: 가운데 창
  const window: Rect = mode === 'compact' ? { x: 0, y: 0, w: 1280, h: 720 } : { x: 140, y: 60, w: 1000, h: 600 };
  const pad = mode === 'compact' ? 16 : 20;
  const headerH = mode === 'compact' ? 76 : 60;
  const tabH = mode === 'compact' ? 70 : 48;
  const header: Rect = { x: window.x + pad, y: window.y + pad / 2, w: window.w - pad * 2, h: headerH };
  const tabsY = header.y + headerH + 4;
  const detailW = mode === 'compact' ? 520 : 330;
  const gridX = window.x + pad;
  const gridW = window.w - pad * 3 - detailW;
  const tabW = Math.floor((gridW - 4 * 6) / 5);
  const tabs = [0, 1, 2, 3, 4].map((i) => ({ x: gridX + i * (tabW + 6), y: tabsY, w: tabW, h: tabH }));
  const gridY = tabsY + tabH + 10;
  const grid: Rect = { x: gridX, y: gridY, w: gridW, h: window.y + window.h - pad - gridY };
  const cell = mode === 'compact' ? 136 : 92;
  const cols = Math.max(1, Math.floor((gridW + 8) / (cell + 8)));
  const detail: Rect = { x: gridX + gridW + pad, y: tabsY, w: detailW, h: window.y + window.h - pad - tabsY };
  return { mode, window, header, tabs, grid, cols, cell, detail, font };
}

export const insideCanvas = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720;
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------- 페이지(v4 §4.2) ----------
// 한 페이지 = 격자에 들어가는 칸 수. 페이지 이동 줄은 격자 아래(그 줄만큼 격자 높이를 뺀다)
export interface GridPaging {
  perPage: number;
  pages: number;
  page: number; // 범위 안으로 맞춘 현재 페이지
  cells: GridCell[]; // 이 페이지 칸
  pager: { prev: Rect; next: Rect; label: { x: number; y: number } } | null;
}
export function pageCells(cells: GridCell[], L: InventoryLayout, page: number): GridPaging {
  const pagerH = L.font.button * 2;
  const fullRows = Math.max(1, Math.floor((L.grid.h + 8) / (L.cell + 8)));
  const fitsAll = cells.length <= fullRows * L.cols;
  const rows = fitsAll ? fullRows : Math.max(1, Math.floor((L.grid.h - pagerH - 8 + 8) / (L.cell + 8)));
  const perPage = rows * L.cols;
  const pages = Math.max(1, Math.ceil(cells.length / perPage));
  const p = Math.min(Math.max(0, page), pages - 1);
  const y = L.grid.y + L.grid.h - pagerH;
  const w = Math.max(pagerH * 1.6, L.font.button * 3);
  return {
    perPage,
    pages,
    page: p,
    cells: cells.slice(p * perPage, (p + 1) * perPage),
    pager: pages > 1 ? { prev: { x: L.grid.x, y, w, h: pagerH }, next: { x: L.grid.x + L.grid.w - w, y, w, h: pagerH }, label: { x: L.grid.x + L.grid.w / 2, y: y + pagerH / 2 } } : null,
  };
}

// 페이지를 바꾼 뒤 선택한 아이템이 이 페이지에 없으면 상세를 비운다
export function keepSelection(selected: string | null, visible: GridCell[]): string | null {
  return selected && visible.some((c) => c.item.itemCode === selected) ? selected : null;
}
