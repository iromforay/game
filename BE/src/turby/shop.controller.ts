import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ShopService } from './shop.service';
import { EquipmentService } from './equipment.service';

@Controller()
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly equipment: EquipmentService,
  ) {}

  @Get('shop')
  listProducts() {
    return this.shop.listProducts();
  }

  @Post('player/:playerId/shop/purchase')
  purchase(@Param('playerId') playerId: string, @Body('productId') productId: number, @Body('requestId') requestId: string) {
    return this.shop.purchase(playerId, productId, requestId);
  }

  @Get('player/:playerId/items')
  listItems(@Param('playerId') playerId: string) {
    return this.equipment.listItems(playerId);
  }

  @Post('player/:playerId/turby/:turbyId/equip')
  equip(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('itemCode') itemCode: string) {
    return this.equipment.equip(playerId, turbyId, itemCode);
  }

  @Post('player/:playerId/turby/:turbyId/unequip')
  unequip(@Param('playerId') playerId: string, @Param('turbyId') turbyId: string, @Body('slotKey') slotKey: string) {
    return this.equipment.unequip(playerId, turbyId, slotKey);
  }
}
