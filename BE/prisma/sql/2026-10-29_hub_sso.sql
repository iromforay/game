-- 게임허브 ↔ 거래소 SSO 재발급 토큰.
-- 원문 토큰은 BOMUL_HUB_REFRESH HttpOnly 쿠키에만 두고 DB에는 SHA-256 해시만 저장한다.
CREATE TABLE IF NOT EXISTS account_refresh_token (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_account_refresh_account (account_id),
  KEY idx_account_refresh_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
