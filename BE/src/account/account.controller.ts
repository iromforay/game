import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AccountService } from './account.service';

// 로그인 토큰은 Authorization: Bearer <token> 헤더로 받는다(허브 FE가 localStorage에 보관).
function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post('register')
  register(@Body('loginId') loginId: unknown, @Body('password') password: unknown, @Body('nickname') nickname: unknown) {
    return this.accounts.register(loginId, password, nickname);
  }

  @Post('login')
  login(@Body('loginId') loginId: unknown, @Body('password') password: unknown) {
    return this.accounts.login(loginId, password);
  }

  @Post('logout')
  logout(@Headers('authorization') auth?: string) {
    return this.accounts.logout(bearer(auth));
  }

  @Get('me')
  me(@Headers('authorization') auth?: string) {
    return this.accounts.me(bearer(auth));
  }
}
