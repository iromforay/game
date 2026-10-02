import { useEffect, useState } from 'react';
import { GAME_RESULT_EVENT } from 'tower-defense';
import type { GameResultDetail } from 'tower-defense';
import { submitGameResult } from './scoreboardClient';
import type { RankingGame, SubmitResult } from './scoreboardClient';
import { hasStoredToken } from '../account/accountClient';
import './Scoreboard.css';

const GAME_TITLES: Record<GameResultDetail['game'], string> = {
  tower_defense: '타워 디펜스',
  offense_tower: '오펜스 타워',
  number_hero_tower: '숫자 용사 탑',
  marbles: '전략 알까기',
};

interface Props {
  onOpenRanking: (game: RankingGame, roundId?: number) => void;
}

// 스코어보드(2026-09-28) — 게임이 판 결과(bomul:game-result)를 알리면 서버에 제출하고 점수 카드를 게임 화면 위에 띄운다.
export function GameResultCard({ onOpenRanking }: Props) {
  const [detail, setDetail] = useState<GameResultDetail | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<GameResultDetail>).detail;
      // 진행 중 기록은 카드 없이 조용히 갱신한다. 숫자 용사 탑은 매 보상 합산 직후 반드시 BE에 전송한다.
      if (d.final === false) {
        if (d.game === 'number_hero_tower' || hasStoredToken()) submitGameResult(d).catch(() => undefined);
        return;
      }
      setDetail(d);
      setResult(null);
      setError('');
      submitGameResult(d).then(setResult).catch((err: unknown) => setError(err instanceof Error ? err.message : '점수 등록에 실패했습니다'));
    };
    window.addEventListener(GAME_RESULT_EVENT, onResult);
    return () => window.removeEventListener(GAME_RESULT_EVENT, onResult);
  }, []);

  useEffect(() => {
    if (!detail || detail.game !== 'number_hero_tower' || detail.stats.cleared) return;

    const dismissTimer = window.setTimeout(() => {
      setDetail(null);
      setResult(null);
      setError('');
    }, 3_000);

    return () => window.clearTimeout(dismissTimer);
  }, [detail]);

  if (!detail) return null;
  const isMarbles = detail.game === 'marbles';
  const roundId = detail.game === 'offense_tower' ? detail.stats.roundId : detail.game === 'number_hero_tower' ? detail.stats.stageId : undefined;

  return (
    <div className="result-card" role="dialog" aria-label="점수 결과">
      <div className="result-card-head">
        <span>{GAME_TITLES[detail.game]}{roundId ? ` · 라운드 ${roundId}` : ''}</span>
        <button type="button" className="result-card-close" onClick={() => setDetail(null)} aria-label="닫기">
          ×
        </button>
      </div>
      {!result && !error && <p className="result-card-muted">점수 계산 중…</p>}
      {error && <p className="result-card-error">{error}</p>}
      {result && (
        <>
          <ul className="result-card-breakdown">
            {result.breakdown.map((b) => (
              <li key={b.label}>
                <span>
                  {b.label} <em>{b.value}</em>
                </span>
                <strong>{b.points >= 0 ? '+' : ''}{b.points.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
          <p className="result-card-total">
            {isMarbles ? '획득 승점' : '총점'} <strong>{result.score.toLocaleString()}</strong>
          </p>
          {result.registered ? (
            <p className="result-card-rank">
              {result.isNewBest && <span className="result-card-badge">최고 기록!</span>}
              {isMarbles && result.rankingScore !== undefined && <>누적 승점 {result.rankingScore} · </>}
              {result.rank ? `현재 ${result.rank}위` : '랭킹에 등록되었습니다'}
            </p>
          ) : (
            <p className="result-card-muted">로그인하면 이 점수가 랭킹에 등록됩니다.</p>
          )}
          <button type="button" className="result-card-link" onClick={() => onOpenRanking(detail.game, roundId)}>
            랭킹 보기
          </button>
        </>
      )}
    </div>
  );
}
