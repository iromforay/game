import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { PrismaService } from '../scoreboard/prisma.service';
import { SweetShopGateway } from './sweet-shop.gateway';
import { SweetShopService } from './sweet-shop.service';

@Module({
  imports: [AccountModule],
  providers: [PrismaService, SweetShopService, SweetShopGateway],
})
export class SweetShopModule {}
