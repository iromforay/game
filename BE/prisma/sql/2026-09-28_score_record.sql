-- 스코어보드(전체 랭킹) — 설계: docs/dev/scoreboard.md. 허브 계정(account)으로 로그인한 플레이어의 판 결과 기록.
-- 점수는 서버(ScoreboardService)가 게임 결과 수치로 계산해 저장. 커비 훔치기는 기록 없이 DB에서 바로 계산하므로 여기 없음.
-- 기존 테이블은 건드리지 않음. 여러 번 실행해도 안전(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS score_record (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  game ENUM('tower_defense','offense_tower','marbles') NOT NULL,
  round_id INT UNSIGNED NOT NULL DEFAULT 0, -- 오펜스 타워 라운드 번호, 그 외 게임은 0
  score INT NOT NULL, -- 알까기는 그 판의 승점(3/1/0), 그 외는 한 판 점수
  detail_json TEXT NULL, -- 제출된 결과 수치(웨이브·처치 수 등) — 점수 재계산/분쟁 확인용
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_score_rank (game, round_id, score),
  KEY idx_score_account (account_id, game, round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
