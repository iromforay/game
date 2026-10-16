-- 터비 구하기: 모든 장의 지도 크기를 1장 구현 해상도 3200×2400으로 통일(2026-10-16 사용자 결정)
-- 2026-09-21_rooms.sql의 초기 설계 값(2장 4000×3000 ~ 5장 6400×4800)은 스토리판에서 쓰지 않는다.
-- 서버 판정은 지역 데이터(story-data/stages/*.json)의 size를 먼저 쓰고, 지역 데이터가 없을 때만 이 표 값을 쓴다.
-- 운영 반영 때 적용한다(멱등).
UPDATE story_chapter
   SET map_width = 3200, map_height = 2400
 WHERE stage_code IN ('forest', 'lake', 'underground', 'ice', 'desert')
   AND (map_width <> 3200 OR map_height <> 2400);
