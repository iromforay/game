import { Module } from '@nestjs/common';
import { SweetShopModule } from './sweet-shop/sweet-shop.module';

@Module({
  imports: [SweetShopModule],
})
export class SweetShopAppModule {}
