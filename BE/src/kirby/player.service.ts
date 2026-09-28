import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { BaseAccessState, LockState } from './baseAccess';
import { AccountService } from '../account/account.service';

// 계정 전용으로 새로 만든 커비 플레이어의 device_uuid 값(account:<accountId>) — 게스트 device_uuid로는 쓸 수 없음
const ACCOUNT_DEVICE_PREFIX = 'account:';

// 2.1 확정: 시작 자금
const STARTING_GOLD = 100;

// 2026-09-17 확정(docs/to_codex.md 7절): 기지 보관 용량 = 층당 4개 × 3층
const MAX_KIRBY_CAPACITY = 12;

// 동시성(2026-09-28, 운영 로그 MariaDB 1020 "Record has changed since last read"): 통합 로그인으로 한 플레이어를
// 여러 기기가 쓰면서 자동 수익·구매·판매가 같은 행을 동시에 건드림. 골드를 움직이는 트랜잭션은 모두
// "조건이 맞는 행만 수정하고, 실제로 수정된 만큼만 골드를 반영"하는 방식 + READ COMMITTED(스냅샷 충돌 에러 없음)로 처리.
// 조건부 수정은 원시 SQL로 한 문장에 한다 — relationMode="prisma"에서는 updateMany/deleteMany가 "조회 후 id로 수정"
// 두 단계로 실행돼 수정 시점에 조건이 다시 확인되지 않음(동시성 테스트에서 자동 수익 이중 지급으로 확인).
const TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };

// 2026-09-18 요청: 초당 발생 재화 — 오프라인 방치 악용 방지용 최대 정산 구간(24시간)
const MAX_COLLECT_SECONDS = 24 * 60 * 60;

// 사용자 지적(2026-09-28): 좌대에 보이는 캐릭터(FE가 뽑음)와 실제 구매된 캐릭터(서버가 다시 뽑음)가
// 달랐음 — 좌대 캐릭터를 서버가 뽑아 "판매권(offer)"으로 내려주고 그 판매권으로만 구매하게 한다.
// 좌대 수·수명은 FE LobbyScene(SPOT_POS 4개, SPOT_LIFETIME_MS 7000)과 맞춤. 수명 안에는 같은 좌대를
// 다시 요청해도 같은 판매권을 돌려줘서 요청 반복으로 희귀 캐릭터를 낚는 것을 막는다.
const MARKET_SLOTS = 4;
const OFFER_TTL_MS = 7500;
const OFFER_BUY_GRACE_MS = 1500; // 좌대가 사라지기 직전 누른 구매의 네트워크 지연 여유

interface MarketOffer {
  offerId: string;
  slot: number;
  characterId: number;
  code: string;
  price: number;
  expiresAt: number;
  used: boolean;
}

type CharacterRow = { id: number; code: string; name: string; grade_id: number; image_key: string | null };
type GradeRow = { income_per_tick: number };
type InstanceRow = {
  id: bigint;
  status: string;
  last_collected_at?: Date;
  kirby_character: CharacterRow & { kirby_grade?: GradeRow };
};

@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountService,
  ) {}

  // playerId -> offerId -> 판매권. 단일 프로세스(kirby-be 1개) 메모리 보관 — 재시작 시 사라져도
  // FE가 좌대 재스폰 때 새로 받아가므로 영향 없음.
  private offers = new Map<string, Map<string, MarketOffer>>();

  // 8번 스키마 패턴 재사용: device_uuid로 플레이어를 식별(없으면 새로 생성) — 기존 운영 그대로.
  // 허브 공통 계정(2026-09-28): 로그인 토큰이 오면 브리지(account_game_player)가 가리키는 플레이어로 바꿔 쓴다.
  // 게임 테이블 구조는 바꾸지 않고, 계정 닉네임만 이 게임 플레이어의 nickname에 맞춰 둔다.
  // Codex QA 지적(2026-09-18) 반영: identify() 때 세션 토큰을 발급/보장하고, 이 응답에만 담아
  // 돌려준다 — getPlayerState() 등 다른 조회 API는 토큰을 노출하지 않는다(타인이 훔쳐볼 수 있는 경로라서).
  async identify(deviceUuid: string, authToken?: string) {
    // 계정 전용으로 만든 플레이어의 device_uuid(account:<id>)를 게스트가 보내 남의 계정 데이터로 들어오는 것을 차단
    if (typeof deviceUuid !== 'string' || deviceUuid.length === 0 || deviceUuid.length > 64 || deviceUuid.startsWith(ACCOUNT_DEVICE_PREFIX)) {
      throw new BadRequestException('invalid deviceUuid');
    }
    const guest = await this.prisma.kirby_player.upsert({
      where: { device_uuid: deviceUuid },
      update: {},
      create: { device_uuid: deviceUuid, nickname: '도둑', gold: STARTING_GOLD, session_token: randomUUID() },
    });

    let player = guest;
    const binding = await this.accounts.bindGamePlayer(authToken, 'kirby', guest.id);
    if (binding) {
      if (binding.playerId === null) {
        // 이 기기의 게스트가 이미 다른 계정 소유 — 이 계정 전용 플레이어를 새로 만든다
        player = await this.prisma.kirby_player.upsert({
          where: { device_uuid: `${ACCOUNT_DEVICE_PREFIX}${binding.accountId}` },
          update: {},
          create: { device_uuid: `${ACCOUNT_DEVICE_PREFIX}${binding.accountId}`, nickname: binding.nickname, gold: STARTING_GOLD, session_token: randomUUID() },
        });
        await this.accounts.attachNewPlayer(binding.accountId, 'kirby', player.id);
      } else if (binding.playerId !== guest.id) {
        player = await this.requirePlayerById(binding.playerId);
      }
      if (player.nickname !== binding.nickname) {
        player = await this.prisma.kirby_player.update({ where: { id: player.id }, data: { nickname: binding.nickname } });
      }
    }

    if (!player.session_token) {
      player = await this.prisma.kirby_player.update({ where: { id: player.id }, data: { session_token: randomUUID() } });
    }
    return {
      ...this.toStateDto(player, await this.getInventory(player.id)),
      sessionToken: player.session_token,
      account: binding ? { nickname: binding.nickname, linkedThisDevice: binding.linkedThisDevice } : null,
    };
  }

  // 로비 기지 이름표용 — playerId -> nickname. 사용자 결정(2026-09-28): 이름이 있는 사람(허브 계정에 연결된
  // 플레이어, 계정 닉네임이 반영돼 있음)만 돌려준다. 게스트는 DB 닉네임이 기본값('도둑')뿐이라 제외 → FE가 "#{id} 기지"로 표시.
  async getNicknames(playerIdStrs: string[]): Promise<Map<string, string>> {
    const ids = playerIdStrs.filter((s) => /^\d+$/.test(s)).map((s) => BigInt(s));
    if (ids.length === 0) return new Map();
    const linked = await this.prisma.account_game_player.findMany({ where: { game: 'kirby', player_id: { in: ids } }, select: { player_id: true } });
    if (linked.length === 0) return new Map();
    const rows = await this.prisma.kirby_player.findMany({ where: { id: { in: linked.map((l) => l.player_id) } }, select: { id: true, nickname: true } });
    return new Map(rows.map((r) => [r.id.toString(), r.nickname]));
  }

  // Codex QA 지적(2026-09-18) 반영: presence:hello가 주장하는 playerId를 이 토큰과 대조해야만 등록 허용
  async verifySessionToken(playerIdStr: string, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    try {
      const player = await this.requirePlayer(playerIdStr);
      return player.session_token === token;
    } catch {
      return false;
    }
  }

  async getPlayerState(playerIdStr: string) {
    const player = await this.requirePlayer(playerIdStr);
    return this.toStateDto(player, await this.getInventory(player.id));
  }

  async getInventory(playerId: bigint) {
    const instances = await this.prisma.kirby_instance.findMany({
      where: { owner_player_id: playerId },
      include: { kirby_character: { include: { kirby_grade: true } } },
      orderBy: { created_at: 'asc' },
    });
    return instances.map((i) => this.toInstanceDto(i));
  }

  // 2026-09-18 요청: 초당 발생 재화 — last_collected_at부터 경과한 시간만큼 income_per_tick(골드/초)을 적립
  async collectIncome(playerIdStr: string, instanceIdStr: string) {
    const player = await this.requirePlayer(playerIdStr);
    const instanceId = BigInt(instanceIdStr);
    const instance = await this.prisma.kirby_instance.findUnique({
      where: { id: instanceId },
      include: { kirby_character: { include: { kirby_grade: true } } },
    });
    if (!instance) throw new NotFoundException('kirby not found');
    if (instance.owner_player_id !== player.id) throw new ForbiddenException('not your kirby');
    if (instance.status !== 'idle') throw new BadRequestException('지금 도둑맞는 중인 커비는 수금할 수 없습니다');

    const elapsedSeconds = Math.min(
      MAX_COLLECT_SECONDS,
      Math.max(0, (Date.now() - instance.last_collected_at.getTime()) / 1000),
    );
    const collected = Math.floor(elapsedSeconds * instance.kirby_character.kirby_grade.income_per_tick);
    const now = new Date();
    if (collected <= 0) {
      await this.prisma.kirby_instance.update({ where: { id: instanceId }, data: { last_collected_at: now } });
      return { player: this.toStateDto(player, await this.getInventory(player.id)), collected: 0 };
    }

    // 읽은 뒤 다른 요청(다른 기기의 자동 수익 등)이 먼저 정산했으면 정산 시각이 달라져 수정되지 않음 → 이중 지급 없음
    const credited = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.$executeRaw`UPDATE kirby_instance SET last_collected_at = ${now}
        WHERE id = ${instanceId} AND owner_player_id = ${player.id} AND status = 'idle' AND last_collected_at = ${instance.last_collected_at}`;
      if (moved === 0) return 0;
      await tx.kirby_player.update({ where: { id: player.id }, data: { gold: { increment: collected } } });
      return collected;
    }, TX_OPTIONS);

    const updated = await this.requirePlayerById(player.id);
    return { player: this.toStateDto(updated, await this.getInventory(player.id)), collected: credited };
  }

  // 자동 수익(사용자 지적 2026-09-21: 진열만 해서는 전혀 못 번다) — 내 idle 커비 전부를 한 번에 정산.
  // 서버가 경과시간×초당수익으로 재계산(24시간 캡). 정산 시각은 지급한 만큼만 앞으로 밀어 소수점 잔여분을 잃지 않음.
  async collectAllIncome(playerIdStr: string) {
    const player = await this.requirePlayer(playerIdStr);
    const instances = await this.prisma.kirby_instance.findMany({
      where: { owner_player_id: player.id, status: 'idle' },
      include: { kirby_character: { include: { kirby_grade: true } } },
    });
    const nowMs = Date.now();
    const pending: { id: bigint; readAt: Date; nextAt: Date; earned: number }[] = [];
    for (const inst of instances) {
      const rate = inst.kirby_character.kirby_grade.income_per_tick;
      if (rate <= 0) continue;
      const elapsedSec = Math.min(MAX_COLLECT_SECONDS, Math.max(0, (nowMs - inst.last_collected_at.getTime()) / 1000));
      const earned = Math.floor(elapsedSec * rate);
      if (earned <= 0) continue;
      pending.push({ id: inst.id, readAt: inst.last_collected_at, nextAt: new Date(inst.last_collected_at.getTime() + (earned / rate) * 1000), earned });
    }
    // 커비마다 "내가 읽은 정산 시각 그대로일 때만" 시각을 밀고, 실제로 민 커비의 수익만 합산해 지급
    // (다른 기기의 자동 수익이 먼저 정산한 커비는 건너뜀 → 이중 지급 없음)
    let total = 0;
    if (pending.length > 0) {
      total = await this.prisma.$transaction(async (tx) => {
        let sum = 0;
        for (const p of pending) {
          const moved = await tx.$executeRaw`UPDATE kirby_instance SET last_collected_at = ${p.nextAt}
            WHERE id = ${p.id} AND owner_player_id = ${player.id} AND status = 'idle' AND last_collected_at = ${p.readAt}`;
          if (moved > 0) sum += p.earned;
        }
        if (sum > 0) await tx.kirby_player.update({ where: { id: player.id }, data: { gold: { increment: sum } } });
        return sum;
      }, TX_OPTIONS);
    }
    const updated = await this.requirePlayerById(player.id);
    return { player: this.toStateDto(updated, await this.getInventory(player.id)), collected: total };
  }

  // 2.2 확정: 등장 확률은 자연수 weight 기반 — 서버가 직접 가중치 추첨(클라이언트가 결과를 정하지 않음).
  // 좌대 하나에 대한 판매권 발급 — 그 좌대의 현재 판매권이 아직 유효(미사용·미만료)하면 새로 뽑지 않고 그대로 돌려준다.
  async rollOffer(playerIdStr: string, slot: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MARKET_SLOTS) throw new BadRequestException('invalid market slot');
    await this.requirePlayer(playerIdStr);
    const now = Date.now();
    const mine = this.offers.get(playerIdStr) ?? new Map<string, MarketOffer>();
    this.offers.set(playerIdStr, mine);
    for (const [id, o] of mine) if (o.used || now > o.expiresAt + OFFER_BUY_GRACE_MS) mine.delete(id);

    const current = [...mine.values()].find((o) => o.slot === slot && !o.used && now < o.expiresAt);
    if (current) return this.toOfferDto(current);

    const characters = await this.prisma.kirby_character.findMany({ include: { kirby_grade: true } });
    if (characters.length === 0) throw new BadRequestException('no kirby characters seeded');
    const totalWeight = characters.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * totalWeight;
    let picked = characters[characters.length - 1];
    for (const c of characters) {
      roll -= c.weight;
      if (roll <= 0) {
        picked = c;
        break;
      }
    }

    const offer: MarketOffer = {
      offerId: randomUUID(),
      slot,
      characterId: picked.id,
      code: picked.code,
      price: picked.kirby_grade.buy_price,
      expiresAt: now + OFFER_TTL_MS,
      used: false,
    };
    mine.set(offer.offerId, offer);
    return this.toOfferDto(offer);
  }

  // 판매권으로만 구매 — 좌대에 보였던 바로 그 캐릭터를 그 가격에 산다.
  async buy(playerIdStr: string, offerId: string) {
    const player = await this.requirePlayer(playerIdStr);
    const offer = offerId ? this.offers.get(playerIdStr)?.get(offerId) : undefined;
    if (!offer || offer.used || Date.now() > offer.expiresAt + OFFER_BUY_GRACE_MS) {
      throw new BadRequestException({ message: '판매가 끝난 상품입니다', code: 'OFFER_EXPIRED' });
    }
    const ownedCount = await this.prisma.kirby_instance.count({ where: { owner_player_id: player.id } });
    if (ownedCount >= MAX_KIRBY_CAPACITY) throw new BadRequestException({ message: '기지 보관 공간이 가득 찼습니다', code: 'BASE_FULL' });
    if (player.gold < offer.price) throw new BadRequestException({ message: '돈이 부족합니다', code: 'NOT_ENOUGH_GOLD' });

    offer.used = true; // 연타·중복 요청으로 같은 판매권을 두 번 쓰지 못하게 트랜잭션 전에 먼저 소진
    try {
      // 잔액 확인과 차감을 한 번에(골드가 가격 이상일 때만 차감) — 두 기기에서 동시에 사도 잔액을 넘겨 빠지지 않음
      const instance = await this.prisma.$transaction(async (tx) => {
        const paid = await tx.$executeRaw`UPDATE kirby_player SET gold = gold - ${offer.price} WHERE id = ${player.id} AND gold >= ${offer.price}`;
        if (paid === 0) throw new BadRequestException({ message: '돈이 부족합니다', code: 'NOT_ENOUGH_GOLD' });
        const owned = await tx.kirby_instance.count({ where: { owner_player_id: player.id } });
        if (owned >= MAX_KIRBY_CAPACITY) throw new BadRequestException({ message: '기지 보관 공간이 가득 찼습니다', code: 'BASE_FULL' });
        return tx.kirby_instance.create({
          data: { owner_player_id: player.id, character_id: offer.characterId },
          include: { kirby_character: true },
        });
      }, TX_OPTIONS);
      const updated = await this.requirePlayerById(player.id);
      return { player: this.toStateDto(updated, await this.getInventory(player.id)), bought: this.toInstanceDto(instance) };
    } catch (err) {
      offer.used = false; // DB 실패 시 판매권 복구(재시도 가능)
      throw err;
    }
  }

  private toOfferDto(o: MarketOffer) {
    return { offerId: o.offerId, slot: o.slot, code: o.code, price: o.price, expiresAt: o.expiresAt };
  }

  async sell(playerIdStr: string, instanceIdStr: string) {
    const player = await this.requirePlayer(playerIdStr);
    const instanceId = BigInt(instanceIdStr);
    const instance = await this.prisma.kirby_instance.findUnique({
      where: { id: instanceId },
      include: { kirby_character: { include: { kirby_grade: true } } },
    });
    if (!instance) throw new NotFoundException('kirby not found');
    if (instance.owner_player_id !== player.id) throw new ForbiddenException('not your kirby');
    if (instance.status !== 'idle') throw new BadRequestException('지금 도둑맞는 중인 커비는 팔 수 없습니다');

    const sellPrice = instance.kirby_character.kirby_grade.sell_price;
    // 내 소유·대기 중인 커비일 때만 삭제하고, 실제로 삭제됐을 때만 판매 대금 지급(동시 두 번 판매해도 1회만)
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.$executeRaw`DELETE FROM kirby_instance WHERE id = ${instanceId} AND owner_player_id = ${player.id} AND status = 'idle'`;
      if (removed === 0) throw new BadRequestException('이미 판매했거나 판매할 수 없는 커비입니다');
      await tx.kirby_player.update({ where: { id: player.id }, data: { gold: { increment: sellPrice } } });
    }, TX_OPTIONS);

    const updated = await this.requirePlayerById(player.id);
    return this.toStateDto(updated, await this.getInventory(player.id));
  }

  // 4.4/4.5 확정: 잠금 상태/오프라인 운영 설정 변경
  async updateSettings(playerIdStr: string, body: { lockState?: LockState; offlineOperationEnabled?: boolean; allowedUserIds?: string[] }) {
    const player = await this.requirePlayer(playerIdStr);
    const updated = await this.prisma.kirby_player.update({
      where: { id: player.id },
      data: {
        ...(body.lockState !== undefined ? { lock_state: body.lockState } : {}),
        ...(body.offlineOperationEnabled !== undefined ? { offline_operation_enabled: body.offlineOperationEnabled } : {}),
        ...(body.allowedUserIds !== undefined ? { allowed_user_ids_json: JSON.stringify(body.allowedUserIds) } : {}),
      },
    });
    return this.toStateDto(updated, await this.getInventory(updated.id));
  }

  async getBaseAccess(playerIdStr: string): Promise<BaseAccessState> {
    const player = await this.requirePlayer(playerIdStr);
    return {
      lockState: player.lock_state as LockState,
      allowedUserIds: player.allowed_user_ids_json ? JSON.parse(player.allowed_user_ids_json) : [],
      offlineOperationEnabled: player.offline_operation_enabled,
    };
  }

  // 5.1 확정: 침입 시작(선택) 트리거 — 대상 커비를 stolen_in_transit으로 표시(원 소유자 화면에 실시간 노출)
  async markStolenInTransit(instanceIdStr: string) {
    const instanceId = BigInt(instanceIdStr);
    const instance = await this.prisma.kirby_instance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new NotFoundException('kirby not found');
    if (instance.status !== 'idle') throw new BadRequestException('이미 다른 사람이 노리고 있습니다');
    await this.prisma.kirby_instance.update({ where: { id: instanceId }, data: { status: 'stolen_in_transit' } });
  }

  // 5.1 확정: 성공(탈출 게이트 통과) — 소유권 이전
  async transferOwnership(instanceIdStr: string, newOwnerPlayerId: bigint) {
    await this.prisma.kirby_instance.update({
      where: { id: BigInt(instanceIdStr) },
      data: { owner_player_id: newOwnerPlayerId, status: 'idle' },
    });
  }

  // 실패(붙잡힘/탈출 게이트 막힘) — 원 소유자에게 그대로, 상태만 복구
  async resetStolenStatus(instanceIdStr: string) {
    // update()는 대상이 이미 삭제됐으면 예외를 던져 연결 종료 처리 중 프로세스가 죽을 수 있음(2026-09-21 실검증 중 발생) — updateMany는 없으면 0건 처리
    await this.prisma.kirby_instance.updateMany({ where: { id: BigInt(instanceIdStr) }, data: { status: 'idle' } });
  }

  async findInstance(instanceIdStr: string) {
    const instance = await this.prisma.kirby_instance.findUnique({
      where: { id: BigInt(instanceIdStr) },
      include: { kirby_character: true },
    });
    if (!instance) throw new NotFoundException('kirby not found');
    return instance;
  }

  private async requirePlayer(playerIdStr: string) {
    return this.requirePlayerById(BigInt(playerIdStr));
  }

  private async requirePlayerById(playerId: bigint) {
    const player = await this.prisma.kirby_player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');
    return player;
  }

  private toInstanceDto(instance: InstanceRow) {
    return {
      instanceId: instance.id.toString(),
      code: instance.kirby_character.code,
      name: instance.kirby_character.name,
      gradeId: instance.kirby_character.grade_id,
      status: instance.status,
      incomePerTick: instance.kirby_character.kirby_grade?.income_per_tick ?? 0,
    };
  }

  private toStateDto(
    player: { id: bigint; nickname: string; gold: number; lock_state: string; offline_operation_enabled: boolean },
    kirbies: ReturnType<PlayerService['toInstanceDto']>[],
  ) {
    return {
      playerId: player.id.toString(),
      nickname: player.nickname,
      gold: player.gold,
      lockState: player.lock_state,
      offlineOperationEnabled: player.offline_operation_enabled,
      kirbies,
    };
  }
}
