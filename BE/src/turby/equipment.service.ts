import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { INSTANCE_INCLUDE, gameError, toTurbyDto } from './turby-dto';
import { STORY_SLOT_PREFIX } from './story/story-data';

// 3.1: 아이템 착용 — 스탯 보너스만 있고 외형 변화는 없음. 터비 1마리당 슬롯 종류(item_definition.equip_slot)마다 1개.
// 보유 수량은 player_item.quantity, 장착 중인 수량은 turby_equipment 행 수로 계산해서 초과 장착을 막는다.
@Injectable()
export class EquipmentService {
  constructor(private readonly prisma: PrismaService) {}

  async listItems(playerIdStr: string) {
    const playerId = BigInt(playerIdStr);
    const owned = await this.prisma.player_item.findMany({ where: { player_id: playerId, quantity: { gt: 0 } }, include: { item_definition: true } });
    const equippedRows = await this.prisma.turby_equipment.groupBy({
      by: ['item_definition_id'],
      where: { turby_instance: { owner_player_id: playerId } },
      _count: { _all: true },
    });
    const equippedById = new Map(equippedRows.map((r) => [r.item_definition_id, r._count._all]));

    return owned.map((o) => {
      const equipped = equippedById.get(o.item_definition_id) ?? 0;
      const d = o.item_definition;
      return {
        code: d.code,
        name: d.name,
        description: d.description ?? '',
        equipSlot: d.equip_slot,
        bonuses: { attack: d.atk_bonus, defense: d.def_bonus, actionPower: d.ap_bonus, maxHp: d.hp_bonus },
        quantity: o.quantity,
        equipped,
        available: Math.max(0, o.quantity - equipped),
      };
    });
  }

  // 같은 슬롯에 이미 다른 아이템이 있으면 교체(기존 아이템은 자동 해제)
  async equip(playerIdStr: string, turbyIdStr: string, itemCode: string) {
    const playerId = BigInt(playerIdStr);
    const turbyId = BigInt(turbyIdStr);
    await this.requireOwnedTurby(playerId, turbyId);

    const item = await this.prisma.item_definition.findUnique({ where: { code: itemCode } });
    if (!item) throw new NotFoundException('item not found');
    if (item.category !== 'equipment' || !item.equip_slot) throw gameError(400, 'NOT_EQUIPPABLE', '장착할 수 없는 아이템입니다.');
    if (item.equip_slot.startsWith(STORY_SLOT_PREFIX)) throw gameError(400, 'STORY_SLOT_RESERVED', '이야기 장식 슬롯은 여기서 바꿀 수 없습니다.');
    const slotKey = item.equip_slot;

    await this.prisma.$transaction(async (tx) => {
      // 같은 플레이어의 같은 아이템 동시 장착 경합을 막기 위해 보유 행을 잠근다
      const rows = await tx.$queryRaw<{ quantity: number }[]>`SELECT quantity FROM player_item WHERE player_id = ${playerId} AND item_definition_id = ${item.id} FOR UPDATE`;
      if (rows.length === 0 || rows[0].quantity <= 0) throw gameError(400, 'ITEM_NOT_OWNED', '보유하지 않은 아이템입니다.');

      const current = await tx.turby_equipment.findUnique({ where: { turby_instance_id_slot_key: { turby_instance_id: turbyId, slot_key: slotKey } } });
      if (current && current.item_definition_id === item.id) throw gameError(409, 'ALREADY_EQUIPPED', '이미 장착 중인 아이템입니다.');
      if (current) await tx.turby_equipment.delete({ where: { id: current.id } });

      const equipped = await tx.turby_equipment.count({ where: { item_definition_id: item.id, turby_instance: { owner_player_id: playerId } } });
      if (Number(rows[0].quantity) - equipped <= 0) throw gameError(400, 'NO_AVAILABLE_ITEM', '장착 가능한 수량이 없습니다. 다른 터비에서 해제하세요.');

      await tx.turby_equipment.create({ data: { turby_instance_id: turbyId, item_definition_id: item.id, slot_key: slotKey } });
    });

    return this.loadDto(turbyId);
  }

  async unequip(playerIdStr: string, turbyIdStr: string, slotKey: string) {
    // 이야기 유물(story_1~5)은 스토리 이벤트 트랜잭션만 바꾼다 — 일반 해제로 빠지지 않게(m0_design 9.4)
    if (typeof slotKey !== 'string' || slotKey.length === 0) throw gameError(400, 'INVALID_SLOT', '슬롯 정보가 올바르지 않습니다.');
    if (slotKey.startsWith(STORY_SLOT_PREFIX)) throw gameError(400, 'STORY_SLOT_RESERVED', '이야기 장식 슬롯은 여기서 바꿀 수 없습니다.');
    const playerId = BigInt(playerIdStr);
    const turbyId = BigInt(turbyIdStr);
    await this.requireOwnedTurby(playerId, turbyId);

    const removed = await this.prisma.turby_equipment.deleteMany({ where: { turby_instance_id: turbyId, slot_key: slotKey } });
    if (removed.count === 0) throw gameError(404, 'NOTHING_EQUIPPED', '해제할 장착 아이템이 없습니다.');
    return this.loadDto(turbyId);
  }

  private async requireOwnedTurby(playerId: bigint, turbyId: bigint) {
    const instance = await this.prisma.turby_instance.findUnique({ where: { id: turbyId } });
    if (!instance) throw new NotFoundException('turby not found');
    if (instance.owner_player_id !== playerId) throw gameError(403, 'NOT_YOUR_TURBY', '내 터비가 아닙니다.');
  }

  private async loadDto(turbyId: bigint) {
    const instance = await this.prisma.turby_instance.findUniqueOrThrow({ where: { id: turbyId }, include: INSTANCE_INCLUDE });
    return toTurbyDto(instance);
  }
}
