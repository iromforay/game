-- 터비 구하기 스토리 M2 — 기존 계정 지역 입장 권한 백필(작성만, 미실행. 사용자 승인 필요)
-- 선행: 2026-09-29_turby_story_m1.sql 적용(player_story_event 테이블)
-- 실행 문서: 이 파일 아래 "실행 절차". 대조: 2026-09-29_turby_story_m2_verify.sql, 롤백: 2026-09-29_turby_story_m2_rollback.sql
--
-- 규칙: 기존 화면 규칙(연속 개방)을 그대로 보존한다.
--   N장(N≥2) 입장 권한 = 1장부터 N-1장까지 모든 대표 터비(story_chapter.clear_character_code)를 직접 포획(wild_capture)
--   → player_story_event(event_id='legacy_access_<stage_code>', source='legacy_backfill')
-- 만들지 않는 것: 체크포인트, 성장 단계, 유물, 정식 *_unlocked 이벤트(개발 계획 4절 7번)
-- 재실행 안전: uq_story_event(player_id, event_id)에 걸리면 아무것도 바꾸지 않는다(ON DUPLICATE KEY UPDATE 자기 자신)
--
-- 참고: 구 서버 입장 검사(requireUnlocked)는 "이전 장 대표"만 봤지만, 화면(FE)은 연속 규칙으로 지역을 잠갔다.
-- 실제 사용자가 들어갈 수 있던 범위는 화면 규칙이므로 연속 규칙으로 백필한다(Codex v9 8절, 테스트 6번).

INSERT INTO player_story_event (player_id, event_id, source)
SELECT p.id, CONCAT('legacy_access_', target.stage_code), 'legacy_backfill'
FROM player p
JOIN story_chapter target ON target.chapter_order >= 2
WHERE NOT EXISTS (
  SELECT 1
  FROM story_chapter prev
  WHERE prev.chapter_order < target.chapter_order
    AND NOT EXISTS (
      SELECT 1
      FROM turby_instance t
      JOIN turby_character c ON c.id = t.character_id
      WHERE t.owner_player_id = p.id
        AND t.acquired_via = 'wild_capture'
        AND c.code = prev.clear_character_code
    )
)
ON DUPLICATE KEY UPDATE event_id = event_id;

-- ===== 실행 절차 =====
-- 0. 전제: M1 SQL 적용, 새 BE 배포 완료, story.stageAccessV2 = false(기본). 1장 스토리(M3·M4)가 플레이 가능해지기 전에는
--    플래그를 켜지 않는다 — 켜면 신규 계정이 lake_unlocked를 얻을 방법이 없어 숲 밖으로 나갈 수 없다.
-- 1. verify.sql의 V1(백필 전 구 규칙 분포)을 실행해 결과를 기록한다.
-- 2. 이 파일의 INSERT를 실행한다.
-- 3. verify.sql의 V2(계정별 구 규칙 ↔ 백필 결과 대조)를 실행한다. mismatched_players가 0이 아니면 즉시 중단하고 롤백한다.
-- 4. V3(백필 행 수 요약)을 기록한다.
-- 5. 플래그 전환 직전에 이 INSERT를 한 번 더 실행한다(백필 이후 새로 포획해 열린 계정 반영). 재실행 안전.
-- 6. UPDATE game_setting SET value_json = 'true' WHERE setting_key = 'story.stageAccessV2'; 후 서버 설정 재적재(재시작).
-- 7. 문제 시: value_json = 'false'로 되돌리면 즉시 구 판정. 백필 행은 구 판정에 영향이 없어 남겨 두어도 된다.
