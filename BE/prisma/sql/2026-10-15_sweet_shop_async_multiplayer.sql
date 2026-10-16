-- 달콤상점 비동기 멀티플레이 최종 스키마.
-- 달콤상점 테이블이 없는 신규 DB에서는 이 파일 하나만 실행한다.

CREATE TABLE IF NOT EXISTS sweet_shop_profile (
  profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '달콤상점 프로필 고유 ID',
  account_id BIGINT UNSIGNED NULL COMMENT '가입 계정 ID, 비회원은 NULL',
  guest_id VARCHAR(64) NULL COMMENT '비회원 브라우저 고유 ID, 가입자는 NULL 가능',
  cafe_name VARCHAR(30) NOT NULL DEFAULT '나의 달콤상점' COMMENT '사용자 카페 이름',
  level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '카페 레벨',
  experience INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '카페 누적 경험치',
  gold INT UNSIGNED NOT NULL DEFAULT 100 COMMENT '보유 골드',
  first_cooking_tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE COMMENT '첫 조리 튜토리얼 완료 여부',
  buff_source_dessert_name VARCHAR(60) NULL COMMENT '현재 조리 버프를 제공한 디저트 이름',
  buff_quality_bonus TINYINT UNSIGNED NULL COMMENT '현재 조리 품질 상승 등급',
  buff_eligible_recipe_level INT UNSIGNED NULL COMMENT '조리 버프 적용 가능 최대 레시피 레벨',
  buff_ends_at TIMESTAMP NULL COMMENT '현재 조리 버프 종료 시각',
  representative_dessert_id BIGINT UNSIGNED NULL COMMENT '카페 대표 디저트 ID',
  last_played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '마지막 카페 접속 시각',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '프로필 생성 시각',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 수정 시각',
  PRIMARY KEY (profile_id),
  UNIQUE KEY uq_sweet_profile_account (account_id),
  UNIQUE KEY uq_sweet_profile_guest (guest_id)
) COMMENT='가입자와 비회원의 달콤상점 프로필 및 진행 상태';

CREATE TABLE IF NOT EXISTS sweet_shop_storage (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '달콤상점 프로필 ID',
  ingredient_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12 COMMENT '재료 보관함 슬롯 한도',
  dessert_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12 COMMENT '디저트 상자 슬롯 한도',
  PRIMARY KEY (profile_id)
) COMMENT='프로필별 재료 및 디저트 보관 한도';

CREATE TABLE IF NOT EXISTS sweet_shop_ingredient (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '재료 소유 프로필 ID',
  ingredient_id VARCHAR(40) NOT NULL COMMENT '재료 종류 식별자',
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '재료 품질 등급',
  quantity INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '보유 수량',
  PRIMARY KEY (profile_id, ingredient_id, quality)
) COMMENT='프로필별 보유 재료와 품질별 수량';

CREATE TABLE IF NOT EXISTS sweet_shop_delivery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '배송 고유 ID',
  request_id VARCHAR(64) NOT NULL COMMENT '중복 주문 방지 요청 ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '주문 프로필 ID',
  ingredient_id VARCHAR(40) NOT NULL COMMENT '주문 재료 식별자',
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '주문 재료 품질 등급',
  quantity INT UNSIGNED NOT NULL COMMENT '주문 수량',
  total_price INT UNSIGNED NOT NULL COMMENT '주문 총 결제 골드',
  status ENUM('ordered','arrived','waiting_for_space','received') NOT NULL DEFAULT 'ordered' COMMENT '배송 처리 상태',
  ordered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '주문 시각',
  arrives_at TIMESTAMP NOT NULL COMMENT '배송 도착 예정 시각',
  received_at TIMESTAMP NULL COMMENT '재료 수령 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sweet_delivery_request (request_id),
  KEY idx_sweet_delivery_profile (profile_id, status, arrives_at)
) COMMENT='재료 주문, 배송 도착 및 수령 상태';

CREATE TABLE IF NOT EXISTS sweet_shop_recipe_progress (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '달콤상점 프로필 ID',
  recipe_id VARCHAR(40) NOT NULL COMMENT '레시피 식별자',
  mastery_level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '레시피 숙련 레벨',
  mastery_experience INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '레시피 숙련 경험치',
  total_cooked INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '해당 레시피 누적 생산 수량',
  highest_quality TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '제작한 최고 품질 등급',
  unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '레시피 해금 시각',
  PRIMARY KEY (profile_id, recipe_id)
) COMMENT='프로필별 레시피 해금과 조리 숙련도';

CREATE TABLE IF NOT EXISTS sweet_shop_cooking_job (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '조리 작업 고유 ID',
  request_id VARCHAR(64) NOT NULL COMMENT '중복 조리 요청 방지 ID',
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '조리 프로필 ID',
  recipe_id VARCHAR(40) NOT NULL COMMENT '생산할 레시피 식별자',
  quantity INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '생산 수량',
  status ENUM('queued','cooking','completed','waiting_for_space','received') NOT NULL DEFAULT 'cooking' COMMENT '생산 대기열 및 수령 상태',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '실제 조리 시작 시각',
  completes_at TIMESTAMP NOT NULL COMMENT '조리 완료 예정 시각',
  received_at TIMESTAMP NULL COMMENT '완성 디저트 수령 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sweet_cooking_request (request_id),
  KEY idx_sweet_cooking_profile (profile_id, status)
) COMMENT='조리 생산 대기열과 완료 및 수령 상태';

CREATE TABLE IF NOT EXISTS sweet_shop_dessert (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '디저트 고유 ID',
  owner_profile_id BIGINT UNSIGNED NOT NULL COMMENT '현재 디저트 소유 프로필 ID',
  creator_profile_id BIGINT UNSIGNED NOT NULL COMMENT '디저트를 제작한 프로필 ID',
  recipe_id VARCHAR(40) NOT NULL COMMENT '디저트 레시피 식별자',
  dessert_level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '디저트 레벨',
  quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '완성 품질 등급',
  quantity INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '보유 수량',
  buff_type VARCHAR(40) NULL COMMENT '섭취 시 제공하는 버프 종류',
  buff_value INT NOT NULL DEFAULT 0 COMMENT '섭취 버프 효과 수치',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '디저트 생성 시각',
  PRIMARY KEY (id),
  KEY idx_sweet_dessert_owner (owner_profile_id),
  KEY idx_sweet_dessert_creator (creator_profile_id)
) COMMENT='제작하거나 구매하여 보유한 디저트';

CREATE TABLE IF NOT EXISTS sweet_shop_listing (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '판매 상품 고유 ID',
  request_id VARCHAR(64) NOT NULL COMMENT '중복 진열 요청 방지 ID',
  seller_profile_id BIGINT UNSIGNED NOT NULL COMMENT '판매자 프로필 ID',
  dessert_id BIGINT UNSIGNED NOT NULL COMMENT '진열한 원본 디저트 ID',
  quantity INT UNSIGNED NOT NULL COMMENT '남은 판매 수량',
  unit_price INT UNSIGNED NOT NULL COMMENT '개당 판매 가격',
  status ENUM('active','sold_out','removed') NOT NULL DEFAULT 'active' COMMENT '판매 활성, 품절 또는 회수 상태',
  listed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '판매대 진열 시각',
  sold_out_at TIMESTAMP NULL COMMENT '품절 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sweet_listing_request (request_id),
  KEY idx_sweet_listing_seller (seller_profile_id, status),
  KEY idx_sweet_listing_browse (status, listed_at)
) COMMENT='카페 판매대에 공개된 디저트 상품';

CREATE TABLE IF NOT EXISTS sweet_shop_trade (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '거래 고유 ID',
  request_id VARCHAR(64) NOT NULL COMMENT '중복 구매 요청 방지 ID',
  listing_id BIGINT UNSIGNED NOT NULL COMMENT '구매한 판매 상품 ID',
  seller_profile_id BIGINT UNSIGNED NOT NULL COMMENT '판매자 프로필 ID',
  buyer_profile_id BIGINT UNSIGNED NOT NULL COMMENT '구매자 프로필 ID',
  dessert_id BIGINT UNSIGNED NOT NULL COMMENT '구매자에게 생성된 디저트 ID',
  quantity INT UNSIGNED NOT NULL COMMENT '거래 수량',
  unit_price INT UNSIGNED NOT NULL COMMENT '거래 당시 개당 가격',
  total_price INT UNSIGNED NOT NULL COMMENT '거래 총 결제 골드',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '거래 성립 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sweet_trade_request (request_id),
  KEY idx_sweet_trade_seller (seller_profile_id, created_at),
  KEY idx_sweet_trade_buyer (buyer_profile_id, created_at)
) COMMENT='사용자 간 디저트 구매 및 판매 거래 기록';

CREATE TABLE IF NOT EXISTS sweet_shop_guestbook (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '방명록 고유 ID',
  cafe_owner_profile_id BIGINT UNSIGNED NOT NULL COMMENT '방문 대상 카페 프로필 ID',
  visitor_profile_id BIGINT UNSIGNED NOT NULL COMMENT '방명록 작성자 프로필 ID',
  message_code VARCHAR(40) NOT NULL COMMENT '선택형 방명록 메시지 코드',
  sticker_code VARCHAR(40) NULL COMMENT '방문자가 첨부한 스티커 코드',
  reply_sticker_code VARCHAR(40) NULL COMMENT '카페 주인의 답장 스티커 코드',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '방명록 작성 시각',
  PRIMARY KEY (id),
  KEY idx_sweet_guestbook_cafe (cafe_owner_profile_id, created_at)
) COMMENT='방문자가 카페에 남긴 방명록과 스티커';

CREATE TABLE IF NOT EXISTS sweet_shop_advertisement (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '광고 중인 달콤상점 프로필 ID',
  ends_at TIMESTAMP NOT NULL COMMENT '알림노트 광고 종료 시각',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '광고 최종 변경 시각',
  PRIMARY KEY (profile_id),
  KEY idx_sweet_advertisement_ends (ends_at)
) COMMENT='카페 거리 알림노트 광고 활성 상태';

CREATE TABLE IF NOT EXISTS sweet_shop_friend (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '친구를 등록한 프로필 ID', friend_profile_id BIGINT UNSIGNED NOT NULL COMMENT '등록된 친구 프로필 ID', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '친구 등록 시각',
  PRIMARY KEY (profile_id, friend_profile_id), KEY idx_sweet_friend_target (friend_profile_id)
) COMMENT='달콤상점 프로필별 친구 목록';
CREATE TABLE IF NOT EXISTS sweet_shop_block (
  profile_id BIGINT UNSIGNED NOT NULL COMMENT '차단한 프로필 ID', blocked_profile_id BIGINT UNSIGNED NOT NULL COMMENT '차단된 프로필 ID', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '차단 시각',
  PRIMARY KEY (profile_id, blocked_profile_id), KEY idx_sweet_block_target (blocked_profile_id)
) COMMENT='달콤상점 사용자 차단 관계';
CREATE TABLE IF NOT EXISTS sweet_shop_report (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '신고 고유 ID', reporter_profile_id BIGINT UNSIGNED NOT NULL COMMENT '신고자 프로필 ID', target_profile_id BIGINT UNSIGNED NOT NULL COMMENT '신고 대상 프로필 ID', reason_code VARCHAR(30) NOT NULL COMMENT '신고 사유 코드', detail VARCHAR(200) NULL COMMENT '신고 상세 내용', status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '처리 상태', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '신고 시각',
  PRIMARY KEY (id), KEY idx_sweet_report_target (target_profile_id, status), KEY idx_sweet_report_reporter (reporter_profile_id, created_at)
) COMMENT='달콤상점 사용자 신고 접수 기록';
CREATE TABLE IF NOT EXISTS sweet_shop_chat_message (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '채팅 메시지 고유 ID', cafe_profile_id BIGINT UNSIGNED NOT NULL COMMENT '채팅이 발생한 카페 프로필 ID', sender_profile_id BIGINT UNSIGNED NOT NULL COMMENT '발신자 프로필 ID', sender_name VARCHAR(40) NOT NULL COMMENT '발신 당시 표시 이름', message VARCHAR(80) NOT NULL COMMENT '채팅 메시지', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '발신 시각',
  PRIMARY KEY (id), KEY idx_sweet_chat_cafe (cafe_profile_id, created_at)
) COMMENT='달콤상점 카페별 최근 채팅 기록';
