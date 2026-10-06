-- 장난감 머지 방어전을 게임 허브 스코어보드 게임 종류에 추가한다.
ALTER TABLE score_record
  MODIFY COLUMN game ENUM('tower_defense','offense_tower','number_hero_tower','number_gate_runner','merge_defense','marbles') NOT NULL;
