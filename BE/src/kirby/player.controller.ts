import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlayerService } from './player.service';
import type { LockState } from './baseAccess';

@Controller('kirby/player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('identify')
  identify(@Body('deviceUuid') deviceUuid: string) {
    return this.playerService.identify(deviceUuid);
  }

  @Get(':playerId')
  getState(@Param('playerId') playerId: string) {
    return this.playerService.getPlayerState(playerId);
  }

  @Post(':playerId/buy')
  buy(@Param('playerId') playerId: string) {
    return this.playerService.buy(playerId);
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
