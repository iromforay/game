-- 첫 조리 튜토리얼 완료 여부는 제작 횟수와 분리해 계정별로 저장한다.
SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sweet_shop_profile'
    AND COLUMN_NAME = 'first_cooking_tutorial_completed'
);

SET @migration_sql = IF(
  @column_exists = 0,
  'ALTER TABLE sweet_shop_profile ADD COLUMN first_cooking_tutorial_completed BOOLEAN NOT NULL DEFAULT FALSE AFTER gold',
  'SELECT 1'
);

PREPARE sweet_shop_tutorial_migration FROM @migration_sql;
EXECUTE sweet_shop_tutorial_migration;
DEALLOCATE PREPARE sweet_shop_tutorial_migration;
