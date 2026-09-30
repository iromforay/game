-- 터비 구하기 스토리 모드 M1 — 스키마 추가(작성만, 미실행. 실행 전 사용자 승인 필요)
-- 근거: docs/dev/save-a-turby/m0/m0_design.md 2절, Codex 검수(docs/history/2026-09-29/save-a-turby/to_claude_v2_R.md)
-- 원칙: 추가만 한다(nullable 또는 기본값). 기존 행·컬럼·enum 값은 바꾸거나 지우지 않는다.
-- 여러 번 실행해도 안전(IF NOT EXISTS). FK 없이 인덱스만 둔다(relationMode = "prisma", 기존 정책).
-- 롤백: 2026-09-29_turby_story_m1_rollback.sql
--
-- 주의(신구 호환): 이 파일은 enum 정의만 넓힌다. 새 enum 값(material/mission/relic/memento, story)을 쓰는 행은
-- 새 BE 배포 뒤에 2026-09-29_turby_story_m1_items.sql로 넣는다. 구 BE(Prisma 클라이언트)는 모르는 enum 값을 읽으면 실패한다.

-- 1) 세션 토큰 — identify()가 발급, /player/me/* 헤더(X-Turby-Session)와 소켓 hello가 검증
ALTER TABLE player
  ADD COLUMN IF NOT EXISTS session_token VARCHAR(64) NULL AFTER updated_at,
  ADD UNIQUE KEY IF NOT EXISTS uq_player_session_token (session_token);

-- 2) 이야기 누비 표시(판매·거래·폐기 불가). is_locked(사용자 잠금)와 별개
ALTER TABLE turby_instance
  ADD COLUMN IF NOT EXISTS is_story_companion TINYINT(1) NOT NULL DEFAULT 0 AFTER hp_bonus;

-- 3) 아이템 분류 확장(끝에만 추가 — 기존 값 순서 유지), 가방 칸 계산, 이야기 유물 슬롯
ALTER TABLE item_definition
  MODIFY COLUMN category ENUM('defense','consumable','upgrade','equipment','material','mission','relic','memento') NOT NULL,
  ADD COLUMN IF NOT EXISTS max_stack SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER hp_bonus,
  ADD COLUMN IF NOT EXISTS story_slot VARCHAR(20) NULL AFTER max_stack;

-- 4) 보유 아이템 표시 정보. 기존 행은 모두 NULL/0으로 시작(과거 시각을 추정해 채우지 않는다)
ALTER TABLE player_item
  ADD COLUMN IF NOT EXISTS first_acquired_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_acquired_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_new TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_locked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMP NULL DEFAULT NULL;

-- 5) 스토리 전투 기록용 enum 값(끝에만 추가)
ALTER TABLE battle_result
  MODIFY COLUMN encounter_type ENUM('wild','raid','story') NOT NULL;

-- 6) 플레이어 스토리 진행(플레이어당 한 행)
CREATE TABLE IF NOT EXISTS player_story_progress (
  player_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  checkpoint VARCHAR(40) NOT NULL DEFAULT 'OPENING_NOT_STARTED',
  story_nubi_turby_instance_id BIGINT UNSIGNED NULL,
  nubi_growth_stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  origin ENUM('new','legacy_backfill') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_story_nubi (story_nubi_turby_instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7) 완료 이벤트 — (player_id, event_id) unique가 영구 보상 멱등성의 마지막 방어선
CREATE TABLE IF NOT EXISTS player_story_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  source ENUM('story','legacy_backfill') NOT NULL DEFAULT 'story',
  completed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_story_event (player_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8) 수집 오브젝트 진행 — 오브젝트 한 개 = 한 행(Codex D4 확정)
CREATE TABLE IF NOT EXISTS player_story_objective_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  objective_key VARCHAR(64) NOT NULL,
  object_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_story_objective_object (player_id, objective_key, object_id),
  KEY idx_story_objective (player_id, objective_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9) 가방 초과 일반 보상 임시 보관함 — 만료 없음(Codex D1 A안). 멱등 키는 플레이어 범위
CREATE TABLE IF NOT EXISTS player_item_overflow (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_id BIGINT UNSIGNED NOT NULL,
  item_definition_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  source_key VARCHAR(96) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  claimed_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_item_overflow_source (player_id, source_key),
  KEY idx_item_overflow_player (player_id, claimed_at),
  KEY idx_item_overflow_item (item_definition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10) 전환 기간 설정 — 기본값은 "강제 안 함"(구 FE가 계속 동작). M1 마지막에 1로 바꾼다
INSERT INTO game_setting (setting_key, value_json) VALUES
  ('auth.requireSession', 'false'),
  ('story.evidenceSlackPx', '48'),
  ('inventory.bagCapacity', '40')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
