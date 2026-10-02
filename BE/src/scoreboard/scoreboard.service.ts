import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { PrismaService } from './prisma.service';

// 스코어보드(2026-09-28, 설계 docs/dev/scoreboard.md) — 점수는 서버가 게임 결과 수치로 계산한다(공식을 한 곳에 두고
// 값 범위를 검사하기 위함). 로그인(허브 계정) 상태면 기록하고 순위를 돌려주며, 게스트는 점수 계산 결과만 받는다.
export type ScoreGame = 'tower_defense' | 'offense_tower' | 'number_hero_tower' | 'marbles';
export type RankingGame = ScoreGame | 'kirby';

const RANKING_LIMIT = 50;
const TD_WAVES = 10;
const TD_MAX_LIVES = 20;
const KIRBY_STARTING_GOLD = 100; // BE/src/kirby/player.service.ts STARTING_GOLD와 같아야 함
// 오펜스 타워 미클리어 판: 돌파 1마리당 점수, 상한은 클리어 최소 점수보다 낮게 두어 클리어가 항상 위에 오게 한다.
const OT_PARTIAL_PER_BREAKTHROUGH = 500;
const OT_PARTIAL_MAX = 4500;
const OT_CLEAR_MIN = 5000;
const RUN_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

interface BreakdownItem {
  label: string;
  value: number | string;
  points: number;
}

interface Computed {
  score: number;
  roundId: number;
  breakdown: BreakdownItem[];
  detail: Record<string, unknown>;
}

function int(v: unknown, min: number, max: number, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException({ message: `잘못된 결과 값: ${name}`, code: 'INVALID_STATS' });
  }
  return n;
}

@Injectable()
export class ScoreboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
  ) {}

  // ----- 점수 공식(docs/dev/scoreboard.md 2절) -----
  private compute(game: unknown, stats: Record<string, unknown>): Computed {
    if (game === 'tower_defense') {
      const won = stats.won === true;
      const waves = int(stats.wavesCleared, 0, TD_WAVES, 'wavesCleared');
      if (won && waves !== TD_WAVES) throw new BadRequestException({ message: '잘못된 결과 값: won', code: 'INVALID_STATS' });
      const kills = int(stats.kills, 0, 100_000, 'kills');
      const lives = won ? int(stats.lives, 0, TD_MAX_LIVES, 'lives') : 0;
      const gold = won ? int(stats.gold, 0, 10_000_000, 'gold') : 0;
      const breakdown: BreakdownItem[] = [
        { label: '클리어한 웨이브', value: waves, points: waves * 1000 },
        { label: '처치한 적', value: kills, points: kills * 10 },
      ];
      if (won) {
        breakdown.push({ label: '승리 보너스', value: '10웨이브 방어', points: 5000 });
        breakdown.push({ label: '남은 라이프', value: lives, points: lives * 200 });
        breakdown.push({ label: '남은 골드', value: gold, points: gold });
      }
      return { score: breakdown.reduce((s, b) => s + b.points, 0), roundId: 0, breakdown, detail: { won, wavesCleared: waves, kills, lives, gold } };
    }
    if (game === 'offense_tower') {
      const roundId = int(stats.roundId, 1, 1000, 'roundId');
      const clearSeconds = int(stats.clearSeconds, 0, 86_400, 'clearSeconds');
      const unitsLost = int(stats.unitsLost, 0, 1_000_000, 'unitsLost');
      // cleared가 없는 제출은 예전 클라이언트(클리어 때만 보냄)이므로 클리어로 본다.
      const cleared = stats.cleared !== false;
      if (!cleared) {
        const breakthroughs = int(stats.breakthroughs, 0, 1000, 'breakthroughs');
        const points = Math.min(breakthroughs * OT_PARTIAL_PER_BREAKTHROUGH, OT_PARTIAL_MAX);
        return {
          score: points,
          roundId,
          breakdown: [{ label: '돌파(미클리어)', value: breakthroughs, points }],
          detail: { roundId, cleared: false, breakthroughs, clearSeconds, unitsLost },
        };
      }
      const timeBonus = Math.max(0, 300 - clearSeconds) * 20;
      const breakdown: BreakdownItem[] = [
        { label: '클리어', value: `라운드 ${roundId}`, points: 10000 },
        { label: '시간 보너스', value: `${clearSeconds}초`, points: timeBonus },
        { label: '잃은 유닛', value: unitsLost, points: -unitsLost * 50 },
      ];
      const raw = breakdown.reduce((s, b) => s + b.points, 0);
      return { score: Math.max(OT_CLEAR_MIN, raw), roundId, breakdown, detail: { roundId, cleared: true, clearSeconds, unitsLost } };
    }
    if (game === 'marbles') {
      const result = stats.result;
      if (result !== 'win' && result !== 'tie' && result !== 'none') {
        throw new BadRequestException({ message: '잘못된 결과 값: result', code: 'INVALID_STATS' });
      }
      const points = result === 'win' ? 3 : result === 'tie' ? 1 : 0;
      const label = result === 'win' ? '단독 1위' : result === 'tie' ? '공동 1위' : '입상 실패';
      return { score: points, roundId: 0, breakdown: [{ label: '대전 결과', value: label, points }], detail: { result } };
    }
    if (game === 'number_hero_tower') {
      const stageId = int(stats.stageId, 1, 1000, 'stageId');
      const currentScore = int(stats.currentScore, 1, 10_000_000, 'currentScore');
      const floorsCleared = int(stats.floorsCleared, 0, 100, 'floorsCleared');
      const cleared = stats.cleared === true;
      const breakdown: BreakdownItem[] = [
        { label: '현재 합산 숫자', value: currentScore, points: currentScore },
      ];
      if (cleared) breakdown.push({ label: '드래곤 격파', value: '완료', points: 0 });
      return { score: currentScore, roundId: stageId, breakdown, detail: { stageId, currentScore, floorsCleared, cleared } };
    }
    throw new BadRequestException({ message: '알 수 없는 게임', code: 'INVALID_GAME' });
  }

  // 판 결과 제출 — 로그인 상태면 기록 + 최고 기록/순위, 게스트면 점수 계산 결과만
  async submit(token: string | undefined, game: unknown, stats: unknown, runIdRaw?: unknown) {
    const computed = this.compute(game, (stats && typeof stats === 'object' ? stats : {}) as Record<string, unknown>);
    const scoreGame = game as ScoreGame;
    const accountId = await this.accounts.resolveAccountId(token);
    if (!accountId) return { score: computed.score, breakdown: computed.breakdown, registered: false };

    // 알까기는 판 도중 갱신이 없어 runId를 쓰지 않는다(판마다 새 행).
    const runId = scoreGame !== 'marbles' && typeof runIdRaw === 'string' && RUN_ID_PATTERN.test(runIdRaw) ? runIdRaw : null;
    const previousBest = await this.bestOf(accountId, scoreGame, computed.roundId, runId);
    const detailJson = JSON.stringify(computed.detail);
    if (runId) {
      // 같은 판은 한 행만 유지하고, 점수는 올라가는 방향으로만 갱신한다(요청 순서가 뒤바뀌어도 되돌아가지 않음).
      // 다른 계정·게임·라운드의 runId와 겹치면 기존 행을 건드리지 않는다. detail_json을 score보다 먼저 비교해야 한다.
      await this.prisma.$executeRaw`
        INSERT INTO score_record (account_id, game, round_id, score, detail_json, run_key)
        VALUES (${accountId}, ${scoreGame}, ${computed.roundId}, ${computed.score}, ${detailJson}, ${runId})
        ON DUPLICATE KEY UPDATE
          detail_json = IF(account_id = VALUES(account_id) AND game = VALUES(game) AND round_id = VALUES(round_id) AND VALUES(score) >= score, VALUES(detail_json), detail_json),
          score = IF(account_id = VALUES(account_id) AND game = VALUES(game) AND round_id = VALUES(round_id) AND VALUES(score) >= score, VALUES(score), score)`;
    } else {
      await this.prisma.score_record.create({
        data: { account_id: accountId, game: scoreGame, round_id: computed.roundId, score: computed.score, detail_json: detailJson },
      });
    }
    const me = await this.myRank(accountId, scoreGame, computed.roundId);
    return {
      score: computed.score,
      breakdown: computed.breakdown,
      registered: true,
      // 알까기는 누적 승점 랭킹이라 "최고 기록" 대신 누적 값을 돌려줌
      rankingScore: me?.score ?? computed.score,
      isNewBest: scoreGame !== 'marbles' && (previousBest === null || computed.score > previousBest),
      rank: me?.rank ?? null,
    };
  }

  async ranking(token: string | undefined, gameRaw: unknown, roundIdRaw: unknown) {
    const game = gameRaw as RankingGame;
    if (!['tower_defense', 'offense_tower', 'number_hero_tower', 'marbles', 'kirby'].includes(game)) {
      throw new BadRequestException({ message: '알 수 없는 게임', code: 'INVALID_GAME' });
    }
    const accountId = await this.accounts.resolveAccountId(token);
    if (game === 'kirby') return this.kirbyRanking(accountId);

    const roundId = game === 'offense_tower' || game === 'number_hero_tower' ? int(roundIdRaw ?? 1, 1, 1000, 'roundId') : 0;
    const rows = await this.aggregate(game, roundId);
    const entries = rows.slice(0, RANKING_LIMIT).map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      score: r.score,
      games: r.games,
      isMe: accountId !== null && r.accountId === accountId,
    }));
    const meRow = accountId !== null ? rows.findIndex((r) => r.accountId === accountId) : -1;
    return { game, roundId, entries, me: meRow >= 0 ? { rank: meRow + 1, score: rows[meRow].score, games: rows[meRow].games } : null };
  }

  // 게임·라운드별 계정 순위표 — 알까기는 누적 승점(동점이면 대전 수 적은 쪽 우선), 그 외는 계정별 최고 점수
  private async aggregate(game: ScoreGame, roundId: number) {
    const rows =
      game === 'marbles'
        ? await this.prisma.$queryRaw<{ account_id: bigint; score: bigint | number; games: bigint | number }[]>`
            SELECT account_id, SUM(score) AS score, COUNT(*) AS games FROM score_record
            WHERE game = 'marbles' GROUP BY account_id ORDER BY score DESC, games ASC, account_id ASC`
        : await this.prisma.$queryRaw<{ account_id: bigint; score: bigint | number; games: bigint | number }[]>`
            SELECT account_id, MAX(score) AS score, COUNT(*) AS games FROM score_record
            WHERE game = ${game} AND round_id = ${roundId} GROUP BY account_id ORDER BY score DESC, account_id ASC`;
    const accounts = await this.prisma.account.findMany({ where: { id: { in: rows.map((r) => r.account_id) } }, select: { id: true, nickname: true } });
    const names = new Map(accounts.map((a) => [a.id, a.nickname]));
    return rows.map((r) => ({ accountId: r.account_id, nickname: names.get(r.account_id) ?? `#${r.account_id}`, score: Number(r.score), games: Number(r.games) }));
  }

  // 이번 판(runId) 자신의 진행 기록은 "이전 최고"에서 빼야 판이 끝났을 때 최고 기록 갱신을 제대로 판단한다.
  private async bestOf(accountId: bigint, game: ScoreGame, roundId: number, excludeRunId: string | null) {
    const best = await this.prisma.score_record.aggregate({
      where: {
        account_id: accountId,
        game,
        round_id: roundId,
        ...(excludeRunId ? { OR: [{ run_key: null }, { run_key: { not: excludeRunId } }] } : {}),
      },
      _max: { score: true },
    });
    return best._max.score;
  }

  private async myRank(accountId: bigint, game: ScoreGame, roundId: number) {
    const rows = await this.aggregate(game, roundId);
    const i = rows.findIndex((r) => r.accountId === accountId);
    return i >= 0 ? { rank: i + 1, score: rows[i].score } : null;
  }

  // 커비 훔치기 — 기록 없이 DB에서 총 자산(골드 + 보유 커비 판매가 합) 계산. 이름은 계정 연결 플레이어만 닉네임, 게스트는 #id
  private async kirbyRanking(accountId: bigint | null) {
    const rows = await this.prisma.$queryRaw<{ id: bigint; nickname: string; linked: bigint | number; assets: bigint | number }[]>`
      SELECT p.id, p.nickname,
             (SELECT COUNT(*) FROM account_game_player a WHERE a.game = 'kirby' AND a.player_id = p.id) AS linked,
             p.gold + COALESCE((SELECT SUM(g.sell_price) FROM kirby_instance i
                                JOIN kirby_character c ON c.id = i.character_id
                                JOIN kirby_grade g ON g.id = c.grade_id
                                WHERE i.owner_player_id = p.id), 0) AS assets
      FROM kirby_player p
      ORDER BY assets DESC, p.id ASC`;
    let myPlayerId: bigint | null = null;
    if (accountId !== null) {
      const link = await this.prisma.account_game_player.findUnique({ where: { account_id_game: { account_id: accountId, game: 'kirby' } } });
      myPlayerId = link?.player_id ?? null;
    }
    // 사용자 요청(2026-09-28): 총 자산이 시작 골드(100) 이하인 플레이어(시작 상태이거나 오히려 잃은 경우)는 랭킹에서 제외
    const all = rows
      .map((r) => ({ playerId: r.id, nickname: Number(r.linked) > 0 ? r.nickname : `#${r.id}`, score: Number(r.assets) }))
      .filter((r) => r.score > KIRBY_STARTING_GOLD);
    const entries = all.slice(0, RANKING_LIMIT).map((r, i) => ({ rank: i + 1, nickname: r.nickname, score: r.score, games: null, isMe: myPlayerId !== null && r.playerId === myPlayerId }));
    const meIndex = myPlayerId !== null ? all.findIndex((r) => r.playerId === myPlayerId) : -1;
    return { game: 'kirby', roundId: 0, entries, me: meIndex >= 0 ? { rank: meIndex + 1, score: all[meIndex].score, games: null } : null };
  }
}
