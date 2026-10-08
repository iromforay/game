-- 머지 디펜스의 계정별 최고 클리어 스테이지를 영구 저장한다.
ALTER TABLE merge_defense_profile
  ADD COLUMN IF NOT EXISTS highest_cleared_stage INT UNSIGNED NOT NULL DEFAULT 0
  COMMENT '순차 진행 기준 최고 클리어 전역 스테이지 ID(1-1=1, 2-1=11, 3-1=21, 4-1=31, 5-1=41)'
  AFTER summon_discount_level;
