// 8번 DB 스키마의 player.device_uuid 방식을 그대로 따름(로그인 시스템 없음, 기기 UUID로 식별).
// 지금은 원격 DB 연동 전이라 localStorage에만 저장 — 나중에 BE 연동 시 이 값을 그대로 회원 식별자로 사용 예정.
const STORAGE_KEY = 'turby_player_id';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `player-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function getPlayerId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = generateId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // localStorage 사용 불가(프라이빗 모드 등) — 이번 세션 한정으로만 동작
    return generateId();
  }
}
