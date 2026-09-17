import { getPlayerId } from './player';
import { identifyPlayer, captureTurby, moveToShelf as apiMoveToShelf, moveToBag as apiMoveToBag } from '../api/client';
import type { ServerTurby } from '../api/client';

// 4.2/4.4: 보유 터비(선반/가방) 상태 + 4.1/4.5 재화(타레). 2026-09-16: DB<->BE<->FE 연동 완료 —
// 진짜 저장소는 이제 원격 MySQL(turby_instance/player.tare_balance)이고, localStorage는 BE가 응답 안 할 때만 쓰는 폴백 캐시.
export type OwnedTurby = ServerTurby;

const STARTER: OwnedTurby = {
  id: 'starter-nubi',
  characterCode: 'nubi',
  characterName: '누비',
  locationType: 'bag',
  slotIndex: null,
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

class InventoryStore {
  private deviceUuid = getPlayerId();
  private dbPlayerId: string | null = null;
  private tareBalance = 0;
  private owned: OwnedTurby[] = [STARTER];

  // game.ts의 mountGame()에서 씬 생성 전에 await로 한 번 호출 — 서버에서 실제 보유 터비/타레를 받아옴
  async init(): Promise<void> {
    try {
      const res = await identifyPlayer(this.deviceUuid);
      this.dbPlayerId = res.playerId;
      this.tareBalance = res.tareBalance;
      // 신규 플레이어도 서버(identify)가 스타터 누비를 이미 DB에 지급해서 내려주므로 그대로 신뢰
      this.owned = res.turbys;
      saveCache(this.deviceUuid, this.owned);
    } catch (err) {
      // BE 연결 실패(오프라인 등) — 로컬 캐시로 폴백해서 게임은 계속 진행 가능하게 함
      console.warn('[inventory] BE 연동 실패, 로컬 캐시로 폴백:', err);
      this.owned = loadCache(this.deviceUuid) ?? this.owned;
    }
  }

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

  async add(characterCode: string) {
    // 낙관적 갱신: 서버 응답을 기다리지 않고 화면에는 바로 반영(소지/가방 상태로 지급, 3.2)
    const optimistic: OwnedTurby = {
      id: `local-${characterCode}-${Date.now()}`,
      characterCode,
      characterName: characterCode,
      locationType: 'bag',
      slotIndex: null,
      stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 0 },
    };
    this.owned.push(optimistic);
    saveCache(this.deviceUuid, this.owned);

    if (!this.dbPlayerId) return; // identify 실패 상태면 서버 반영 스킵(로컬 캐시만 유지)
    try {
      const saved = await captureTurby(this.dbPlayerId, characterCode);
      Object.assign(optimistic, saved); // 서버가 내려준 진짜 값(id/스탯 등)으로 교체
      saveCache(this.deviceUuid, this.owned);
    } catch (err) {
      console.warn('[inventory] 포획 결과 서버 저장 실패(로컬에는 남아있음):', err);
    }
  }

  // 4.2: 가방(소지) → 선반(기지 보관) 특정 슬롯으로 이동
  async moveToShelf(turbyId: string, slotIndex: number): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.dbPlayerId) return { ok: false, error: 'offline' };
    try {
      const updated = await apiMoveToShelf(this.dbPlayerId, turbyId, slotIndex);
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
      const updated = await apiMoveToBag(this.dbPlayerId, turbyId);
      this.replace(updated);
      return { ok: true };
    } catch (err) {
      console.warn('[inventory] 가방 이동 실패:', err);
      return { ok: false, error: String(err) };
    }
  }

  private replace(updated: OwnedTurby) {
    const idx = this.owned.findIndex((t) => t.id === updated.id);
    if (idx >= 0) this.owned[idx] = updated;
    saveCache(this.deviceUuid, this.owned);
  }
}

export const inventory = new InventoryStore();
