import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { InvasionService } from './invasion.service';
import { InvasionGateway } from './invasion.gateway';

@Module({
  controllers: [PlayerController],
  providers: [PrismaService, PlayerService, InvasionService, InvasionGateway],
})
export class KirbyModule {}
