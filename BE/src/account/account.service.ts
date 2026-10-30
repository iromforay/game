import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { PrismaService } from './prisma.service';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// 허브 공통 계정(2026-09-28 사용자 결정) — 아이디+비밀번호, 목적은 브라우저/기기 통합.
// 비밀번호 찾기·이메일 인증·닉네임은 1차 범위에서 제외(단순 구조).
const LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const KEY_LEN = 64;
const NICKNAME_MAX = 12;
const ACCESS_TOKEN_TTL_SECONDS = positiveInt(process.env.HUB_ACCESS_TOKEN_TTL_SECONDS, 60 * 60);
const REFRESH_TOKEN_TTL_SECONDS = positiveInt(process.env.HUB_REFRESH_TOKEN_TTL_SECONDS, 14 * 24 * 60 * 60);

export interface IssuedAccountSession {
  token: string;
  loginId: string;
  nickname: string;
  accessToken?: string;
  refreshToken?: string;
}

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

export type AccountGame = 'kirby' | 'turby';

// 로그인 상태에서 게임 identify가 받는 결과 — playerId가 null이면 "이 계정 전용 게임 플레이어를 새로 만들어 attachNewPlayer로 연결"
export interface AccountGameBinding {
  accountId: bigint;
  nickname: string;
  playerId: bigint | null;
  linkedThisDevice: boolean; // 이 기기의 게스트 플레이어가 계정에 연결됨 → 로그아웃 시 FE가 device_uuid를 새로 만들어야 함
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async register(loginIdRaw: unknown, password: unknown, nicknameRaw: unknown) {
    const loginId = this.normalizeLoginId(loginIdRaw);
    if (!LOGIN_ID_RE.test(loginId)) {
      throw new BadRequestException({ message: '아이디는 영문 소문자·숫자·밑줄 4~20자입니다', code: 'INVALID_LOGIN_ID' });
    }
    this.assertPassword(password);
    // 닉네임을 비우면 아이디를 쓰되, 아이디(최대 20자)가 닉네임 제한(12자)보다 길 수 있어 앞부분만 사용
    const nickname = typeof nicknameRaw === 'string' && nicknameRaw.trim() ? nicknameRaw.trim() : loginId.slice(0, NICKNAME_MAX);
    if ([...nickname].length > NICKNAME_MAX) {
      throw new BadRequestException({ message: `닉네임은 ${NICKNAME_MAX}자 이하입니다`, code: 'INVALID_NICKNAME' });
    }
    const exists = await this.prisma.account.findUnique({ where: { login_id: loginId } });
    if (exists) throw new ConflictException({ message: '이미 사용 중인 아이디입니다', code: 'LOGIN_ID_TAKEN' });

    const salt = randomBytes(16);
    const hash = await scrypt(password as string, salt, KEY_LEN);
    try {
      const account = await this.prisma.account.create({
        data: { login_id: loginId, nickname, password_hash: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}` },
      });
      return this.issueSession(account.id, account.login_id, account.nickname);
    } catch (err) {
      // 동시에 같은 아이디로 가입한 경우 유니크 인덱스에서 걸림
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException({ message: '이미 사용 중인 아이디입니다', code: 'LOGIN_ID_TAKEN' });
      throw err;
    }
  }

  async login(loginIdRaw: unknown, password: unknown) {
    const account = await this.authenticate(loginIdRaw, password);
    return this.issueSession(account.id, account.login_id, account.nickname);
  }

  // 거래소 BE 전용 로그인: 허브의 기존 Bearer 세션은 만들지 않고 SSO 토큰만 발급한다.
  async loginForSso(loginIdRaw: unknown, password: unknown) {
    const account = await this.authenticate(loginIdRaw, password);
    const tokens = await this.issueSsoTokens(account.id, account.nickname);
    return {
      tokenType: 'Bearer',
      accessToken: tokens.accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: tokens.refreshToken,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    };
  }

  async logout(token: string | undefined) {
    if (token) await this.prisma.account_session.deleteMany({ where: { token_hash: hashToken(token) } });
    return { ok: true };
  }

  async revokeRefreshToken(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.account_refresh_token.updateMany({
      where: { token_hash: hashToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async refreshAccessToken(refreshToken: unknown) {
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new UnauthorizedException({ message: '다시 로그인해 주세요', code: 'UNAUTHENTICATED' });
    }
    const stored = await this.prisma.account_refresh_token.findUnique({ where: { token_hash: hashToken(refreshToken) } });
    if (!stored || stored.revoked_at || stored.expires_at <= new Date()) {
      throw new UnauthorizedException({ message: '다시 로그인해 주세요', code: 'UNAUTHENTICATED' });
    }
    const account = await this.prisma.account.findUnique({ where: { id: stored.account_id } });
    if (!account) throw new UnauthorizedException({ message: '다시 로그인해 주세요', code: 'UNAUTHENTICATED' });
    return { accessToken: this.signAccessToken(account.id, account.nickname), expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async me(token: string | undefined) {
    const account = await this.findAccountByToken(token);
    if (!account) throw new UnauthorizedException({ message: '로그인이 필요합니다', code: 'NOT_LOGGED_IN' });
    return { loginId: account.login_id, nickname: account.nickname, isAdmin: account.role === 'admin' };
  }

  // 관리자 백오피스(2026-09-29) — 토큰의 계정이 role='admin'이면 계정 id, 아니면 null
  async resolveAdminId(token: string | undefined): Promise<bigint | null> {
    const account = await this.findAccountByToken(token);
    return account?.role === 'admin' ? account.id : null;
  }

  // 게임 서버(커비/터비)의 identify에서 사용 — 토큰이 없거나 무효면 null(게스트로 처리)
  async resolveAccountId(token: unknown): Promise<bigint | null> {
    if (typeof token !== 'string' || token.length === 0) return null;
    const session = await this.prisma.account_session.findUnique({ where: { token_hash: hashToken(token) } });
    return session?.account_id ?? null;
  }

  // 게임 서버 identify용 — 브리지(account_game_player)로 이 계정의 게임 플레이어를 찾는다. 게임 테이블은 건드리지 않음.
  // 연결이 없으면 지금 기기의 게스트 플레이어(guestPlayerId)를 연결(사용자 결정: 계정에 없을 때만 이어받기).
  // 그 게스트가 이미 다른 계정에 연결돼 있으면 playerId=null을 돌려줘 게임 서버가 새 플레이어를 만들게 한다.
  async bindGamePlayer(token: unknown, game: AccountGame, guestPlayerId: bigint): Promise<AccountGameBinding | null> {
    const accountId = await this.resolveAccountId(token);
    if (!accountId) return null;
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) return null;
    const base = { accountId, nickname: account.nickname };

    const existing = await this.prisma.account_game_player.findUnique({ where: { account_id_game: { account_id: accountId, game } } });
    if (existing) return { ...base, playerId: existing.player_id, linkedThisDevice: existing.player_id === guestPlayerId };

    const guestOwner = await this.prisma.account_game_player.findUnique({ where: { game_player_id: { game, player_id: guestPlayerId } } });
    if (guestOwner) return { ...base, playerId: null, linkedThisDevice: false };

    try {
      await this.prisma.account_game_player.create({ data: { account_id: accountId, game, player_id: guestPlayerId } });
      return { ...base, playerId: guestPlayerId, linkedThisDevice: true };
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      // 같은 계정이 두 기기에서 동시에 처음 들어온 경우 — 먼저 연결된 쪽을 사용
      const winner = await this.prisma.account_game_player.findUnique({ where: { account_id_game: { account_id: accountId, game } } });
      if (winner) return { ...base, playerId: winner.player_id, linkedThisDevice: winner.player_id === guestPlayerId };
      return { ...base, playerId: null, linkedThisDevice: false };
    }
  }

  // bindGamePlayer가 playerId=null을 돌려줬을 때 게임 서버가 새로 만든 플레이어를 계정에 연결
  async attachNewPlayer(accountId: bigint, game: AccountGame, playerId: bigint) {
    await this.prisma.account_game_player.create({ data: { account_id: accountId, game, player_id: playerId } });
  }

  private async findAccountByToken(token: string | undefined) {
    const accountId = await this.resolveAccountId(token);
    return accountId ? this.prisma.account.findUnique({ where: { id: accountId } }) : null;
  }

  private async issueSession(accountId: bigint, loginId: string, nickname: string): Promise<IssuedAccountSession> {
    this.jwtSecret();
    const token = randomBytes(32).toString('hex');
    await this.prisma.account_session.create({ data: { token_hash: hashToken(token), account_id: accountId } });
    const sso = await this.issueSsoTokens(accountId, nickname);
    return { token, loginId, nickname, ...sso };
  }

  private async issueSsoTokens(accountId: bigint, nickname: string) {
    this.jwtSecret();
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.account_refresh_token.create({
      data: {
        token_hash: hashToken(refreshToken),
        account_id: accountId,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { accessToken: this.signAccessToken(accountId, nickname), refreshToken };
  }

  private signAccessToken(accountId: bigint, nickname: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({
      iss: 'game-hub',
      aud: 'myplaymarket',
      sub: accountId.toString(),
      nickname,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
    }));
    const unsigned = `${header}.${payload}`;
    const signature = createHmac('sha256', this.jwtSecret()).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  private jwtSecret() {
    const secret = process.env.HUB_JWT_SECRET;
    if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new Error('HUB_JWT_SECRET must be at least 32 bytes for hub SSO');
    }
    return secret;
  }

  private normalizeLoginId(raw: unknown) {
    return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  }

  private async authenticate(loginIdRaw: unknown, password: unknown) {
    const loginId = this.normalizeLoginId(loginIdRaw);
    const account = typeof password === 'string' ? await this.prisma.account.findUnique({ where: { login_id: loginId } }) : null;
    if (!account || !(await this.verifyPassword(password as string, account.password_hash))) {
      throw new UnauthorizedException({ message: '아이디 또는 비밀번호가 올바르지 않습니다', code: 'INVALID_CREDENTIALS' });
    }
    return account;
  }

  private assertPassword(password: unknown) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new BadRequestException({ message: `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자입니다`, code: 'INVALID_PASSWORD' });
    }
  }

  private async verifyPassword(password: string, stored: string) {
    const [algo, saltHex, hashHex] = stored.split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
