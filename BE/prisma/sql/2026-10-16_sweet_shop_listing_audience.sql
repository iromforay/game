-- 판매대를 친구 전용과 전체 공개 구역으로 구분한다.
-- 기존 진열 상품은 이전 동작을 유지하도록 모두에게 판매로 설정한다.

ALTER TABLE sweet_shop_listing
  ADD COLUMN audience ENUM('friends', 'everyone') NOT NULL DEFAULT 'everyone'
    COMMENT 'friends: 플레이어에게만 판매, everyone: 플레이어와 NPC 모두에게 판매'
    AFTER unit_price;
