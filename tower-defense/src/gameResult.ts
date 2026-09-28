// 스코어보드(2026-09-28, docs/dev/scoreboard.md) — 판이 끝나면 결과 수치만 허브에 알린다.
// 게임은 서버·계정을 몰라도 되고, 허브(hub/src/scoreboard)가 이 이벤트를 받아 서버에 제출하고 점수 카드를 띄운다.
// 단독 개발 서버로 실행할 때는 받는 쪽이 없어 아무 일도 일어나지 않는다.
export const GAME_RESULT_EVENT = 'bomul:game-result';

// runId가 있는 판은 진행 중에도(final=false) 같은 판 기록을 계속 갱신한다. 중간에 나가거나 꺼져도 마지막 진행까지 남는다.
// final=true(또는 runId 없는 알까기)일 때만 허브가 점수 카드를 띄운다.
export type GameResultDetail = { runId?: string; final?: boolean } & (
  | { game: 'tower_defense'; stats: { won: boolean; wavesCleared: number; kills: number; lives: number; gold: number } }
  | { game: 'offense_tower'; stats: { roundId: number; cleared: boolean; breakthroughs: number; clearSeconds: number; unitsLost: number } }
  | { game: 'marbles'; stats: { result: 'win' | 'tie' | 'none' } }
);

export function reportGameResult(detail: GameResultDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GameResultDetail>(GAME_RESULT_EVENT, { detail }));
}

export function newRunId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}
