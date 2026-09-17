const BASE_URL = 'http://localhost:3003';

export interface KirbyInstanceDto {
  instanceId: string;
  code: string;
  name: string;
  gradeId: number;
  status: 'idle' | 'stolen_in_transit';
}

export interface PlayerStateDto {
  playerId: string;
  nickname: string;
  gold: number;
  lockState: 'open' | 'locked' | 'conditional';
  offlineOperationEnabled: boolean;
  kirbies: KirbyInstanceDto[];
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  identify: (deviceUuid: string) => postJson<PlayerStateDto>('/kirby/player/identify', { deviceUuid }),
  getState: (playerId: string) => getJson<PlayerStateDto>(`/kirby/player/${playerId}`),
  buy: (playerId: string) => postJson<{ player: PlayerStateDto; bought: KirbyInstanceDto }>(`/kirby/player/${playerId}/buy`),
  sell: (playerId: string, instanceId: string) => postJson<PlayerStateDto>(`/kirby/player/${playerId}/sell/${instanceId}`),
  updateSettings: (
    playerId: string,
    body: { lockState?: PlayerStateDto['lockState']; offlineOperationEnabled?: boolean; allowedUserIds?: string[] },
  ) => postJson<PlayerStateDto>(`/kirby/player/${playerId}/settings`, body),
};

export function getOrCreateDeviceUuid(): string {
  // 개발/테스트 편의: 같은 브라우저의 여러 탭은 localStorage를 공유해서 기본값만으로는 항상 같은
  // device_uuid가 나옴(=같은 플레이어) — ?device=이름 쿼리로 탭마다 다른 테스트 계정을 강제할 수 있게 함.
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('device');
  if (forced) return `dev-${forced}`;

  const KEY = 'steal_a_kirby_device_uuid';
  let uuid = localStorage.getItem(KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(KEY, uuid);
  }
  return uuid;
}
