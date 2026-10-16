-- 접속 여부와 무관한 서버 NPC 자동 구매를 위한 판매 예약 및 거래 알림 정보.

ALTER TABLE sweet_shop_listing
  ADD COLUMN next_npc_purchase_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    COMMENT '모두에게 팔기 상품의 다음 NPC 구매 시도 시각' AFTER audience,
  ADD KEY idx_sweet_listing_npc_due (status, audience, next_npc_purchase_at);

ALTER TABLE sweet_shop_trade
  MODIFY COLUMN buyer_profile_id BIGINT UNSIGNED NULL
    COMMENT '플레이어 구매자 프로필 ID; NPC 구매는 NULL',
  MODIFY COLUMN dessert_id BIGINT UNSIGNED NOT NULL
    COMMENT '플레이어 구매 결과 또는 NPC가 구매한 원본 디저트 ID',
  ADD COLUMN buyer_kind ENUM('player','npc') NOT NULL DEFAULT 'player'
    COMMENT '구매자 유형' AFTER buyer_profile_id,
  ADD COLUMN buyer_name VARCHAR(40) NULL
    COMMENT '거래 당시 표시할 구매자 이름' AFTER buyer_kind,
  ADD COLUMN notification_read_at TIMESTAMP NULL
    COMMENT '판매자가 판매 알림을 확인한 시각' AFTER total_price;

UPDATE sweet_shop_listing
SET next_npc_purchase_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 60 SECOND)
WHERE status = 'active' AND audience = 'everyone';
