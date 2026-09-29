-- 커비 스폿 설정(2026-09-29, docs/dev/admin_backoffice.md) — 관리자 백오피스에서 캐릭터별 등장 여부·등장 기간을 조정.
-- 확률은 기존 weight 칼럼 그대로 사용. 여러 번 실행해도 안전(IF NOT EXISTS).
-- 기간은 UTC로 저장(Prisma DateTime). 둘 다 NULL이면 기간 제한 없음.

ALTER TABLE kirby_character
  ADD COLUMN IF NOT EXISTS spawn_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER weight,
  ADD COLUMN IF NOT EXISTS spawn_starts_at DATETIME NULL DEFAULT NULL AFTER spawn_enabled,
  ADD COLUMN IF NOT EXISTS spawn_ends_at DATETIME NULL DEFAULT NULL AFTER spawn_starts_at;
