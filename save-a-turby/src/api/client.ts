import { ApiError, createHttp } from './http';
import type { StoryDelivery, StoryPlay } from '../story/storyFlow';
import type { InventoryList } from '../inventory/inventoryView';
import { createMeApi } from './meApi';
import { SessionManager, type KeyValueStorage } from '../state/session';
import { getPlayerId } from '../state/player';
import type { ServerStageStatus } from '../state/stageView';

export { ApiError };

// 터비 전용 BE(3.5.3, 포트 3002)와 통신하는 최소 REST 클라이언트.
// 접속 주소는 .env(VITE_TURBY_SERVER_URL)에서 읽음. 배포는 hub에서 빌드하므로 hub/.env에 설정.
export const BASE_URL: string = import.meta.env.VITE_TURBY_SERVER_URL ?? 'http://localhost:3002';

export interface ServerTurbyStats {
  attack: number;
  defense: number;
  actionPower: number;
  maxHp: number;
}

export interface ServerTurby {
  id: string;
  characterCode: string;
  characterName: string;
  acquiredVia?: string;
  // 등급기본+캐릭터보정치+개별강화보너스(turby_instance.*_bonus)까지 서버가 계산해서 내려줌 — 강화 시스템 자체는 아직 미기획
  stats: ServerTurbyStats;
  // 4.2: base_slot_id 유무로 구분 — 'bag'(소지/원정파티 후보) vs 'shelf'(기지 보관/전시)
  locationType: 'bag' | 'shelf';
  slotIndex: number | null;
  // 3.1: 장착 중인 아이템(스탯 보너스는 stats에 이미 합산되어 내려옴)
  equipment: { slotKey: string; itemCode: string; itemName: string }[];
}

export interface ShopProduct {
  id: number;
  productType: 'turby' | 'item';
  code: string;
  name: string;
  description: string;
  price: number;
  stats: ServerTurbyStats;
  equipSlot: string | null;
}

export interface PurchaseResult {
  duplicate: boolean;
  tareBalance: number;
  turby: ServerTurby | null;
  itemCode: string | null;
}

export interface OwnedItem {
  code: string;
  name: string;
  description: string;
  equipSlot: string | null;
  bonuses: ServerTurbyStats;
  quantity: number;
  equipped: number;
  available: number;
}

export interface IdentifyResponse {
  playerId: string;
  nickname: string;
  tareBalance: number;
  turbys: ServerTurby[];
  sessionToken?: string; // 스토리 M1: /player/me/* 헤더와 소켓 hello에 쓰는 세션 토큰(구 BE는 없음)
}

const http = createHttp(BASE_URL, (url, init) => fetch(url, init));

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// 기기 식별자(device_uuid)별 세션. 토큰 거부 시 identify를 한 번만 다시 부른다(state/session.ts).
export const session = new SessionManager(getPlayerId(), browserStorage(), () => identifyPlayer(getPlayerId()));
const me = createMeApi(http, session);

export async function identifyPlayer(deviceUuid: string): Promise<IdentifyResponse> {
  const res = await http.postJson<IdentifyResponse>('/player/identify', { deviceUuid });
  session.accept(res.sessionToken);
  return res;
}

export function fetchShop(): Promise<ShopProduct[]> {
  return http.getJson('/shop');
}

// 아래는 세션 토큰 기반 /player/me/* (스토리 M1-B). 구 경로 /player/:playerId/* 는 서버에 호환용으로만 남아 있다.
export function moveToShelf(turbyId: string, slotIndex: number): Promise<ServerTurby> {
  return me.post(`/turby/${turbyId}/shelf`, { slotIndex });
}

export function moveToBag(turbyId: string): Promise<ServerTurby> {
  return me.post(`/turby/${turbyId}/bag`, {});
}

export function purchaseProduct(productId: number, requestId: string): Promise<PurchaseResult> {
  return me.post('/shop/purchase', { productId, requestId });
}

export function fetchItems(): Promise<OwnedItem[]> {
  return me.get('/items');
}

export function equipItem(turbyId: string, itemCode: string): Promise<ServerTurby> {
  return me.post(`/turby/${turbyId}/equip`, { itemCode });
}

export function unequipItem(turbyId: string, slotKey: string): Promise<ServerTurby> {
  return me.post(`/turby/${turbyId}/unequip`, { slotKey });
}

// 스토리 상태(M2: 지역 입장·표시 상태 포함). 판정은 서버만 한다.
export interface StoryState {
  checkpoint: string;
  chapterCode: string;
  needsName: boolean;
  playerName: string;
  stages: ServerStageStatus[];
  delivery: StoryDelivery | null; // M4-C: 전달을 기다리는 목표(서버 인벤토리 수량)
  storyNubi?: { turbyId: string; growthStage: number; slots: { slotKey: string; itemCode: string; name: string }[] } | null;
}

export function fetchStory(): Promise<StoryState> {
  return me.get('/story');
}

// ---- 스토리(M3 오프닝) ----
export interface StoryStateFull extends StoryState {
  openingRequired: boolean;
  openingAvailable: boolean;
  openingStarted: boolean;
  resume: { segmentId: string | null; tutorial: 'relic_equip' | null };
  completedEvents: string[];
}

export function fetchStoryFull(): Promise<StoryStateFull> {
  return me.get('/story');
}

export function fetchDialogue(chapterCode: string): Promise<unknown> {
  return me.get(`/story/dialogue/${chapterCode}`);
}

export function completeStoryEvent(eventId: string): Promise<{ eventId: string; alreadyCompleted: boolean; story: StoryStateFull }> {
  return me.post(`/story/events/${eventId}/complete`, { requestId: `${eventId}-${Date.now()}` });
}

// M4-C: 이야기 지점 상호작용(보풀이 전달 등). 서버가 위치·진행·보유 수량을 판정하고 재생할 구간을 돌려준다
export interface StoryTriggerResult {
  triggerId: string;
  play: StoryPlay | null;
  shortage: { itemCode: string; have: number; need: number } | null;
  story: StoryStateFull;
}

export function triggerStory(triggerId: string): Promise<StoryTriggerResult> {
  return me.post(`/story/triggers/${triggerId}`, {});
}

export function saveProfileName(name: string): Promise<{ eventId: string; alreadyCompleted: boolean; story: StoryStateFull }> {
  return me.post('/profile/name', { name });
}

// ---- 인벤토리(v3 M4-D) — 수량·잠금·장착 가능 여부는 서버가 정본 ----
export function fetchInventory(): Promise<InventoryList> {
  return me.get('/inventory');
}

// 상세를 연 아이템 하나만 신규 표시 해제
export function markItemSeen(itemCode: string): Promise<{ itemCode: string; cleared: boolean }> {
  return me.post(`/inventory/items/${itemCode}/seen`, {});
}

// 누비에게 장착: 유물 코드만 보낸다(이벤트·대상 터비는 서버가 정함). 새로 장착하면 play = 장착 장면
export function equipRelicToNubi(itemCode: string): Promise<{ eventId: string; alreadyCompleted: boolean; story: StoryStateFull; play: StoryPlay | null }> {
  return me.post(`/story/relics/${itemCode}/equip`, {});
}
