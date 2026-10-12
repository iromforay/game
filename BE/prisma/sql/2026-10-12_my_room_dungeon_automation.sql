ALTER TABLE my_room_dungeon_profile
  ADD COLUMN cleared_zones_json TEXT NOT NULL COMMENT '최초 전체 채집을 완료한 구역 ID JSON 배열' AFTER crafted_swords,
  ADD COLUMN robot_assignments_json TEXT NOT NULL COMMENT '구역별 자동 채집봇 배치 및 작업 상태 JSON 객체' AFTER cleared_zones_json;
