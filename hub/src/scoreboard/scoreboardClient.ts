import { ACCOUNT_SERVER_URL, authHeader } from '../account/accountClient';
import type { GameResultDetail } from 'tower-defense';

// 스코어보드(2026-09-28, docs/dev/scoreboard.md) — 점수 계산은 서버가 한다. 로그인 상태면 기록 + 순위, 게스트면 점수만.
export type RankingGame = 'tower_defense' | 'offense_tower' | 'marbles' | 'kirby';

export interface ScoreBreakdownItem {
  label: string;
  value: number | string;
  points: number;
}

export interface SubmitResult {
  score: number;
  breakdown: ScoreBreakdownItem[];
  registered: boolean;
  rankingScore?: number;
  isNewBest?: boolean;
  rank?: number | null;
}

export interface RankingEntry {
  rank: number;
  nickname: string;
  score: number;
  games: number | null;
  isMe: boolean;
}

export interface RankingResponse {
  game: RankingGame;
  roundId: number;
  entries: RankingEntry[];
  me: { rank: number; score: number; games: number | null } | null;
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.message === 'string' ? body.message : '요청에 실패했습니다');
  return body as T;
}

export async function submitGameResult(detail: GameResultDetail): Promise<SubmitResult> {
  const res = await fetch(`${ACCOUNT_SERVER_URL}/scoreboard/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(detail),
  });
  return parse<SubmitResult>(res);
}

export async function fetchRanking(game: RankingGame, roundId?: number): Promise<RankingResponse> {
  const q = new URLSearchParams({ game });
  if (roundId) q.set('roundId', String(roundId));
  const res = await fetch(`${ACCOUNT_SERVER_URL}/scoreboard/ranking?${q}`, { headers: authHeader() });
  return parse<RankingResponse>(res);
}
