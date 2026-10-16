-- 달콤상점 친구·차단·신고 기능용 테이블.
CREATE TABLE IF NOT EXISTS sweet_shop_friend (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '친구를 등록한 프로필 ID',
  friend_profile_id BIGINT UNSIGNED NOT NULL COMMENT '등록된 친구 프로필 ID',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '친구 등록 시각',
  PRIMARY KEY (profile_id, friend_profile_id),
  KEY idx_sweet_friend_target (friend_profile_id)
) COMMENT='달콤상점 프로필별 친구 목록';

CREATE TABLE IF NOT EXISTS sweet_shop_block (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '차단한 프로필 ID',
  blocked_profile_id BIGINT UNSIGNED NOT NULL COMMENT '차단된 프로필 ID',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '차단 시각',
  PRIMARY KEY (profile_id, blocked_profile_id),
  KEY idx_sweet_block_target (blocked_profile_id)
) COMMENT='달콤상점 사용자 차단 관계';

CREATE TABLE IF NOT EXISTS sweet_shop_report (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '신고 고유 ID',
  reporter_profile_id BIGINT UNSIGNED NOT NULL COMMENT '신고자 프로필 ID',
  target_profile_id BIGINT UNSIGNED NOT NULL COMMENT '신고 대상 프로필 ID',
  reason_code VARCHAR(30) NOT NULL COMMENT '신고 사유 코드',
  detail VARCHAR(200) NULL COMMENT '신고 상세 내용',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '처리 상태',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '신고 시각',
  PRIMARY KEY (id),
  KEY idx_sweet_report_target (target_profile_id, status),
  KEY idx_sweet_report_reporter (reporter_profile_id, created_at)
) COMMENT='달콤상점 사용자 신고 접수 기록';

CREATE TABLE IF NOT EXISTS sweet_shop_chat_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '채팅 메시지 고유 ID',
  cafe_profile_id BIGINT UNSIGNED NOT NULL COMMENT '채팅이 발생한 카페 프로필 ID',
  sender_profile_id BIGINT UNSIGNED NOT NULL COMMENT '발신자 프로필 ID',
  sender_name VARCHAR(40) NOT NULL COMMENT '발신 당시 표시 이름',
  message VARCHAR(80) NOT NULL COMMENT '채팅 메시지',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '발신 시각',
  PRIMARY KEY (id),
  KEY idx_sweet_chat_cafe (cafe_profile_id, created_at)
) COMMENT='달콤상점 카페별 최근 채팅 기록';
