-- 터비 구하기 스토리 M1 — 1장 이야기 아이템 정의(작성만, 미실행)
-- 실행 순서: 2026-09-29_turby_story_m1.sql 적용 → 새 BE 배포(prisma generate 포함) → 이 파일.
-- 새 enum 값(mission/relic)을 쓰므로 구 BE가 떠 있는 동안 넣으면 구 BE의 아이템 조회가 실패한다.
-- 능력치는 0(Codex D9: 장별 밸런스 승인 전 비활성). 이름·설명은 docs/story/chapter_01_forest.md 기준.
-- 롤백: DELETE는 보유 행이 없을 때만(2026-09-29_turby_story_m1_rollback.sql 3절).

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus, max_stack, story_slot) VALUES
  ('glowing_yarn_dust', '빛나는 실가루', 'mission', '오래된 실의 떨림에 반응하는 가루. 보풀이에게 열 개를 가져가면 무언가를 만들 수 있다.', NULL, 0, 0, 0, 0, 99, NULL),
  ('yarn_tremor_compass', '실의 떨림을 찾는 나침판', 'mission', '감춰진 실오라기 길을 가리키는 나침판.', NULL, 0, 0, 0, 0, 1, NULL),
  ('first_knot', '첫 매듭', 'relic', '첫 만남의 크림색 매듭이 매듭심과 결속해 깨어난 이야기 장식.', NULL, 0, 0, 0, 0, 1, 'story_1')
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  max_stack = VALUES(max_stack), story_slot = VALUES(story_slot);
