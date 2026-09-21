import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { INSTANCE_INCLUDE, gameError, toTurbyDto } from './turby-dto';

interface ShopProductDto {
  id: number;
  productType: 'turby' | 'item';
  code: string;
  name: string;
  description: string;
  price: number;
  stats: { attack: number; defense: number; actionPower: number; maxHp: number };
  equipSlot: string | null;
}

// 4.1: 기본 NPC 상점 — 상품/가격은 shop_product(DB)가 진실. 가격·잔액·소유권은 전부 서버가 검증하고,
// 같은 requestId는 한 번만 처리(이중 탭/재시도로 두 번 차감되지 않음).
@Injectable()
export class ShopService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(): Promise<ShopProductDto[]> {
    const products = await this.prisma.shop_product.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } });
    const turbyCodes = products.filter((p) => p.product_type === 'turby').map((p) => p.ref_code);
    const itemCodes = products.filter((p) => p.product_type === 'item').map((p) => p.ref_code);
    const [characters, items] = await Promise.all([
      this.prisma.turby_character.findMany({ where: { code: { in: turbyCodes } }, include: { turby_grade: true } }),
      this.prisma.item_definition.findMany({ where: { code: { in: itemCodes } } }),
    ]);

    return products.flatMap((p): ShopProductDto[] => {
      if (p.product_type === 'turby') {
        const c = characters.find((x) => x.code === p.ref_code);
        if (!c) return [];
        const g = c.turby_grade;
        return [
          {
            id: p.id,
            productType: 'turby' as const,
            code: c.code,
            name: c.name,
            description: `${g.name} 등급 터비`,
            price: p.price_tare,
            stats: {
              attack: (g.base_attack ?? 0) + c.atk_mod,
              defense: (g.base_defense ?? 0) + c.def_mod,
              actionPower: (g.base_action_power ?? 0) + c.ap_mod,
              maxHp: (g.base_hp ?? 0) + c.hp_mod,
            },
            equipSlot: null,
          },
        ];
      }
      const it = items.find((x) => x.code === p.ref_code);
      if (!it) return [];
      return [
        {
          id: p.id,
          productType: 'item' as const,
          code: it.code,
          name: it.name,
          description: it.description ?? '',
          price: p.price_tare,
          stats: { attack: it.atk_bonus, defense: it.def_bonus, actionPower: it.ap_bonus, maxHp: it.hp_bonus },
          equipSlot: it.equip_slot,
        },
      ];
    });
  }

  async purchase(playerIdStr: string, productId: number, requestId: string) {
    if (!Number.isInteger(productId) || productId <= 0) throw gameError(400, 'INVALID_PRODUCT', '상품 정보가 올바르지 않습니다.');
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 64) throw gameError(400, 'INVALID_REQUEST', '요청 정보가 올바르지 않습니다.');
    const playerId = BigInt(playerIdStr);

    const previous = await this.prisma.shop_purchase.findUnique({ where: { request_id: requestId } });
    if (previous) return this.replay(previous, playerId);

    const product = await this.prisma.shop_product.findUnique({ where: { id: productId } });
    if (!product || !product.is_active) throw new NotFoundException('product not found');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({ where: { id: playerId } });
        if (!player) throw new NotFoundException('player not found');

        // 결제 대상(캐릭터/아이템)이 실제로 존재하는지 먼저 확인 — 없으면 차감 전에 실패
        const character = product.product_type === 'turby' ? await tx.turby_character.findUnique({ where: { code: product.ref_code } }) : null;
        const item = product.product_type === 'item' ? await tx.item_definition.findUnique({ where: { code: product.ref_code } }) : null;
        if (!character && !item) throw gameError(404, 'PRODUCT_UNAVAILABLE', '판매할 수 없는 상품입니다.');

        // requestId 유니크 키가 동시에 들어온 같은 요청을 막고, 조건부 차감이 잔액 부족/경합을 막는다
        const purchase = await tx.shop_purchase.create({ data: { request_id: requestId, player_id: playerId, product_id: product.id, price_tare: product.price_tare } });
        const charged = await tx.player.updateMany({
          where: { id: playerId, tare_balance: { gte: product.price_tare } },
          data: { tare_balance: { decrement: product.price_tare } },
        });
        if (charged.count === 0) throw gameError(400, 'INSUFFICIENT_TARE', '타레가 부족합니다.');

        let turbyDto: ReturnType<typeof toTurbyDto> | null = null;
        if (character) {
          const created = await tx.turby_instance.create({ data: { owner_player_id: playerId, character_id: character.id, acquired_via: 'shop' }, include: INSTANCE_INCLUDE });
          await tx.shop_purchase.update({ where: { id: purchase.id }, data: { turby_instance_id: created.id } });
          turbyDto = toTurbyDto(created);
        } else if (item) {
          await tx.player_item.upsert({
            where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: item.id } },
            update: { quantity: { increment: 1 } },
            create: { player_id: playerId, item_definition_id: item.id, quantity: 1 },
          });
        }

        const after = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
        return { duplicate: false, tareBalance: after.tare_balance, turby: turbyDto, itemCode: item?.code ?? null };
      });
    } catch (err) {
      // 같은 requestId가 동시에 두 번 들어와 유니크 키에 걸린 경우 — 먼저 성공한 결과를 돌려준다
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.shop_purchase.findUnique({ where: { request_id: requestId } });
        if (winner) return this.replay(winner, playerId);
      }
      throw err;
    }
  }

  private async replay(purchase: { player_id: bigint; product_id: number; turby_instance_id: bigint | null }, playerId: bigint) {
    if (purchase.player_id !== playerId) throw gameError(403, 'REQUEST_OWNER_MISMATCH', '다른 플레이어의 요청입니다.');
    const [player, product, instance] = await Promise.all([
      this.prisma.player.findUniqueOrThrow({ where: { id: playerId } }),
      this.prisma.shop_product.findUnique({ where: { id: purchase.product_id } }),
      purchase.turby_instance_id ? this.prisma.turby_instance.findUnique({ where: { id: purchase.turby_instance_id }, include: INSTANCE_INCLUDE }) : null,
    ]);
    return {
      duplicate: true,
      tareBalance: player.tare_balance,
      turby: instance ? toTurbyDto(instance) : null,
      itemCode: product?.product_type === 'item' ? product.ref_code : null,
    };
  }
}
