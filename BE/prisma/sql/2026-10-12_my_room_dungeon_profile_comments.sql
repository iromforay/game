-- 코멘트 없이 먼저 생성된 my_room_dungeon_profile 테이블 보정용.
ALTER TABLE my_room_dungeon_profile
  COMMENT = '내 방이 던전 계정별 인벤토리·발견 자원·제작품 저장 프로필',
  MODIFY COLUMN account_id BIGINT UNSIGNED NOT NULL COMMENT '계정 account.id',
  MODIFY COLUMN inventory_json TEXT NOT NULL COMMENT '인벤토리 자원별 보유 수량 JSON 객체',
  MODIFY COLUMN discovered_json TEXT NOT NULL COMMENT '최초 발견을 완료한 자원 ID JSON 배열',
  MODIFY COLUMN crafted_bots INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '제작 후 현재 보유 중인 종이상자 채집봇 수',
  MODIFY COLUMN crafted_swords INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '제작 후 현재 보유 중인 종이검 수',
  MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 변경 시각';
