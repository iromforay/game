import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// 4.4: 선반 슬롯 수 제안(8열×5행) — 문서 5.2-4 최종 확정 전까지 이 값 사용
const SHELF_SLOT_COUNT = 40;
// 4.1/4.5: 게임 시작 지급 타레(정해진 금액)
const STARTING_TARE = 100;

type CharacterWithGrade = {
  code: string;
  name: string;
  atk_mod: number;
  def_mod: number;
  ap_mod: number;
  hp_mod: number;
  turby_grade: { base_attack: number | null; base_defense: number | null; base_action_power: number | null; base_hp: number | null };
};

type InstanceRow = {
  id: bigint;
  acquired_via: string;
  atk_bonus: number;
  def_bonus: number;
  ap_bonus: number;
  hp_bonus: number;
  base_slot_id: bigint | null;
  turby_character: CharacterWithGrade;
  player_base_slot?: { slot_index: number } | null;
};

@Injectable()
export class PlayerService {
  constructor(private readonly prisma: PrismaService) {}

  // 8번 스키마: 로그인 시스템이 없어 device_uuid로 플레이어를 식별(없으면 새로 생성)
  async identify(deviceUuid: string) {
    const player = await this.prisma.player.upsert({
      where: { device_uuid: deviceUuid },
      update: {},
      create: { device_uuid: deviceUuid, nickname: '터비 탐험가', tare_balance: STARTING_TARE },
    });

    let turbys = await this.getInventory(player.id);
    if (turbys.length === 0) {
      // 보유 터비가 하나도 없는 플레이어(신규) — 스타터 누비를 DB에 실제로 지급(acquired_via='starter').
      const starter = await this.prisma.turby_character.findUnique({ where: { code: 'nubi' } });
      if (starter) {
        await this.prisma.turby_instance.create({
          data: { owner_player_id: player.id, character_id: starter.id, acquired_via: 'starter' },
        });
        turbys = await this.getInventory(player.id);
      }
    }

    return { playerId: player.id.toString(), nickname: player.nickname, tareBalance: player.tare_balance, turbys };
  }

  async getInventory(playerId: bigint) {
    const instances = await this.prisma.turby_instance.findMany({
      where: { owner_player_id: playerId },
      include: { turby_character: { include: { turby_grade: true } }, player_base_slot: true },
      orderBy: { created_at: 'asc' },
    });
    return instances.map((i) => this.toDto(i));
  }

  // 3.2: 야생 조우 승리 시 포획 — 소지(가방) 상태로 지급(base_slot_id=null, 4.2)
  async capture(playerIdStr: string, characterCode: string) {
    const playerId = BigInt(playerIdStr);
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('player not found');

    const character = await this.prisma.turby_character.findUnique({ where: { code: characterCode }, include: { turby_grade: true } });
    if (!character) throw new NotFoundException(`unknown character code: ${characterCode}`);

    const instance = await this.prisma.turby_instance.create({
      data: {
        owner_player_id: playerId,
        character_id: character.id,
        acquired_via: 'wild_capture',
      },
    });
    return this.toDto({ ...instance, turby_character: character, player_base_slot: null });
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
      include: { turby_character: { include: { turby_grade: true } }, player_base_slot: true },
    });
    return this.toDto(updated);
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
      include: { turby_character: { include: { turby_grade: true } }, player_base_slot: true },
    });
    return this.toDto(updated);
  }

  // 6.2 스탯 산정 공식(등급 기본 + 캐릭터 보정치) + 개별 강화 보너스(turby_instance.*_bonus, 기획 미확정이라
  // 시스템/UI는 없지만 DB 컬럼은 미리 마련해둠) — 최종 스탯까지 서버에서 계산해서 내려줌.
  private toDto(instance: InstanceRow) {
    const { turby_character: character } = instance;
    const grade = character.turby_grade;
    return {
      id: instance.id.toString(),
      characterCode: character.code,
      characterName: character.name,
      acquiredVia: instance.acquired_via,
      // 4.2: base_slot_id 없으면 소지(가방), 있으면 기지 보관(선반)
      locationType: instance.base_slot_id === null ? ('bag' as const) : ('shelf' as const),
      slotIndex: instance.player_base_slot?.slot_index ?? null,
      stats: {
        attack: (grade.base_attack ?? 0) + character.atk_mod + instance.atk_bonus,
        defense: (grade.base_defense ?? 0) + character.def_mod + instance.def_bonus,
        actionPower: (grade.base_action_power ?? 0) + character.ap_mod + instance.ap_bonus,
        maxHp: (grade.base_hp ?? 0) + character.hp_mod + instance.hp_bonus,
      },
    };
  }
}
