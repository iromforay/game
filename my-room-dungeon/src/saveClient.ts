export type DungeonResourceId = 'paper' | 'tape' | 'screw' | 'battery';

export interface DungeonSaveData {
  inventory: Partial<Record<DungeonResourceId, number>>;
  discovered: DungeonResourceId[];
  craftedBots: number;
  craftedSwords: number;
  clearedZones?: string[];
  robotAssignments?: Record<string, DungeonRobotAssignment>;
  isNew?: boolean;
}

export interface DungeonRobotAssignment {
  robotId: 'paper-box';
  status: 'working';
  remainingUses: number;
  startedAt: string;
}

const SERVER_URL: string = import.meta.env.VITE_MY_ROOM_DUNGEON_SERVER_URL
  ?? 'http://localhost:3004';
const AUTH_TOKEN_KEY = 'bomul_auth_token';

function token() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

export function hasDungeonAccount() {
  return !!token();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authToken = token();
  if (!authToken) throw new Error('로그인이 필요합니다');
  const response = await fetch(`${SERVER_URL}/scoreboard/my-room-dungeon${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : '저장 서버에 연결하지 못했습니다');
  return body as T;
}

export function fetchDungeonSave() {
  return request<DungeonSaveData>('/profile');
}

export function saveDungeonProgress(save: DungeonSaveData) {
  return request<DungeonSaveData>('/profile', { method: 'PUT', body: JSON.stringify(save) });
}

export function collectDungeonResource(resource: DungeonResourceId, quantity: number) {
  return request<DungeonSaveData>('/collect', {
    method: 'POST',
    body: JSON.stringify({ resource, quantity }),
  });
}

export function completeDungeonZone(zoneId: string) {
  return request<DungeonSaveData>('/complete-zone', {
    method: 'POST',
    body: JSON.stringify({ zoneId }),
  });
}

export function deployDungeonRobot(zoneId: string) {
  return request<DungeonSaveData>('/deploy-robot', {
    method: 'POST',
    body: JSON.stringify({ zoneId }),
  });
}
