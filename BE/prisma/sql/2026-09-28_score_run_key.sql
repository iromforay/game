-- 스코어보드: 판 도중 기록 갱신(디펜스 타워는 웨이브마다, 오펜스 타워는 돌파마다). 중간에 나가거나 꺼져도 마지막 진행이 남는다.
-- 판마다 한 행(run_key UNIQUE). 알까기와 예전 클라이언트 기록은 run_key가 NULL(판마다 새 행, 기존 동작 그대로).
-- 여러 번 실행해도 안전(IF NOT EXISTS).

ALTER TABLE score_record
  ADD COLUMN IF NOT EXISTS run_key VARCHAR(64) NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_score_run (run_key);
