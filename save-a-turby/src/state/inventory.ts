import { getPlayerId } from './player';
import {
  ApiError,
  identifyPlayer,
  moveToShelf as apiMoveToShelf,
  moveToBag as apiMoveToBag,
  fetchItems,
  purchaseProduct,
  equipItem,
  unequipItem,
} from '../api/client';
import type { ServerTurby, OwnedItem, ShopProduct } from '../api/client';

// 4.2/4.4: 보유 터비(선반/가방) 상태 + 4.1/4.5 재화(타레). 2026-09-16: DB<->BE<->FE 연동 완료 —
// 진짜 저장소는 이제 원격 MySQL(turby_instance/player.tare_balance)이고, localStorage는 BE가 응답 안 할 때만 쓰는 폴백 캐시.
export type OwnedTurby = ServerTurby;

const STARTER: OwnedTurby = {
  id: 'starter-nubi',
  characterCode: 'nubi',
  characterName: '누비',
  locationType: 'bag',
  slotIndex: null,
  equipment: [],
  stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 0 },
};

function cacheKey(deviceUuid: string) {
  return `turby_inventory_cache_${deviceUuid}`;
}

function loadCache(deviceUuid: string): OwnedTurby[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(deviceUuid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCache(deviceUuid: string, items: OwnedTurby[]) {
  try {
    localStorage.setItem(cacheKey(deviceUuid), JSON.stringify(items));
  } catch {
    // localStorage 사용 불가 — 폴백 캐시 없이 이번 세션만 정상 동작
  }
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

class InventoryStore {
  private deviceUuid = getPlayerId();
  private dbPlayerId: string | null = null;
  private tareBalance = 0;
  private owned: OwnedTurby[] = [STARTER];
  private items: OwnedItem[] = [];
  // 응답을 못 받은(네트워크 실패) 구매는 재시도할 때 같은 requestId를 다시 써서 서버가 중복 결제를 막게 함
  private pendingRequests = new Map<number, string>();

  // game.ts의 mountGame()에서 씬 생성 전에 await로 한 번 호출 — 서버에서 실제 보유 터비/타레를 받아옴
  async init(): Promise<void> {
    try {
      const res = await identifyPlayer(this.deviceUuid);
      this.dbPlayerId = res.playerId;
      this.tareBalance = res.tareBalance;
      // 신규 플레이어도 서버(identify)가 스타터 누비를 이미 DB에 지급해서 내려주므로 그대로 신뢰
      this.owned = res.turbys;
      saveCache(this.deviceUuid, this.owned);
      await this.refreshItems();
    } catch (err) {
      // BE 연결 실패(오프라인 등) — 로컬 캐시로 폴백해서 게임은 계속 진행 가능하게 함
      console.warn('[inventory] BE 연동 실패, 로컬 캐시로 폴백:', err);
      this.owned = loadCache(this.deviceUuid) ?? this.owned;
    }
  }

  // 화면 표시·구 경로 호환용. 권한 판단은 서버가 세션 토큰으로 한다(스토리 M1-B)
  getPlayerId(): string {
    return this.dbPlayerId ?? this.deviceUuid;
  }

  getTareBalance(): number {
    return this.tareBalance;
  }

  getAll(): OwnedTurby[] {
    return this.owned;
  }

  getBag(): OwnedTurby[] {
    return this.owned.filter((t) => t.locationType === 'bag');
  }

  getShelf(): OwnedTurby[] {
    return this.owned.filter((t) => t.locationType === 'shelf');
  }

  // 3.2: 서버가 전투 결과로 지급한 포획 터비를 보유 목록에 편입(소지/가방 상태). 같은 id가 이미 있으면 중복 추가하지 않는다.
  addFromServer(turby: OwnedTurby) {
    if (this.owned.some((t) => t.id === turby.id)) return;
    this.owned.push(turby);
    saveCache(this.deviceUuid, this.owned);
  }

  // 4.2: 가방(소지) → 선반(기지 보관) 특정 슬롯으로 이동
  async moveToShelf(turbyId: string, slotIndex: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.dbPlayerId) return { ok: false, error: 'offline' };
    try {
      const updated = await apiMoveToShelf(turbyId, slotIndex);
      this.replace(updated);
      return { ok: true };
    } catch (err) {
      console.warn('[inventory] 선반 이동 실패:', err);
      return { ok: false, error: String(err) };
    }
  }

  // 4.2: 선반(기지 보관) → 가방(소지)으로 이동
  async moveToBag(turbyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.dbPlayerId) return { ok: false, error: 'offline' };
    try {
      const updated = await apiMoveToBag(turbyId);
      this.replace(updated);
      return { ok: true };
    } catch (err) {
      console.warn('[inventory] 가방 이동 실패:', err);
      return { ok: false, error: String(err) };
    }
  }

  getItems(): OwnedItem[] {
    return this.items;
  }

  async refreshItems(): Promise<void> {
    if (!this.dbPlayerId) return;
    try {
      this.items = await fetchItems();
    } catch (err) {
      console.warn('[inventory] 아이템 조회 실패:', err);
    }
  }

  // 4.1: NPC 상점 구매 — 가격/잔액/지급은 전부 서버가 판정하고, 성공한 결과만 로컬에 반영
  async purchase(product: ShopProduct): Promise<{ ok: true; turby: OwnedTurby | null } | { ok: false; code: string; message: string }> {
    if (!this.dbPlayerId) return { ok: false, code: 'OFFLINE', message: '서버에 연결할 수 없습니다.' };
    const requestId = this.pendingRequests.get(product.id) ?? newRequestId();
    this.pendingRequests.set(product.id, requestId);
    try {
      const res = await purchaseProduct(product.id, requestId);
      this.pendingRequests.delete(product.id);
      this.tareBalance = res.tareBalance;
      if (res.turby && !this.owned.some((t) => t.id === res.turby!.id)) this.owned.push(res.turby);
      saveCache(this.deviceUuid, this.owned);
      await this.refreshItems();
      return { ok: true, turby: res.turby };
    } catch (err) {
      if (err instanceof ApiError) {
        this.pendingRequests.delete(product.id); // 서버가 명확히 거절 — 다음 시도는 새 요청
        return { ok: false, code: err.code ?? 'ERROR', message: err.message };
      }
      return { ok: false, code: 'NETWORK', message: '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' };
    }
  }

  // 3.1: 아이템 장착/해제 — 서버가 소유권·수량·슬롯을 검증하고 최종 스탯을 계산해서 돌려줌
  async equip(turbyId: string, itemCode: string) {
    return this.runEquipment(() => equipItem(turbyId, itemCode));
  }

  async unequip(turbyId: string, slotKey: string) {
    return this.runEquipment(() => unequipItem(turbyId, slotKey));
  }

  private async runEquipment(call: () => Promise<OwnedTurby>): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!this.dbPlayerId) return { ok: false, message: '서버에 연결할 수 없습니다.' };
    try {
      this.replace(await call());
      await this.refreshItems();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' };
    }
  }

  private replace(updated: OwnedTurby) {
    const idx = this.owned.findIndex((t) => t.id === updated.id);
    if (idx >= 0) this.owned[idx] = updated;
    saveCache(this.deviceUuid, this.owned);
  }
}

export const inventory = new InventoryStore();
