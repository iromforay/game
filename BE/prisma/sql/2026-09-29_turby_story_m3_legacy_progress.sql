-- 터비 구하기 스토리 M3 호환 — 기존 플레이어를 "기존 계정"으로 명시하는 백필(작성만, 미실행. 사용자 승인 필요)
-- 근거: Codex v13(기존 계정은 오프닝 선택, 신규만 필수), 개발 계획 4절 8번
-- 선행: 2026-09-29_turby_story_m1.sql(player_story_progress 테이블)
-- 반드시 새 BE 배포 "전에" 실행한다 — 새 BE는 진행 행이 없고 터비도 없는 계정을 신규(오프닝 필수)로 본다.
--
-- 하는 일: 진행 행이 없는 모든 player에 player_story_progress(origin='legacy_backfill') 행을 만든다.
-- 하지 않는 일: 체크포인트 진행(기본 OPENING_NOT_STARTED 그대로), 성장 단계, 이야기 누비 연결, 보상·이벤트 생성.
-- 멱등: 이미 행이 있으면(PK player_id) 아무것도 바꾸지 않는다. 기존 행을 덮어쓰지 않는다.

INSERT INTO player_story_progress (player_id, origin)
SELECT p.id, 'legacy_backfill'
FROM player p
ON DUPLICATE KEY UPDATE player_id = player_story_progress.player_id;

-- ===== 검증(SELECT 전용, 집계만) =====
-- L1. 진행 행이 없는 플레이어 수 — 0이어야 한다
-- SELECT COUNT(*) AS players_without_progress
-- FROM player p LEFT JOIN player_story_progress sp ON sp.player_id = p.id
-- WHERE sp.player_id IS NULL;
--
-- L2. 백필 행이 진행을 위조하지 않았는지 — 0이어야 한다
-- SELECT COUNT(*) AS forged_rows
-- FROM player_story_progress
-- WHERE origin = 'legacy_backfill'
--   AND (checkpoint <> 'OPENING_NOT_STARTED' OR nubi_growth_stage <> 0 OR story_nubi_turby_instance_id IS NOT NULL)
--   AND player_id NOT IN (SELECT player_id FROM player_story_event WHERE source = 'story');
--
-- L3. 출신 분포
-- SELECT origin, COUNT(*) AS players FROM player_story_progress GROUP BY origin;

-- ===== 롤백(주석 해제해 실행) =====
-- 아직 이야기를 시작하지 않은 백필 행만 지운다(시작한 기존 계정의 진행은 보존).
-- DELETE FROM player_story_progress
-- WHERE origin = 'legacy_backfill'
--   AND checkpoint = 'OPENING_NOT_STARTED'
--   AND story_nubi_turby_instance_id IS NULL
--   AND player_id NOT IN (SELECT player_id FROM (SELECT DISTINCT player_id FROM player_story_event WHERE source = 'story') s);
