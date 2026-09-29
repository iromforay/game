import { request } from '../account/accountClient';

// 관리자 백오피스(2026-09-29, docs/dev/admin_backoffice.md) — 허브 로그인 토큰으로 커비 서버의 /admin/*를 호출.
// 권한 확인은 서버(AdminGuard)가 한다: 관리자가 아니면 모든 요청이 403.
export interface AdminPlayerRow {
  playerId: string;
  nickname: string;
  gold: number;
  loginId: string | null;
  accountNickname: string | null;
  kirbyCount: number;
  createdAt: string;
}

export interface AdminKirbyInstance {
  instanceId: string;
  characterId: number;
  code: string;
  name: string;
  grade: string;
  sellPrice: number;
  incomePerTick: number;
  status: 'idle' | 'stolen_in_transit';
  createdAt: string;
}

export interface AdminPlayerDetail {
  playerId: string;
  nickname: string;
  gold: number;
  lockState: string;
  createdAt: string;
  account: { accountId: string; loginId: string; nickname: string } | null;
  instances: AdminKirbyInstance[];
}

export interface AdminCharacter {
  characterId: number;
  code: string;
  name: string;
  grade: string;
  gradeId: number;
}

export interface AdminLog {
  id: string;
  admin: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export const searchPlayers = (q: string) => request<AdminPlayerRow[]>(`/admin/kirby/players?${new URLSearchParams({ q })}`);

export const getPlayer = (playerId: string) => request<AdminPlayerDetail>(`/admin/kirby/players/${encodeURIComponent(playerId)}`);

export const listCharacters = () => request<AdminCharacter[]>('/admin/kirby/characters');

export const addKirbies = (playerId: string, characterId: number, count: number) =>
  request<AdminPlayerDetail>(`/admin/kirby/players/${encodeURIComponent(playerId)}/instances`, {
    method: 'POST',
    body: JSON.stringify({ characterId, count }),
  });

export const removeKirby = (playerId: string, instanceId: string) =>
  request<AdminPlayerDetail>(`/admin/kirby/players/${encodeURIComponent(playerId)}/instances/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });

export const adjustGold = (playerId: string, mode: 'set' | 'add', amount: number) =>
  request<AdminPlayerDetail>(`/admin/kirby/players/${encodeURIComponent(playerId)}/gold`, {
    method: 'POST',
    body: JSON.stringify({ mode, amount }),
  });

export const listLogs = (targetId?: string) =>
  request<AdminLog[]>(`/admin/logs?${new URLSearchParams({ limit: '100', ...(targetId ? { targetId } : {}) })}`);

// 스폿 설정(2026-09-29) — 가중치·등장 여부·등장 기간. probability는 지금 추첨 대상 안에서의 확률(%)
export interface AdminSpawnSetting {
  characterId: number;
  code: string;
  name: string;
  grade: string;
  gradeId: number;
  weight: number;
  spawnEnabled: boolean;
  spawnStartsAt: string | null;
  spawnEndsAt: string | null;
  activeNow: boolean;
  probability: number;
}

export interface AdminSpawnChange {
  characterId: number;
  weight?: number;
  spawnEnabled?: boolean;
  spawnStartsAt?: string | null;
  spawnEndsAt?: string | null;
}

export const listSpawnSettings = () => request<AdminSpawnSetting[]>('/admin/kirby/spawn');

export const updateSpawnSettings = (changes: AdminSpawnChange[]) =>
  request<AdminSpawnSetting[]>('/admin/kirby/spawn', { method: 'PUT', body: JSON.stringify({ changes }) });
