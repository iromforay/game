import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlayerService } from './player.service';
import type { LockState } from './baseAccess';

@Controller('kirby/player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  // authToken(선택) — 허브 공통 계정 로그인 토큰. 있으면 계정 기준, 없으면 기존처럼 device_uuid 기준(게스트)
  @Post('identify')
  identify(@Body('deviceUuid') deviceUuid: string, @Body('authToken') authToken?: string) {
    return this.playerService.identify(deviceUuid, authToken);
  }

  @Get(':playerId')
  getState(@Param('playerId') playerId: string) {
    return this.playerService.getPlayerState(playerId);
  }

  @Post(':playerId/market/roll')
  rollOffer(@Param('playerId') playerId: string, @Body('slot') slot: number) {
    return this.playerService.rollOffer(playerId, Number(slot));
  }

  @Post(':playerId/buy')
  buy(@Param('playerId') playerId: string, @Body('offerId') offerId: string) {
    return this.playerService.buy(playerId, offerId);
  }

  @Post(':playerId/sell/:instanceId')
  sell(@Param('playerId') playerId: string, @Param('instanceId') instanceId: string) {
    return this.playerService.sell(playerId, instanceId);
  }

  @Post(':playerId/collect-all')
  collectAll(@Param('playerId') playerId: string) {
    return this.playerService.collectAllIncome(playerId);
  }

  @Post(':playerId/collect/:instanceId')
  collect(@Param('playerId') playerId: string, @Param('instanceId') instanceId: string) {
    return this.playerService.collectIncome(playerId, instanceId);
  }

  @Post(':playerId/settings')
  updateSettings(
    @Param('playerId') playerId: string,
    @Body() body: { lockState?: LockState; offlineOperationEnabled?: boolean; allowedUserIds?: string[] },
  ) {
    return this.playerService.updateSettings(playerId, body);
  }
}
