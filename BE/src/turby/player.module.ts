import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';

@Module({
  controllers: [PlayerController],
  providers: [PrismaService, PlayerService],
})
export class PlayerModule {}
