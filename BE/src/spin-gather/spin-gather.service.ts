import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { PrismaService } from '../scoreboard/prisma.service';

const GUEST_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

@Injectable()
export class SpinGatherService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: AccountService) {}

  private async identity(token?: string, guestRaw?: string) {
    const accountId = await this.accounts.resolveAccountId(token);
    const guestId = typeof guestRaw === 'string' && GUEST_PATTERN.test(guestRaw) ? guestRaw : undefined;
    if (!accountId && !guestId) throw new UnauthorizedException({ code: 'IDENTITY_REQUIRED', message: '로그인 또는 게스트 식별자가 필요합니다.' });
    if (accountId) {
      let profile = await this.prisma.spin_gather_profile.findUnique({ where: { account_id: accountId } });
      if (!profile && guestId) {
        const guest = await this.prisma.spin_gather_profile.findUnique({ where: { guest_id: guestId } });
        if (guest && !guest.account_id) profile = await this.prisma.spin_gather_profile.update({ where: { profile_id: guest.profile_id }, data: { account_id: accountId } });
      }
      return { accountId, guestId, profile };
    }
    return { accountId: null, guestId: guestId!, profile: await this.prisma.spin_gather_profile.findUnique({ where: { guest_id: guestId! } }) };
  }

  async getProfile(token?: string, guestId?: string) {
    const identity = await this.identity(token, guestId);
    if (!identity.profile) return { profile: null, revision: 0, schemaVersion: 1 };
    return { profile: JSON.parse(identity.profile.state_json), revision: identity.profile.revision, schemaVersion: identity.profile.schema_version, updatedAt: identity.profile.updated_at };
  }

  async saveProfile(token: string | undefined, guestId: string | undefined, body: Record<string, unknown>) {
    const identity = await this.identity(token, guestId);
    const state = body.profile;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new BadRequestException({ code: 'INVALID_PROFILE', message: '저장 데이터 형식이 올바르지 않습니다.' });
    const serialized = JSON.stringify(state);
    if (serialized.length > 100_000) throw new BadRequestException({ code: 'PROFILE_TOO_LARGE', message: '저장 데이터가 너무 큽니다.' });
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 0) throw new BadRequestException({ code: 'INVALID_REVISION', message: 'revision 값이 올바르지 않습니다.' });
    if (identity.profile && revision !== identity.profile.revision) throw new ConflictException({ code: 'REVISION_CONFLICT', message: '다른 저장 데이터가 먼저 반영되었습니다.', revision: identity.profile.revision });
    const nextRevision = revision + 1;
    const data = { state_json: serialized, revision: nextRevision, schema_version: 1 };
    const profile = identity.profile
      ? await this.prisma.spin_gather_profile.update({ where: { profile_id: identity.profile.profile_id }, data })
      : await this.prisma.spin_gather_profile.create({ data: { ...data, account_id: identity.accountId, guest_id: identity.guestId } });
    return { ok: true, revision: profile.revision, updatedAt: profile.updated_at };
  }
}
