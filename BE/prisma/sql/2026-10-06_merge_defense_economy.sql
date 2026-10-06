CREATE TABLE IF NOT EXISTS merge_defense_profile (
  account_id BIGINT UNSIGNED NOT NULL COMMENT '계정 account.id',
  silver INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '영구 보유 은화',
  attack_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '전체 용사 추가 공격력 강화 레벨',
  warrior_unlocked INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '합성으로 발견한 검사 최고 단계(1~10)',
  archer_unlocked INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '합성으로 발견한 궁사 최고 단계(1~10)',
  spellblade_unlocked INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '합성으로 발견한 마검사 최고 단계(0~10)',
  spellblade_recipe_unlocked BOOLEAN NOT NULL DEFAULT FALSE COMMENT '1-2 클리어 마검사 융합식 해금 여부',
  start_coin_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '전 스테이지 시작 코인 강화 레벨(레벨당 +5)',
  summon_discount_level INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '용사 직접 호출 비용 할인 레벨(레벨당 -3%)',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 변경 시각',
  PRIMARY KEY (account_id)
) COMMENT='장난감 머지 방어전 계정별 도감·은화·영구 강화 프로필';

CREATE TABLE IF NOT EXISTS merge_defense_silver_claim (
  run_key VARCHAR(64) NOT NULL COMMENT '은화 중복 적립 방지용 전투 고유키',
  account_id BIGINT UNSIGNED NOT NULL COMMENT '계정 account.id',
  stage_id INT UNSIGNED NOT NULL COMMENT '은화를 획득한 스테이지 번호',
  silver INT UNSIGNED NOT NULL COMMENT '해당 전투에서 획득한 은화',
  kills INT UNSIGNED NOT NULL COMMENT '해당 전투의 적 처치 수',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '은화 적립 처리 시각',
  PRIMARY KEY (run_key),
  KEY idx_merge_silver_account (account_id)
) COMMENT='장난감 머지 방어전 은화 중복 적립 방지 기록';
