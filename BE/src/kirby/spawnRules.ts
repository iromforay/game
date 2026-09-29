// 커비 스폿 설정(2026-09-29) — 좌대 추첨(PlayerService.rollOffer)과 관리자 확률 미리보기(AdminService)가 같은 규칙을 쓴다.
// 등장 켜짐 + 가중치 > 0 + 기간 안(시작 ≤ 지금 < 종료, 비어 있으면 제한 없음)일 때만 추첨 대상.
export interface SpawnFields {
  weight: number;
  spawn_enabled: boolean;
  spawn_starts_at: Date | null;
  spawn_ends_at: Date | null;
}

export function isSpawnActive(c: SpawnFields, now = Date.now()) {
  if (!c.spawn_enabled || c.weight <= 0) return false;
  if (c.spawn_starts_at && now < c.spawn_starts_at.getTime()) return false;
  if (c.spawn_ends_at && now >= c.spawn_ends_at.getTime()) return false;
  return true;
}
