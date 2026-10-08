import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { isSpawnActive } from '../kirby/spawnRules';

// 관리자 백오피스(2026-09-29, docs/dev/admin_backoffice.md) — 커비 훔치기 유저 조회·보유 커비 추가/삭제·골드 조정.
// 모든 변경은 같은 트랜잭션 안에서 admin_log에 전후 값을 남긴다.
const TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const SEARCH_LIMIT = 50;
const ADD_MAX_COUNT = 20;
const GOLD_MAX = 4_294_967_295; // kirby_player.gold UNSIGNED INT
const LOG_LIMIT_MAX = 200;
const WEIGHT_MAX = 1_000_000;
const UNSIGNED_INT_MAX = 4_294_967_295;

export interface SpawnChange {
  characterId: unknown;
  weight?: unknown;
  spawnEnabled?: unknown;
  spawnStartsAt?: unknown; // ISO 문자열 또는 null(제한 없음)
  spawnEndsAt?: unknown;
}

function parseDateOrNull(raw: unknown, label: string): Date | null {
  if (raw === null || raw === '') return null;
  const d = typeof raw === 'string' ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException({ message: `${label}이 올바르지 않습니다`, code: 'INVALID_DATE' });
  d.setMilliseconds(0);
  return d;
}

type Tx = Prisma.TransactionClient;

function parseId(raw: unknown, label: string): bigint {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  if (!/^\d{1,19}$/.test(s)) throw new BadRequestException({ message: `${label}가 올바르지 않습니다`, code: 'INVALID_ID' });
  return BigInt(s);
}

function parseInt32(raw: unknown, label: string): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new BadRequestException({ message: `${label}는 정수여야 합니다`, code: 'INVALID_NUMBER' });
  return n;
}

function parseRangedInt(raw: unknown, label: string, min: number, max: number): number {
  const n = parseInt32(raw, label);
  if (n < min || n > max) throw new BadRequestException({ message: `${label} 범위는 ${min}~${max}입니다`, code: 'INVALID_RANGE' });
  return n;
}

function parseBoolean(raw: unknown, label: string): boolean {
  if (typeof raw !== 'boolean') throw new BadRequestException({ message: `${label} 값이 올바르지 않습니다`, code: 'INVALID_BOOLEAN' });
  return raw;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 검색어가 숫자면 플레이어 id, 그 외에는 게임 닉네임·허브 아이디·허브 닉네임 부분 일치. 비우면 최근 가입순.
  async searchKirbyPlayers(qRaw: unknown) {
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const idMatch = /^\d{1,19}$/.test(q) ? BigInt(q) : null;
    const rows = await this.prisma.$queryRaw<
      { id: bigint; nickname: string; gold: number; created_at: Date; login_id: string | null; account_nickname: string | null; kirby_count: bigint }[]
    >`
      SELECT p.id, p.nickname, p.gold, p.created_at, a.login_id, a.nickname AS account_nickname,
             (SELECT COUNT(*) FROM kirby_instance i WHERE i.owner_player_id = p.id) AS kirby_count
      FROM kirby_player p
      LEFT JOIN account_game_player agp ON agp.game = 'kirby' AND agp.player_id = p.id
      LEFT JOIN account a ON a.id = agp.account_id
      WHERE ${q === ''}
         OR p.id = ${idMatch ?? -1}
         OR p.nickname LIKE ${like}
         OR a.login_id LIKE ${like}
         OR a.nickname LIKE ${like}
      ORDER BY p.id DESC
      LIMIT ${SEARCH_LIMIT}`;
    return rows.map((r) => ({
      playerId: r.id.toString(),
      nickname: r.nickname,
      gold: Number(r.gold),
      loginId: r.login_id,
      accountNickname: r.account_nickname,
      kirbyCount: Number(r.kirby_count),
      createdAt: r.created_at,
    }));
  }

  async getKirbyPlayer(playerIdRaw: unknown) {
    const playerId = parseId(playerIdRaw, '플레이어 id');
    const player = await this.prisma.kirby_player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException({ message: '플레이어를 찾을 수 없습니다', code: 'PLAYER_NOT_FOUND' });
    const link = await this.prisma.account_game_player.findUnique({ where: { game_player_id: { game: 'kirby', player_id: playerId } } });
    const account = link ? await this.prisma.account.findUnique({ where: { id: link.account_id } }) : null;
    const instances = await this.prisma.kirby_instance.findMany({
      where: { owner_player_id: playerId },
      include: { kirby_character: { include: { kirby_grade: true } } },
      orderBy: { id: 'asc' },
    });
    return {
      playerId: player.id.toString(),
      nickname: player.nickname,
      gold: player.gold,
      lockState: player.lock_state,
      createdAt: player.created_at,
      account: account ? { accountId: account.id.toString(), loginId: account.login_id, nickname: account.nickname } : null,
      instances: instances.map((i) => ({
        instanceId: i.id.toString(),
        characterId: i.character_id,
        code: i.kirby_character.code,
        name: i.kirby_character.name,
        grade: i.kirby_character.kirby_grade.name,
        sellPrice: i.kirby_character.kirby_grade.sell_price,
        incomePerTick: i.kirby_character.kirby_grade.income_per_tick,
        status: i.status,
        createdAt: i.created_at,
      })),
    };
  }

  async listKirbyCharacters() {
    const chars = await this.prisma.kirby_character.findMany({ include: { kirby_grade: true }, orderBy: [{ grade_id: 'asc' }, { id: 'asc' }] });
    return chars.map((c) => ({ characterId: c.id, code: c.code, name: c.name, grade: c.kirby_grade.name, gradeId: c.grade_id }));
  }

  async addKirbies(adminId: bigint, playerIdRaw: unknown, characterIdRaw: unknown, countRaw: unknown) {
    const playerId = parseId(playerIdRaw, '플레이어 id');
    const characterId = parseInt32(characterIdRaw, '캐릭터 id');
    const count = countRaw === undefined ? 1 : parseInt32(countRaw, '수량');
    if (count < 1 || count > ADD_MAX_COUNT) throw new BadRequestException({ message: `수량은 1~${ADD_MAX_COUNT}개입니다`, code: 'INVALID_COUNT' });
    await this.requirePlayer(playerId);
    const character = await this.prisma.kirby_character.findUnique({ where: { id: characterId } });
    if (!character) throw new NotFoundException({ message: '없는 캐릭터입니다', code: 'CHARACTER_NOT_FOUND' });

    await this.prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (let n = 0; n < count; n++) {
        const row = await tx.kirby_instance.create({ data: { owner_player_id: playerId, character_id: characterId } });
        created.push(row.id.toString());
      }
      await this.log(tx, adminId, 'kirby.instance.add', 'kirby_player', playerId, null, { characterId, code: character.code, count, instanceIds: created });
    }, TX_OPTIONS);
    return this.getKirbyPlayer(playerId.toString());
  }

  // 도둑맞는 중(stolen_in_transit)인 커비는 진행 중인 침입 판정이 가리키고 있어 삭제하지 않는다
  async removeKirby(adminId: bigint, playerIdRaw: unknown, instanceIdRaw: unknown) {
    const playerId = parseId(playerIdRaw, '플레이어 id');
    const instanceId = parseId(instanceIdRaw, '커비 id');
    await this.prisma.$transaction(async (tx) => {
      const instance = await tx.kirby_instance.findUnique({ where: { id: instanceId }, include: { kirby_character: true } });
      if (!instance || instance.owner_player_id !== playerId) throw new NotFoundException({ message: '이 플레이어의 커비가 아닙니다', code: 'INSTANCE_NOT_FOUND' });
      const removed = await tx.$executeRaw`DELETE FROM kirby_instance WHERE id = ${instanceId} AND owner_player_id = ${playerId} AND status = 'idle'`;
      if (removed === 0) throw new BadRequestException({ message: '도둑맞는 중인 커비는 삭제할 수 없습니다', code: 'INSTANCE_BUSY' });
      await this.log(tx, adminId, 'kirby.instance.remove', 'kirby_player', playerId, { instanceId: instanceId.toString(), characterId: instance.character_id, code: instance.kirby_character.code }, null);
    }, TX_OPTIONS);
    return this.getKirbyPlayer(playerId.toString());
  }

  // mode='set'이면 amount로 바꾸고, 'add'면 amount만큼 더한다(음수면 차감, 0 아래로는 내려가지 않음)
  async adjustGold(adminId: bigint, playerIdRaw: unknown, modeRaw: unknown, amountRaw: unknown) {
    const playerId = parseId(playerIdRaw, '플레이어 id');
    if (modeRaw !== 'set' && modeRaw !== 'add') throw new BadRequestException({ message: 'mode는 set 또는 add입니다', code: 'INVALID_MODE' });
    const amount = parseInt32(amountRaw, '금액');
    if (Math.abs(amount) > GOLD_MAX || (modeRaw === 'set' && amount < 0)) throw new BadRequestException({ message: '금액 범위를 벗어났습니다', code: 'INVALID_AMOUNT' });

    await this.prisma.$transaction(async (tx) => {
      const player = await tx.kirby_player.findUnique({ where: { id: playerId } });
      if (!player) throw new NotFoundException({ message: '플레이어를 찾을 수 없습니다', code: 'PLAYER_NOT_FOUND' });
      if (modeRaw === 'set') {
        await tx.$executeRaw`UPDATE kirby_player SET gold = ${amount} WHERE id = ${playerId}`;
      } else {
        await tx.$executeRaw`UPDATE kirby_player SET gold = LEAST(${GOLD_MAX}, GREATEST(0, CAST(gold AS SIGNED) + ${amount})) WHERE id = ${playerId}`;
      }
      const after = await tx.kirby_player.findUniqueOrThrow({ where: { id: playerId } });
      await this.log(tx, adminId, `kirby.gold.${modeRaw}`, 'kirby_player', playerId, { gold: player.gold }, { gold: after.gold, amount });
    }, TX_OPTIONS);
    return this.getKirbyPlayer(playerId.toString());
  }

  // 스폿 설정 목록 — 지금 추첨 대상(activeNow)과 그 안에서의 확률(%)을 함께 계산
  async listSpawnSettings() {
    const now = Date.now();
    const chars = await this.prisma.kirby_character.findMany({ include: { kirby_grade: true }, orderBy: [{ grade_id: 'asc' }, { id: 'asc' }] });
    const activeTotal = chars.reduce((sum, c) => sum + (isSpawnActive(c, now) ? c.weight : 0), 0);
    return chars.map((c) => {
      const activeNow = isSpawnActive(c, now);
      return {
        characterId: c.id,
        code: c.code,
        name: c.name,
        grade: c.kirby_grade.name,
        gradeId: c.grade_id,
        weight: c.weight,
        spawnEnabled: c.spawn_enabled,
        spawnStartsAt: c.spawn_starts_at,
        spawnEndsAt: c.spawn_ends_at,
        activeNow,
        probability: activeNow && activeTotal > 0 ? (c.weight / activeTotal) * 100 : 0,
      };
    });
  }

  // 여러 캐릭터의 스폿 설정을 한 트랜잭션으로 저장 — 실제로 바뀐 캐릭터만 admin_log에 전후 기록
  async updateSpawnSettings(adminId: bigint, changesRaw: unknown) {
    if (!Array.isArray(changesRaw) || changesRaw.length === 0 || changesRaw.length > 500) {
      throw new BadRequestException({ message: '변경 내용이 없습니다', code: 'NO_CHANGES' });
    }
    const changes = (changesRaw as SpawnChange[]).map((c) => {
      const characterId = parseInt32(c.characterId, '캐릭터 id');
      const data: Prisma.kirby_characterUpdateInput = {};
      if (c.weight !== undefined) {
        const w = parseInt32(c.weight, '가중치');
        if (w < 0 || w > WEIGHT_MAX) throw new BadRequestException({ message: `가중치는 0~${WEIGHT_MAX}입니다`, code: 'INVALID_WEIGHT' });
        data.weight = w;
      }
      if (c.spawnEnabled !== undefined) {
        if (typeof c.spawnEnabled !== 'boolean') throw new BadRequestException({ message: '등장 여부가 올바르지 않습니다', code: 'INVALID_ENABLED' });
        data.spawn_enabled = c.spawnEnabled;
      }
      if (c.spawnStartsAt !== undefined) data.spawn_starts_at = parseDateOrNull(c.spawnStartsAt, '시작 시각');
      if (c.spawnEndsAt !== undefined) data.spawn_ends_at = parseDateOrNull(c.spawnEndsAt, '종료 시각');
      return { characterId, data };
    });

    await this.prisma.$transaction(async (tx) => {
      for (const { characterId, data } of changes) {
        const before = await tx.kirby_character.findUnique({ where: { id: characterId } });
        if (!before) throw new NotFoundException({ message: `없는 캐릭터입니다 (#${characterId})`, code: 'CHARACTER_NOT_FOUND' });
        const starts = data.spawn_starts_at !== undefined ? (data.spawn_starts_at as Date | null) : before.spawn_starts_at;
        const ends = data.spawn_ends_at !== undefined ? (data.spawn_ends_at as Date | null) : before.spawn_ends_at;
        if (starts && ends && starts.getTime() >= ends.getTime()) {
          throw new BadRequestException({ message: `[${before.name}] 종료 시각이 시작 시각보다 늦어야 합니다`, code: 'INVALID_PERIOD' });
        }
        const after = await tx.kirby_character.update({ where: { id: characterId }, data });
        const pick = (c: typeof before) => ({ weight: c.weight, spawnEnabled: c.spawn_enabled, spawnStartsAt: c.spawn_starts_at, spawnEndsAt: c.spawn_ends_at });
        const b = pick(before);
        const a = pick(after);
        if (JSON.stringify(b) === JSON.stringify(a)) continue;
        await this.log(tx, adminId, 'kirby.spawn.update', 'kirby_character', BigInt(characterId), { code: before.code, ...b }, a);
      }
    }, TX_OPTIONS);
    return this.listSpawnSettings();
  }

  async searchMergeDefenseAccounts(qRaw: unknown) {
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const idMatch = /^\d{1,19}$/.test(q) ? BigInt(q) : null;
    const rows = await this.prisma.$queryRaw<{
      id: bigint; login_id: string; nickname: string; silver: number | null; warrior_unlocked: number | null;
      archer_unlocked: number | null; spellblade_unlocked: number | null; spellblade_recipe_unlocked: boolean | null; attack_level: number | null;
      start_coin_level: number | null; summon_discount_level: number | null; highest_cleared_stage: number | null; updated_at: Date | null;
    }[]>`
      SELECT a.id, a.login_id, a.nickname,
             p.silver, p.warrior_unlocked, p.archer_unlocked, p.spellblade_unlocked, p.spellblade_recipe_unlocked,
             p.attack_level, p.start_coin_level, p.summon_discount_level,
             p.highest_cleared_stage, p.updated_at
      FROM account a
      LEFT JOIN merge_defense_profile p ON p.account_id = a.id
      WHERE ${q === ''}
         OR a.id = ${idMatch ?? -1}
         OR a.login_id LIKE ${like}
         OR a.nickname LIKE ${like}
      ORDER BY COALESCE(p.updated_at, a.updated_at) DESC
      LIMIT ${SEARCH_LIMIT}`;
    return rows.map((row) => this.mergeDefenseAdminSummary(row));
  }

  async getMergeDefenseProfile(accountIdRaw: unknown) {
    const accountId = parseId(accountIdRaw, '계정 id');
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException({ message: '계정을 찾을 수 없습니다', code: 'ACCOUNT_NOT_FOUND' });
    const profile = await this.prisma.merge_defense_profile.findUnique({ where: { account_id: accountId } });
    return this.mergeDefenseAdminSummary({
      id: account.id, login_id: account.login_id, nickname: account.nickname,
      silver: profile?.silver ?? null,
      warrior_unlocked: profile?.warrior_unlocked ?? null,
      archer_unlocked: profile?.archer_unlocked ?? null,
      spellblade_unlocked: profile?.spellblade_unlocked ?? null,
      spellblade_recipe_unlocked: profile?.spellblade_recipe_unlocked ?? null,
      attack_level: profile?.attack_level ?? null,
      start_coin_level: profile?.start_coin_level ?? null,
      summon_discount_level: profile?.summon_discount_level ?? null,
      highest_cleared_stage: profile?.highest_cleared_stage ?? null,
      updated_at: profile?.updated_at ?? null,
    });
  }

  async updateMergeDefenseProfile(adminId: bigint, accountIdRaw: unknown, bodyRaw: unknown) {
    const accountId = parseId(accountIdRaw, '계정 id');
    const body = bodyRaw && typeof bodyRaw === 'object' ? bodyRaw as Record<string, unknown> : {};
    const data = {
      silver: parseRangedInt(body.silver, '은화', 0, UNSIGNED_INT_MAX),
      warrior_unlocked: parseRangedInt(body.warriorUnlocked, '검사 도감', 1, 10),
      archer_unlocked: parseRangedInt(body.archerUnlocked, '궁수 도감', 1, 10),
      spellblade_unlocked: parseRangedInt(body.spellbladeUnlocked, '마검사 도감', 0, 10),
      spellblade_recipe_unlocked: parseBoolean(body.spellbladeRecipeUnlocked, '마검사 합성법'),
      attack_level: parseRangedInt(body.attackLevel, '전체 공격력 강화', 0, 8),
      start_coin_level: parseRangedInt(body.startCoinLevel, '시작 코인 강화', 0, 5),
      summon_discount_level: parseRangedInt(body.summonDiscountLevel, '소환 할인 강화', 0, 5),
      highest_cleared_stage: parseRangedInt(body.highestClearedStage, '최고 클리어 스테이지', 0, 50),
    };
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException({ message: '계정을 찾을 수 없습니다', code: 'ACCOUNT_NOT_FOUND' });

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.merge_defense_profile.findUnique({ where: { account_id: accountId } });
      const after = await tx.merge_defense_profile.upsert({
        where: { account_id: accountId },
        create: { account_id: accountId, ...data },
        update: data,
      });
      const pick = (profile: typeof after | null) => profile ? {
        silver: profile.silver,
        warriorUnlocked: profile.warrior_unlocked,
        archerUnlocked: profile.archer_unlocked,
        spellbladeUnlocked: profile.spellblade_unlocked,
        spellbladeRecipeUnlocked: profile.spellblade_recipe_unlocked,
        attackLevel: profile.attack_level,
        startCoinLevel: profile.start_coin_level,
        summonDiscountLevel: profile.summon_discount_level,
        highestClearedStage: profile.highest_cleared_stage,
      } : null;
      await this.log(tx, adminId, 'merge_defense.profile.update', 'account', accountId, pick(before), pick(after));
    }, TX_OPTIONS);
    return this.getMergeDefenseProfile(accountId.toString());
  }

  async listLogs(limitRaw: unknown, targetIdRaw: unknown) {
    const limit = Math.min(LOG_LIMIT_MAX, Math.max(1, Number(limitRaw) || 50));
    const targetId = typeof targetIdRaw === 'string' && targetIdRaw.trim() ? targetIdRaw.trim() : undefined;
    const logs = await this.prisma.admin_log.findMany({
      where: targetId ? { target_id: targetId } : undefined,
      orderBy: { id: 'desc' },
      take: limit,
    });
    const adminIds = [...new Set(logs.map((l) => l.admin_account_id))];
    const admins = await this.prisma.account.findMany({ where: { id: { in: adminIds } }, select: { id: true, login_id: true } });
    const loginById = new Map(admins.map((a) => [a.id.toString(), a.login_id]));
    return logs.map((l) => ({
      id: l.id.toString(),
      admin: loginById.get(l.admin_account_id.toString()) ?? `#${l.admin_account_id}`,
      action: l.action,
      targetType: l.target_type,
      targetId: l.target_id,
      before: l.before_json ? JSON.parse(l.before_json) : null,
      after: l.after_json ? JSON.parse(l.after_json) : null,
      createdAt: l.created_at,
    }));
  }

  private async requirePlayer(playerId: bigint) {
    const player = await this.prisma.kirby_player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException({ message: '플레이어를 찾을 수 없습니다', code: 'PLAYER_NOT_FOUND' });
    return player;
  }

  private mergeDefenseAdminSummary(row: {
    id: bigint; login_id: string; nickname: string; silver: number | null; warrior_unlocked: number | null;
    archer_unlocked: number | null; spellblade_unlocked: number | null; spellblade_recipe_unlocked?: boolean | null;
    attack_level: number | null; start_coin_level: number | null; summon_discount_level: number | null;
    highest_cleared_stage: number | null; updated_at: Date | null;
  }) {
    const warriorUnlocked = Number(row.warrior_unlocked ?? 1);
    const archerUnlocked = Number(row.archer_unlocked ?? 1);
    const spellbladeUnlocked = Number(row.spellblade_unlocked ?? 0);
    const highestClearedStage = Number(row.highest_cleared_stage ?? 0);
    return {
      accountId: row.id.toString(),
      loginId: row.login_id,
      nickname: row.nickname,
      silver: Number(row.silver ?? 0),
      warriorUnlocked,
      archerUnlocked,
      spellbladeUnlocked,
      spellbladeRecipeUnlocked: Boolean(row.spellblade_recipe_unlocked ?? false),
      collectionUnlocked: warriorUnlocked + archerUnlocked + spellbladeUnlocked,
      collectionTotal: 30,
      attackLevel: Number(row.attack_level ?? 0),
      startCoinLevel: Number(row.start_coin_level ?? 0),
      summonDiscountLevel: Number(row.summon_discount_level ?? 0),
      highestClearedStage,
      highestClearedChapter: highestClearedStage === 0 ? 0 : Math.floor((highestClearedStage - 1) / 10) + 1,
      highestClearedChapterStage: highestClearedStage === 0 ? 0 : ((highestClearedStage - 1) % 10) + 1,
      updatedAt: row.updated_at,
    };
  }

  private async log(tx: Tx, adminId: bigint, action: string, targetType: string, targetId: bigint, before: unknown, after: unknown) {
    await tx.admin_log.create({
      data: {
        admin_account_id: adminId,
        action,
        target_type: targetType,
        target_id: targetId.toString(),
        before_json: before === null ? null : JSON.stringify(before),
        after_json: after === null ? null : JSON.stringify(after),
      },
    });
  }
}
