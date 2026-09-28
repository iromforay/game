// 사용자 지적(2026-09-18): "localhost" 하드코딩은 BE와 같은 기기에서만 동작하고, 배포 환경(리버스
// 프록시 등)에서는 포트 직접 노출이 아예 안 될 수도 있음 — hub의 VITE_MULTIPLAYER_SERVER_URL과
// 동일한 패턴으로 .env에서 읽어옴. 서버 주소는 hub/.env(hub/.env.example 참고)에서 설정.
const BASE_URL = import.meta.env.VITE_KIRBY_SERVER_URL ?? 'http://localhost:3003';

export interface KirbyInstanceDto {
  instanceId: string;
  code: string;
  name: string;
  gradeId: number;
  status: 'idle' | 'stolen_in_transit';
  incomePerTick: number; // 초당 발생 재화(골드/초) — 2026-09-18 요청
}

export interface PlayerStateDto {
  playerId: string;
  nickname: string;
  gold: number;
  lockState: 'open' | 'locked' | 'conditional';
  offlineOperationEnabled: boolean;
  kirbies: KirbyInstanceDto[];
}

export interface MarketOfferDto {
  offerId: string;
  slot: number;
  code: string;
  price: number;
  expiresAt: number;
}

// identify()에서만 내려오는 세션 토큰 — Codex QA 지적(2026-09-18) 반영, presence:hello에 실어 보내
// 서버가 "이 소켓이 정말 이 playerId가 맞는지" 검증하는 데 씀. 다른 조회 API는 이 필드를 안 줌(타인이 훔쳐볼 수 있는 경로라서).
export interface IdentifyResponseDto extends PlayerStateDto {
  sessionToken: string;
  // 허브 공통 계정으로 로그인한 상태면 채워짐(게스트면 null)
  account: { nickname: string; linkedThisDevice: boolean } | null;
}

// 허브 공통 계정(2026-09-28) — 허브(같은 출처)가 저장한 로그인 토큰. hub/src/account/accountClient.ts와 키가 같아야 함.
const AUTH_TOKEN_KEY = 'bomul_auth_token';
// 이 기기의 게스트 플레이어가 계정에 연결됐다는 표시 — 허브 로그아웃 때 이 기기의 device_uuid를 지우는 기준
const DEVICE_LINKED_KEY = 'steal_a_kirby_device_linked';

function readAuthToken(): string | undefined {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function markDeviceLinked() {
  try {
    localStorage.setItem(DEVICE_LINKED_KEY, '1');
  } catch {
    // localStorage 불가(프라이빗 모드 등) — 표시 생략
  }
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
  identify: (deviceUuid: string) => postJson<IdentifyResponseDto>('/kirby/player/identify', { deviceUuid, authToken: readAuthToken() }),
  getState: (playerId: string) => getJson<PlayerStateDto>(`/kirby/player/${playerId}`),
  // 사용자 지적(2026-09-28): 좌대 캐릭터는 서버가 뽑은 판매권(offer)으로 표시하고, 구매도 그 판매권으로만 한다.
  rollOffer: (playerId: string, slot: number) => postJson<MarketOfferDto>(`/kirby/player/${playerId}/market/roll`, { slot }),
  buy: (playerId: string, offerId: string) =>
    postJson<{ player: PlayerStateDto; bought: KirbyInstanceDto }>(`/kirby/player/${playerId}/buy`, { offerId }),
  sell: (playerId: string, instanceId: string) => postJson<PlayerStateDto>(`/kirby/player/${playerId}/sell/${instanceId}`),
  collectAll: (playerId: string) => postJson<{ player: PlayerStateDto; collected: number }>(`/kirby/player/${playerId}/collect-all`),
  collect: (playerId: string, instanceId: string) =>
    postJson<{ player: PlayerStateDto; collected: number }>(`/kirby/player/${playerId}/collect/${instanceId}`),
  updateSettings: (
    playerId: string,
    body: { lockState?: PlayerStateDto['lockState']; offlineOperationEnabled?: boolean; allowedUserIds?: string[] },
  ) => postJson<PlayerStateDto>(`/kirby/player/${playerId}/settings`, body),
};

export function getOrCreateDeviceUuid(): string {
  // 개발/테스트 편의: 같은 브라우저의 여러 탭은 localStorage를 공유해서 기본값만으로는 항상 같은
  // device_uuid가 나옴(=같은 플레이어) — ?device=이름 쿼리로 탭마다 다른 테스트 계정을 강제할 수 있게 함.
  // 운영에서는 막음(2026-09-28) — 누구나 ?device=로 dev- 계정을 만들거나 들어갈 수 있었음(터비와 동일하게 개발 전용)
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(window.location.search).get('device');
    if (forced) return `dev-${forced}`;
  }

  const KEY = 'steal_a_kirby_device_uuid';
  let uuid = localStorage.getItem(KEY);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(KEY, uuid);
  }
  return uuid;
}
