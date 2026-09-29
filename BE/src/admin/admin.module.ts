import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { PrismaService } from './prisma.service';

// 관리자 백오피스(2026-09-29) — 허브가 계정 API와 같은 서버(커비 서버)로 호출한다.
@Module({
  imports: [AccountModule],
  controllers: [AdminController],
  providers: [PrismaService, AdminService, AdminGuard],
})
export class AdminModule {}
