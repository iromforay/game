-- 허브 공통 계정(아이디+비밀번호) — 목적: 브라우저/기기가 달라도 같은 게임 데이터를 쓰게 하는 것(2026-09-28 사용자 결정).
-- 게임 테이블(kirby_player/player)은 전혀 바꾸지 않는다: 기존 device_uuid 기반 운영 그대로 두고,
-- account_game_player 브리지로 "허브 계정(user_id) ↔ 게임 플레이어(owner_player_id)"만 연결한다.
-- 원격 DB에 직접 적용(prisma db push 미사용, FK 없이 인덱스만 — 기존 정책). 여러 번 실행해도 안전(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS account (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login_id VARCHAR(20) NOT NULL,
  -- scrypt$<salt hex>$<hash hex> — 평문 비밀번호는 저장하지 않음
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_login_id (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 로그인 토큰 — 기기마다 하나씩 생김(여러 기기 동시 로그인 허용). DB에는 토큰의 SHA-256 해시만 저장.
CREATE TABLE IF NOT EXISTS account_session (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_account_session_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 브리지: 허브 계정 ↔ 게임별 플레이어(kirby → kirby_player.id, turby → player.id)
CREATE TABLE IF NOT EXISTS account_game_player (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  game ENUM('kirby','turby') NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agp_account_game (account_id, game),
  UNIQUE KEY uq_agp_game_player (game, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
