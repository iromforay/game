import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import type { BaseAccessState, LockState } from './baseAccess';

// 2.1 확정: 시작 자금
const STARTING_GOLD = 100;

// 2026-09-17 확정(docs/to_codex.md 7절): 기지 보관 용량 = 층당 4개 × 3층
const MAX_KIRBY_CAPACITY = 12;

// 2026-09-18 요청: 초당 발생 재화 — 오프라인 방치 악용 방지용 최대 정산 구간(24시간)
const MAX_COLLECT_SECONDS = 24 * 60 * 60;

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
  constructor(private readonly prisma: PrismaService) {}

  // 8번 스키마 패턴 재사용: 로그인 시스템이 없어 device_uuid로 플레이어를 식별(없으면 새로 생성).
  // Codex QA 지적(2026-09-18) 반영: identify() 때 세션 토큰을 발급/보장하고, 이 응답에만 담아
  // 돌려준다 — getPlayerState() 등 다른 조회 API는 토큰을 노출하지 않는다(타인이 훔쳐볼 수 있는 경로라서).
  async identify(deviceUuid: string) {
    let player = await this.prisma.kirby_player.upsert({
      where: { device_uuid: deviceUuid },
      update: {},
      create: { device_uuid: deviceUuid, nickname: '도둑', gold: STARTING_GOLD, session_token: randomUUID() },
    });
    if (!player.session_token) {
      player = await this.prisma.kirby_player.update({ where: { id: player.id }, data: { session_token: randomUUID() } });
    }
    return { ...this.toStateDto(player, await this.getInventory(player.id)), sessionToken: player.session_token };
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

    await this.prisma.$transaction([
      this.prisma.kirby_player.update({ where: { id: player.id }, data: { gold: { increment: collected } } }),
      this.prisma.kirby_instance.update({ where: { id: instanceId }, data: { last_collected_at: now } }),
    ]);

    const updated = await this.requirePlayerById(player.id);
    return { player: this.toStateDto(updated, await this.getInventory(player.id)), collected };
  }

  // 2.2 확정: 등장 확률은 자연수 weight 기반 — 서버가 직접 가중치 추첨해서 구매 처리(클라이언트가 결과를 정하지 않음)
  async buy(playerIdStr: string) {
    const player = await this.requirePlayer(playerIdStr);
    const ownedCount = await this.prisma.kirby_instance.count({ where: { owner_player_id: player.id } });
    if (ownedCount >= MAX_KIRBY_CAPACITY) throw new BadRequestException('기지 보관 공간이 가득 찼습니다');

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

    const price = picked.kirby_grade.buy_price;
    if (player.gold < price) throw new BadRequestException('돈이 부족합니다');

    const [, instance] = await this.prisma.$transaction([
      this.prisma.kirby_player.update({ where: { id: player.id }, data: { gold: { decrement: price } } }),
      this.prisma.kirby_instance.create({
        data: { owner_player_id: player.id, character_id: picked.id },
        include: { kirby_character: true },
      }),
    ]);

    const updated = await this.requirePlayerById(player.id);
    return { player: this.toStateDto(updated, await this.getInventory(player.id)), bought: this.toInstanceDto(instance) };
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
    await this.prisma.$transaction([
      this.prisma.kirby_instance.delete({ where: { id: instanceId } }),
      this.prisma.kirby_player.update({ where: { id: player.id }, data: { gold: { increment: sellPrice } } }),
    ]);

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
