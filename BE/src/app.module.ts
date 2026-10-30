import { Module } from '@nestjs/common';
import { RoomsModule } from './rooms/rooms.module';
import { AccountModule } from './account/account.module';
import { ScoreboardModule } from './scoreboard/scoreboard.module';
import { PrismaService } from './scoreboard/prisma.service';
import { SpinGatherController } from './spin-gather/spin-gather.controller';
import { SpinGatherService } from './spin-gather/spin-gather.service';

// 메인 BE(3001) — 멀티플레이 방 소켓 + 내 방이 던전 저장 API(ScoreboardModule) + 빙글 채집왕 저장 API.
// 10-30 통합: my-room-dungeon-be(3004)·spin-gather-be(3006)를 이 프로세스로 합침.
// 컬러 블래스터즈는 미서비스라 운영에서 빼고, 개발용 color-blasters-main.ts(3007)로만 띄운다.
@Module({
  imports: [RoomsModule, AccountModule, ScoreboardModule],
  controllers: [SpinGatherController],
  providers: [PrismaService, SpinGatherService],
})
export class AppModule {}
