CREATE TABLE IF NOT EXISTS spin_gather_profile (
  profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '빙글 채집왕 프로필 고유 ID',
  account_id BIGINT UNSIGNED NULL COMMENT '로그인 계정 ID. 게스트 프로필은 NULL',
  guest_id VARCHAR(64) NULL COMMENT '비로그인 사용자의 브라우저 게스트 식별자',
  state_json LONGTEXT NOT NULL COMMENT '자원·맵·기지·포탑·칼날 진행 상태 JSON',
  revision INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '동시 저장 충돌 방지용 증가 버전',
  schema_version INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'state_json 데이터 구조 버전',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '프로필 최초 생성 시각',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 저장 시각',
  PRIMARY KEY (profile_id),
  UNIQUE KEY uq_spin_gather_account (account_id),
  UNIQUE KEY uq_spin_gather_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='빙글 채집왕 회원·게스트 영구 진행 저장';
