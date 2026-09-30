import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SessionService } from './session.service';
import { INSTANCE_INCLUDE, toTurbyDto } from './turby-dto';

// 4.4: 선반 슬롯 수 제안(8열×5행) — 문서 5.2-4 최종 확정 전까지 이 값 사용
const SHELF_SLOT_COUNT = 40;
// 4.1/4.5: 게임 시작 지급 타레(정해진 금액)
const STARTING_TARE = 100;

@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  // 8번 스키마: 로그인 시스템이 없어 device_uuid로 플레이어를 식별(없으면 새로 생성)
  async identify(deviceUuid: string) {
    const player = await this.prisma.player.upsert({
      where: { device_uuid: deviceUuid },
      update: {},
      create: { device_uuid: deviceUuid, nickname: '터비 탐험가', tare_balance: STARTING_TARE },
    });

    // 스토리 M3: 스타터 누비 자동 지급을 없앴다. 이야기 누비는 오프닝 완료 이벤트(story_nubi_granted)가
    // 이름 입력 뒤에 한 트랜잭션으로 지급·연결한다(기존 계정은 가장 오래된 스타터를 재사용, 없으면 그때 생성).
    const turbys = await this.getInventory(player.id);

    // 스토리 M1: 세션 토큰 발급(이미 있으면 그대로). 이후 /player/me/* 헤더(X-Turby-Session)와 소켓 hello에 쓴다.
    const sessionToken = await this.session.ensureToken(player.id, player.session_token);
    return { playerId: player.id.toString(), nickname: player.nickname, tareBalance: player.tare_balance, turbys, sessionToken };
  }

  async getInventory(playerId: bigint) {
    const instances = await this.prisma.turby_instance.findMany({
      where: { owner_player_id: playerId },
      include: INSTANCE_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
    return instances.map(toTurbyDto);
  }

  // 4.2/4.4: 소지(가방) → 기지 보관(선반) 특정 슬롯으로 이동
  async moveToShelf(playerIdStr: string, turbyIdStr: string, slotIndex: number) {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SHELF_SLOT_COUNT) {
      throw new BadRequestException(`slotIndex must be 0-${SHELF_SLOT_COUNT - 1}`);
    }
    const playerId = BigInt(playerIdStr);
    const turbyId = BigInt(turbyIdStr);

    const instance = await this.prisma.turby_instance.findUnique({ where: { id: turbyId } });
    if (!instance) throw new NotFoundException('turby not found');
    if (instance.owner_player_id !== playerId) throw new ForbiddenException('not your turby');

    const slot = await this.prisma.player_base_slot.upsert({
      where: { player_id_slot_index: { player_id: playerId, slot_index: slotIndex } },
      update: {},
      create: { player_id: playerId, slot_index: slotIndex },
    });

    const occupant = await this.prisma.turby_instance.findFirst({ where: { base_slot_id: slot.id, id: { not: turbyId } } });
    if (occupant) throw new ConflictException('slot already occupied');

    const updated = await this.prisma.turby_instance.update({
      where: { id: turbyId },
      data: { base_slot_id: slot.id },
      include: INSTANCE_INCLUDE,
    });
    return toTurbyDto(updated);
  }

  // 4.2: 기지 보관(선반) → 소지(가방)로 이동
  async moveToBag(playerIdStr: string, turbyIdStr: string) {
    const playerId = BigInt(playerIdStr);
    const turbyId = BigInt(turbyIdStr);

    const instance = await this.prisma.turby_instance.findUnique({ where: { id: turbyId } });
    if (!instance) throw new NotFoundException('turby not found');
    if (instance.owner_player_id !== playerId) throw new ForbiddenException('not your turby');

    const updated = await this.prisma.turby_instance.update({
      where: { id: turbyId },
      data: { base_slot_id: null },
      include: INSTANCE_INCLUDE,
    });
    return toTurbyDto(updated);
  }
}
