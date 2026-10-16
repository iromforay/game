-- 기존 달콤상점 DB에 알림노트 광고 저장소를 추가한다.
CREATE TABLE IF NOT EXISTS sweet_shop_advertisement (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '광고 중인 달콤상점 프로필 ID',
  ends_at TIMESTAMP NOT NULL COMMENT '알림노트 광고 종료 시각',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '광고 최종 변경 시각',
  PRIMARY KEY (profile_id),
  KEY idx_sweet_advertisement_ends (ends_at)
) COMMENT='카페 거리 알림노트 광고 활성 상태';
