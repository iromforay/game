-- 숫자 용사 탑 점수 지원. 같은 run_key 행을 매 보상 합산 후 상승 방향으로 갱신한다.
ALTER TABLE score_record
  MODIFY COLUMN game ENUM('tower_defense','offense_tower','number_hero_tower','marbles') NOT NULL;
