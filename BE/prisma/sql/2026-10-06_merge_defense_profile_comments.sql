ALTER TABLE merge_defense_profile
  COMMENT = '장난감 머지 방어전 계정별 도감·은화·영구 강화 프로필',
  MODIFY COLUMN account_id BIGINT UNSIGNED NOT NULL COMMENT '계정 account.id',
  MODIFY COLUMN silver INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '영구 보유 은화',
  MODIFY COLUMN attack_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '전체 용사 추가 공격력 강화 레벨',
  MODIFY COLUMN warrior_unlocked INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '합성으로 발견한 검사 최고 단계(1~10)',
  MODIFY COLUMN archer_unlocked INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '합성으로 발견한 궁사 최고 단계(1~10)',
  MODIFY COLUMN spellblade_unlocked INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '합성으로 발견한 마검사 최고 단계(0~10)',
  MODIFY COLUMN spellblade_recipe_unlocked TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1-2 클리어 마검사 융합식 해금 여부',
  MODIFY COLUMN start_coin_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '전 스테이지 시작 코인 강화 레벨(레벨당 +5)',
  MODIFY COLUMN summon_discount_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '용사 직접 호출 비용 할인 레벨(레벨당 -3%)',
  MODIFY COLUMN highest_cleared_stage INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '순차 진행 기준 최고 클리어 전역 스테이지 ID(1-1=1, 2-1=11, 3-1=21)',
  MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 변경 시각';
