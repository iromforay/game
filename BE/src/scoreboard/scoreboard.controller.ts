import { Body, Controller, Get, Headers, Post, Put, Query } from '@nestjs/common';
import { ScoreboardService } from './scoreboard.service';

function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

@Controller('scoreboard')
export class ScoreboardController {
  constructor(private readonly scoreboard: ScoreboardService) {}

  // 판 결과 제출 {game, stats, runId?} — 로그인 토큰(Authorization: Bearer)이 있으면 기록, 없으면 점수 계산만.
  // runId가 있으면 같은 판 기록 한 줄을 진행에 따라 갱신한다.
  @Post('submit')
  submit(@Headers('authorization') auth: string | undefined, @Body('game') game: unknown, @Body('stats') stats: unknown, @Body('runId') runId: unknown) {
    return this.scoreboard.submit(bearer(auth), game, stats, runId);
  }

  // 랭킹 조회 ?game=tower_defense|offense_tower|marbles|kirby[&roundId=]
  @Get('ranking')
  ranking(@Headers('authorization') auth: string | undefined, @Query('game') game: unknown, @Query('roundId') roundId: unknown) {
    return this.scoreboard.ranking(bearer(auth), game, roundId);
  }

  @Get('merge-defense/profile')
  mergeDefenseProfile(@Headers('authorization') auth: string | undefined) {
    return this.scoreboard.mergeDefenseProfile(bearer(auth));
  }

  @Post('merge-defense/collect')
  collectMergeDefenseSilver(@Headers('authorization') auth: string | undefined, @Body() body: Record<string, unknown>) {
    return this.scoreboard.collectMergeDefenseSilver(bearer(auth), body);
  }

  @Post('merge-defense/discover')
  discoverMergeDefenseHero(@Headers('authorization') auth: string | undefined, @Body('heroClass') heroClass: unknown, @Body('grade') grade: unknown) {
    return this.scoreboard.discoverMergeDefenseHero(bearer(auth), heroClass, grade);
  }

  @Post('merge-defense/clear-stage')
  clearMergeDefenseStage(@Headers('authorization') auth: string | undefined, @Body('stageId') stageId: unknown) {
    return this.scoreboard.clearMergeDefenseStage(bearer(auth), stageId);
  }

  @Post('merge-defense/unlock-spellblade')
  unlockMergeDefenseSpellblade(@Headers('authorization') auth: string | undefined) {
    return this.scoreboard.unlockMergeDefenseSpellblade(bearer(auth));
  }

  @Post('merge-defense/purchase')
  purchaseMergeDefenseUpgrade(@Headers('authorization') auth: string | undefined, @Body('upgrade') upgrade: unknown) {
    return this.scoreboard.purchaseMergeDefenseUpgrade(bearer(auth), upgrade);
  }

  @Get('my-room-dungeon/profile')
  myRoomDungeonProfile(@Headers('authorization') auth: string | undefined) {
    return this.scoreboard.myRoomDungeonProfile(bearer(auth));
  }

  @Put('my-room-dungeon/profile')
  saveMyRoomDungeonProfile(@Headers('authorization') auth: string | undefined, @Body() body: Record<string, unknown>) {
    return this.scoreboard.saveMyRoomDungeonProfile(bearer(auth), body);
  }

  @Post('my-room-dungeon/collect')
  collectMyRoomDungeonResource(@Headers('authorization') auth: string | undefined, @Body() body: Record<string, unknown>) {
    return this.scoreboard.collectMyRoomDungeonResource(bearer(auth), body);
  }

  @Post('my-room-dungeon/complete-zone')
  completeMyRoomDungeonZone(@Headers('authorization') auth: string | undefined, @Body('zoneId') zoneId: unknown) {
    return this.scoreboard.completeMyRoomDungeonZone(bearer(auth), zoneId);
  }

  @Post('my-room-dungeon/deploy-robot')
  deployMyRoomDungeonRobot(@Headers('authorization') auth: string | undefined, @Body('zoneId') zoneId: unknown) {
    return this.scoreboard.deployMyRoomDungeonRobot(bearer(auth), zoneId);
  }

  @Post('my-room-dungeon/settle-robots')
  settleMyRoomDungeonRobots(@Headers('authorization') auth: string | undefined) {
    return this.scoreboard.settleMyRoomDungeonRobots(bearer(auth));
  }
}
