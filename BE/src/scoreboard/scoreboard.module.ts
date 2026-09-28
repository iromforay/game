import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { PrismaService } from './prisma.service';
import { ScoreboardController } from './scoreboard.controller';
import { ScoreboardService } from './scoreboard.service';

// 스코어보드(2026-09-28, docs/dev/scoreboard.md) — 허브가 계정 API와 같은 서버(커비 서버)로 호출한다.
@Module({
  imports: [AccountModule],
  controllers: [ScoreboardController],
  providers: [PrismaService, ScoreboardService],
})
export class ScoreboardModule {}
