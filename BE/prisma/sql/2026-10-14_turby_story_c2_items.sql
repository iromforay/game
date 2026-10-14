-- 터비 구하기 2장 C2-5B — 물빛 염색실 이야기 아이템 정의(작성만, 미실행)
-- 실행 순서: 2026-09-29_turby_story_m1_items.sql 적용 뒤. 스키마 변경 없음(item_definition 행 추가만).
-- 능력치 0, 최대 중첩 1, 이야기 슬롯 story_2(장착·성장은 C2-6). 판매·버리기·분해·거래·일반 사용 불가는 category = relic 규칙(스토리 아이템 잠금)으로 보장한다.
-- 롤백: 보유 행이 없을 때만 DELETE FROM item_definition WHERE code = 'water_dye_yarn'.

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus, max_stack, story_slot) VALUES
  ('water_dye_yarn', '물빛 염색실', 'relic', '물먹은 박음이의 몸 중심에서 떠오른 푸른 물빛 염색실. 물들이에게는 반응하지 않고 누비에게만 천천히 다가간다.', NULL, 0, 0, 0, 0, 1, 'story_2')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  max_stack = VALUES(max_stack), story_slot = VALUES(story_slot);
