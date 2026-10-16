import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { PrismaService } from '../scoreboard/prisma.service';
import { SweetShopGateway } from './sweet-shop.gateway';
import { SweetShopService } from './sweet-shop.service';
import { SweetShopController } from './sweet-shop.controller';

@Module({
  imports: [AccountModule],
  controllers: [SweetShopController],
  providers: [PrismaService, SweetShopService, SweetShopGateway],
})
export class SweetShopModule {}
