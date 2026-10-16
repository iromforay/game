-- account_id PK 구조를 profile_id PK 구조로 전환한다.
-- 기존 가입자 데이터는 account_id로 새 profile_id에 연결하여 보존한다.
-- 적용 대상: 아직 account_id가 PK인 기존 DB. 실행 전 백업하고 한 번만 실행한다.
-- profile_id가 이미 존재하는 DB에는 실행하지 않는다.

ALTER TABLE sweet_shop_profile
  DROP PRIMARY KEY,
  ADD COLUMN profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  MODIFY COLUMN account_id BIGINT UNSIGNED NULL COMMENT '가입 계정 ID, 비회원은 NULL',
  ADD COLUMN guest_id VARCHAR(64) NULL COMMENT '비회원 브라우저 고유 ID' AFTER account_id,
  ADD UNIQUE KEY uq_sweet_profile_account (account_id),
  ADD UNIQUE KEY uq_sweet_profile_guest (guest_id);

ALTER TABLE sweet_shop_storage ADD COLUMN profile_id BIGINT UNSIGNED NULL FIRST;
UPDATE sweet_shop_storage s JOIN sweet_shop_profile p ON p.account_id = s.account_id SET s.profile_id = p.profile_id;
ALTER TABLE sweet_shop_storage DROP PRIMARY KEY, DROP COLUMN account_id, MODIFY profile_id BIGINT UNSIGNED NOT NULL, ADD PRIMARY KEY (profile_id);

ALTER TABLE sweet_shop_ingredient ADD COLUMN profile_id BIGINT UNSIGNED NULL FIRST;
UPDATE sweet_shop_ingredient i JOIN sweet_shop_profile p ON p.account_id = i.account_id SET i.profile_id = p.profile_id;
ALTER TABLE sweet_shop_ingredient DROP PRIMARY KEY, DROP COLUMN account_id, MODIFY profile_id BIGINT UNSIGNED NOT NULL, ADD PRIMARY KEY (profile_id, ingredient_id, quality);

ALTER TABLE sweet_shop_delivery ADD COLUMN profile_id BIGINT UNSIGNED NULL AFTER request_id;
UPDATE sweet_shop_delivery d JOIN sweet_shop_profile p ON p.account_id = d.account_id SET d.profile_id = p.profile_id;
ALTER TABLE sweet_shop_delivery DROP INDEX idx_sweet_delivery_account, DROP COLUMN account_id, MODIFY profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_delivery_profile (profile_id, status, arrives_at);

ALTER TABLE sweet_shop_recipe_progress ADD COLUMN profile_id BIGINT UNSIGNED NULL FIRST;
UPDATE sweet_shop_recipe_progress r JOIN sweet_shop_profile p ON p.account_id = r.account_id SET r.profile_id = p.profile_id;
ALTER TABLE sweet_shop_recipe_progress DROP PRIMARY KEY, DROP COLUMN account_id, MODIFY profile_id BIGINT UNSIGNED NOT NULL, ADD PRIMARY KEY (profile_id, recipe_id);

ALTER TABLE sweet_shop_cooking_job ADD COLUMN profile_id BIGINT UNSIGNED NULL AFTER request_id;
UPDATE sweet_shop_cooking_job j JOIN sweet_shop_profile p ON p.account_id = j.account_id SET j.profile_id = p.profile_id;
ALTER TABLE sweet_shop_cooking_job DROP INDEX idx_sweet_cooking_account, DROP COLUMN account_id, MODIFY profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_cooking_profile (profile_id, status);

ALTER TABLE sweet_shop_dessert ADD COLUMN owner_profile_id BIGINT UNSIGNED NULL AFTER id, ADD COLUMN creator_profile_id BIGINT UNSIGNED NULL AFTER owner_profile_id;
UPDATE sweet_shop_dessert d JOIN sweet_shop_profile p ON p.account_id = d.owner_id SET d.owner_profile_id = p.profile_id;
UPDATE sweet_shop_dessert d JOIN sweet_shop_profile p ON p.account_id = d.creator_id SET d.creator_profile_id = p.profile_id;
ALTER TABLE sweet_shop_dessert DROP INDEX idx_sweet_dessert_owner, DROP INDEX idx_sweet_dessert_creator, DROP COLUMN owner_id, DROP COLUMN creator_id, MODIFY owner_profile_id BIGINT UNSIGNED NOT NULL, MODIFY creator_profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_dessert_owner (owner_profile_id), ADD KEY idx_sweet_dessert_creator (creator_profile_id);

ALTER TABLE sweet_shop_listing ADD COLUMN seller_profile_id BIGINT UNSIGNED NULL AFTER request_id;
UPDATE sweet_shop_listing l JOIN sweet_shop_profile p ON p.account_id = l.seller_id SET l.seller_profile_id = p.profile_id;
ALTER TABLE sweet_shop_listing DROP INDEX idx_sweet_listing_seller, DROP COLUMN seller_id, MODIFY seller_profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_listing_seller (seller_profile_id, status);

ALTER TABLE sweet_shop_trade ADD COLUMN seller_profile_id BIGINT UNSIGNED NULL AFTER listing_id, ADD COLUMN buyer_profile_id BIGINT UNSIGNED NULL AFTER seller_profile_id;
UPDATE sweet_shop_trade t JOIN sweet_shop_profile p ON p.account_id = t.seller_id SET t.seller_profile_id = p.profile_id;
UPDATE sweet_shop_trade t JOIN sweet_shop_profile p ON p.account_id = t.buyer_id SET t.buyer_profile_id = p.profile_id;
ALTER TABLE sweet_shop_trade DROP INDEX idx_sweet_trade_seller, DROP INDEX idx_sweet_trade_buyer, DROP COLUMN seller_id, DROP COLUMN buyer_id, MODIFY seller_profile_id BIGINT UNSIGNED NOT NULL, MODIFY buyer_profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_trade_seller (seller_profile_id, created_at), ADD KEY idx_sweet_trade_buyer (buyer_profile_id, created_at);

ALTER TABLE sweet_shop_guestbook ADD COLUMN cafe_owner_profile_id BIGINT UNSIGNED NULL AFTER id, ADD COLUMN visitor_profile_id BIGINT UNSIGNED NULL AFTER cafe_owner_profile_id;
UPDATE sweet_shop_guestbook g JOIN sweet_shop_profile p ON p.account_id = g.cafe_owner_id SET g.cafe_owner_profile_id = p.profile_id;
UPDATE sweet_shop_guestbook g JOIN sweet_shop_profile p ON p.account_id = g.visitor_id SET g.visitor_profile_id = p.profile_id;
ALTER TABLE sweet_shop_guestbook DROP INDEX idx_sweet_guestbook_cafe, DROP COLUMN cafe_owner_id, DROP COLUMN visitor_id, MODIFY cafe_owner_profile_id BIGINT UNSIGNED NOT NULL, MODIFY visitor_profile_id BIGINT UNSIGNED NOT NULL, ADD KEY idx_sweet_guestbook_cafe (cafe_owner_profile_id, created_at);
