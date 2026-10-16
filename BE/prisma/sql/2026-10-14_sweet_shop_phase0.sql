-- 달콤상점 0단계: account 기반 카페, 인벤토리, 조리, 판매, 거래 계약
CREATE TABLE IF NOT EXISTS sweet_shop_profile (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  cafe_name VARCHAR(30) NOT NULL DEFAULT '나의 달콤상점',
  level INT UNSIGNED NOT NULL DEFAULT 1,
  experience INT UNSIGNED NOT NULL DEFAULT 0,
  gold INT UNSIGNED NOT NULL DEFAULT 100,
  first_cooking_tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE,
  representative_dessert_id BIGINT UNSIGNED NULL,
  last_played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sweet_shop_storage (
  account_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  ingredient_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12,
  dessert_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12
);

CREATE TABLE IF NOT EXISTS sweet_shop_ingredient (
  account_id BIGINT UNSIGNED NOT NULL,
  ingredient_id VARCHAR(40) NOT NULL,
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  quantity INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, ingredient_id, quality)
);

CREATE TABLE IF NOT EXISTS sweet_shop_delivery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  ingredient_id VARCHAR(40) NOT NULL,
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  quantity INT UNSIGNED NOT NULL,
  total_price INT UNSIGNED NOT NULL,
  status ENUM('ordered','arrived','waiting_for_space','received') NOT NULL DEFAULT 'ordered',
  ordered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  arrives_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP NULL,
  UNIQUE KEY uq_sweet_delivery_request (request_id),
  KEY idx_sweet_delivery_account (account_id, status, arrives_at)
);

CREATE TABLE IF NOT EXISTS sweet_shop_recipe_progress (
  account_id BIGINT UNSIGNED NOT NULL,
  recipe_id VARCHAR(40) NOT NULL,
  mastery_level INT UNSIGNED NOT NULL DEFAULT 1,
  mastery_experience INT UNSIGNED NOT NULL DEFAULT 0,
  total_cooked INT UNSIGNED NOT NULL DEFAULT 0,
  highest_quality TINYINT UNSIGNED NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS sweet_shop_cooking_job (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  recipe_id VARCHAR(40) NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('cooking','waiting_for_space','received') NOT NULL DEFAULT 'cooking',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completes_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP NULL,
  UNIQUE KEY uq_sweet_cooking_request (request_id),
  KEY idx_sweet_cooking_account (account_id, status)
);

CREATE TABLE IF NOT EXISTS sweet_shop_dessert (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  creator_id BIGINT UNSIGNED NOT NULL,
  recipe_id VARCHAR(40) NOT NULL,
  dessert_level INT UNSIGNED NOT NULL DEFAULT 1,
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  buff_type VARCHAR(40) NULL,
  buff_value INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sweet_dessert_owner (owner_id),
  KEY idx_sweet_dessert_creator (creator_id)
);

CREATE TABLE IF NOT EXISTS sweet_shop_listing (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  seller_id BIGINT UNSIGNED NOT NULL,
  dessert_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL,
  status ENUM('active','sold_out','removed') NOT NULL DEFAULT 'active',
  listed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sold_out_at TIMESTAMP NULL,
  UNIQUE KEY uq_sweet_listing_request (request_id),
  KEY idx_sweet_listing_seller (seller_id, status),
  KEY idx_sweet_listing_browse (status, listed_at)
);

CREATE TABLE IF NOT EXISTS sweet_shop_trade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  listing_id BIGINT UNSIGNED NOT NULL,
  seller_id BIGINT UNSIGNED NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  dessert_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL,
  total_price INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sweet_trade_request (request_id),
  KEY idx_sweet_trade_seller (seller_id, created_at),
  KEY idx_sweet_trade_buyer (buyer_id, created_at)
);

CREATE TABLE IF NOT EXISTS sweet_shop_guestbook (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cafe_owner_id BIGINT UNSIGNED NOT NULL,
  visitor_id BIGINT UNSIGNED NOT NULL,
  message_code VARCHAR(40) NOT NULL,
  sticker_code VARCHAR(40) NULL,
  reply_sticker_code VARCHAR(40) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sweet_guestbook_cafe (cafe_owner_id, created_at)
);
