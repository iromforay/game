-- 터비 구하기 4-C: 협동 조우·야생 공유 상태용 설정. 원격 DB에 직접 적용, 여러 번 실행해도 안전.
-- 조우 거리: 프런트 조우 판정(40px)에 이동 보고 지연(120ms 주기 × 최대 속도)과 여유를 더한 값. 서버가 조우 요청 시 실제 위치를 확인한다.
INSERT INTO game_setting (setting_key, value_json) VALUES
  ('battle.encounterRadiusPx', '120')
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);
