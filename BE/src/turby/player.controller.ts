import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PlayerService } from './player.service';

@Controller('player')
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post('identify')
  identify(@Body('deviceUuid') deviceUuid: string) {
    return this.playerService.identify(deviceUuid);
  }

  @Get(':playerId/turby')
  getInventory(@Param('playerId') playerId: string) {
    return this.playerService.getInventory(BigInt(playerId));
  }

  @Post(':playerId/turby/:turbyId/shelf')
  moveToShelf(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('slotIndex') slotIndex: number) {
    return this.playerService.moveToShelf(playerId, turbyId, slotIndex);
  }

  @Post(':playerId/turby/:turbyId/bag')
  moveToBag(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string) {
    return this.playerService.moveToBag(playerId, turbyId);
  }
}
