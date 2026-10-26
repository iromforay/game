-- 터비 구하기 5장 C5-3 — 금빛 마감실 이야기 아이템 정의
-- 실행 순서: 2026-10-23_turby_story_c4_items.sql 적용 뒤. 스키마 변경 없음(item_definition 행 추가만).
-- 능력치 0, 최대 중첩 1, 이야기 슬롯 story_5. 판매·버리기·분해·거래·일반 사용 불가는 category = relic 규칙(스토리 아이템 잠금)으로 보장한다.
-- 롤백: 보유 행이 없을 때만 DELETE FROM item_definition WHERE code = 'golden_finish_thread'.

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus, max_stack, story_slot) VALUES
  ('golden_finish_thread', '금빛 마감실', 'relic', '황금 재단인형의 몸 가장자리를 감싸 잘린 곳을 계속 꿰매던 금빛 실. 잘리지 않은 채 누비의 손에 남았다. 몸 가장자리에 두르면 모든 조각을 이을 준비가 끝날 것 같다.', NULL, 0, 0, 0, 0, 1, 'story_5')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  max_stack = VALUES(max_stack), story_slot = VALUES(story_slot);
