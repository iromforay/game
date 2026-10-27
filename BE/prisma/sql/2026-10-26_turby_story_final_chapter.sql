-- 터비 구하기 종장(집의 중심, 지역 코드 home_core): 지역 선택에 종장 카드를 추가한다(2026-10-26 F-1, 사용자 "종장 제안대로 진행").
-- 입장은 5장 금빛 마감실 장착 때 기록되는 final_unlocked 사건으로 열린다(서버 STAGE_UNLOCK_EVENTS). 지도 크기는 1~5장과 같은 3200×2400.
-- clear_character_code는 구 입장 판정(대표 직접 포획) 롤백 경로에서만 다음 장을 위해 읽는다 — 종장 다음 장이 없으므로 이야기 누비로 둔다.
-- 운영 반영 때 적용한다(멱등).
INSERT INTO story_chapter (chapter_order, stage_code, clear_character_code, title, map_width, map_height) VALUES
  (6, 'home_core', 'nubi', '종장 — 집의 중심', 3200, 2400)
ON DUPLICATE KEY UPDATE stage_code = VALUES(stage_code), clear_character_code = VALUES(clear_character_code),
  title = VALUES(title), map_width = VALUES(map_width), map_height = VALUES(map_height);
