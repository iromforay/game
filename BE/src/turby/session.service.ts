import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { SettingsService } from './rooms/settings.service';
import { gameError } from './turby-dto';

export const SESSION_HEADER = 'x-turby-session';

// 스토리 M1: URL의 playerId를 믿지 않고 identify()가 발급한 세션 토큰으로 플레이어를 정한다(커비와 같은 방식).
// 한계: deviceUuid를 아는 사람은 identify로 토큰을 받을 수 있다. 토큰은 "번호만 바꿔 남의 계정 조작"을 막는다(m0_design 4.1).
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // 이미 있으면 그대로 돌려준다(여러 탭·재접속이 서로의 토큰을 무효화하지 않도록).
  // 최초 발급이 동시에 두 번 오면 session_token IS NULL 조건부 갱신으로 한 요청만 기록하고,
  // 진 요청은 DB에 실제 저장된 토큰을 다시 읽어 돌려준다(두 응답이 같은 토큰).
  async ensureToken(playerId: bigint, current: string | null): Promise<string> {
    if (current) return current;
    const token = randomUUID();
    const won = await this.prisma.player.updateMany({ where: { id: playerId, session_token: null }, data: { session_token: token } });
    if (won.count === 1) return token;
    const stored = await this.prisma.player.findUnique({ where: { id: playerId }, select: { session_token: true } });
    if (!stored?.session_token) throw gameError(500, 'SESSION_ISSUE_FAILED', '접속 정보를 만들지 못했습니다. 다시 시도해 주세요.');
    return stored.session_token;
  }

  // /player/me/* — 토큰 필수
  async require(token: unknown): Promise<bigint> {
    if (typeof token !== 'string' || token.length === 0) throw gameError(401, 'SESSION_REQUIRED', '접속 정보가 없습니다. 다시 시작해 주세요.');
    const playerId = await this.resolve(token);
    if (playerId === null) throw gameError(401, 'SESSION_INVALID', '접속 정보가 만료되었습니다. 다시 시작해 주세요.');
    return playerId;
  }

  // 구 경로 /player/:playerId/* — 전환 기간: 토큰이 오면 반드시 같은 플레이어여야 하고,
  // 없으면 auth.requireSession 설정이 켜졌을 때만 거부한다(m0_design 7.2 1~4단계)
  async checkLegacy(playerIdParam: string, token: unknown): Promise<void> {
    if (typeof token === 'string' && token.length > 0) {
      const playerId = await this.resolve(token);
      if (playerId === null) throw gameError(401, 'SESSION_INVALID', '접속 정보가 만료되었습니다. 다시 시작해 주세요.');
      if (playerId.toString() !== playerIdParam) throw gameError(403, 'SESSION_PLAYER_MISMATCH', '다른 플레이어의 요청입니다.');
      return;
    }
    if (this.settings.flag('auth.requireSession', false)) throw gameError(401, 'SESSION_REQUIRED', '접속 정보가 없습니다. 다시 시작해 주세요.');
  }

  // 소켓 hello: deviceUuid로 찾은 플레이어와 토큰이 같은지(토큰이 없으면 설정에 따름)
  socketTokenOk(storedToken: string | null, token: unknown): boolean {
    if (typeof token === 'string' && token.length > 0) return storedToken !== null && storedToken === token;
    return !this.settings.flag('auth.requireSession', false);
  }

  private async resolve(token: string): Promise<bigint | null> {
    if (token.length < 8 || token.length > 64) return null;
    const player = await this.prisma.player.findUnique({ where: { session_token: token } });
    return player ? player.id : null;
  }
}
