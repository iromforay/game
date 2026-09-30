// 가방(일반 아이템 40칸) 계산과 보유 수량 증가 — 스토리 보상 지급과 임시 보관함 수령이 같이 쓴다.
import type { Prisma } from '@prisma/client';
import { STORY_CATEGORIES } from './story-data';
import { slotsOf } from './story-rules';

type Tx = Prisma.TransactionClient;

// 이야기 탭 아이템은 칸을 차지하지 않는다
export async function usedBagSlots(tx: Tx, playerId: bigint): Promise<number> {
  const rows = await tx.player_item.findMany({ where: { player_id: playerId }, include: { item_definition: true } });
  return rows.filter((r) => !STORY_CATEGORIES.has(r.item_definition.category)).reduce((sum, r) => sum + slotsOf(r.quantity, r.item_definition.max_stack), 0);
}

// 보유 행이 없으면 만들고, 있으면 수량을 늘린다. 최초 획득 시각은 처음 한 번만 기록한다.
// locked: 스토리 아이템(판매·폐기·일반 소비 불가)은 지급할 때 잠금으로 기록한다(v3 §2.1)
export async function addToPlayerItem(tx: Tx, playerId: bigint, itemDefinitionId: number, quantity: number, now = new Date(), locked = false) {
  const key = { player_id_item_definition_id: { player_id: playerId, item_definition_id: itemDefinitionId } };
  const owned = await tx.player_item.findUnique({ where: key });
  if (owned) {
    await tx.player_item.update({
      where: key,
      data: { quantity: { increment: quantity }, last_acquired_at: now, is_new: true, first_acquired_at: owned.first_acquired_at ?? now, ...(locked ? { is_locked: true } : {}) },
    });
  } else {
    await tx.player_item.create({ data: { player_id: playerId, item_definition_id: itemDefinitionId, quantity, first_acquired_at: now, last_acquired_at: now, is_new: true, is_locked: locked } });
  }
}
