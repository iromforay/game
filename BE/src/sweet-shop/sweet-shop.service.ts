import { Injectable, UnauthorizedException } from '@nestjs/common';
import { INGREDIENTS, RECIPES, type DessertQuality, type IngredientId, type RecipeId, type SweetShopCafeState, type SweetShopResult } from 'sweet-shop-contracts';
import { AccountService } from '../account/account.service';
import { PrismaService } from '../scoreboard/prisma.service';

const qualities: DessertQuality[] = ['normal', 'good', 'excellent', 'premium'];
const recipe = (id: string) => RECIPES.find((x) => x.id === id);
const good = <T>(data: T, message?: string): SweetShopResult<T> => ({ ok: true, data, message });
const bad = <T>(code: string, message: string): SweetShopResult<T> => ({ ok: false, code, message });

@Injectable()
export class SweetShopService {
  constructor(private readonly prisma: PrismaService, private readonly accounts: AccountService) {}

  private async profile(token: unknown, guestId: unknown) {
    // 비회원 요청은 공통 계정 인증 로직을 통과시키지 않는다.
    // token:null을 계정 서비스에 전달하면 구버전 서버에서 NOT_LOGGED_IN 예외가 날 수 있다.
    const accountId = typeof token === 'string' && token.length > 0
      ? await this.accounts.resolveAccountId(token)
      : null;
    const guest = typeof guestId === 'string' && /^[0-9a-f-]{20,64}$/i.test(guestId) ? guestId : null;
    if (accountId) {
      let profile = await this.prisma.sweet_shop_profile.findUnique({ where: { account_id: accountId } });
      if (!profile && guest) {
        const guestProfile = await this.prisma.sweet_shop_profile.findUnique({ where: { guest_id: guest } });
        if (guestProfile && !guestProfile.account_id) profile = await this.prisma.sweet_shop_profile.update({ where: { profile_id: guestProfile.profile_id }, data: { account_id: accountId } });
      } else if (profile && guest) {
        const guestProfile = await this.prisma.sweet_shop_profile.findUnique({ where: { guest_id: guest } });
        if (guestProfile && guestProfile.profile_id !== profile.profile_id && !guestProfile.account_id) profile = await this.mergeGuestProfile(profile.profile_id, guestProfile.profile_id, guest);
      }
      profile ??= await this.prisma.sweet_shop_profile.create({ data: { account_id: accountId, guest_id: guest } });
      const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { nickname: true } });
      return { profileId: profile.profile_id, nickname: account.nickname };
    }
    if (!guest) throw new UnauthorizedException({ code: 'GUEST_ID_REQUIRED', message: '브라우저 식별 정보가 필요합니다.' });
    const profile = await this.prisma.sweet_shop_profile.upsert({ where: { guest_id: guest }, create: { guest_id: guest }, update: {} });
    return { profileId: profile.profile_id, nickname: `손님${profile.profile_id.toString().padStart(4, '0')}` };
  }

  private async mergeGuestProfile(memberId: bigint, guestId: bigint, browserGuestId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [member, guest, memberStorage, guestStorage, ingredients, recipes] = await Promise.all([
        tx.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: memberId } }),
        tx.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: guestId } }),
        tx.sweet_shop_storage.findUnique({ where: { profile_id: memberId } }),
        tx.sweet_shop_storage.findUnique({ where: { profile_id: guestId } }),
        tx.sweet_shop_ingredient.findMany({ where: { profile_id: guestId } }),
        tx.sweet_shop_recipe_progress.findMany({ where: { profile_id: guestId } }),
      ]);
      for (const item of ingredients) await tx.sweet_shop_ingredient.upsert({ where: { profile_id_ingredient_id_quality: { profile_id: memberId, ingredient_id: item.ingredient_id, quality: item.quality } }, create: { profile_id: memberId, ingredient_id: item.ingredient_id, quality: item.quality, quantity: item.quantity }, update: { quantity: { increment: item.quantity } } });
      for (const item of recipes) { const current = await tx.sweet_shop_recipe_progress.findUnique({ where: { profile_id_recipe_id: { profile_id: memberId, recipe_id: item.recipe_id } } }); await tx.sweet_shop_recipe_progress.upsert({ where: { profile_id_recipe_id: { profile_id: memberId, recipe_id: item.recipe_id } }, create: { ...item, profile_id: memberId }, update: { mastery_level: Math.max(current?.mastery_level ?? 1, item.mastery_level), mastery_experience: (current?.mastery_experience ?? 0) + item.mastery_experience, total_cooked: (current?.total_cooked ?? 0) + item.total_cooked, highest_quality: Math.max(current?.highest_quality ?? 0, item.highest_quality) } }); }
      await tx.sweet_shop_delivery.updateMany({ where: { profile_id: guestId }, data: { profile_id: memberId } });
      await tx.sweet_shop_cooking_job.updateMany({ where: { profile_id: guestId }, data: { profile_id: memberId } });
      await tx.sweet_shop_dessert.updateMany({ where: { owner_profile_id: guestId }, data: { owner_profile_id: memberId } });
      await tx.sweet_shop_dessert.updateMany({ where: { creator_profile_id: guestId }, data: { creator_profile_id: memberId } });
      await tx.sweet_shop_listing.updateMany({ where: { seller_profile_id: guestId }, data: { seller_profile_id: memberId } });
      await tx.sweet_shop_trade.updateMany({ where: { seller_profile_id: guestId }, data: { seller_profile_id: memberId } });
      await tx.sweet_shop_trade.updateMany({ where: { buyer_profile_id: guestId }, data: { buyer_profile_id: memberId } });
      await tx.sweet_shop_guestbook.updateMany({ where: { cafe_owner_profile_id: guestId }, data: { cafe_owner_profile_id: memberId } });
      await tx.sweet_shop_guestbook.updateMany({ where: { visitor_profile_id: guestId }, data: { visitor_profile_id: memberId } });
      const socialTableCount = await tx.$queryRawUnsafe<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('sweet_shop_friend','sweet_shop_block','sweet_shop_report','sweet_shop_chat_message')");
      if (Number(socialTableCount[0]?.count ?? 0) === 4) {
        await tx.$executeRawUnsafe('INSERT IGNORE INTO sweet_shop_friend (profile_id, friend_profile_id, created_at) SELECT ?, friend_profile_id, created_at FROM sweet_shop_friend WHERE profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('UPDATE IGNORE sweet_shop_friend SET friend_profile_id = ? WHERE friend_profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('DELETE FROM sweet_shop_friend WHERE profile_id = ? OR friend_profile_id = ?', guestId, guestId);
        await tx.$executeRawUnsafe('INSERT IGNORE INTO sweet_shop_block (profile_id, blocked_profile_id, created_at) SELECT ?, blocked_profile_id, created_at FROM sweet_shop_block WHERE profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('UPDATE IGNORE sweet_shop_block SET blocked_profile_id = ? WHERE blocked_profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('DELETE FROM sweet_shop_block WHERE profile_id = ? OR blocked_profile_id = ?', guestId, guestId);
        await tx.$executeRawUnsafe('UPDATE sweet_shop_report SET reporter_profile_id = ? WHERE reporter_profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('UPDATE sweet_shop_report SET target_profile_id = ? WHERE target_profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('UPDATE sweet_shop_chat_message SET sender_profile_id = ? WHERE sender_profile_id = ?', memberId, guestId);
        await tx.$executeRawUnsafe('UPDATE sweet_shop_chat_message SET cafe_profile_id = ? WHERE cafe_profile_id = ?', memberId, guestId);
      }
      const guestAd = await tx.$queryRawUnsafe<Array<{ ends_at: Date }>>('SELECT ends_at FROM sweet_shop_advertisement WHERE profile_id = ? LIMIT 1', guestId);
      if (guestAd[0]) await tx.$executeRawUnsafe('INSERT INTO sweet_shop_advertisement (profile_id, ends_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE ends_at = GREATEST(ends_at, VALUES(ends_at))', memberId, guestAd[0].ends_at);
      await tx.$executeRawUnsafe('DELETE FROM sweet_shop_advertisement WHERE profile_id = ?', guestId);
      await tx.sweet_shop_ingredient.deleteMany({ where: { profile_id: guestId } });
      await tx.sweet_shop_recipe_progress.deleteMany({ where: { profile_id: guestId } });
      if (guestStorage) await tx.sweet_shop_storage.upsert({ where: { profile_id: memberId }, create: { profile_id: memberId, ingredient_slot_limit: guestStorage.ingredient_slot_limit, dessert_slot_limit: guestStorage.dessert_slot_limit }, update: { ingredient_slot_limit: Math.max(memberStorage?.ingredient_slot_limit ?? 0, guestStorage.ingredient_slot_limit), dessert_slot_limit: Math.max(memberStorage?.dessert_slot_limit ?? 0, guestStorage.dessert_slot_limit) } });
      if (guestStorage) await tx.sweet_shop_storage.delete({ where: { profile_id: guestId } });
      await tx.sweet_shop_profile.delete({ where: { profile_id: guestId } });
      return tx.sweet_shop_profile.update({ where: { profile_id: memberId }, data: { guest_id: member.guest_id ?? browserGuestId, level: Math.max(member.level, guest.level), experience: Math.max(member.experience, guest.experience), gold: Math.max(member.gold, guest.gold), first_cooking_tutorial_completed: member.first_cooking_tutorial_completed || guest.first_cooking_tutorial_completed, last_played_at: new Date() } });
    });
  }

  realtimeIdentity(token: unknown, guestId: unknown) { return this.profile(token, guestId); }

  private async prepare(id: bigint) {
    // 카페 화면은 짧은 주기로 다시 읽히므로 같은 계정의 prepare가 겹칠 수 있다.
    // 기존 행까지 UPDATE하는 upsert 배치 대신 중복을 무시하는 초기 INSERT만 수행한다.
    await this.prisma.sweet_shop_storage.createMany({ data: [{ profile_id: id }], skipDuplicates: true });
    await this.prisma.sweet_shop_recipe_progress.createMany({
      data: [{ profile_id: id, recipe_id: 'butter-cookie' }],
      skipDuplicates: true,
    });
    const now = new Date();
    await this.prisma.sweet_shop_delivery.updateMany({ where: { profile_id: id, status: 'ordered', arrives_at: { lte: now } }, data: { status: 'arrived' } });
    await this.prisma.sweet_shop_cooking_job.updateMany({ where: { profile_id: id, status: { in: ['queued', 'cooking'] }, completes_at: { lte: now } }, data: { status: 'completed' } });
    await this.prisma.sweet_shop_cooking_job.updateMany({ where: { profile_id: id, status: 'queued', started_at: { lte: now }, completes_at: { gt: now } }, data: { status: 'cooking' } });
    const firstButterCookie = await this.prisma.sweet_shop_cooking_job.findFirst({
      where: { profile_id: id, recipe_id: 'butter-cookie', completes_at: { lte: now } },
      select: { id: true },
    });
    if (firstButterCookie) await this.prisma.sweet_shop_profile.updateMany({
      where: { profile_id: id, first_cooking_tutorial_completed: false },
      data: { first_cooking_tutorial_completed: true },
    });
    await this.prisma.sweet_shop_profile.updateMany({ where: { profile_id: id, buff_ends_at: { lte: now } }, data: { buff_source_dessert_name: null, buff_quality_bonus: null, buff_eligible_recipe_level: null, buff_ends_at: null } });
  }

  async loadCafe(token: unknown, request?: any): Promise<SweetShopCafeState> {
    const identity = await this.profile(token, request?.guestId); const id = identity.profileId; await this.prepare(id);
    const [p, s, ingredients, progress, deliveries, jobs, desserts, listings, trades] = await Promise.all([
      this.prisma.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: id } }),
      this.prisma.sweet_shop_storage.findUniqueOrThrow({ where: { profile_id: id } }),
      this.prisma.sweet_shop_ingredient.findMany({ where: { profile_id: id, quantity: { gt: 0 } } }),
      this.prisma.sweet_shop_recipe_progress.findMany({ where: { profile_id: id } }),
      this.prisma.sweet_shop_delivery.findMany({ where: { profile_id: id }, orderBy: { id: 'asc' } }),
      this.prisma.sweet_shop_cooking_job.findMany({ where: { profile_id: id }, orderBy: { id: 'asc' } }),
      this.prisma.sweet_shop_dessert.findMany({ where: { owner_profile_id: id, quantity: { gt: 0 } }, orderBy: { id: 'asc' } }),
      this.prisma.sweet_shop_listing.findMany({ where: { seller_profile_id: id, status: 'active', quantity: { gt: 0 } }, orderBy: { id: 'asc' } }),
      this.prisma.sweet_shop_trade.findMany({ where: { seller_profile_id: id }, orderBy: { created_at: 'desc' }, take: 20 }),
    ]);
    const listedDesserts = await this.prisma.sweet_shop_dessert.findMany({ where: { id: { in: listings.map((x) => x.dessert_id) } } });
    const ownDesserts = new Map([...desserts, ...listedDesserts].map((x) => [x.id.toString(), x]));
    const tradeDesserts = await this.prisma.sweet_shop_dessert.findMany({ where: { id: { in: trades.map((x) => x.dessert_id) } } });
    const sold = new Map(tradeDesserts.map((x) => [x.id.toString(), x]));
    return {
      profile: { profileId: p.profile_id.toString(), ownerName: identity.nickname, cafeName: p.cafe_name, level: p.level, experience: p.experience, gold: p.gold },
      storage: { ingredientSlotLimit: s.ingredient_slot_limit, dessertSlotLimit: s.dessert_slot_limit }, tutorial: { firstCookingCompleted: p.first_cooking_tutorial_completed },
      ingredients: Object.fromEntries(ingredients.map((x) => [x.ingredient_id, x.quantity])), unlockedRecipes: progress.map((x) => x.recipe_id) as RecipeId[],
      deliveries: deliveries.map((x) => ({ id: x.id.toString(), ingredientId: x.ingredient_id as IngredientId, quantity: x.quantity, totalPrice: x.total_price, orderedAt: x.ordered_at.toISOString(), arrivesAt: x.arrives_at.toISOString(), status: x.status.toUpperCase() as any })),
      cookingJobs: jobs.map((x) => ({ id: x.id.toString(), recipeId: x.recipe_id as RecipeId, quantity: x.quantity, startedAt: x.started_at.toISOString(), completesAt: x.completes_at.toISOString(), status: x.status.toUpperCase() as any })),
      desserts: desserts.map((x) => ({ id: x.id.toString(), recipeId: x.recipe_id as RecipeId, name: recipe(x.recipe_id)?.name ?? x.recipe_id, quantity: x.quantity, quality: qualities[x.quality - 1] ?? 'normal', createdAt: x.created_at.toISOString(), level: x.dessert_level, makerName: x.creator_profile_id === id ? identity.nickname : '이웃 파티시에', source: x.creator_profile_id === id ? 'crafted' : 'npc-cafe' })),
      recipeProgress: Object.fromEntries(progress.map((x) => [x.recipe_id, { masteryExperience: x.mastery_experience, craftCount: x.total_cooked, bestQuality: qualities[x.highest_quality - 1] ?? null }])),
      listings: listings.map((x) => { const d = ownDesserts.get(x.dessert_id.toString()); return { id: x.id.toString(), dessertId: x.dessert_id.toString(), recipeId: (d?.recipe_id ?? 'butter-cookie') as RecipeId, name: recipe(d?.recipe_id ?? '')?.name ?? '디저트', quality: qualities[(d?.quality ?? 1) - 1] ?? 'normal', quantity: x.quantity, unitPrice: x.unit_price, listedAt: x.listed_at.toISOString(), nextNpcPurchaseAt: '2099-01-01T00:00:00.000Z' }; }),
      sales: trades.map((x) => ({ id: x.id.toString(), listingId: x.listing_id.toString(), dessertName: recipe(sold.get(x.dessert_id.toString())?.recipe_id ?? '')?.name ?? '디저트', quantity: x.quantity, totalPrice: x.total_price, buyerName: '이웃 손님', soldAt: x.created_at.toISOString() })),
      buff: p.buff_ends_at && p.buff_ends_at > new Date() ? { sourceDessertName: p.buff_source_dessert_name ?? '디저트', qualityBonus: p.buff_quality_bonus === 2 ? 2 : 1, eligibleRecipeLevel: p.buff_eligible_recipe_level ?? 1, endsAt: p.buff_ends_at.toISOString() } : null,
      updatedAt: p.updated_at.toISOString(),
    };
  }

  async orderIngredients(token: unknown, r: any) {
    const id = (await this.profile(token, r.guestId)).profileId; await this.prepare(id); const item = INGREDIENTS.find((x) => x.id === r.ingredientId); const qty = Math.floor(r.quantity);
    if (!item || qty < 1 || qty > 99) return bad('INVALID_ORDER', '주문 수량은 1~99개까지 가능합니다.');
    const old = await this.prisma.sweet_shop_delivery.findUnique({ where: { request_id: r.requestId } }); if (old) return good({ deliveryId: old.id.toString() });
    const price = item.unitPrice * qty; const paid = await this.prisma.sweet_shop_profile.updateMany({ where: { profile_id: id, gold: { gte: price } }, data: { gold: { decrement: price } } });
    if (!paid.count) return bad('NOT_ENOUGH_GOLD', '골드가 부족합니다.');
    const now = new Date(); const d = await this.prisma.sweet_shop_delivery.create({ data: { request_id: r.requestId, profile_id: id, ingredient_id: item.id, quantity: qty, total_price: price, ordered_at: now, arrives_at: new Date(now.getTime() + item.deliverySeconds * 1000) } });
    return good({ deliveryId: d.id.toString() }, `${item.name} ${qty}개를 주문했습니다.`);
  }

  async receiveDelivery(token: unknown, r: any) {
    const id = (await this.profile(token, r.guestId)).profileId; await this.prepare(id); const d = await this.prisma.sweet_shop_delivery.findFirst({ where: { id: BigInt(r.deliveryId), profile_id: id } });
    if (!d || d.status === 'received') return bad('DELIVERY_NOT_FOUND', '받을 배송이 없습니다.'); if (d.arrives_at > new Date()) return bad('DELIVERY_NOT_READY', '아직 배송 중입니다.');
    await this.prisma.$transaction([this.prisma.sweet_shop_ingredient.upsert({ where: { profile_id_ingredient_id_quality: { profile_id: id, ingredient_id: d.ingredient_id, quality: d.quality } }, create: { profile_id: id, ingredient_id: d.ingredient_id, quality: d.quality, quantity: d.quantity }, update: { quantity: { increment: d.quantity } } }), this.prisma.sweet_shop_delivery.update({ where: { id: d.id }, data: { status: 'received', received_at: new Date() } })]);
    return good(await this.loadCafe(token, r), '재료를 보관함에 넣었습니다.');
  }

  async startCooking(token: unknown, r: any) {
    const id = (await this.profile(token, r.guestId)).profileId; await this.prepare(id); const item = recipe(r.recipeId); const qty = Math.floor(r.quantity);
    if (!item || qty < 1) return bad('INVALID_RECIPE', '조리할 레시피를 확인해주세요.');
    if (!await this.prisma.sweet_shop_recipe_progress.findUnique({ where: { profile_id_recipe_id: { profile_id: id, recipe_id: item.id } } })) return bad('RECIPE_LOCKED', '아직 획득하지 않은 레시피입니다.');
    const queue = await this.prisma.sweet_shop_cooking_job.findMany({ where: { profile_id: id, status: { not: 'received' } }, orderBy: { completes_at: 'desc' } }); if (queue.length >= 5) return bad('COOKING_QUEUE_FULL', '조리 대기열 5칸이 모두 찼습니다.');
    const stock = await this.prisma.sweet_shop_ingredient.findMany({ where: { profile_id: id, quality: 1 } });
    for (const [key, amount] of Object.entries(item.ingredients)) if ((stock.find((x) => x.ingredient_id === key)?.quantity ?? 0) < (amount ?? 0) * qty) return bad('NOT_ENOUGH_INGREDIENTS', '필요한 재료가 부족합니다.');
    const starts = new Date(Math.max(Date.now(), queue[0]?.completes_at.getTime() ?? 0)); const completes = new Date(starts.getTime() + item.cookSeconds * qty * 1000);
    const job = await this.prisma.$transaction(async (tx) => { for (const [key, amount] of Object.entries(item.ingredients)) await tx.sweet_shop_ingredient.update({ where: { profile_id_ingredient_id_quality: { profile_id: id, ingredient_id: key, quality: 1 } }, data: { quantity: { decrement: (amount ?? 0) * qty } } }); return tx.sweet_shop_cooking_job.create({ data: { request_id: r.requestId, profile_id: id, recipe_id: item.id, quantity: qty, status: queue.length ? 'queued' : 'cooking', started_at: starts, completes_at: completes } }); });
    return good({ cookingId: job.id.toString(), completesAt: completes.toISOString() }, `${item.name} 조리를 대기열에 추가했습니다.`);
  }

  async receiveCooking(token: unknown, r: any) {
    const id = (await this.profile(token, r.guestId)).profileId; await this.prepare(id); const job = await this.prisma.sweet_shop_cooking_job.findFirst({ where: { id: BigInt(r.cookingId), profile_id: id } });
    if (!job || job.status === 'received') return bad('COOKING_NOT_FOUND', '받을 디저트가 없습니다.'); if (job.completes_at > new Date()) return bad('COOKING_NOT_READY', '아직 조리 중입니다.');
    const p = await this.prisma.sweet_shop_recipe_progress.findUniqueOrThrow({ where: { profile_id_recipe_id: { profile_id: id, recipe_id: job.recipe_id } } }); const roll = Math.random() * 100; const q = roll < 5 ? 3 : roll < 25 ? 2 : 1; const item = recipe(job.recipe_id)!;
    const d = await this.prisma.$transaction(async (tx) => { const made = await tx.sweet_shop_dessert.create({ data: { owner_profile_id: id, creator_profile_id: id, recipe_id: job.recipe_id, dessert_level: item.level, quality: q, quantity: job.quantity } }); await tx.sweet_shop_cooking_job.update({ where: { id: job.id }, data: { status: 'received', received_at: new Date() } }); await tx.sweet_shop_recipe_progress.update({ where: { profile_id_recipe_id: { profile_id: id, recipe_id: job.recipe_id } }, data: { mastery_experience: { increment: 10 * job.quantity }, total_cooked: { increment: job.quantity }, highest_quality: Math.max(p.highest_quality, q) } }); await tx.sweet_shop_profile.update({ where: { profile_id: id }, data: { experience: { increment: 5 * job.quantity }, ...(job.recipe_id === 'butter-cookie' ? { first_cooking_tutorial_completed: true } : {}) } }); return made; });
    const total = (await this.prisma.sweet_shop_recipe_progress.aggregate({ where: { profile_id: id }, _sum: { total_cooked: true } }))._sum.total_cooked ?? 0; const unlocks = [[1, 'milk-pudding'], [3, 'strawberry-macaron'], [6, 'choco-cupcake'], [10, 'honey-cake'], [15, 'vanilla-cream-puff'], [21, 'berry-tart'], [28, 'caramel-eclair'], [36, 'royal-choco-gateau'], [45, 'starlight-celebration-cake']] as const; for (const [count, rid] of unlocks) if (total >= count) await this.prisma.sweet_shop_recipe_progress.upsert({ where: { profile_id_recipe_id: { profile_id: id, recipe_id: rid } }, create: { profile_id: id, recipe_id: rid }, update: {} }); const nextLevel = 1 + unlocks.filter(([count]) => total >= count).length; await this.prisma.sweet_shop_profile.updateMany({ where: { profile_id: id, level: { lt: nextLevel } }, data: { level: nextLevel } });
    return good({ dessertId: d.id.toString() }, `${item.name}이 완성되었습니다.`);
  }

  async completeFirstCookingTutorial(token: unknown, r?: any) { const id = (await this.profile(token, r?.guestId)).profileId; await this.prisma.sweet_shop_profile.update({ where: { profile_id: id }, data: { first_cooking_tutorial_completed: true } }); return this.loadCafe(token, r); }

  async createListing(token: unknown, r: any) {
    const id = (await this.profile(token, r.guestId)).profileId; const dessertId = BigInt(r.dessertId); const qty = Math.floor(r.quantity); const price = Math.floor(r.unitPrice); const old = await this.prisma.sweet_shop_listing.findUnique({ where: { request_id: r.requestId } }); if (old) return good({ listingId: old.id.toString() });
    const activeCount = await this.prisma.sweet_shop_listing.count({ where: { seller_profile_id: id, status: 'active', quantity: { gt: 0 } } });
    if (activeCount >= 3) return bad('DISPLAY_FULL', '판매대 3칸이 모두 사용 중입니다.'); const d = await this.prisma.sweet_shop_dessert.findFirst({ where: { id: dessertId, owner_profile_id: id, creator_profile_id: id } }); if (!d || qty < 1 || d.quantity < qty || price < 1) return bad('INVALID_LISTING', '진열할 상품을 확인해주세요.');
    const listing = await this.prisma.$transaction(async (tx) => { await tx.sweet_shop_dessert.update({ where: { id: dessertId }, data: { quantity: { decrement: qty } } }); return tx.sweet_shop_listing.create({ data: { request_id: r.requestId, seller_profile_id: id, dessert_id: dessertId, quantity: qty, unit_price: price } }); }); return good({ listingId: listing.id.toString(), profileId: id.toString(), cafeOpened: activeCount === 0 }, '판매대에 진열했습니다.');
  }

  async updateListing(token: unknown, r: any) { const id = (await this.profile(token, r.guestId)).profileId; const listing = await this.prisma.sweet_shop_listing.findFirst({ where: { id: BigInt(r.listingId), seller_profile_id: id, status: 'active' } }); if (!listing) return bad('LISTING_NOT_FOUND', '진열 상품을 찾지 못했습니다.'); await this.prisma.sweet_shop_listing.update({ where: { id: listing.id }, data: { unit_price: Math.max(1, Math.floor(r.unitPrice)) } }); return good({ listingId: listing.id.toString(), profileId: id.toString() }); }
  async removeListing(token: unknown, r: any) { const id = (await this.profile(token, r.guestId)).profileId; const x = await this.prisma.sweet_shop_listing.findFirst({ where: { id: BigInt(r.listingId), seller_profile_id: id, status: 'active' } }); if (!x) return bad('LISTING_NOT_FOUND', '진열 상품을 찾지 못했습니다.'); await this.prisma.$transaction([this.prisma.sweet_shop_dessert.update({ where: { id: x.dessert_id }, data: { quantity: { increment: x.quantity } } }), this.prisma.sweet_shop_listing.update({ where: { id: x.id }, data: { status: 'removed' } })]); const remaining = await this.prisma.sweet_shop_listing.count({ where: { seller_profile_id: id, status: 'active', quantity: { gt: 0 } } }); return good({ listingId: x.id.toString(), profileId: id.toString(), cafeClosed: remaining === 0 }); }

  async listCafeStreet(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const rows = await this.prisma.sweet_shop_listing.findMany({ where: { seller_profile_id: { not: me }, status: 'active', quantity: { gt: 0 } }, distinct: ['seller_profile_id'] }); let ads: Array<{ profile_id: bigint }> = []; try { ads = await this.prisma.$queryRawUnsafe<Array<{ profile_id: bigint }>>('SELECT profile_id FROM sweet_shop_advertisement WHERE ends_at > CURRENT_TIMESTAMP'); } catch { /* 광고 마이그레이션 전에도 기본 카페 목록은 제공한다. */ } let blocked = new Set<string>(); try { const blocks = await this.prisma.$queryRawUnsafe<Array<{ profile_id: bigint }>>('SELECT blocked_profile_id AS profile_id FROM sweet_shop_block WHERE profile_id = ? UNION SELECT profile_id FROM sweet_shop_block WHERE blocked_profile_id = ?', me, me); blocked = new Set(blocks.map((x) => x.profile_id.toString())); } catch { /* 소셜 관계 마이그레이션 전에는 차단 필터를 생략한다. */ } const advertised = new Set(ads.map((x) => x.profile_id.toString())); const visibleRows = rows.filter((x) => !blocked.has(x.seller_profile_id.toString())); const data = await Promise.all(visibleRows.map(async (x) => { const [p, d, count] = await Promise.all([this.prisma.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: x.seller_profile_id } }), this.prisma.sweet_shop_dessert.findUnique({ where: { id: x.dessert_id } }), this.prisma.sweet_shop_listing.count({ where: { seller_profile_id: x.seller_profile_id, status: 'active' } })]); const u = p.account_id ? await this.prisma.account.findUnique({ where: { id: p.account_id } }) : null; return { profileId: p.profile_id.toString(), cafeName: p.cafe_name, ownerName: u?.nickname ?? `손님${p.profile_id.toString().padStart(4, '0')}`, icon: '🏠', level: p.level, representativeDessert: recipe(d?.recipe_id ?? '')?.name ?? '오늘의 디저트', listingCount: count, advertised: advertised.has(p.profile_id.toString()) }; })); data.sort((a, b) => Number(b.advertised) - Number(a.advertised)); return good(data); }

  async visitCafe(token: unknown, r: any) { return this.getCafeForViewer(r.cafeProfileId, token, r.guestId); }

  async getCafeForViewer(profileId: unknown, token: unknown, guestId: unknown) { const viewer = await this.profile(token, guestId); const raw = String(profileId ?? ''); if (!/^\d+$/.test(raw)) return bad('CAFE_NOT_FOUND', '카페를 찾지 못했습니다.'); const owner = BigInt(raw); if (viewer.profileId !== owner && await this.isInteractionBlocked(viewer.profileId, owner)) return bad('PROFILE_BLOCKED', '방문할 수 없는 카페입니다.'); return this.getCafe(profileId); }

  async getCafe(profileId: unknown) {
    const raw = String(profileId ?? '');
    if (!/^\d+$/.test(raw)) return bad('CAFE_NOT_FOUND', '카페를 찾지 못했습니다.');
    const owner = BigInt(raw); const [p, rows, notes] = await Promise.all([this.prisma.sweet_shop_profile.findUnique({ where: { profile_id: owner } }), this.prisma.sweet_shop_listing.findMany({ where: { seller_profile_id: owner, status: 'active', quantity: { gt: 0 } } }), this.prisma.sweet_shop_guestbook.findMany({ where: { cafe_owner_profile_id: owner }, orderBy: { created_at: 'desc' }, take: 20 })]); if (!p) return bad('CAFE_NOT_FOUND', '카페를 찾지 못했습니다.'); const u = p.account_id ? await this.prisma.account.findUnique({ where: { id: p.account_id } }) : null; const listings = await Promise.all(rows.map(async (x) => { const d = await this.prisma.sweet_shop_dessert.findUniqueOrThrow({ where: { id: x.dessert_id } }); return { id: x.id.toString(), recipeId: d.recipe_id as RecipeId, name: recipe(d.recipe_id)?.name ?? '디저트', quality: qualities[d.quality - 1] ?? 'normal', level: d.dessert_level, quantity: x.quantity, unitPrice: x.unit_price }; })); const guestbook = await Promise.all(notes.map(async (note) => { const visitor = await this.prisma.sweet_shop_profile.findUnique({ where: { profile_id: note.visitor_profile_id } }); const account = visitor?.account_id ? await this.prisma.account.findUnique({ where: { id: visitor.account_id } }) : null; return { id: note.id.toString(), visitorName: account?.nickname ?? `손님${note.visitor_profile_id.toString().padStart(4, '0')}`, messageCode: note.message_code, stickerCode: note.sticker_code ?? undefined, replyStickerCode: note.reply_sticker_code ?? undefined, createdAt: note.created_at.toISOString() }; })); return good({ profileId: owner.toString(), cafeName: p.cafe_name, ownerName: u?.nickname ?? `손님${owner.toString().padStart(4, '0')}`, icon: '🏠', level: p.level, representativeDessert: listings[0]?.name ?? '오늘의 디저트', listingCount: listings.length, greeting: '정성껏 만든 디저트를 구경해보세요!', listings, guestbook });
  }

  async buyDessert(token: unknown, r: any) {
    const buyer = (await this.profile(token, r.guestId)).profileId; const listingId = BigInt(r.listingId); const qty = Math.floor(r.quantity); const old = await this.prisma.sweet_shop_trade.findUnique({ where: { request_id: r.requestId } }); if (old) return good({ dessertId: old.dessert_id.toString() });
    const targetListing = await this.prisma.sweet_shop_listing.findUnique({ where: { id: listingId } }); if (targetListing && await this.isInteractionBlocked(buyer, targetListing.seller_profile_id)) return bad('PROFILE_BLOCKED', '차단 관계에서는 상품을 구매할 수 없습니다.');
    try { const bought = await this.prisma.$transaction(async (tx) => {
      const x = await tx.sweet_shop_listing.findFirst({ where: { id: listingId, status: 'active' } }); if (!x || qty < 1 || x.quantity < qty || x.seller_profile_id === buyer) throw new Error('INVALID_PURCHASE');
      const source = await tx.sweet_shop_dessert.findUniqueOrThrow({ where: { id: x.dessert_id } });
      const stack = await tx.sweet_shop_dessert.findFirst({ where: { owner_profile_id: buyer, creator_profile_id: source.creator_profile_id, recipe_id: source.recipe_id, dessert_level: source.dessert_level, quality: source.quality }, orderBy: { id: 'asc' } });
      if (!stack) { const storage = await tx.sweet_shop_storage.findUnique({ where: { profile_id: buyer } }); const occupied = await tx.sweet_shop_dessert.count({ where: { owner_profile_id: buyer, quantity: { gt: 0 } } }); if (!storage || occupied >= storage.dessert_slot_limit) throw new Error('DESSERT_STORAGE_FULL'); }
      const total = x.unit_price * qty; if (!(await tx.sweet_shop_profile.updateMany({ where: { profile_id: buyer, gold: { gte: total } }, data: { gold: { decrement: total } } })).count) throw new Error('NOT_ENOUGH_GOLD'); if (!(await tx.sweet_shop_listing.updateMany({ where: { id: x.id, status: 'active', quantity: { gte: qty } }, data: { quantity: { decrement: qty } } })).count) throw new Error('SOLD_OUT');
      await tx.sweet_shop_profile.update({ where: { profile_id: x.seller_profile_id }, data: { gold: { increment: total } } });
      const d = stack ? await tx.sweet_shop_dessert.update({ where: { id: stack.id }, data: { quantity: { increment: qty } } }) : await tx.sweet_shop_dessert.create({ data: { owner_profile_id: buyer, creator_profile_id: source.creator_profile_id, recipe_id: source.recipe_id, dessert_level: source.dessert_level, quality: source.quality, quantity: qty } });
      await tx.sweet_shop_trade.create({ data: { request_id: r.requestId, listing_id: x.id, seller_profile_id: x.seller_profile_id, buyer_profile_id: buyer, dessert_id: d.id, quantity: qty, unit_price: x.unit_price, total_price: total } });
      const cafeClosed = x.quantity === qty; if (cafeClosed) await tx.sweet_shop_listing.update({ where: { id: x.id }, data: { status: 'sold_out', sold_out_at: new Date() } });
      const remaining = cafeClosed ? await tx.sweet_shop_listing.count({ where: { seller_profile_id: x.seller_profile_id, status: 'active', quantity: { gt: 0 }, id: { not: x.id } } }) : 1;
      return { dessert: d, sellerProfileId: x.seller_profile_id, cafeClosed: cafeClosed && remaining === 0, dessertName: recipe(source.recipe_id)?.name ?? '디저트', totalPrice: total };
    }, { isolationLevel: 'Serializable' }); return good({ dessertId: bought.dessert.id.toString(), profileId: bought.sellerProfileId.toString(), cafeClosed: bought.cafeClosed, dessertName: bought.dessertName, totalPrice: bought.totalPrice }, '디저트를 구매했습니다. 내 카페의 디저트 상자에 보관했습니다.'); } catch (e) { const code = e instanceof Error ? e.message : 'PURCHASE_FAILED'; const message = code === 'NOT_ENOUGH_GOLD' ? '골드가 부족합니다.' : code === 'DESSERT_STORAGE_FULL' ? '디저트 상자가 가득 찼습니다. 공간을 비운 뒤 구매해주세요.' : '상품이 품절되었거나 구매할 수 없습니다.'; return bad(code, message); }
  }

  async eatDessert(token: unknown, r: any) { const id = (await this.profile(token, r.guestId)).profileId; const d = await this.prisma.sweet_shop_dessert.findFirst({ where: { id: BigInt(r.dessertId), owner_profile_id: id, creator_profile_id: { not: id }, quantity: { gt: 0 } } }); if (!d) return bad('BUFF_DESSERT_REQUIRED', '다른 카페에서 구매한 디저트만 먹을 수 있습니다.'); const ends = new Date(Date.now() + 180000); const name = recipe(d.recipe_id)?.name ?? '디저트'; await this.prisma.$transaction([this.prisma.sweet_shop_dessert.update({ where: { id: d.id }, data: { quantity: { decrement: 1 } } }), this.prisma.sweet_shop_profile.update({ where: { profile_id: id }, data: { buff_source_dessert_name: name, buff_quality_bonus: d.quality >= 4 ? 2 : 1, buff_eligible_recipe_level: d.dessert_level, buff_ends_at: ends } })]); return good({ buffEndsAt: ends.toISOString() }); }
  async createGuestbook(token: unknown, r: any) { const id = (await this.profile(token, r.guestId)).profileId; const owner = BigInt(r.cafeProfileId); if (owner === id) return bad('OWN_GUESTBOOK', '내 카페에는 방명록을 남길 수 없습니다.'); if (await this.isInteractionBlocked(id, owner)) return bad('PROFILE_BLOCKED', '차단 관계에서는 방명록을 남길 수 없습니다.'); const messages = new Set(['맛있어 보여요!', '또 놀러 올게요!', '멋진 카페예요!']); const stickers = new Set(['🧁', '💖', '✨']); const messageCode = String(r.messageCode ?? ''); const stickerCode = String(r.stickerCode ?? ''); if (!messages.has(messageCode) || !stickers.has(stickerCode)) return bad('INVALID_GUESTBOOK_MESSAGE', '사용할 수 없는 방명록 메시지입니다.'); const recent = await this.prisma.sweet_shop_guestbook.findFirst({ where: { cafe_owner_profile_id: owner, visitor_profile_id: id, created_at: { gte: new Date(Date.now() - 60000) } } }); if (recent) return bad('GUESTBOOK_COOLDOWN', '방명록은 1분 뒤에 다시 남길 수 있습니다.'); const x = await this.prisma.sweet_shop_guestbook.create({ data: { cafe_owner_profile_id: owner, visitor_profile_id: id, message_code: messageCode, sticker_code: stickerCode } }); return good({ guestbookId: x.id.toString(), profileId: owner.toString() }, '방명록을 남겼습니다.'); }
  async replyGuestbook(token: unknown, r: any) { const owner = (await this.profile(token, r.guestId)).profileId; const guestbookId = BigInt(r.guestbookId); const sticker = String(r.replyStickerCode ?? '').trim(); if (!new Set(['💖', '🍪', '✨']).has(sticker)) return bad('INVALID_REPLY_STICKER', '사용할 수 없는 답장 스티커입니다.'); const updated = await this.prisma.sweet_shop_guestbook.updateMany({ where: { id: guestbookId, cafe_owner_profile_id: owner }, data: { reply_sticker_code: sticker } }); if (!updated.count) return bad('GUESTBOOK_NOT_FOUND', '답장할 방명록을 찾지 못했습니다.'); return good({ guestbookId: guestbookId.toString(), profileId: owner.toString() }, '답장 스티커를 남겼습니다.'); }
  async isInteractionBlocked(a: bigint, b: bigint) { try { const rows = await this.prisma.$queryRawUnsafe<Array<{ found: number }>>('SELECT 1 AS found FROM sweet_shop_block WHERE (profile_id = ? AND blocked_profile_id = ?) OR (profile_id = ? AND blocked_profile_id = ?) LIMIT 1', a, b, b, a); return rows.length > 0; } catch { return false; } }
  async saveChatMessage(cafeProfileId: bigint, senderProfileId: bigint, senderName: string, message: string) { try { await this.prisma.$executeRawUnsafe('INSERT INTO sweet_shop_chat_message (cafe_profile_id, sender_profile_id, sender_name, message) VALUES (?, ?, ?, ?)', cafeProfileId, senderProfileId, senderName.slice(0, 40), message.slice(0, 80)); } catch { /* 채팅 기록 마이그레이션 전에도 실시간 채팅은 유지한다. */ } }
  async listChatMessages(cafeProfileId: bigint) { try { const rows = await this.prisma.$queryRawUnsafe<Array<{ sender_profile_id: bigint; sender_name: string; message: string; created_at: Date }>>('SELECT sender_profile_id, sender_name, message, created_at FROM sweet_shop_chat_message WHERE cafe_profile_id = ? ORDER BY id DESC LIMIT 30', cafeProfileId); return rows.reverse().map((row) => ({ profileId: row.sender_profile_id.toString(), cafeProfileId: cafeProfileId.toString(), nickname: row.sender_name, message: row.message, sentAt: row.created_at.toISOString() })); } catch { return []; } }
  async listFriends(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const rows = await this.prisma.$queryRawUnsafe<Array<{ friend_profile_id: bigint }>>('SELECT friend_profile_id FROM sweet_shop_friend WHERE profile_id = ? ORDER BY created_at DESC', me); const data = await Promise.all(rows.map(async ({ friend_profile_id }) => { const p = await this.prisma.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: friend_profile_id } }); const u = p.account_id ? await this.prisma.account.findUnique({ where: { id: p.account_id } }) : null; const listing = await this.prisma.sweet_shop_listing.findFirst({ where: { seller_profile_id: friend_profile_id, status: 'active', quantity: { gt: 0 } } }); const dessert = listing ? await this.prisma.sweet_shop_dessert.findUnique({ where: { id: listing.dessert_id } }) : null; const count = await this.prisma.sweet_shop_listing.count({ where: { seller_profile_id: friend_profile_id, status: 'active', quantity: { gt: 0 } } }); return { profileId: p.profile_id.toString(), cafeName: p.cafe_name, ownerName: u?.nickname ?? `손님${p.profile_id.toString().padStart(4, '0')}`, icon: '🏠', level: p.level, representativeDessert: recipe(dessert?.recipe_id ?? '')?.name ?? '오늘의 디저트', listingCount: count }; })); return good(data); }
  async addFriend(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const target = BigInt(r.profileId); if (me === target) return bad('OWN_PROFILE', '자신은 친구로 등록할 수 없습니다.'); if (await this.isInteractionBlocked(me, target)) return bad('PROFILE_BLOCKED', '차단 관계에서는 친구로 등록할 수 없습니다.'); await this.prisma.$executeRawUnsafe('INSERT IGNORE INTO sweet_shop_friend (profile_id, friend_profile_id) VALUES (?, ?)', me, target); return good({ profileId: target.toString() }, '친구 카페에 등록했습니다.'); }
  async removeFriend(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const target = BigInt(r.profileId); await this.prisma.$executeRawUnsafe('DELETE FROM sweet_shop_friend WHERE profile_id = ? AND friend_profile_id = ?', me, target); return good({ profileId: target.toString() }, '친구 목록에서 삭제했습니다.'); }
  async blockProfile(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const target = BigInt(r.profileId); if (me === target) return bad('OWN_PROFILE', '자신은 차단할 수 없습니다.'); await this.prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe('INSERT IGNORE INTO sweet_shop_block (profile_id, blocked_profile_id) VALUES (?, ?)', me, target); await tx.$executeRawUnsafe('DELETE FROM sweet_shop_friend WHERE (profile_id = ? AND friend_profile_id = ?) OR (profile_id = ? AND friend_profile_id = ?)', me, target, target, me); }); return good({ profileId: target.toString() }, '사용자를 차단했습니다.'); }
  async listBlockedProfiles(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const rows = await this.prisma.$queryRawUnsafe<Array<{ blocked_profile_id: bigint }>>('SELECT blocked_profile_id FROM sweet_shop_block WHERE profile_id = ? ORDER BY created_at DESC', me); const data = await Promise.all(rows.map(async ({ blocked_profile_id }) => { const p = await this.prisma.sweet_shop_profile.findUniqueOrThrow({ where: { profile_id: blocked_profile_id } }); const u = p.account_id ? await this.prisma.account.findUnique({ where: { id: p.account_id } }) : null; return { profileId: p.profile_id.toString(), cafeName: p.cafe_name, ownerName: u?.nickname ?? `손님${p.profile_id.toString().padStart(4, '0')}`, icon: '🚫', level: p.level, representativeDessert: '', listingCount: 0 }; })); return good(data); }
  async unblockProfile(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const target = BigInt(r.profileId); await this.prisma.$executeRawUnsafe('DELETE FROM sweet_shop_block WHERE profile_id = ? AND blocked_profile_id = ?', me, target); return good({ profileId: target.toString() }, '차단을 해제했습니다.'); }
  async reportProfile(token: unknown, r: any) { const me = (await this.profile(token, r.guestId)).profileId; const target = BigInt(r.profileId); const allowed = new Set(['spam', 'abuse', 'inappropriate', 'other']); const reason = allowed.has(String(r.reasonCode)) ? String(r.reasonCode) : 'other'; if (me === target) return bad('OWN_PROFILE', '자신은 신고할 수 없습니다.'); const duplicate = await this.prisma.$queryRawUnsafe<Array<{ id: bigint }>>('SELECT id FROM sweet_shop_report WHERE reporter_profile_id = ? AND target_profile_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE) LIMIT 1', me, target); if (duplicate.length) return bad('REPORT_COOLDOWN', '같은 사용자는 10분 뒤에 다시 신고할 수 있습니다.'); const detail = r.detail ? String(r.detail).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 200) : null; const count = await this.prisma.$executeRawUnsafe('INSERT INTO sweet_shop_report (reporter_profile_id, target_profile_id, reason_code, detail) VALUES (?, ?, ?, ?)', me, target, reason, detail); const found = await this.prisma.$queryRawUnsafe<Array<{ id: bigint }>>('SELECT id FROM sweet_shop_report WHERE reporter_profile_id = ? ORDER BY id DESC LIMIT 1', me); return good({ reportId: found[0]?.id.toString() ?? String(count) }, '신고가 접수되었습니다.'); }
  async activateAdvertisement(token: unknown, r: any) { const id = (await this.profile(token, r.guestId)).profileId; const hours = [1, 3, 6].includes(Number(r.hours)) ? Number(r.hours) : 0; const cost = hours === 1 ? 20 : hours === 3 ? 50 : hours === 6 ? 90 : 0; if (!cost) return bad('INVALID_AD_DURATION', '광고 시간을 확인해주세요.'); if (!await this.prisma.sweet_shop_listing.count({ where: { seller_profile_id: id, status: 'active', quantity: { gt: 0 } } })) return bad('NO_ACTIVE_LISTING', '판매 상품을 먼저 진열해주세요.'); const current = await this.prisma.$queryRawUnsafe<Array<{ ends_at: Date }>>('SELECT ends_at FROM sweet_shop_advertisement WHERE profile_id = ? LIMIT 1', id); const start = current[0]?.ends_at && current[0].ends_at > new Date() ? current[0].ends_at.getTime() : Date.now(); const ends = new Date(start + hours * 3600000); const updated = await this.prisma.$transaction(async (tx) => { if (!(await tx.sweet_shop_profile.updateMany({ where: { profile_id: id, gold: { gte: cost } }, data: { gold: { decrement: cost } } })).count) return false; await tx.$executeRawUnsafe('INSERT INTO sweet_shop_advertisement (profile_id, ends_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE ends_at = VALUES(ends_at)', id, ends); return true; }); if (!updated) return bad('NOT_ENOUGH_GOLD', '광고에 필요한 골드가 부족합니다.'); return good({ endsAt: ends.toISOString() }, `${hours}시간 동안 카페를 홍보합니다.`); }
}
