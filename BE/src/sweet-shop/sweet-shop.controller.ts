import { Controller, Get, Headers, Param } from '@nestjs/common';
import { SweetShopService } from './sweet-shop.service';

@Controller('sweet-shop')
export class SweetShopController {
  constructor(private readonly sweetShop: SweetShopService) {}

  @Get('cafes/:profileId')
  getCafe(@Param('profileId') profileId: string, @Headers('authorization') authorization?: string, @Headers('x-sweet-shop-guest-id') guestId?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : authorization;
    return this.sweetShop.getCafeForViewer(profileId, token, guestId);
  }
}
