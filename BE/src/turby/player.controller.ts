import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PlayerService } from './player.service';
import { SESSION_HEADER, SessionService } from './session.service';
import { parseId } from './turby-dto';

// 구 경로(URL의 playerId). 새 클라이언트는 /player/me/*(me.controller.ts)를 쓴다.
// 전환 기간: 토큰이 오면 같은 플레이어인지 확인하고, auth.requireSession이 켜지면 토큰 없는 요청을 거부한다.
@Controller('player')
export class PlayerController {
  constructor(
    private readonly playerService: PlayerService,
    private readonly session: SessionService,
  ) {}

  @Post('identify')
  identify(@Body('deviceUuid') deviceUuid: string) {
    return this.playerService.identify(deviceUuid);
  }

  @Get(':playerId/turby')
  async getInventory(@Param('playerId') playerId: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.playerService.getInventory(parseId(playerId, '플레이어'));
  }

  @Post(':playerId/turby/:turbyId/shelf')
  async moveToShelf(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('slotIndex') slotIndex: number, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.playerService.moveToShelf(playerId, turbyId, slotIndex);
  }

  @Post(':playerId/turby/:turbyId/bag')
  async moveToBag(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.playerService.moveToBag(playerId, turbyId);
  }
}
