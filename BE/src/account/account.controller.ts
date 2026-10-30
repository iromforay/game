import { Body, Controller, ForbiddenException, Get, Headers, Post, Req, Res } from '@nestjs/common';
import { AccountService, IssuedAccountSession } from './account.service';

interface HubRequest {
  headers: { cookie?: string };
}

interface HubResponse {
  cookie(name: string, value: string, options: ReturnType<typeof cookieOptions>): void;
  clearCookie(name: string, options: ReturnType<typeof cookieOptions>): void;
}

// 로그인 토큰은 Authorization: Bearer <token> 헤더로 받는다(허브 FE가 localStorage에 보관).
function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}


const ACCESS_COOKIE = 'BOMUL_HUB_TOKEN';
const REFRESH_COOKIE = 'BOMUL_HUB_REFRESH';
const ACCESS_MAX_AGE_MS = positiveInt(process.env.HUB_ACCESS_TOKEN_TTL_SECONDS, 60 * 60) * 1000;
const REFRESH_MAX_AGE_MS = positiveInt(process.env.HUB_REFRESH_TOKEN_TTL_SECONDS, 14 * 24 * 60 * 60) * 1000;

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function cookieOptions(maxAge?: number, httpOnly = true) {
  const production = process.env.NODE_ENV === 'production';
  return {
    domain: process.env.HUB_COOKIE_DOMAIN || (production ? '.bomul.ai.kr' : undefined),
    path: '/',
    httpOnly,
    secure: production,
    sameSite: 'lax' as const,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

function cookie(req: HubRequest, name: string) {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

function setSsoCookies(res: HubResponse, session: IssuedAccountSession) {
  if (session.accessToken) res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(ACCESS_MAX_AGE_MS, false));
  if (session.refreshToken) res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(REFRESH_MAX_AGE_MS));
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...body } = session;
  return body;
}

@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post('register')
  async register(@Res({ passthrough: true }) res: HubResponse, @Body('loginId') loginId: unknown, @Body('password') password: unknown, @Body('nickname') nickname: unknown) {
    return setSsoCookies(res, await this.accounts.register(loginId, password, nickname));
  }

  @Post('login')
  async login(@Res({ passthrough: true }) res: HubResponse, @Body('loginId') loginId: unknown, @Body('password') password: unknown) {
    return setSsoCookies(res, await this.accounts.login(loginId, password));
  }

  @Post('logout')
  async logout(@Req() req: HubRequest, @Res({ passthrough: true }) res: HubResponse, @Headers('authorization') auth?: string) {
    await Promise.all([
      this.accounts.logout(bearer(auth)),
      this.accounts.revokeRefreshToken(cookie(req, REFRESH_COOKIE)),
    ]);
    res.clearCookie(ACCESS_COOKIE, cookieOptions(undefined, false));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    return { ok: true };
  }

  @Get('me')
  me(@Headers('authorization') auth?: string) {
    return this.accounts.me(bearer(auth));
  }

}


@Controller('internal/auth')
export class InternalAuthController {
  constructor(private readonly accounts: AccountService) {}

  @Post('refresh')
  async refresh(@Headers('x-api-key') apiKey: string | undefined, @Body('refreshToken') refreshToken: unknown) {
    this.assertApiKey(apiKey);
    return this.accounts.refreshAccessToken(refreshToken);
  }

  @Post('login')
  async login(
    @Headers('x-api-key') apiKey: string | undefined,
    @Body('loginId') loginId: unknown,
    @Body('password') password: unknown,
  ) {
    this.assertApiKey(apiKey);
    return this.accounts.loginForSso(loginId, password);
  }

  private assertApiKey(apiKey: string | undefined) {
    const expected = process.env.HUB_INTERNAL_API_KEY;
    if (!expected || !apiKey || apiKey !== expected) {
      throw new ForbiddenException({ message: '허용되지 않은 요청입니다', code: 'FORBIDDEN' });
    }
  }
}
