// 화면 상태 판정(순수 계산 — test/screenLayouts.test.ts). 색만으로 구분하지 않도록 상태마다 글자를 정한다.

// ----- 지역 선택: 상태 배지 문구(상태 + 할 수 있는 행동) -----
export const STAGE_BADGE = { cleared: '완료', current: '진행 중', open: '탐험 가능', locked: '잠김' } as const;
export type StageBadgeState = keyof typeof STAGE_BADGE;
export const stageBadgeLabel = (state: StageBadgeState, enterable: boolean) => (enterable ? `${STAGE_BADGE[state]} · 입장` : STAGE_BADGE[state]);

// ----- 상점: 구매 버튼 상태 -----
export type BuyState = 'buying' | 'locked' | 'short' | 'ready';
export function buyStateOf(productId: number, price: number, balance: number, pendingId: number | null): BuyState {
  if (pendingId === productId) return 'buying';
  if (pendingId !== null) return 'locked'; // 다른 상품을 구매하는 중 — 끝날 때까지 누를 수 없다
  return balance >= price ? 'ready' : 'short';
}
export const BUY_NOTE: Record<BuyState, string | null> = { buying: '구매 중…', locked: null, short: '부족', ready: null };
// 버튼 글자: 가격은 늘 보이고, 잔액이 모자라면 "… · 부족"을 붙인다
export const buyLabel = (price: number, state: BuyState) => (state === 'short' ? `${price} 타레 · ${BUY_NOTE.short}` : `${price} 타레`);

// ----- 장비 창: 그릴 줄(일반 슬롯 + 누비가 장착한 이야기 유물 슬롯 — 장착 전 이야기 슬롯은 보이지 않음) -----
export type EquipRowKind = { kind: 'general'; slotKey: string; label: string; iconKey?: string } | { kind: 'story'; slotKey: string; itemName: string };
export const isStorySlot = (slotKey: string) => slotKey.startsWith('story_');
export function equipRows(equipment: { slotKey: string; itemName: string }[], slots: { key: string; label: string; iconKey?: string }[]): EquipRowKind[] {
  const general: EquipRowKind[] = slots.map((s) => ({ kind: 'general', slotKey: s.key, label: s.label, iconKey: s.iconKey }));
  const story: EquipRowKind[] = equipment.filter((e) => isStorySlot(e.slotKey)).map((e) => ({ kind: 'story', slotKey: e.slotKey, itemName: e.itemName }));
  return [...general, ...story];
}
export const STORY_SLOT_LABEL = '이야기 슬롯';
export const STORY_SLOT_LOCK = '해제 불가';

// ----- 지도 범례: 색이 아니라 모양·표식으로 구분한다. 지도에 실제로 있는 종류만 보여 준다 -----
// story·dust: 탐험 지도의 이야기 지점·수집 오브젝트(임시 도형)
// wild: 야생 터비(서버가 내려 준 위치 — 10-02 v6)
export type MarkerType = 'home' | 'market' | 'exit' | 'target' | 'story' | 'dust' | 'wild';
// path·wall·gateClosed·gateOpen: 회색상자(임시) 지형 — 지도에 있을 때만 범례에 나온다
export type TerrainKey = 'path' | 'wall' | 'gateClosed' | 'gateOpen';
export type LegendKey = 'player' | 'peer' | MarkerType | TerrainKey;
export const LEGEND_LABEL: Record<LegendKey, string> = {
  player: '내 위치 — 화살표(가는 방향)',
  peer: '함께 온 친구 — 동그라미와 번호',
  home: '내 집',
  market: '장터',
  exit: '야생 출구',
  target: '목적지 — 별',
  story: '이야기 지점 — 겹동그라미',
  dust: '빛나는 실가루 — 마름모',
  wild: '야생 터비 ▲',
  path: '길 — 굵은 선(임시)',
  wall: '막힌 곳 — 어두운 사각형',
  gateClosed: '닫힌 문 — 채운 사각형',
  gateOpen: '열린 문 — 테두리만',
};
export function legendEntries(markerTypes: MarkerType[], hasPeers: boolean, terrain?: Partial<Record<TerrainKey, boolean>>): LegendKey[] {
  const order: MarkerType[] = ['target', 'story', 'dust', 'wild', 'home', 'market', 'exit'];
  const ground: TerrainKey[] = (['path', 'wall', 'gateClosed', 'gateOpen'] as const).filter((t) => terrain?.[t]);
  return ['player', ...(hasPeers ? (['peer'] as const) : []), ...order.filter((t) => markerTypes.includes(t)), ...ground];
}

// ----- 탐험 맵 HUD 글자 -----
export const capturedLabel = (count: number) => `포획: ${count}`;
