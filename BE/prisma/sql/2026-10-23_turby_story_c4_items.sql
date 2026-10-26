-- 터비 구하기 4장 C4-3 — 얼음 극세사 이야기 아이템 정의(작성만, 미실행)
-- 실행 순서: 2026-10-16_turby_story_c3_items.sql 적용 뒤. 스키마 변경 없음(item_definition 행 추가만).
-- 능력치 0, 최대 중첩 1, 이야기 슬롯 story_4. 판매·버리기·분해·거래·일반 사용 불가는 category = relic 규칙(스토리 아이템 잠금)으로 보장한다.
-- 롤백: 보유 행이 없을 때만 DELETE FROM item_definition WHERE code = 'ice_microfiber'.

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus, max_stack, story_slot) VALUES
  ('ice_microfiber', '얼음 극세사', 'relic', '서리 미싱의 윗실로 쓰이던 차가운 은빛 극세사. 누비의 팔과 목 둘레에 감으면 끊어진 감각이 이어질 것 같다.', NULL, 0, 0, 0, 0, 1, 'story_4')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  max_stack = VALUES(max_stack), story_slot = VALUES(story_slot);
