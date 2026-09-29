import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountService } from '../account/account.service';

export interface AdminRequest {
  headers: Record<string, string | undefined>;
  adminAccountId?: bigint;
}

// 관리자 백오피스(2026-09-29) — 모든 /admin/* 요청은 허브 로그인 토큰(Authorization: Bearer)의 계정이
// role='admin'일 때만 통과. 허브의 [관리자] 버튼은 표시용일 뿐이고 실제 권한 확인은 여기서만 한다.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly accounts: AccountService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ message: '로그인이 필요합니다', code: 'NOT_LOGGED_IN' });
    const adminId = await this.accounts.resolveAdminId(token);
    if (!adminId) throw new ForbiddenException({ message: '관리자 권한이 없습니다', code: 'NOT_ADMIN' });
    req.adminAccountId = adminId;
    return true;
  }
}
