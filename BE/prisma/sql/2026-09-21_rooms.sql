-- 터비 구하기 4-A: 협동 방·위치 동기화용 서버 데이터. 원격 DB에 직접 적용(FK 없음), 여러 번 실행해도 안전.
-- 수치는 전부 잠정값(밸런싱 전)이며 코드에 박지 않고 game_setting에서 읽는다.

CREATE TABLE IF NOT EXISTS story_chapter (
  chapter_order INT NOT NULL PRIMARY KEY,
  stage_code VARCHAR(30) NOT NULL,
  clear_character_code VARCHAR(30) NOT NULL,
  title VARCHAR(50) NOT NULL,
  map_width INT UNSIGNED NOT NULL,
  map_height INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_story_chapter_stage (stage_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS game_setting (
  setting_key VARCHAR(60) NOT NULL PRIMARY KEY,
  value_json TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO story_chapter (chapter_order, stage_code, clear_character_code, title, map_width, map_height) VALUES
  (1, 'forest', 'nubi', '1장 — 숲', 3200, 2400),
  (2, 'lake', 'muldeuli', '2장 — 호수', 4000, 3000),
  (3, 'underground', 'pokshini', '3장 — 지하', 4800, 3600),
  (4, 'ice', 'ganeuri', '4장 — 얼음', 5600, 4200),
  (5, 'desert', 'geumbiti', '5장 — 사막', 6400, 4800)
ON DUPLICATE KEY UPDATE stage_code = VALUES(stage_code), clear_character_code = VALUES(clear_character_code),
  title = VALUES(title), map_width = VALUES(map_width), map_height = VALUES(map_height);

INSERT INTO game_setting (setting_key, value_json) VALUES
  ('move.maxSpeedPxPerSec', '390'),
  ('move.minIntervalMs', '80'),
  ('move.slackPx', '24'),
  ('room.reconnectGraceMs', '45000')
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);
