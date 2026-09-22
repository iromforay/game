-- 터비 구하기 4-B: 서버 전투 엔진용 데이터. 원격 DB에 직접 적용(FK 없음), 여러 번 실행해도 안전.
-- 수치는 전부 잠정값(밸런싱 전)이며 코드에 박지 않고 game_setting에서 읽는다.

-- 협동 전투 1건(결과 기록). battle_key는 서버가 만든 전투 식별자(재시도·중복 지급 방지의 기준).
CREATE TABLE IF NOT EXISTS coop_battle (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  battle_key VARCHAR(40) NOT NULL,
  room_code VARCHAR(10) NOT NULL,
  stage_code VARCHAR(30) NOT NULL,
  spawn_index INT NOT NULL,
  wild_character_code VARCHAR(30) NOT NULL,
  participant_count INT NOT NULL,
  result ENUM('win','lose','draw','cancelled') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coop_battle_key (battle_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 참가자별 결과·포획 지급 1행. (battle_id, player_id) 유니크가 중복 지급을 막는다.
ALTER TABLE battle_result MODIFY COLUMN result ENUM('win','lose','draw','cancelled') NOT NULL;
ALTER TABLE battle_result ADD COLUMN IF NOT EXISTS battle_id BIGINT UNSIGNED NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_battle_result_battle_player ON battle_result (battle_id, player_id);

-- 지역별 야생 터비 스폰(프런트 config/stages/*.ts와 같은 값). 서버가 조우 요청의 spawnIndex를 검증하는 기준이자 4-C 야생 상태의 원본.
CREATE TABLE IF NOT EXISTS stage_wild_spawn (
  stage_code VARCHAR(30) NOT NULL,
  spawn_index INT NOT NULL,
  character_code VARCHAR(30) NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  PRIMARY KEY (stage_code, spawn_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO stage_wild_spawn (stage_code, spawn_index, character_code, x, y) VALUES
  ('desert', 0, 'geumbiti', 900, 800),
  ('desert', 1, 'ganeuri', 2000, 1500),
  ('desert', 2, 'geumbiti', 3400, 700),
  ('desert', 3, 'pokshini', 4800, 1600),
  ('desert', 4, 'geumbiti', 1400, 3000),
  ('desert', 5, 'ganeuri', 3000, 3700),
  ('desert', 6, 'geumbiti', 5000, 3200),
  ('desert', 7, 'pokshini', 5600, 4300),
  ('forest', 0, 'nubi', 500, 400),
  ('forest', 1, 'bopuli', 900, 700),
  ('forest', 2, 'nubi', 1600, 300),
  ('forest', 3, 'bopuli', 2100, 900),
  ('forest', 4, 'nubi', 700, 1500),
  ('forest', 5, 'bopuli', 1400, 1800),
  ('forest', 6, 'nubi', 2500, 1600),
  ('forest', 7, 'bopuli', 2800, 2100),
  ('ice', 0, 'ganeuri', 800, 700),
  ('ice', 1, 'pokshini', 1800, 1300),
  ('ice', 2, 'ganeuri', 3000, 600),
  ('ice', 3, 'muldeuli', 4200, 1500),
  ('ice', 4, 'ganeuri', 1200, 2600),
  ('ice', 5, 'pokshini', 2800, 3200),
  ('ice', 6, 'ganeuri', 4400, 2800),
  ('ice', 7, 'muldeuli', 5000, 3700),
  ('lake', 0, 'muldeuli', 600, 500),
  ('lake', 1, 'nubi', 1200, 900),
  ('lake', 2, 'muldeuli', 2000, 400),
  ('lake', 3, 'bopuli', 2600, 1100),
  ('lake', 4, 'muldeuli', 900, 1800),
  ('lake', 5, 'nubi', 1800, 2200),
  ('lake', 6, 'muldeuli', 3200, 1700),
  ('lake', 7, 'bopuli', 3400, 2500),
  ('underground', 0, 'pokshini', 700, 600),
  ('underground', 1, 'muldeuli', 1500, 1100),
  ('underground', 2, 'pokshini', 2400, 500),
  ('underground', 3, 'bopuli', 3300, 1200),
  ('underground', 4, 'pokshini', 1000, 2200),
  ('underground', 5, 'muldeuli', 2200, 2800),
  ('underground', 6, 'pokshini', 3800, 2100),
  ('underground', 7, 'bopuli', 4100, 3100)
ON DUPLICATE KEY UPDATE character_code = VALUES(character_code), x = VALUES(x), y = VALUES(y);

INSERT INTO game_setting (setting_key, value_json) VALUES
  ('battle.gridCols', '12'),
  ('battle.gridRows', '8'),
  ('battle.maxAlliedUnits', '5'),
  ('battle.partyStartCol', '1'),
  ('battle.wildStartCol', '10'),
  ('battle.wildStartRow', '4'),
  ('battle.minDamage', '1'),
  ('battle.defenseDivisor', '2'),
  ('battle.wildHpMult.1', '1'),
  ('battle.wildHpMult.2', '1.5'),
  ('battle.wildHpMult.3', '2'),
  ('battle.wildHpMult.4', '2.5'),
  ('battle.wildHpMult.5', '3'),
  ('battle.inviteSeconds', '15'),
  ('battle.partySelectSeconds', '30'),
  ('battle.subturnSeconds', '30'),
  ('battle.resolvedRetentionSeconds', '600')
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);
