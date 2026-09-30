import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ShopService } from './shop.service';
import { EquipmentService } from './equipment.service';
import { SESSION_HEADER, SessionService } from './session.service';

@Controller()
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly equipment: EquipmentService,
    private readonly session: SessionService,
  ) {}

  @Get('shop')
  listProducts() {
    return this.shop.listProducts();
  }

  // 아래는 구 경로(URL의 playerId) — 새 클라이언트는 /player/me/*. 전환 기간 검사는 player.controller.ts와 같다.
  @Post('player/:playerId/shop/purchase')
  async purchase(@Param('playerId') playerId: string, @Body('productId') productId: number, @Body('requestId') requestId: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.shop.purchase(playerId, productId, requestId);
  }

  @Get('player/:playerId/items')
  async listItems(@Param('playerId') playerId: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.equipment.listItems(playerId);
  }

  @Post('player/:playerId/turby/:turbyId/equip')
  async equip(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('itemCode') itemCode: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.equipment.equip(playerId, turbyId, itemCode);
  }

  @Post('player/:playerId/turby/:turbyId/unequip')
  async unequip(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('slotKey') slotKey: string, @Headers(SESSION_HEADER) token: string) {
    await this.session.checkLegacy(playerId, token);
    return this.equipment.unequip(playerId, turbyId, slotKey);
  }
}
