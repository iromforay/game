-- 터비 구하기 스토리 M2 — 백필 전·후 대조(SELECT 전용, 작성만, 미실행)
-- 집계값만 출력한다. device_uuid·닉네임·토큰은 출력하지 않는다.
-- 개발 테스트 계정(device_uuid LIKE 'dev-%')도 백필 대상이지만 집계에서는 따로 센다.

-- V1. 구 규칙(연속 개방)의 가장 먼 개방 지역 분포 — 백필 전에 기록(player_distribution.select.sql Q7과 같은 식)
SELECT reached_order, SUM(is_dev = 0) AS real_players, SUM(is_dev = 1) AS dev_players
FROM (
  SELECT p.id, (p.device_uuid LIKE 'dev-%') AS is_dev,
         1 + (SELECT COUNT(*) FROM story_chapter sc
              WHERE sc.chapter_order < (SELECT MAX(chapter_order) FROM story_chapter)
                AND NOT EXISTS (
                  SELECT 1 FROM story_chapter prev
                  WHERE prev.chapter_order <= sc.chapter_order
                    AND NOT EXISTS (
                      SELECT 1 FROM turby_instance t JOIN turby_character c ON c.id = t.character_id
                      WHERE t.owner_player_id = p.id AND t.acquired_via = 'wild_capture' AND c.code = prev.clear_character_code))) AS reached_order
  FROM player p
) x
GROUP BY reached_order
ORDER BY reached_order;
-- reached_order | real_players | dev_players
--             1 |          111 |           2
--             2 |            8 |           0

-- V2. 계정별 대조 — 구 규칙의 가장 먼 개방 지역 vs 백필 이벤트로 열리는 가장 먼 지역(신 판정은 숲 + legacy_access_*)
--     mismatched_players = 0 이어야 플래그 전환 가능. 한 계정이라도 다르면 중단.
SELECT COUNT(*) AS checked_players, SUM(legacy_reached <> backfill_reached) AS mismatched_players
FROM (
  SELECT p.id,
         1 + (SELECT COUNT(*) FROM story_chapter sc
              WHERE sc.chapter_order < (SELECT MAX(chapter_order) FROM story_chapter)
                AND NOT EXISTS (
                  SELECT 1 FROM story_chapter prev
                  WHERE prev.chapter_order <= sc.chapter_order
                    AND NOT EXISTS (
                      SELECT 1 FROM turby_instance t JOIN turby_character c ON c.id = t.character_id
                      WHERE t.owner_player_id = p.id AND t.acquired_via = 'wild_capture' AND c.code = prev.clear_character_code))) AS legacy_reached,
         GREATEST(1, COALESCE((SELECT MAX(sc.chapter_order) FROM story_chapter sc
                               JOIN player_story_event e ON e.player_id = p.id AND e.event_id = CONCAT('legacy_access_', sc.stage_code)), 1)) AS backfill_reached
  FROM player p
) x;
-- checked_players | mismatched_players
--             125 |                  0

-- V3. 백필 행 요약
SELECT event_id, COUNT(*) AS players
FROM player_story_event
WHERE source = 'legacy_backfill'
GROUP BY event_id
ORDER BY event_id;
-- event_id                  | players
-- legacy_access_lake        |      14
-- legacy_access_underground |       6

-- V4. 백필이 만들면 안 되는 것이 없는지(0행이어야 함)
SELECT COUNT(*) AS forbidden_rows
FROM player_story_event
WHERE source = 'legacy_backfill' AND event_id NOT LIKE 'legacy\_access\_%';
