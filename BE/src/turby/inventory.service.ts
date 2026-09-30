import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SettingsService } from './rooms/settings.service';
import { gameError } from './turby-dto';
import { EVENT_BY_ID, RELIC_EQUIP_EVENT, STORY_CATEGORIES, STORY_SLOT_PREFIX } from './story/story-data';
import { bagRoomFor, checkEvent, slotsOf, toCheckpoint } from './story/story-rules';
import { addToPlayerItem, usedBagSlots } from './story/bag';

export type InventoryTab = 'equipment' | 'consumable' | 'material' | 'story';

// 화면 분류 이름(v3 §2.1: 재료·소비·장비·스토리)
const TAB_LABEL: Record<InventoryTab, string> = { material: '재료', consumable: '소비', equipment: '장비', story: '스토리' };

// 한 칸에 max_stack까지만 — 넘는 수량은 다음 칸(가방 칸 계산과 같은 규칙). 스토리 아이템은 칸을 쓰지 않으므로 한 묶음
export function stacksOf(quantity: number, maxStack: number, isStory: boolean): number[] {
  if (isStory) return [quantity];
  const size = Math.max(1, maxStack);
  const out: number[] = [];
  for (let left = quantity; left > 0; left -= size) out.push(Math.min(size, left));
  return out;
}

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
    const [rows, equippedRows, overflowCount, progress, events] = await Promise.all([
      this.prisma.player_item.findMany({ where: { player_id: playerId }, include: { item_definition: true } }),
      this.prisma.turby_instance.findMany({ where: { owner_player_id: playerId }, select: { id: true } }).then((mine) => this.prisma.turby_equipment.findMany({ where: { turby_instance_id: { in: mine.map((t) => t.id) } } })),
      this.prisma.player_item_overflow.count({ where: { player_id: playerId, claimed_at: null } }),
      this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } }),
      this.prisma.player_story_event.findMany({ where: { player_id: playerId } }),
    ]);
    const equippedById = new Map<number, number>();
    for (const e of equippedRows) equippedById.set(e.item_definition_id, (equippedById.get(e.item_definition_id) ?? 0) + 1);
    const nubiId = progress?.story_nubi_turby_instance_id ?? null;
    const onNubi = new Set(equippedRows.filter((e) => nubiId !== null && e.turby_instance_id === nubiId && e.slot_key.startsWith(STORY_SLOT_PREFIX)).map((e) => e.item_definition_id));
    const snap = { checkpoint: toCheckpoint(progress?.checkpoint ?? 'OPENING_NOT_STARTED'), events: new Set(events.map((e) => e.event_id)), objectives: new Map(), growthStage: progress?.nubi_growth_stage ?? 0 };

    // 수량 0인 행은 수집 기록으로만 남는다(가방에는 표시하지 않음)
    const items = rows
      .filter((r) => r.quantity > 0)
      .map((r) => {
        const d = r.item_definition;
        const tab = TAB_OF[d.category] ?? 'material';
        const isStory = STORY_CATEGORIES.has(d.category);
        const equipped = equippedById.get(r.item_definition_id) ?? 0;
        const relicEvent = d.category === 'relic' ? (RELIC_EQUIP_EVENT.get(d.code) ?? null) : null;
        // 누비에게 장착: 서버 규칙(체크포인트·선행 이벤트·이야기 누비)으로 지금 가능한지 판정해 알려 준다. 실행 때 서버가 다시 검증한다
        const storyFailure = relicEvent && !onNubi.has(r.item_definition_id) ? checkEvent(EVENT_BY_ID.get(relicEvent)!, snap) : null;
        const storyAction =
          relicEvent && !onNubi.has(r.item_definition_id)
            ? {
                kind: 'equip_story_nubi' as const,
                label: '누비에게 장착' as const,
                available: !storyFailure && nubiId !== null,
                reason: !nubiId ? '이야기 누비를 찾을 수 없어요' : storyFailure ? '아직 장착할 때가 아니에요' : null,
              }
            : null;
        return {
          recordId: String(r.item_definition_id), // 보유 행은 (플레이어, 아이템 정의) 복합 키 — 한 플레이어 안에서는 정의 ID가 곧 레코드 ID
          itemDefinitionId: r.item_definition_id,
          itemCode: d.code,
          iconKey: d.code, // 아이콘 에셋 키(item-<code>) — 아이콘 컬럼이 아직 없어 코드와 같게 둔다
          name: d.name,
          tab,
          tabLabel: TAB_LABEL[tab],
          category: d.category,
          storySlot: d.story_slot ?? null,
          stacks: stacksOf(r.quantity, d.max_stack, isStory),
          gradeLabel: null as string | null, // 아이템 등급 컬럼이 아직 없다
          quantity: r.quantity,
          slotsUsed: isStory ? 0 : slotsOf(r.quantity, d.max_stack),
          maxStack: d.max_stack,
          equipped,
          equippedOnStoryNubi: onNubi.has(r.item_definition_id),
          isNew: r.is_new,
          isLocked: r.is_locked || isStory, // 스토리 아이템은 언제나 잠금(판매·폐기·일반 소비 불가)
          isMissionTarget: false, // 목표 연동은 M4(1장 트리거)에서
          usedAt: r.used_at?.toISOString() ?? null,
          firstAcquiredAt: r.first_acquired_at?.toISOString() ?? null,
          lastAcquiredAt: r.last_acquired_at?.toISOString() ?? null,
          // 판매·폐기·거래 기능은 아직 없다. 생기면 서버가 이 값과 같은 규칙으로 다시 검증한다
          permissions: { sell: !isStory, discard: !isStory, trade: !isStory, consume: !isStory && d.category === 'consumable', unequip: !isStory },
          lockReason: isStory ? '이야기에 필요한 물건이라 팔거나 버리거나 해제할 수 없어요' : null,
          storyAction,
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

  // 신규 표시는 상세를 실제로 연 아이템 하나만 해제한다(v3 §2.3 — 화면을 열었다고 일괄 해제하지 않음). 이미 읽었거나 없으면 cleared=false
  async markItemSeen(playerId: bigint, itemCodeRaw: unknown) {
    if (typeof itemCodeRaw !== 'string' || !/^[a-z0-9_]{1,30}$/.test(itemCodeRaw)) throw gameError(400, 'INVALID_ITEM', '아이템 정보가 올바르지 않습니다.');
    const def = await this.prisma.item_definition.findUnique({ where: { code: itemCodeRaw } });
    if (!def) throw gameError(404, 'ITEM_NOT_FOUND', '가지고 있지 않은 아이템입니다.');
    const res = await this.prisma.player_item.updateMany({ where: { player_id: playerId, item_definition_id: def.id, is_new: true }, data: { is_new: false } });
    return { itemCode: itemCodeRaw, cleared: res.count === 1 };
  }
}
