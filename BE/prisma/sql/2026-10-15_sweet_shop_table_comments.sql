-- 최종 profile_id 구조가 적용된 DB의 테이블과 전체 컬럼에 한글 코멘트를 반영한다.
-- 신규 DB는 CREATE 파일에 코멘트가 포함되어 있으므로 이 파일을 실행할 필요가 없다.

ALTER TABLE sweet_shop_profile
  COMMENT = '가입자와 비회원의 달콤상점 프로필 및 진행 상태',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '달콤상점 프로필 고유 ID',
  MODIFY COLUMN account_id BIGINT UNSIGNED NULL COMMENT '가입 계정 ID, 비회원은 NULL',
  MODIFY COLUMN guest_id VARCHAR(64) NULL COMMENT '비회원 브라우저 고유 ID, 가입자는 NULL 가능',
  MODIFY COLUMN cafe_name VARCHAR(30) NOT NULL DEFAULT '나의 달콤상점' COMMENT '사용자 카페 이름',
  MODIFY COLUMN level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '카페 레벨',
  MODIFY COLUMN experience INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '카페 누적 경험치',
  MODIFY COLUMN gold INT UNSIGNED NOT NULL DEFAULT 100 COMMENT '보유 골드',
  MODIFY COLUMN first_cooking_tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE COMMENT '첫 조리 튜토리얼 완료 여부',
  MODIFY COLUMN buff_source_dessert_name VARCHAR(60) NULL COMMENT '현재 조리 버프를 제공한 디저트 이름',
  MODIFY COLUMN buff_quality_bonus TINYINT UNSIGNED NULL COMMENT '현재 조리 품질 상승 등급',
  MODIFY COLUMN buff_eligible_recipe_level INT UNSIGNED NULL COMMENT '조리 버프 적용 가능 최대 레시피 레벨',
  MODIFY COLUMN buff_ends_at TIMESTAMP NULL COMMENT '현재 조리 버프 종료 시각',
  MODIFY COLUMN representative_dessert_id BIGINT UNSIGNED NULL COMMENT '카페 대표 디저트 ID',
  MODIFY COLUMN last_played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '마지막 카페 접속 시각',
  MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '프로필 생성 시각',
  MODIFY COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '프로필 최종 수정 시각';

ALTER TABLE sweet_shop_storage
  COMMENT = '프로필별 재료 및 디저트 보관 한도',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL COMMENT '달콤상점 프로필 ID',
  MODIFY COLUMN ingredient_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12 COMMENT '재료 보관함 슬롯 한도',
  MODIFY COLUMN dessert_slot_limit SMALLINT UNSIGNED NOT NULL DEFAULT 12 COMMENT '디저트 상자 슬롯 한도';

ALTER TABLE sweet_shop_ingredient
  COMMENT = '프로필별 보유 재료와 품질별 수량',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL COMMENT '재료 소유 프로필 ID',
  MODIFY COLUMN ingredient_id VARCHAR(40) NOT NULL COMMENT '재료 종류 식별자',
  MODIFY COLUMN quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '재료 품질 등급',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '보유 수량';

ALTER TABLE sweet_shop_delivery
  COMMENT = '달콤상점 재료 주문, 배송 도착 및 수령 상태',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '배송 고유 ID',
  MODIFY COLUMN request_id VARCHAR(64) NOT NULL COMMENT '중복 주문 방지 요청 ID',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL COMMENT '주문 프로필 ID',
  MODIFY COLUMN ingredient_id VARCHAR(40) NOT NULL COMMENT '주문 재료 식별자',
  MODIFY COLUMN quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '주문 재료 품질 등급',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL COMMENT '주문 수량',
  MODIFY COLUMN total_price INT UNSIGNED NOT NULL COMMENT '주문 총 결제 골드',
  MODIFY COLUMN status ENUM('ordered','arrived','waiting_for_space','received') NOT NULL DEFAULT 'ordered' COMMENT '배송 처리 상태',
  MODIFY COLUMN ordered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '주문 시각',
  MODIFY COLUMN arrives_at TIMESTAMP NOT NULL COMMENT '배송 도착 예정 시각',
  MODIFY COLUMN received_at TIMESTAMP NULL COMMENT '재료 수령 시각';

ALTER TABLE sweet_shop_recipe_progress
  COMMENT = '프로필별 레시피 해금과 조리 숙련도',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL COMMENT '달콤상점 프로필 ID',
  MODIFY COLUMN recipe_id VARCHAR(40) NOT NULL COMMENT '레시피 식별자',
  MODIFY COLUMN mastery_level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '레시피 숙련 레벨',
  MODIFY COLUMN mastery_experience INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '레시피 숙련 경험치',
  MODIFY COLUMN total_cooked INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '해당 레시피 누적 생산 수량',
  MODIFY COLUMN highest_quality TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '제작한 최고 품질 등급',
  MODIFY COLUMN unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '레시피 해금 시각';

ALTER TABLE sweet_shop_cooking_job
  COMMENT = '달콤상점 조리 생산 대기열과 완료 및 수령 상태',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '조리 작업 고유 ID',
  MODIFY COLUMN request_id VARCHAR(64) NOT NULL COMMENT '중복 조리 요청 방지 ID',
  MODIFY COLUMN profile_id BIGINT UNSIGNED NOT NULL COMMENT '조리 프로필 ID',
  MODIFY COLUMN recipe_id VARCHAR(40) NOT NULL COMMENT '생산할 레시피 식별자',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '생산 수량',
  MODIFY COLUMN status ENUM('queued','cooking','completed','waiting_for_space','received') NOT NULL DEFAULT 'cooking' COMMENT '생산 대기열 및 수령 상태',
  MODIFY COLUMN started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '실제 조리 시작 시각',
  MODIFY COLUMN completes_at TIMESTAMP NOT NULL COMMENT '조리 완료 예정 시각',
  MODIFY COLUMN received_at TIMESTAMP NULL COMMENT '완성 디저트 수령 시각';

ALTER TABLE sweet_shop_dessert
  COMMENT = '달콤상점에서 제작하거나 구매하여 보유한 디저트',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '디저트 고유 ID',
  MODIFY COLUMN owner_profile_id BIGINT UNSIGNED NOT NULL COMMENT '현재 디저트 소유 프로필 ID',
  MODIFY COLUMN creator_profile_id BIGINT UNSIGNED NOT NULL COMMENT '디저트를 제작한 프로필 ID',
  MODIFY COLUMN recipe_id VARCHAR(40) NOT NULL COMMENT '디저트 레시피 식별자',
  MODIFY COLUMN dessert_level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '디저트 레벨',
  MODIFY COLUMN quality TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '완성 품질 등급',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '보유 수량',
  MODIFY COLUMN buff_type VARCHAR(40) NULL COMMENT '섭취 시 제공하는 버프 종류',
  MODIFY COLUMN buff_value INT NOT NULL DEFAULT 0 COMMENT '섭취 버프 효과 수치',
  MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '디저트 생성 시각';

ALTER TABLE sweet_shop_listing
  COMMENT = '달콤상점 카페 판매대에 공개된 디저트 상품',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '판매 상품 고유 ID',
  MODIFY COLUMN request_id VARCHAR(64) NOT NULL COMMENT '중복 진열 요청 방지 ID',
  MODIFY COLUMN seller_profile_id BIGINT UNSIGNED NOT NULL COMMENT '판매자 프로필 ID',
  MODIFY COLUMN dessert_id BIGINT UNSIGNED NOT NULL COMMENT '진열한 원본 디저트 ID',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL COMMENT '남은 판매 수량',
  MODIFY COLUMN unit_price INT UNSIGNED NOT NULL COMMENT '개당 판매 가격',
  MODIFY COLUMN status ENUM('active','sold_out','removed') NOT NULL DEFAULT 'active' COMMENT '판매 활성, 품절 또는 회수 상태',
  MODIFY COLUMN listed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '판매대 진열 시각',
  MODIFY COLUMN sold_out_at TIMESTAMP NULL COMMENT '품절 시각';

ALTER TABLE sweet_shop_trade
  COMMENT = '달콤상점 사용자 간 디저트 구매 및 판매 거래 기록',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '거래 고유 ID',
  MODIFY COLUMN request_id VARCHAR(64) NOT NULL COMMENT '중복 구매 요청 방지 ID',
  MODIFY COLUMN listing_id BIGINT UNSIGNED NOT NULL COMMENT '구매한 판매 상품 ID',
  MODIFY COLUMN seller_profile_id BIGINT UNSIGNED NOT NULL COMMENT '판매자 프로필 ID',
  MODIFY COLUMN buyer_profile_id BIGINT UNSIGNED NOT NULL COMMENT '구매자 프로필 ID',
  MODIFY COLUMN dessert_id BIGINT UNSIGNED NOT NULL COMMENT '구매자에게 생성된 디저트 ID',
  MODIFY COLUMN quantity INT UNSIGNED NOT NULL COMMENT '거래 수량',
  MODIFY COLUMN unit_price INT UNSIGNED NOT NULL COMMENT '거래 당시 개당 가격',
  MODIFY COLUMN total_price INT UNSIGNED NOT NULL COMMENT '거래 총 결제 골드',
  MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '거래 성립 시각';

ALTER TABLE sweet_shop_guestbook
  COMMENT = '달콤상점 방문자가 카페에 남긴 방명록과 스티커',
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '방명록 고유 ID',
  MODIFY COLUMN cafe_owner_profile_id BIGINT UNSIGNED NOT NULL COMMENT '방문 대상 카페 프로필 ID',
  MODIFY COLUMN visitor_profile_id BIGINT UNSIGNED NOT NULL COMMENT '방명록 작성자 프로필 ID',
  MODIFY COLUMN message_code VARCHAR(40) NOT NULL COMMENT '선택형 방명록 메시지 코드',
  MODIFY COLUMN sticker_code VARCHAR(40) NULL COMMENT '방문자가 첨부한 스티커 코드',
  MODIFY COLUMN reply_sticker_code VARCHAR(40) NULL COMMENT '카페 주인의 답장 스티커 코드',
  MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '방명록 작성 시각';
