// 터비 전용 BE(3.5.3, 포트 3002)와 통신하는 최소 REST 클라이언트.
// TODO: 배포 환경별 URL 분기는 아직 없음 — 지금은 로컬 개발 서버만 가정.
const BASE_URL = 'http://localhost:3002';

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
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export function identifyPlayer(deviceUuid: string): Promise<IdentifyResponse> {
  return postJson('/player/identify', { deviceUuid });
}

export function captureTurby(playerId: string, characterCode: string): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/capture`, { characterCode });
}

export function moveToShelf(playerId: string, turbyId: string, slotIndex: number): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/shelf`, { slotIndex });
}

export function moveToBag(playerId: string, turbyId: string): Promise<ServerTurby> {
  return postJson(`/player/${playerId}/turby/${turbyId}/bag`, {});
}
