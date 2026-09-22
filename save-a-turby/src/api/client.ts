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

// 서버가 { code, message }로 내려주는 게임 규칙 위반(잔액 부족 등)과 네트워크 실패를 구분하기 위한 에러
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface IdentifyResponse {
  playerId: string;
  nickname: string;
  tareBalance: number;
  turbys: ServerTurby[];
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parse(path, res);
}

async function getJson<T>(path: string): Promise<T> {
  return parse(path, await fetch(`${BASE_URL}${path}`));
}

async function parse<T>(path: string, res: Response): Promise<T> {
  if (!res.ok) {
    let body: { code?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      // 본문이 JSON이 아니면 상태코드만 사용
    }
    throw new ApiError(res.status, body.code ?? null, body.message ?? `${path} failed: ${res.status}`);
  }
  return res.json();
}

export function identifyPlayer(deviceUuid: string): Promise<IdentifyResponse> {
  return postJson('/player/identify', { deviceUuid });
}

export function moveToShelf(playerId: string, turbyId: string, slotIndex: number): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/shelf`, { slotIndex });
}

export function moveToBag(playerId: string, turbyId: string): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/bag`, {});
}

export function fetchShop(): Promise<ShopProduct[]> {
  return getJson('/shop');
}

export function purchaseProduct(playerId: string, productId: number, requestId: string): Promise<PurchaseResult> {
  return postJson(`/player/${playerId}/shop/purchase`, { productId, requestId });
}

export function fetchItems(playerId: string): Promise<OwnedItem[]> {
  return getJson(`/player/${playerId}/items`);
}

export function equipItem(playerId: string, turbyId: string, itemCode: string): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/equip`, { itemCode });
}

export function unequipItem(playerId: string, turbyId: string, slotKey: string): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/unequip`, { slotKey });
}
