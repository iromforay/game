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
import { SessionService } from './session.service';
import { InventoryService } from './inventory.service';
import { MeController } from './me.controller';
import { StoryController } from './story/story.controller';
import { StoryService } from './story/story.service';
import { StoryContentService } from './story/story-content.service';
import { StageAccessService } from './story/stage-access.service';

@Module({
  // 순서 중요: /player/me/* 가 구 경로 /player/:playerId/* 보다 먼저 등록돼야 'me'가 playerId로 잡히지 않는다
  controllers: [MeController, StoryController, PlayerController, ShopController],
  providers: [
    PrismaService,
    SettingsService,
    SessionService,
    PlayerService,
    ShopService,
    EquipmentService,
    InventoryService,
    RoomsService,
    RoomsGateway,
    BattleService,
    BattleGateway,
    StoryContentService,
    StageAccessService,
    StoryService,
  ],
})
export class PlayerModule {}
