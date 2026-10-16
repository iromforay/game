-- 조리 시작 시점의 재료·숙련도·섭취 버프를 생산 작업에 고정한다.

ALTER TABLE sweet_shop_cooking_job
  ADD COLUMN ingredient_quality_bonus DOUBLE NOT NULL DEFAULT 0
    COMMENT '실제 소비한 재료 품질의 수량 가중 보정값' AFTER quantity,
  ADD COLUMN mastery_quality_bonus DOUBLE NOT NULL DEFAULT 0
    COMMENT '조리 시작 시 레시피 숙련도 보정값' AFTER ingredient_quality_bonus,
  ADD COLUMN buff_quality_bonus TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '조리 시작 시 적용된 확정 품질 승급 단계' AFTER mastery_quality_bonus;
