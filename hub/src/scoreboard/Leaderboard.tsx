import { useEffect, useState } from 'react';
import { STAGES } from 'offense-tower';
import { fetchRanking } from './scoreboardClient';
import type { RankingGame, RankingResponse } from './scoreboardClient';
import { hasStoredToken } from '../account/accountClient';
import './Scoreboard.css';

const TABS: { game: RankingGame; title: string; scoreLabel: string; note: string }[] = [
  { game: 'tower_defense', title: '타워 디펜스', scoreLabel: '최고 점수', note: '웨이브·처치·라이프·골드로 계산한 한 판 최고 점수' },
  { game: 'offense_tower', title: '오펜스 타워', scoreLabel: '최고 점수', note: '라운드별 · 빨리, 유닛을 덜 잃고 클리어할수록 높음' },
  { game: 'number_hero_tower', title: '숫자 용사 탑', scoreLabel: '게임 최고 점수', note: '전체 스테이지에서 달성한 최고 합산 숫자와 최고 도달 스테이지' },
  { game: 'number_gate_runner', title: '숫자 게이트 러너', scoreLabel: '게임 최고 점수', note: '전체 스테이지에서 달성한 최대 소대 병력과 최고 도달 스테이지' },
  { game: 'merge_defense', title: '장난감 머지 방어전', scoreLabel: '게임 최고 점수', note: '전체 스테이지에서 달성한 최고 전투 점수와 최고 도달 스테이지' },
  { game: 'marbles', title: '전략 알까기', scoreLabel: '누적 승점', note: '온라인 대전 · 단독 1위 3점, 공동 1위 1점' },
  { game: 'kirby', title: '커비 훔치기', scoreLabel: '총 자산', note: '보유 골드 + 보유 커비 판매가 합(실시간)' },
];

interface Props {
  initialGame?: RankingGame;
  initialRoundId?: number;
  onBack: () => void;
}

// 스코어보드(2026-09-28, docs/dev/scoreboard.md) — 허브의 게임별 전체 랭킹 화면(상위 50위 + 내 순위)
export function Leaderboard({ initialGame = 'tower_defense', initialRoundId, onBack }: Props) {
  const [game, setGame] = useState<RankingGame>(initialGame);
  const [roundId, setRoundId] = useState<number>(initialRoundId ?? STAGES[0]?.id ?? 1);
  const [data, setData] = useState<RankingResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetchRanking(game, game === 'offense_tower' ? roundId : undefined)
      .then((d) => alive && setData(d))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : '랭킹을 불러오지 못했습니다'));
    return () => {
      alive = false;
    };
  }, [game, roundId]);

  const tab = TABS.find((t) => t.game === game)!;
  const meInTop = data?.entries.some((e) => e.isMe);

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <button type="button" className="back-button" onClick={onBack}>
          ← 게임 허브로
        </button>
        <h1>랭킹</h1>
      </div>

      <div className="leaderboard-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.game}
            type="button"
            role="tab"
            aria-selected={t.game === game}
            className={t.game === game ? 'active' : ''}
            onClick={() => {
              setGame(t.game);
              if (t.game === 'offense_tower') setRoundId(1);
            }}
          >
            {t.title}
          </button>
        ))}
      </div>

      <p className="leaderboard-note">
        {tab.note}
        {game === 'offense_tower' && STAGES.length > 1 && (
          <select value={roundId} onChange={(e) => setRoundId(Number(e.target.value))}>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                라운드 {s.id}
              </option>
            ))}
          </select>
        )}
      </p>

      {error && <p className="result-card-error">{error}</p>}
      {!data && !error && <p className="result-card-muted">불러오는 중…</p>}
      {data && data.entries.length === 0 && <p className="result-card-muted">아직 기록이 없습니다. 첫 번째 기록의 주인공이 되어 보세요!</p>}
      {data && data.entries.length > 0 && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>플레이어</th>
              <th>{tab.scoreLabel}</th>
              {isOverallStageGame(game) && <th>최고 스테이지</th>}
              {game === 'marbles' && <th>대전</th>}
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.rank} className={e.isMe ? 'me' : ''}>
                <td>{e.rank}</td>
                <td>{e.nickname}{e.isMe ? ' (나)' : ''}</td>
                <td>{e.score.toLocaleString()}</td>
                {isOverallStageGame(game) && (
                  <td>{formatStage(game, e.highestStage)}</td>
                )}
                {game === 'marbles' && <td>{e.games}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.me && !meInTop && (
        <p className="leaderboard-me">
          내 순위 {data.me.rank}위 · {data.me.score.toLocaleString()}
          {isOverallStageGame(game) && ` · 최고 ${formatStage(game, data.me.highestStage)}`}
        </p>
      )}
      {data && !hasStoredToken() && game !== 'kirby' && <p className="result-card-muted">로그인하면 내 기록이 랭킹에 등록됩니다.</p>}
    </div>
  );
}

function formatStage(game: RankingGame, stageId?: number | null) {
  if (!stageId) return '-';
  if (game === 'number_gate_runner' || game === 'merge_defense') return `${Math.floor((stageId - 1) / 10) + 1}-${((stageId - 1) % 10) + 1}`;
  return `1-${stageId}`;
}

function isOverallStageGame(game: RankingGame) {
  return game === 'number_hero_tower' || game === 'number_gate_runner' || game === 'merge_defense';
}
