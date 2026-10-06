-- 숫자 게이트 러너를 스코어보드 게임 종류에 추가한다.
ALTER TABLE score_record
  MODIFY COLUMN game ENUM('tower_defense','offense_tower','number_hero_tower','number_gate_runner','marbles') NOT NULL;
