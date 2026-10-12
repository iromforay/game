-- 터비 구하기 스토리 M2 — 롤백(작성만, 미실행. 사용자 승인 필요)

-- 1) 판정 롤백(즉시, 데이터 변경 없음): 구 포획 판정으로 되돌린다. 서버 설정 재적재(재시작) 필요.
-- UPDATE game_setting SET value_json = 'false' WHERE setting_key = 'story.stageAccessV2';

-- 2) 백필 데이터 제거(백필을 다시 해야 할 때만). 정식 스토리 이벤트(source='story')는 건드리지 않는다.
-- DELETE FROM player_story_event WHERE source = 'legacy_backfill' AND event_id LIKE 'legacy\_access\_%';
