-- 터비 구하기 스토리 M1 — 롤백(작성만, 미실행. 실행 전 사용자 승인 필요)
-- 기본 롤백은 "코드만 되돌리기"다. 새 컬럼·테이블은 구 코드가 읽지 않으므로 남겨 두어도 된다.
-- 아래는 데이터까지 되돌려야 할 때만, 번호 순서대로 필요한 절만 실행한다.

-- 1) 백필 데이터만 제거(M2 입장 권한 백필을 되돌릴 때)
-- DELETE FROM player_story_event WHERE source = 'legacy_backfill';
-- DELETE FROM player_story_progress WHERE origin = 'legacy_backfill';

-- 2) 스토리 진행 전체 초기화(스토리 기능 자체를 철회할 때. 이야기 누비 표시도 해제)
-- UPDATE turby_instance SET is_story_companion = 0 WHERE is_story_companion = 1;
-- DELETE FROM turby_equipment WHERE slot_key LIKE 'story\_%';
-- DELETE FROM player_story_objective_progress;
-- DELETE FROM player_story_event;
-- DELETE FROM player_story_progress;

-- 3) 이야기 아이템 정의 제거 — 구 BE로 되돌리기 전에 반드시 먼저(구 Prisma 클라이언트가 새 enum 값을 못 읽음)
--    보유·장착 행을 먼저 지워야 한다. 사용자에게 지급된 이야기 아이템이 사라지므로 2)와 함께만 실행
-- DELETE FROM player_item WHERE item_definition_id IN (SELECT id FROM item_definition WHERE category IN ('material','mission','relic','memento'));
-- DELETE FROM player_item_overflow;
-- DELETE FROM item_definition WHERE category IN ('material','mission','relic','memento');
-- DELETE FROM battle_result WHERE encounter_type = 'story';

-- 4) 스키마 제거(최후 수단 — 데이터 손실. 사전 백업 필수)
-- ALTER TABLE battle_result MODIFY COLUMN encounter_type ENUM('wild','raid') NOT NULL;
-- ALTER TABLE item_definition MODIFY COLUMN category ENUM('defense','consumable','upgrade','equipment') NOT NULL,
--   DROP COLUMN IF EXISTS story_slot, DROP COLUMN IF EXISTS max_stack;
-- ALTER TABLE player_item DROP COLUMN IF EXISTS used_at, DROP COLUMN IF EXISTS is_locked, DROP COLUMN IF EXISTS is_new,
--   DROP COLUMN IF EXISTS last_acquired_at, DROP COLUMN IF EXISTS first_acquired_at;
-- ALTER TABLE turby_instance DROP COLUMN IF EXISTS is_story_companion;
-- ALTER TABLE player DROP INDEX IF EXISTS uq_player_session_token, DROP COLUMN IF EXISTS session_token;
-- DROP TABLE IF EXISTS player_item_overflow;
-- DROP TABLE IF EXISTS player_story_objective_progress;
-- DROP TABLE IF EXISTS player_story_event;
-- DROP TABLE IF EXISTS player_story_progress;
-- DELETE FROM game_setting WHERE setting_key IN ('auth.requireSession', 'story.evidenceSlackPx', 'inventory.bagCapacity');
