import { Module } from '@nestjs/common';
import { AccountController, InternalAuthController } from './account.controller';
import { AccountService } from './account.service';
import { PrismaService } from './prisma.service';

// 허브 공통 계정 — 커비/터비 서버가 이 모듈을 import해 identify 때 AccountService.resolveAccountId로
// 로그인 토큰을 확인한다. /account/* 라우트는 import한 서버마다 생기지만 같은 DB를 보므로 어느 서버로
// 호출해도 결과가 같다. 허브는 기본적으로 커비 서버(운영에서 HTTP 접근이 확인된 서버)로 호출한다.
@Module({
  controllers: [AccountController, InternalAuthController],
  providers: [PrismaService, AccountService],
  exports: [AccountService],
})
export class AccountModule {}
