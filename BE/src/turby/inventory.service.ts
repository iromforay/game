import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SettingsService } from './rooms/settings.service';
import { gameError } from './turby-dto';
import { RELIC_EQUIP_EVENT, STORY_CATEGORIES } from './story/story-data';
import { bagRoomFor, slotsOf } from './story/story-rules';
import { addToPlayerItem, usedBagSlots } from './story/bag';

export type InventoryTab = 'equipment' | 'consumable' | 'material' | 'story';

const TAB_OF: Record<string, InventoryTab> = {
  equipment: 'equipment',
  consumable: 'consumable',
  upgrade: 'material',
  material: 'material',
  defense: 'material', // 사용처 없는 기존 값 — 표시만 재료 탭에
  mission: 'story',
  relic: 'story',
  memento: 'story',
};

// 인벤토리 조회(docs/save_a_turby_inventory_spec.md, m0_design 4.3·9절). 정렬은 클라이언트가 한다.
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(playerId: bigint) {
    const [rows, equippedRows, overflowCount] = await Promise.all([
      this.prisma.player_item.findMany({ where: { player_id: playerId }, include: { item_definition: true } }),
      this.prisma.turby_equipment.groupBy({ by: ['item_definition_id'], where: { turby_instance: { owner_player_id: playerId } }, _count: { _all: true } }),
      this.prisma.player_item_overflow.count({ where: { player_id: playerId, claimed_at: null } }),
    ]);
    const equippedById = new Map(equippedRows.map((r) => [r.item_definition_id, r._count._all]));

    // 수량 0인 행은 수집 기록으로만 남는다(가방에는 표시하지 않음)
    const items = rows
      .filter((r) => r.quantity > 0)
      .map((r) => {
        const d = r.item_definition;
        const tab = TAB_OF[d.category] ?? 'material';
        const isStory = STORY_CATEGORIES.has(d.category);
        const equipped = equippedById.get(r.item_definition_id) ?? 0;
        const relicEvent = d.category === 'relic' && equipped === 0 ? (RELIC_EQUIP_EVENT.get(d.code) ?? null) : null;
        return {
          itemCode: d.code,
          name: d.name,
          tab,
          category: d.category,
          gradeLabel: null as string | null, // 아이템 등급 컬럼이 아직 없다
          quantity: r.quantity,
          slotsUsed: isStory ? 0 : slotsOf(r.quantity, d.max_stack),
          maxStack: d.max_stack,
          equipped,
          isNew: r.is_new,
          isLocked: r.is_locked,
          isMissionTarget: false, // 목표 연동은 M4(1장 트리거)에서
          usedAt: r.used_at?.toISOString() ?? null,
          firstAcquiredAt: r.first_acquired_at?.toISOString() ?? null,
          lastAcquiredAt: r.last_acquired_at?.toISOString() ?? null,
          // 판매·폐기·거래 기능은 아직 없다. 생기면 서버가 이 값과 같은 규칙으로 다시 검증한다
          permissions: { sell: !isStory, discard: !isStory, trade: !isStory },
          storyAction: relicEvent ? { label: '누비에게 장착' as const, eventId: relicEvent } : null,
          description: d.description ?? '',
          bonuses: { attack: d.atk_bonus, defense: d.def_bonus, actionPower: d.ap_bonus, maxHp: d.hp_bonus },
        };
      });

    const used = items.reduce((sum, i) => sum + i.slotsUsed, 0);
    return { bag: { capacity: this.settings.numberOr('inventory.bagCapacity', 40), used }, overflowCount, items };
  }

  // ---------- 임시 보관함(인벤토리 명세 3절, Codex D1: M5까지 만료 없음) ----------

  async listOverflow(playerId: bigint) {
    const rows = await this.prisma.player_item_overflow.findMany({ where: { player_id: playerId, claimed_at: null }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
    const defs = await this.prisma.item_definition.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.item_definition_id))] } } });
    const defById = new Map(defs.map((d) => [d.id, d]));
    return rows.map((r) => ({
      id: r.id.toString(),
      itemCode: defById.get(r.item_definition_id)?.code ?? null,
      name: defById.get(r.item_definition_id)?.name ?? '',
      quantity: r.quantity,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at?.toISOString() ?? null,
    }));
  }

  // 가방에 들어가는 만큼만 옮기고 나머지는 보관함에 남긴다. 전부 옮기면 claimed_at 기록.
  // 동시성: ① 트랜잭션 첫 문장으로 플레이어 행을 갱신해 같은 플레이어의 수령을 한 줄로 세우고(InnoDB 행 잠금),
  //        ② 보관함 행은 "읽은 수량·미수령" 조건부 갱신으로만 바꿔, 끼어든 요청이 있으면 0건 → 전체 롤백.
  async claimOverflow(playerId: bigint, idRaw: unknown) {
    if (typeof idRaw !== 'string' || !/^\d{1,20}$/.test(idRaw)) throw gameError(400, 'INVALID_OVERFLOW', '보관함 항목 정보가 올바르지 않습니다.');
    const id = BigInt(idRaw);
    return this.prisma.$transaction(async (tx) => {
      await tx.player.update({ where: { id: playerId }, data: { updated_at: new Date() } });
      // 다른 플레이어의 행도 "없음"으로 답한다(존재 여부를 알려 주지 않음)
      const row = await tx.player_item_overflow.findFirst({ where: { id, player_id: playerId, claimed_at: null } });
      if (!row) throw gameError(404, 'OVERFLOW_NOT_FOUND', '보관함에 없는 항목입니다.');
      const def = await tx.item_definition.findUnique({ where: { id: row.item_definition_id } });
      if (!def) throw gameError(500, 'STORY_DATA_MISSING', '아이템 정의가 없습니다.');
      const owned = await tx.player_item.findUnique({ where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } } });
      const room = bagRoomFor(owned?.quantity ?? 0, def.max_stack, await usedBagSlots(tx, playerId), this.settings.numberOr('inventory.bagCapacity', 40));
      if (room <= 0) throw gameError(409, 'BAG_FULL', '가방에 빈 칸이 없습니다.');

      const take = Math.min(row.quantity, room);
      const remaining = row.quantity - take;
      const updated = await tx.player_item_overflow.updateMany({
        where: { id, player_id: playerId, claimed_at: null, quantity: row.quantity },
        data: remaining === 0 ? { claimed_at: new Date() } : { quantity: remaining },
      });
      if (updated.count !== 1) throw gameError(409, 'OVERFLOW_CHANGED', '보관함 상태가 바뀌었습니다. 다시 시도하세요.');
      await addToPlayerItem(tx, playerId, def.id, take);
      return { id: idRaw, itemCode: def.code, claimed: take, remaining, fullyClaimed: remaining === 0 };
    });
  }

  async markSeen(playerId: bigint, tab: unknown) {
    const categories = Object.entries(TAB_OF)
      .filter(([, t]) => t === tab)
      .map(([c]) => c);
    if (categories.length === 0) throw gameError(400, 'INVALID_TAB', '탭 정보가 올바르지 않습니다.');
    const defs = await this.prisma.item_definition.findMany({ where: { category: { in: categories as never } }, select: { id: true } });
    const res = await this.prisma.player_item.updateMany({ where: { player_id: playerId, is_new: true, item_definition_id: { in: defs.map((d) => d.id) } }, data: { is_new: false } });
    return { tab, cleared: res.count };
  }
}
