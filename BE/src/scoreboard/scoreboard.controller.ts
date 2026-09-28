import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ScoreboardService } from './scoreboard.service';

function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

@Controller('scoreboard')
export class ScoreboardController {
  constructor(private readonly scoreboard: ScoreboardService) {}

  // 판 결과 제출 {game, stats} — 로그인 토큰(Authorization: Bearer)이 있으면 기록, 없으면 점수 계산만
  @Post('submit')
  submit(@Headers('authorization') auth: string | undefined, @Body('game') game: unknown, @Body('stats') stats: unknown) {
    return this.scoreboard.submit(bearer(auth), game, stats);
  }

  // 랭킹 조회 ?game=tower_defense|offense_tower|marbles|kirby[&roundId=]
  @Get('ranking')
  ranking(@Headers('authorization') auth: string | undefined, @Query('game') game: unknown, @Query('roundId') roundId: unknown) {
    return this.scoreboard.ranking(bearer(auth), game, roundId);
  }
}
