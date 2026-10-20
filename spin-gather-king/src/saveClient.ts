import type { GameSave } from './save';

const SERVER_URL: string = import.meta.env.SPIN_GATHER_SERVER_URL ?? 'http://localhost:3006';
const TOKEN_KEY = 'bomul_auth_token';
const GUEST_KEY = 'spin-gather-guest-id';

function guestId() {
  let value = localStorage.getItem(GUEST_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(GUEST_KEY, value); }
  return value;
}

function headers() {
  const token = localStorage.getItem(TOKEN_KEY);
  return { 'Content-Type': 'application/json', 'X-Spin-Gather-Guest-Id': guestId(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}/spin-gather/profile`, { ...init, headers: { ...headers(), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof body?.message === 'string' ? body.message : '저장 서버에 연결하지 못했습니다.'), { status: response.status, body });
  return body as T;
}

export function fetchSpinGatherSave() {
  return request<{ profile: GameSave | null; revision: number; schemaVersion: number }>();
}

export function saveSpinGatherProgress(profile: GameSave, revision: number) {
  return request<{ ok: true; revision: number; updatedAt: string }>({ method: 'PUT', body: JSON.stringify({ profile, revision }) });
}
