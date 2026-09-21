import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { ShopService } from './shop.service';
import { EquipmentService } from './equipment.service';
import { ShopController } from './shop.controller';
import { RoomsService } from './rooms/rooms.service';
import { RoomsGateway } from './rooms/rooms.gateway';
import { SettingsService } from './rooms/settings.service';
import { BattleService } from './battle/battle.service';
import { BattleGateway } from './battle/battle.gateway';

@Module({
  controllers: [PlayerController, ShopController],
  providers: [PrismaService, PlayerService, ShopService, EquipmentService, SettingsService, RoomsService, RoomsGateway, BattleService, BattleGateway],
})
export class PlayerModule {}
