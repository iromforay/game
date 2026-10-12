CREATE TABLE IF NOT EXISTS my_room_dungeon_profile (
  account_id BIGINT UNSIGNED NOT NULL COMMENT '계정 account.id',
  inventory_json TEXT NOT NULL COMMENT '인벤토리 자원별 보유 수량 JSON 객체',
  discovered_json TEXT NOT NULL COMMENT '최초 발견을 완료한 자원 ID JSON 배열',
  crafted_bots INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '제작 후 현재 보유 중인 종이상자 채집봇 수',
  crafted_swords INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '제작 후 현재 보유 중인 종이검 수',
  cleared_zones_json TEXT NOT NULL COMMENT '최초 전체 채집을 완료한 구역 ID JSON 배열',
  robot_assignments_json TEXT NOT NULL COMMENT '구역별 자동 채집봇 배치 및 작업 상태 JSON 객체',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 변경 시각',
  PRIMARY KEY (account_id),
  CONSTRAINT fk_my_room_dungeon_account
    FOREIGN KEY (account_id) REFERENCES account(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='내 방이 던전 계정별 인벤토리·발견 자원·제작품 저장 프로필';
