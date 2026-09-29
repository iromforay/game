-- 관리자 백오피스(2026-09-29, docs/dev/admin_backoffice.md) — 허브 계정 중 role='admin'인 계정만 /admin/* API 사용 가능.
-- 원격 DB에 직접 적용(prisma db push 미사용, FK 없이 인덱스만 — 기존 정책). 여러 번 실행해도 안전(IF NOT EXISTS).

ALTER TABLE account ADD COLUMN IF NOT EXISTS role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER nickname;

-- 관리자 조작 기록 — 누가(admin_account_id) 언제 무엇을(action/target) 어떻게(before/after) 바꿨는지
CREATE TABLE IF NOT EXISTS admin_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_account_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  target_id VARCHAR(40) NOT NULL,
  before_json TEXT NULL,
  after_json TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_log_created (created_at),
  KEY idx_admin_log_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 관리자 지정(예시) — login_id를 바꿔서 실행
-- UPDATE account SET role = 'admin' WHERE login_id = '관리자아이디';
