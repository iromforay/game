// 허브 공통 계정(2026-09-28) — 아이디+비밀번호, 목적은 브라우저/기기 통합.
// 게임들은 허브와 같은 출처(origin)에서 실행되므로 이 localStorage 토큰을 그대로 읽어 identify에 함께 보낸다.
// 계정 API는 커비 서버(운영에서 HTTP 접근이 확인된 BE)로 호출 — 어느 BE로 불러도 같은 DB라 결과는 같다.
export const ACCOUNT_SERVER_URL: string =
  import.meta.env.VITE_ACCOUNT_SERVER_URL ?? import.meta.env.VITE_KIRBY_SERVER_URL ?? 'http://localhost:3003';
const BASE_URL = ACCOUNT_SERVER_URL;

export const AUTH_TOKEN_KEY = 'bomul_auth_token';
const NICKNAME_KEY = 'bomul_account_nickname';

// 로그인 시 게스트 플레이어가 계정에 연결된 게임은 로그아웃 때 그 기기의 device_uuid를 지워야 한다.
// 그래야 로그아웃한 뒤 같은 브라우저에서 계정 데이터가 로그인 없이 열리지 않고 새 게스트로 시작한다.
// linkedFlag는 각 게임이 identify 응답(account.linkedThisDevice)을 보고 직접 기록한다.
const GAME_DEVICE_KEYS = [
  { deviceKey: 'steal_a_kirby_device_uuid', linkedFlag: 'steal_a_kirby_device_linked' },
  { deviceKey: 'turby_player_id', linkedFlag: 'turby_device_linked' },
];

export interface AccountSession {
  loginId: string;
  nickname: string;
}

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readStorage(AUTH_TOKEN_KEY);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.message === 'string' ? body.message : '요청에 실패했습니다';
    throw new Error(message);
  }
  return body as T;
}

function saveSession(res: { token: string; loginId: string; nickname: string }) {
  localStorage.setItem(AUTH_TOKEN_KEY, res.token);
  localStorage.setItem(NICKNAME_KEY, res.nickname);
}

export function hasStoredToken() {
  return !!readStorage(AUTH_TOKEN_KEY);
}

// 다른 허브 기능(스코어보드 등)이 같은 로그인 토큰으로 서버를 부를 때 사용
export function authHeader(): Record<string, string> {
  const token = readStorage(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(loginId: string, password: string) {
  saveSession(await request<{ token: string; loginId: string; nickname: string }>('/account/login', {
    method: 'POST',
    body: JSON.stringify({ loginId, password }),
  }));
}

export async function register(loginId: string, password: string, nickname: string) {
  saveSession(await request<{ token: string; loginId: string; nickname: string }>('/account/register', {
    method: 'POST',
    body: JSON.stringify({ loginId, password, nickname }),
  }));
}

// 저장된 토큰이 아직 유효한지 서버에 확인 — 무효(다른 곳에서 삭제 등)면 토큰을 지우고 null
export async function fetchSession(): Promise<AccountSession | null> {
  if (!hasStoredToken()) return null;
  try {
    return await request<AccountSession>('/account/me');
  } catch {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(NICKNAME_KEY);
    return null;
  }
}

export async function logout() {
  await request('/account/logout', { method: 'POST' }).catch(() => undefined);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(NICKNAME_KEY);
  for (const { deviceKey, linkedFlag } of GAME_DEVICE_KEYS) {
    if (readStorage(linkedFlag)) {
      localStorage.removeItem(deviceKey);
      localStorage.removeItem(linkedFlag);
    }
  }
}
