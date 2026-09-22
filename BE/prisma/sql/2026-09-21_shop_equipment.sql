-- 터비 구하기 2단계: NPC 상점 + 아이템 장착. 원격 DB에 직접 적용(prisma db push 미사용, FK 없이 인덱스만 — 기존 정책).
-- 여러 번 실행해도 안전하도록 IF NOT EXISTS / ON DUPLICATE KEY 사용. 가격·보너스 수치는 전부 잠정값(밸런싱 전).

ALTER TABLE item_definition
  MODIFY COLUMN category ENUM('defense','consumable','upgrade','equipment') NOT NULL,
  ADD COLUMN IF NOT EXISTS equip_slot VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS atk_bonus INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS def_bonus INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ap_bonus INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hp_bonus INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS shop_product (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_type ENUM('turby','item') NOT NULL,
  ref_code VARCHAR(30) NOT NULL,
  price_tare INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_shop_product (product_type, ref_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shop_purchase (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  price_tare INT UNSIGNED NOT NULL,
  turby_instance_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shop_purchase_request (request_id),
  KEY idx_shop_purchase_player (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS turby_equipment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  turby_instance_id BIGINT UNSIGNED NOT NULL,
  item_definition_id INT UNSIGNED NOT NULL,
  slot_key VARCHAR(20) NOT NULL,
  UNIQUE KEY uq_turby_slot (turby_instance_id, slot_key),
  KEY idx_turby_equipment_item (item_definition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO item_definition (code, name, category, description, equip_slot, atk_bonus, def_bonus, ap_bonus, hp_bonus) VALUES
  ('knit_needle', '뜨개바늘', 'equipment', '공격력이 오르는 작은 바늘', 'weapon', 2, 0, 0, 0),
  ('wool_glove', '털장갑', 'equipment', '방어력이 오르는 포근한 장갑', 'armor', 0, 2, 0, 0),
  ('yarn_scarf', '실뭉치 목도리', 'equipment', '생명력이 오르는 두툼한 목도리', 'accessory', 0, 0, 0, 8),
  ('lucky_button', '행운 단추', 'equipment', '행동력이 오르는 반짝이는 단추', 'accessory', 0, 0, 1, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), description = VALUES(description),
  equip_slot = VALUES(equip_slot), atk_bonus = VALUES(atk_bonus), def_bonus = VALUES(def_bonus),
  ap_bonus = VALUES(ap_bonus), hp_bonus = VALUES(hp_bonus);

INSERT INTO shop_product (product_type, ref_code, price_tare, sort_order) VALUES
  ('turby', 'nubi', 40, 1),
  ('turby', 'bopuli', 60, 2),
  ('item', 'knit_needle', 30, 3),
  ('item', 'wool_glove', 30, 4),
  ('item', 'yarn_scarf', 40, 5),
  ('item', 'lucky_button', 60, 6)
ON DUPLICATE KEY UPDATE price_tare = VALUES(price_tare), sort_order = VALUES(sort_order);
