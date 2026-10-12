import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PlayerService } from './player.service';
import { ShopService } from './shop.service';
import { EquipmentService } from './equipment.service';
import { InventoryService } from './inventory.service';
import { SESSION_HEADER, SessionService } from './session.service';

// 스토리 M1: 기존 player/:playerId/* 기능을 세션 토큰 기반 /player/me/*로 옮긴다.
// 구 경로는 전환 기간 동안 유지한다(m0_design 7.2). 서비스 로직은 공유하므로 동작은 같다.
@Controller('player/me')
export class MeController {
  constructor(
    private readonly session: SessionService,
    private readonly players: PlayerService,
    private readonly shop: ShopService,
    private readonly equipment: EquipmentService,
    private readonly inventory: InventoryService,
  ) {}

  @Get('turby')
  async turbys(@Headers(SESSION_HEADER) token: string) {
    return this.players.getInventory(await this.session.require(token));
  }

  @Post('turby/:turbyId/shelf')
  @HttpCode(200)
  async moveToShelf(@Headers(SESSION_HEADER) token: string, @Param('turbyId') turbyId: string, @Body('slotIndex') slotIndex: number) {
    const playerId = await this.session.require(token);
    return this.players.moveToShelf(playerId.toString(), turbyId, slotIndex);
  }

  @Post('turby/:turbyId/bag')
  @HttpCode(200)
  async moveToBag(@Headers(SESSION_HEADER) token: string, @Param('turbyId') turbyId: string) {
    const playerId = await this.session.require(token);
    return this.players.moveToBag(playerId.toString(), turbyId);
  }

  @Get('items')
  async items(@Headers(SESSION_HEADER) token: string) {
    return this.equipment.listItems((await this.session.require(token)).toString());
  }

  @Post('turby/:turbyId/equip')
  @HttpCode(200)
  async equip(@Headers(SESSION_HEADER) token: string, @Param('turbyId') turbyId: string, @Body('itemCode') itemCode: string) {
    return this.equipment.equip((await this.session.require(token)).toString(), turbyId, itemCode);
  }

  @Post('turby/:turbyId/unequip')
  @HttpCode(200)
  async unequip(@Headers(SESSION_HEADER) token: string, @Param('turbyId') turbyId: string, @Body('slotKey') slotKey: string) {
    return this.equipment.unequip((await this.session.require(token)).toString(), turbyId, slotKey);
  }

  @Post('shop/purchase')
  @HttpCode(200)
  async purchase(@Headers(SESSION_HEADER) token: string, @Body('productId') productId: number, @Body('requestId') requestId: string) {
    return this.shop.purchase((await this.session.require(token)).toString(), productId, requestId);
  }

  @Get('inventory')
  async inventoryList(@Headers(SESSION_HEADER) token: string) {
    return this.inventory.list(await this.session.require(token));
  }

  @Get('inventory/overflow')
  async overflow(@Headers(SESSION_HEADER) token: string) {
    return this.inventory.listOverflow(await this.session.require(token));
  }

  @Post('inventory/overflow/:id/claim')
  @HttpCode(200)
  async claimOverflow(@Headers(SESSION_HEADER) token: string, @Param('id') id: string) {
    return this.inventory.claimOverflow(await this.session.require(token), id);
  }

  // 상세를 연 아이템 하나만 신규 표시 해제(v3 §2.3)
  @Post('inventory/items/:itemCode/seen')
  @HttpCode(200)
  async inventorySeen(@Headers(SESSION_HEADER) token: string, @Param('itemCode') itemCode: string) {
    return this.inventory.markItemSeen(await this.session.require(token), itemCode);
  }
}
