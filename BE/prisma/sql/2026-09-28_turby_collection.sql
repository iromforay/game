-- 허브 터비 구하기 도감: 캐릭터 설명 컬럼. 원격 DB에 직접 적용(prisma db push 미사용 — 기존 정책).
-- 여러 번 실행해도 안전하도록 IF NOT EXISTS 사용. 설명 문구는 도감 표시용이며 DB에서 바로 고칠 수 있다.
-- 누비 설명은 종류(일반 누비) 설명이다. 이야기 동료 '풀린 누비'의 정체(태초의 실타래)를 암시하지 않는다.

ALTER TABLE turby_character
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

UPDATE turby_character SET description = '여기저기 기운 자국이 남은 소박한 헌실 터비. 화려하지도 특별한 재주도 없지만, 한 번 맺은 인연은 끝까지 놓지 않는다.' WHERE code = 'nubi';
UPDATE turby_character SET description = '소파 속 먼지숲에 사는 보풀형 터비. 폭신한 보풀 덕에 먼지바람에도 끄떡없고, 손재주가 좋아 빛나는 실가루로 작은 도구를 엮어 낸다.' WHERE code = 'bopuli';
UPDATE turby_character SET description = '어항 속 호숫가에 사는 색실 터비. 닿는 것마다 은은한 물빛을 입히는 재주가 있어, 호수의 색이 바래면 가장 먼저 알아차린다.' WHERE code = 'muldeuli';
UPDATE turby_character SET description = '마루바닥 밑 오래된 물건 사이에 사는 벨벳실 터비. 푹신한 몸으로 동료를 감싸 지켜 주며, 오래 산 폭신이는 실의 냄새만으로 길을 찾는다.' WHERE code = 'pokshini';
UPDATE turby_character SET description = '따뜻한 곳을 좋아하는 금실 터비. 몸에서 은은한 금빛이 번져 어두운 곳을 밝힌다. 좀처럼 모습을 드러내지 않아 만나기 어렵다.' WHERE code = 'geumbiti';
UPDATE turby_character SET description = '차가운 냉장고 속에서 지내는 극세사 터비. 몸이 가늘고 섬세해 아주 작은 떨림과 소리도 놓치지 않는다. 말수가 적고 조심스럽다.' WHERE code = 'ganeuri';
UPDATE turby_character SET description = '일곱 빛깔 실로 짜인 전설 속 터비. 보았다는 이야기만 떠돌 뿐, 직접 만난 이는 거의 없다.' WHERE code = 'mujigae';
