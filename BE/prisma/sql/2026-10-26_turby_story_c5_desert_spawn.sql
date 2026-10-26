-- 터비 구하기 5장 C5-1 — 사막 야생 출현 좌표를 새 길 골격(3200×2400, BE/scripts/data/desert-skeleton.json v1)에 맞춘다(작성만, 미실행)
-- 2026-09-21_battle.sql의 사막 좌표는 초기 설계 지도(6400×4800) 기준이라 절반 이상이 지도 밖·벽 안이다(2026-10-26 사용자 결정: 새 골격 기준으로 다시 정한다).
-- 새 좌표는 모두 걸을 수 있는 길 위(몸 반지름 40px 안에 벽·틈 없음)이고 이야기 지점 반경 + 120px 밖이다. 캐릭터·개수(8)는 바꾸지 않는다.
-- 실행 순서: 2026-10-16_turby_story_map_size.sql 적용 뒤. 스키마 변경 없음. 멱등(같은 값으로 다시 실행해도 된다).
-- 롤백: 2026-09-21_battle.sql의 사막 행 값으로 되돌린다.

UPDATE stage_wild_spawn SET x = 700,  y = 1940 WHERE stage_code = 'desert' AND spawn_index = 0; -- 단서 길 앞(금빛이)
UPDATE stage_wild_spawn SET x = 680,  y = 1300 WHERE stage_code = 'desert' AND spawn_index = 1; -- 막다른 갈래 끝(가느리)
UPDATE stage_wild_spawn SET x = 1420, y = 1820 WHERE stage_code = 'desert' AND spawn_index = 2; -- 단서 길 끝(금빛이)
UPDATE stage_wild_spawn SET x = 1900, y = 1700 WHERE stage_code = 'desert' AND spawn_index = 3; -- 능선 입구(폭신이)
UPDATE stage_wild_spawn SET x = 2400, y = 1250 WHERE stage_code = 'desert' AND spawn_index = 4; -- 능선 둘째 구간·뜨거운 모래(금빛이)
UPDATE stage_wild_spawn SET x = 2700, y = 880  WHERE stage_code = 'desert' AND spawn_index = 5; -- 능선 셋째 구간(가느리)
UPDATE stage_wild_spawn SET x = 2650, y = 470  WHERE stage_code = 'desert' AND spawn_index = 6; -- 절단면 → 금빛 마감실 길(금빛이)
UPDATE stage_wild_spawn SET x = 1900, y = 320  WHERE stage_code = 'desert' AND spawn_index = 7; -- 금빛 마감실이 잠든 자리 북쪽(폭신이)
