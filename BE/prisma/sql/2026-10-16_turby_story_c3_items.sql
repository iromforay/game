-- 터비 구하기 3장 C3-3 — 오래된 솜심 이야기 아이템 정의(작성만, 미실행)
-- 실행 순서: 2026-10-14_turby_story_c2_items.sql 적용 뒤. 스키마 변경 없음(item_definition 행 추가만).
-- 능력치 0, 최대 중첩 1, 이야기 슬롯 story_3. 판매·버리기·분해·거래·일반 사용 불가는 category = relic 규칙(스토리 아이템 잠금)으로 보장한다.
-- 롤백: 보유 행이 없을 때만 DELETE FROM item_definition WHERE code = 'old_cotton_core'.

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus, max_stack, story_slot) VALUES
  ('old_cotton_core', '오래된 솜심', 'relic', '기억 실패굴이의 중심축에서 빠져나온, 오래되어 바랜 솜 뭉치. 누비의 가슴 중앙에 맞는 것 같다.', NULL, 0, 0, 0, 0, 1, 'story_3')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  max_stack = VALUES(max_stack), story_slot = VALUES(story_slot);
