import {
  INGREDIENTS, RECIPES, SWEET_SHOP_EVENTS, type ActivateAdvertisementRequest, type BuyDessertRequest, type CreateGuestbookRequest,
  type CompleteFirstCookingTutorialRequest, type CreateListingRequest, type DessertQuality, type EatDessertRequest,
  type IngredientId, type OrderIngredientsRequest, type ReceiveCookingRequest, type RecipeId,
  type ProfileTargetRequest, type ReceiveDeliveryRequest, type RemoveListingRequest, type ReplyGuestbookRequest, type ReportProfileRequest, type StartCookingRequest,
  type SweetShopCafeState, type SweetShopCafeSummary,
  type SweetShopGateway, type SweetShopResult, type SweetShopVisitedCafe,
  type UpdateListingRequest, type VisitCafeRequest, type EnterRealtimeCafeRequest,
  type MoveRealtimeCafeRequest, type SweetShopCafeAccessRevokedEvent, type SweetShopCafeChatEvent, type SweetShopCafeDisplayEvent, type SweetShopCafeOpenEvent, type SweetShopCafePurchaseEvent, type SweetShopRealtimeEvent, type SweetShopRealtimePlayer,
} from 'sweet-shop-contracts';
import { io, type Socket } from 'socket.io-client';
import { NPC_BUYER_NAMES } from './customerNpcs';

export const SWEET_SHOP_SERVER_URL: string =
  import.meta.env?.VITE_SWEET_SHOP_SERVER_URL ?? 'http://localhost:3005';

const STORAGE_KEY = 'sweet-shop-local-state-v1';
const QUALITY_ORDER: DessertQuality[] = ['normal', 'good', 'excellent', 'premium'];
const QUALITY_PRICE: Record<DessertQuality, [number, number]> = {
  normal: [0.8, 1.2], good: [1, 1.6], excellent: [1.3, 2.1], premium: [1.8, 3],
};
export function dessertPriceRange(recipeId: string, quality: DessertQuality): [number, number] {
  const base = RECIPES.find((item) => item.id === recipeId)?.basePrice ?? 20;
  const [min, max] = QUALITY_PRICE[quality];
  return [Math.max(1, Math.round(base * min)), Math.max(1, Math.round(base * max))];
}

const NPC_CAFES: SweetShopVisitedCafe[] = [
  {
    profileId: 'npc-berry', cafeName: '딸기구름 카페', ownerName: '베리', icon: '🐰', level: 8,
    representativeDessert: '딸기 마카롱', listingCount: 2, greeting: '딸기 향이 가득한 오늘의 디저트를 맛보세요!',
    guestbook: [],
    listings: [
      { id: 'berry-macaron', recipeId: 'strawberry-macaron', name: '딸기 마카롱', quality: 'excellent', level: 3, quantity: 8, unitPrice: 68 },
      { id: 'berry-pudding', recipeId: 'milk-pudding', name: '우유 푸딩', quality: 'good', level: 2, quantity: 10, unitPrice: 42 },
    ],
  },
  {
    profileId: 'npc-cookie', cafeName: '노을 쿠키집', ownerName: '쿠키 할머니', icon: '🧑‍🍳', level: 5,
    representativeDessert: '버터 쿠키', listingCount: 2, greeting: '갓 구운 쿠키 하나 먹고 천천히 쉬어가렴.',
    guestbook: [],
    listings: [
      { id: 'cookie-butter', recipeId: 'butter-cookie', name: '버터 쿠키', quality: 'good', level: 1, quantity: 20, unitPrice: 30 },
      { id: 'cookie-cupcake', recipeId: 'choco-cupcake', name: '초코 컵케이크', quality: 'excellent', level: 4, quantity: 6, unitPrice: 88 },
    ],
  },
  {
    profileId: 'npc-moon', cafeName: '달빛 디저트 연구소', ownerName: '루나', icon: '🦊', level: 12,
    representativeDessert: '허니 케이크', listingCount: 2, greeting: '한 조각에 특별한 조리 영감을 담았어요.',
    guestbook: [],
    listings: [
      { id: 'moon-cake', recipeId: 'honey-cake', name: '허니 케이크', quality: 'premium', level: 5, quantity: 4, unitPrice: 210 },
      { id: 'moon-macaron', recipeId: 'strawberry-macaron', name: '딸기 마카롱', quality: 'premium', level: 3, quantity: 5, unitPrice: 130 },
    ],
  },
];

function initialState(): SweetShopCafeState {
  return {
    profile: { profileId: 'local-guest', ownerName: '게스트', cafeName: '나의 달콤상점', level: 1, experience: 0, gold: 100 },
    storage: { ingredientSlotLimit: 12, dessertSlotLimit: 12 }, ingredients: {},
    tutorial: { firstCookingCompleted: false },
    unlockedRecipes: ['butter-cookie'], deliveries: [], cookingJobs: [], desserts: [], listings: [], sales: [], buff: null,
    recipeProgress: { 'butter-cookie': { masteryExperience: 0, craftCount: 0, bestQuality: null } },
    updatedAt: new Date().toISOString(),
  };
}

function settle(state: SweetShopCafeState): SweetShopCafeState {
  const now = Date.now();
  const next: SweetShopCafeState = {
    ...state,
    deliveries: state.deliveries.map((item) => item.status === 'ORDERED' && Date.parse(item.arrivesAt) <= now ? { ...item, status: 'ARRIVED' } : item),
    cookingJobs: state.cookingJobs.map((item) => {
      if (item.status === 'RECEIVED' || item.status === 'WAITING_FOR_SPACE') return item;
      if (Date.parse(item.completesAt) <= now) return { ...item, status: 'COMPLETED' };
      if (Date.parse(item.startedAt) <= now) return { ...item, status: 'COOKING' };
      return { ...item, status: 'QUEUED' };
    }),
    updatedAt: new Date().toISOString(),
  };
  if (!next.tutorial.firstCookingCompleted && next.cookingJobs.some((item) => item.recipeId === 'butter-cookie' && Date.parse(item.completesAt) <= now)) {
    next.tutorial.firstCookingCompleted = true;
  }
  if (next.buff && Date.parse(next.buff.endsAt) <= now) next.buff = null;
  for (const listing of [...next.listings]) {
    if (Date.parse(listing.nextNpcPurchaseAt) > now || listing.quantity < 1) continue;
    listing.quantity -= 1;
    next.profile.gold += listing.unitPrice;
    next.sales.unshift({ id: makeId('sale'), listingId: listing.id, dessertName: listing.name, quantity: 1, totalPrice: listing.unitPrice, buyerName: NPC_BUYER_NAMES[Math.floor(Math.random() * NPC_BUYER_NAMES.length)], soldAt: new Date().toISOString() });
    listing.nextNpcPurchaseAt = new Date(now + 12000).toISOString();
    if (listing.quantity === 0) next.listings = next.listings.filter((item) => item.id !== listing.id);
  }
  next.sales = next.sales.slice(0, 20);
  return next;
}

function normalize(value: Partial<SweetShopCafeState>): SweetShopCafeState {
  const base = initialState();
  return settle({
    ...base, ...value, profile: { ...base.profile, ...value.profile }, storage: { ...base.storage, ...value.storage }, tutorial: { ...base.tutorial, ...value.tutorial },
    ingredients: value.ingredients ?? {}, unlockedRecipes: value.unlockedRecipes?.length ? value.unlockedRecipes : base.unlockedRecipes,
    deliveries: value.deliveries ?? [], cookingJobs: value.cookingJobs ?? [],
    desserts: (value.desserts ?? []).map((item) => ({ ...item, level: item.level ?? RECIPES.find((recipe) => recipe.id === item.recipeId)?.level ?? 1, makerName: item.makerName ?? base.profile.cafeName, source: item.source ?? 'crafted' })),
    recipeProgress: value.recipeProgress ?? base.recipeProgress,
    listings: value.listings ?? [], sales: value.sales ?? [], buff: value.buff ?? null,
  });
}

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fail = <T,>(code: string, message: string): SweetShopResult<T> => ({ ok: false, code, message });

export class LocalSweetShopGateway implements SweetShopGateway {
  async loadCafe(): Promise<SweetShopCafeState> {
    let state = initialState();
    try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) state = normalize(JSON.parse(saved)); } catch { /* 기본 상태 사용 */ }
    this.save(state); return state;
  }

  async orderIngredients(request: OrderIngredientsRequest): Promise<SweetShopResult<{ deliveryId: string }>> {
    const state = await this.loadCafe();
    const ingredient = INGREDIENTS.find((item) => item.id === request.ingredientId);
    const quantity = Math.floor(request.quantity);
    if (!ingredient || quantity < 1 || quantity > 99) return fail('INVALID_ORDER', '주문 수량은 1~99개까지 가능합니다.');
    const totalPrice = ingredient.unitPrice * quantity;
    if (state.profile.gold < totalPrice) return fail('NOT_ENOUGH_GOLD', '골드가 부족합니다.');
    const orderedAt = new Date(); const deliveryId = makeId('delivery');
    state.profile.gold -= totalPrice;
    state.deliveries.push({ id: deliveryId, ingredientId: ingredient.id, quantity, totalPrice, orderedAt: orderedAt.toISOString(), arrivesAt: new Date(orderedAt.getTime() + ingredient.deliverySeconds * 1000).toISOString(), status: 'ORDERED' });
    this.save(state); return { ok: true, data: { deliveryId }, message: `${ingredient.name} ${quantity}개를 주문했습니다.` };
  }

  async receiveDelivery(request: ReceiveDeliveryRequest): Promise<SweetShopResult<SweetShopCafeState>> {
    const state = await this.loadCafe(); const delivery = state.deliveries.find((item) => item.id === request.deliveryId);
    if (!delivery || delivery.status === 'RECEIVED') return fail('DELIVERY_NOT_FOUND', '받을 배송이 없습니다.');
    if (Date.parse(delivery.arrivesAt) > Date.now()) return fail('DELIVERY_NOT_READY', '아직 배송 중입니다.');
    const occupied = Object.values(state.ingredients).filter((quantity) => (quantity ?? 0) > 0).length;
    if ((state.ingredients[delivery.ingredientId] ?? 0) === 0 && occupied >= state.storage.ingredientSlotLimit) {
      delivery.status = 'WAITING_FOR_SPACE'; this.save(state); return fail('INGREDIENT_STORAGE_FULL', '재료 보관함에 빈칸이 없습니다.');
    }
    state.ingredients[delivery.ingredientId] = (state.ingredients[delivery.ingredientId] ?? 0) + delivery.quantity;
    delivery.status = 'RECEIVED'; this.save(state); return { ok: true, data: state, message: '재료를 보관함에 넣었습니다.' };
  }

  async startCooking(request: StartCookingRequest): Promise<SweetShopResult<{ cookingId: string; completesAt: string }>> {
    const state = await this.loadCafe(); const recipe = RECIPES.find((item) => item.id === request.recipeId);
    if (!recipe || !state.unlockedRecipes.includes(request.recipeId)) return fail('RECIPE_LOCKED', '아직 획득하지 않은 레시피입니다.');
    const pendingJobs = state.cookingJobs.filter((item) => item.status !== 'RECEIVED');
    if (pendingJobs.length >= 5) return fail('COOKING_QUEUE_FULL', '조리 대기열 5칸이 모두 찼습니다. 완성된 디저트를 먼저 담아주세요.');
    for (const [id, amount] of Object.entries(recipe.ingredients)) if ((state.ingredients[id as IngredientId] ?? 0) < (amount ?? 0) * request.quantity) return fail('NOT_ENOUGH_INGREDIENTS', '필요한 재료가 부족합니다.');
    for (const [id, amount] of Object.entries(recipe.ingredients)) state.ingredients[id as IngredientId] = (state.ingredients[id as IngredientId] ?? 0) - (amount ?? 0) * request.quantity;
    const lastScheduledAt = pendingJobs.reduce((latest, item) => Math.max(latest, Date.parse(item.completesAt)), Date.now());
    const startedAt = new Date(lastScheduledAt); const completesAt = new Date(startedAt.getTime() + recipe.cookSeconds * 1000).toISOString(); const cookingId = makeId('cooking');
    const status = pendingJobs.length ? 'QUEUED' : 'COOKING';
    state.cookingJobs.push({ id: cookingId, recipeId: recipe.id, quantity: request.quantity, startedAt: startedAt.toISOString(), completesAt, status });
    this.save(state); return { ok: true, data: { cookingId, completesAt }, message: pendingJobs.length ? `${recipe.name}을 ${pendingJobs.length + 1}번째 대기열에 추가했습니다.` : `${recipe.name} 조리를 시작했습니다.` };
  }

  async receiveCooking(request: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>> {
    const state = await this.loadCafe(); const job = state.cookingJobs.find((item) => item.id === request.cookingId);
    if (!job || job.status === 'RECEIVED') return fail('COOKING_NOT_FOUND', '받을 디저트가 없습니다.');
    if (Date.parse(job.completesAt) > Date.now()) return fail('COOKING_NOT_READY', '아직 조리 중입니다.');
    if (state.desserts.length >= state.storage.dessertSlotLimit) { job.status = 'WAITING_FOR_SPACE'; this.save(state); return fail('DESSERT_STORAGE_FULL', '디저트 상자에 빈칸이 없습니다.'); }
    const recipe = RECIPES.find((item) => item.id === job.recipeId)!;
    const progress = state.recipeProgress[job.recipeId] ?? { masteryExperience: 0, craftCount: 0, bestQuality: null };
    const masteryTier = progress.masteryExperience >= 200 ? 2 : progress.masteryExperience >= 50 ? 1 : 0;
    const roll = Math.random() * 100;
    let qualityIndex = roll < 5 + masteryTier * 5 ? 2 : roll < 25 + masteryTier * 15 ? 1 : 0;
    if (state.buff && Date.parse(state.buff.endsAt) > Date.now() && recipe.level <= state.buff.eligibleRecipeLevel) qualityIndex += state.buff.qualityBonus;
    const quality = QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, qualityIndex)]; const dessertId = makeId('dessert');
    state.desserts.push({ id: dessertId, recipeId: job.recipeId, name: recipe.name, quantity: job.quantity, quality, createdAt: new Date().toISOString(), level: recipe.level, makerName: state.profile.cafeName, source: 'crafted' });
    const completesTutorial = job.recipeId === 'butter-cookie' && !state.tutorial.firstCookingCompleted;
    state.recipeProgress[job.recipeId] = { masteryExperience: progress.masteryExperience + 10 * job.quantity, craftCount: progress.craftCount + job.quantity, bestQuality: !progress.bestQuality || QUALITY_ORDER.indexOf(quality) > QUALITY_ORDER.indexOf(progress.bestQuality) ? quality : progress.bestQuality };
    const totalCrafts = Object.values(state.recipeProgress).reduce((sum, item) => sum + (item?.craftCount ?? 0), 0);
    const unlocks: Array<[number, RecipeId]> = [[1, 'milk-pudding'], [3, 'strawberry-macaron'], [6, 'choco-cupcake'], [10, 'honey-cake'], [15, 'vanilla-cream-puff'], [21, 'berry-tart'], [28, 'caramel-eclair'], [36, 'royal-choco-gateau'], [45, 'starlight-celebration-cake']];
    for (const [required, recipeId] of unlocks) if (totalCrafts >= required && !state.unlockedRecipes.includes(recipeId)) state.unlockedRecipes.push(recipeId);
    state.profile.level = 1 + unlocks.filter(([required]) => totalCrafts >= required).length;
    if (completesTutorial) state.tutorial.firstCookingCompleted = true;
    state.profile.experience += 5 * job.quantity; job.status = 'RECEIVED'; this.save(state);
    return { ok: true, data: { dessertId }, message: completesTutorial ? '첫 버터 쿠키 완성! 첫 조리 안내를 마쳤습니다. 이제 자유롭게 카페를 운영해보세요.' : `${recipe.name}이 완성되어 디저트 상자에 보관되었습니다.` };
  }

  async completeFirstCookingTutorial(_request: CompleteFirstCookingTutorialRequest): Promise<SweetShopResult<SweetShopCafeState>> {
    const state = await this.loadCafe();
    state.tutorial.firstCookingCompleted = true;
    this.save(state);
    return { ok: true, data: state };
  }

  async createListing(request: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>> {
    const state = await this.loadCafe();
    if (state.listings.length >= 3) return fail('DISPLAY_FULL', '판매대 3칸이 모두 사용 중입니다.');
    const dessert = state.desserts.find((item) => item.id === request.dessertId && item.source === 'crafted');
    const quantity = Math.floor(request.quantity); const unitPrice = Math.floor(request.unitPrice);
    if (!dessert || quantity < 1 || quantity > dessert.quantity) return fail('INVALID_DESSERT', '진열할 디저트 수량을 확인해주세요.');
    const [min, max] = dessertPriceRange(dessert.recipeId, dessert.quality);
    if (unitPrice < min || unitPrice > max) return fail('INVALID_PRICE', `판매가격은 ${min}~${max}G로 정해주세요.`);
    const listingId = makeId('listing');
    state.listings.push({ id: listingId, dessertId: dessert.id, recipeId: dessert.recipeId, name: dessert.name, quality: dessert.quality, quantity, unitPrice, listedAt: new Date().toISOString(), nextNpcPurchaseAt: new Date(Date.now() + 12000).toISOString() });
    dessert.quantity -= quantity; if (dessert.quantity === 0) state.desserts = state.desserts.filter((item) => item.id !== dessert.id);
    this.save(state); return { ok: true, data: { listingId }, message: `${dessert.name}을 판매대에 진열했습니다. 곧 손님이 찾아옵니다!` };
  }

  async updateListing(request: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>> {
    const state = await this.loadCafe(); const listing = state.listings.find((item) => item.id === request.listingId);
    if (!listing) return fail('LISTING_NOT_FOUND', '진열 상품을 찾을 수 없습니다.');
    const quantity = Math.floor(request.quantity); const unitPrice = Math.floor(request.unitPrice);
    const [min, max] = dessertPriceRange(listing.recipeId, listing.quality);
    if (unitPrice < min || unitPrice > max) return fail('INVALID_PRICE', `판매가격은 ${min}~${max}G로 정해주세요.`);
    if (quantity < 1 || quantity > listing.quantity) return fail('INVALID_QUANTITY', '현재 진열 수량보다 적은 수량으로만 조정할 수 있습니다.');
    if (quantity < listing.quantity) this.returnListingDessert(state, listing, listing.quantity - quantity);
    listing.quantity = quantity; listing.unitPrice = unitPrice; listing.nextNpcPurchaseAt = new Date(Date.now() + 12000).toISOString();
    this.save(state); return { ok: true, data: { listingId: listing.id }, message: '진열 상품의 가격과 수량을 수정했습니다.' };
  }

  async removeListing(request: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>> {
    const state = await this.loadCafe(); const listing = state.listings.find((item) => item.id === request.listingId);
    if (!listing) return fail('LISTING_NOT_FOUND', '진열 상품을 찾을 수 없습니다.');
    this.returnListingDessert(state, listing, listing.quantity);
    state.listings = state.listings.filter((item) => item.id !== listing.id); this.save(state);
    return { ok: true, data: { listingId: listing.id }, message: `${listing.name}을 디저트 상자로 회수했습니다.` };
  }

  async listCafeStreet(): Promise<SweetShopResult<SweetShopCafeSummary[]>> {
    return { ok: true, data: NPC_CAFES.map(({ listings: _listings, greeting: _greeting, ...summary }) => summary) };
  }

  async visitCafe(request: VisitCafeRequest): Promise<SweetShopResult<SweetShopVisitedCafe>> {
    const cafe = NPC_CAFES.find((item) => item.profileId === request.cafeProfileId);
    return cafe ? { ok: true, data: cafe } : fail('CAFE_NOT_FOUND', '방문할 카페를 찾지 못했습니다.');
  }

  async buyDessert(request: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>> {
    const state = await this.loadCafe(); const offered = NPC_CAFES.flatMap((cafe) => cafe.listings.map((listing) => ({ cafe, listing }))).find((item) => item.listing.id === request.listingId);
    const quantity = Math.floor(request.quantity);
    if (!offered || quantity < 1 || quantity > offered.listing.quantity) return fail('INVALID_PURCHASE', '구매할 상품과 수량을 확인해주세요.');
    const total = offered.listing.unitPrice * quantity;
    if (state.profile.gold < total) return fail('NOT_ENOUGH_GOLD', '골드가 부족합니다. 내 판매대에서 디저트를 판매해보세요.');
    const dessertId = makeId('dessert'); state.profile.gold -= total;
    state.desserts.push({ id: dessertId, recipeId: offered.listing.recipeId, name: offered.listing.name, quality: offered.listing.quality, quantity, createdAt: new Date().toISOString(), level: offered.listing.level, makerName: offered.cafe.cafeName, source: 'npc-cafe' });
    this.save(state); return { ok: true, data: { dessertId }, message: `${offered.cafe.cafeName}에서 ${offered.listing.name}을 구매했습니다.` };
  }

  async eatDessert(request: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>> {
    const state = await this.loadCafe(); const dessert = state.desserts.find((item) => item.id === request.dessertId);
    if (!dessert || dessert.source !== 'npc-cafe') return fail('BUFF_DESSERT_REQUIRED', '다른 카페에서 구매한 디저트만 조리 버프로 먹을 수 있습니다.');
    const qualityBonus = dessert.quality === 'premium' ? 2 : 1; const buffEndsAt = new Date(Date.now() + 180000).toISOString();
    state.buff = { sourceDessertName: dessert.name, qualityBonus, eligibleRecipeLevel: dessert.level, endsAt: buffEndsAt };
    dessert.quantity -= 1; if (dessert.quantity === 0) state.desserts = state.desserts.filter((item) => item.id !== dessert.id);
    this.save(state); return { ok: true, data: { buffEndsAt }, message: `${dessert.name} 디저트를 먹었습니다! 3분 동안 Lv.${dessert.level} 이하 조리 품질이 +${qualityBonus}등급 상승합니다.` };
  }
  createGuestbook(_r: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.later(); }
  replyGuestbook(_r: ReplyGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.later(); }
  listFriends(): Promise<SweetShopResult<SweetShopCafeSummary[]>> { return Promise.resolve({ ok: true, data: [] }); }
  addFriend(_r: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>> { return this.later(); }
  removeFriend(_r: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>> { return this.later(); }
  blockProfile(_r: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>> { return this.later(); }
  listBlockedProfiles(): Promise<SweetShopResult<SweetShopCafeSummary[]>> { return Promise.resolve({ ok: true, data: [] }); }
  unblockProfile(_r: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>> { return this.later(); }
  reportProfile(_r: ReportProfileRequest): Promise<SweetShopResult<{ reportId: string }>> { return this.later(); }
  activateAdvertisement(_r: ActivateAdvertisementRequest): Promise<SweetShopResult<{ endsAt: string }>> { return this.later(); }
  async enterRealtimeCafe(_r: EnterRealtimeCafeRequest): Promise<SweetShopResult<{ players: SweetShopRealtimePlayer[]; chatMessages?: SweetShopCafeChatEvent[] }>> { return { ok: true, data: { players: [], chatMessages: [] } }; }
  async leaveRealtimeCafe(): Promise<SweetShopResult<Record<string, never>>> { return { ok: true, data: {} }; }
  moveRealtimeCafe(_r: MoveRealtimeCafeRequest) { /* 로컬 데모에는 원격 사용자가 없다. */ }
  onRealtimePresence(_listener: (event: SweetShopRealtimeEvent) => void) { return () => undefined; }
  onCafeOpenState(_listener: (event: SweetShopCafeOpenEvent) => void) { return () => undefined; }
  onCafeDisplayChanged(_listener: (event: SweetShopCafeDisplayEvent) => void) { return () => undefined; }
  sendCafeChat(_message: string): Promise<SweetShopResult<{ cafeProfileId: string; participantCount: number }>> { return Promise.resolve({ ok: true, data: { cafeProfileId: '', participantCount: 1 } }); }
  onCafeChat(_listener: (event: SweetShopCafeChatEvent) => void) { return () => undefined; }
  onCafePurchase(_listener: (event: SweetShopCafePurchaseEvent) => void) { return () => undefined; }
  onCafeAccessRevoked(_listener: (event: SweetShopCafeAccessRevokedEvent) => void) { return () => undefined; }
  private returnListingDessert(state: SweetShopCafeState, listing: SweetShopCafeState['listings'][number], quantity: number) {
    const existing = state.desserts.find((item) => item.recipeId === listing.recipeId && item.quality === listing.quality && item.source === 'crafted');
    if (existing) existing.quantity += quantity;
    else state.desserts.push({ id: makeId('dessert'), recipeId: listing.recipeId, name: listing.name, quantity, quality: listing.quality, createdAt: new Date().toISOString(), level: RECIPES.find((item) => item.id === listing.recipeId)?.level ?? 1, makerName: state.profile.cafeName, source: 'crafted' });
  }
  private async later<T>(): Promise<SweetShopResult<T>> { return fail('NOT_AVAILABLE', '먼저 디저트를 만들며 카페 영업을 준비해주세요.'); }
  private save(state: SweetShopCafeState) { state.updatedAt = new Date().toISOString(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 실패 무시 */ } }
}

export class SocketSweetShopGateway implements SweetShopGateway {
  readonly serverUrl = SWEET_SHOP_SERVER_URL;
  private readonly socket: Socket = io(this.serverUrl, { transports: ['websocket'], autoConnect: true });
  private currentRealtimeCafe: EnterRealtimeCafeRequest | null = null;
  private connectedOnce = false;
  constructor() {
    this.socket.on('connect', () => {
      if (this.connectedOnce && this.currentRealtimeCafe) this.socket.emit('sweet_shop:realtime:enter', { ...this.currentRealtimeCafe, token: this.token, guestId: this.guestId });
      this.connectedOnce = true;
    });
  }
  private get token() { return localStorage.getItem('bomul_auth_token'); }
  private get guestId() { const key = 'sweet-shop-guest-id'; let value = localStorage.getItem(key); if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); } return value; }
  private emit<T>(event: string, request: object = {}): Promise<SweetShopResult<T>> {
    return new Promise((resolve) => {
      this.socket.timeout(7000).emit(event, { ...request, token: this.token, guestId: this.guestId }, (error: Error | null, result?: SweetShopResult<T>) => {
        if (error || !result) resolve(fail('SERVER_UNAVAILABLE', '달콤상점 서버에 연결할 수 없습니다.'));
        else resolve(result);
      });
    });
  }
  async loadCafe(): Promise<SweetShopCafeState> {
    const result = await this.emit<SweetShopCafeState>('sweet_shop:cafe:load');
    if (!result.ok || !result.data) throw new Error(result.message ?? '카페 정보를 불러오지 못했습니다.');
    return result.data;
  }
  orderIngredients(r: OrderIngredientsRequest) { return this.emit<{ deliveryId: string }>('sweet_shop:ingredient:order', r); }
  receiveDelivery(r: ReceiveDeliveryRequest) { return this.emit<SweetShopCafeState>('sweet_shop:delivery:receive', r); }
  startCooking(r: StartCookingRequest) { return this.emit<{ cookingId: string; completesAt: string }>('sweet_shop:cooking:start', r); }
  receiveCooking(r: ReceiveCookingRequest) { return this.emit<{ dessertId: string }>('sweet_shop:cooking:receive', r); }
  completeFirstCookingTutorial(r: CompleteFirstCookingTutorialRequest) { return this.emit<SweetShopCafeState>('sweet_shop:tutorial:first-cooking:complete', r); }
  createListing(r: CreateListingRequest) { return this.emit<{ listingId: string }>('sweet_shop:listing:create', r); }
  updateListing(r: UpdateListingRequest) { return this.emit<{ listingId: string }>('sweet_shop:listing:update', r); }
  removeListing(r: RemoveListingRequest) { return this.emit<{ listingId: string }>('sweet_shop:listing:remove', r); }
  listCafeStreet() { return this.emit<SweetShopCafeSummary[]>('sweet_shop:cafe-street:list'); }
  async visitCafe(r: VisitCafeRequest): Promise<SweetShopResult<SweetShopVisitedCafe>> {
    try {
      const response = await fetch(`${this.serverUrl}/sweet-shop/cafes/${encodeURIComponent(r.cafeProfileId)}`, { headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), 'X-Sweet-Shop-Guest-Id': this.guestId } });
      if (!response.ok) return fail('CAFE_FETCH_FAILED', '카페 정보를 불러오지 못했습니다.');
      return await response.json() as SweetShopResult<SweetShopVisitedCafe>;
    } catch {
      return fail('SERVER_UNAVAILABLE', '달콤상점 서버에 연결할 수 없습니다.');
    }
  }
  buyDessert(r: BuyDessertRequest) { return this.emit<{ dessertId: string }>('sweet_shop:dessert:buy', r); }
  eatDessert(r: EatDessertRequest) { return this.emit<{ buffEndsAt: string }>('sweet_shop:dessert:eat', r); }
  createGuestbook(r: CreateGuestbookRequest) { return this.emit<{ guestbookId: string }>('sweet_shop:guestbook:create', r); }
  replyGuestbook(r: ReplyGuestbookRequest) { return this.emit<{ guestbookId: string }>(SWEET_SHOP_EVENTS.replyGuestbook, r); }
  listFriends() { return this.emit<SweetShopCafeSummary[]>(SWEET_SHOP_EVENTS.listFriends); }
  addFriend(r: ProfileTargetRequest) { return this.emit<{ profileId: string }>(SWEET_SHOP_EVENTS.addFriend, r); }
  removeFriend(r: ProfileTargetRequest) { return this.emit<{ profileId: string }>(SWEET_SHOP_EVENTS.removeFriend, r); }
  blockProfile(r: ProfileTargetRequest) { return this.emit<{ profileId: string }>(SWEET_SHOP_EVENTS.blockProfile, r); }
  listBlockedProfiles() { return this.emit<SweetShopCafeSummary[]>(SWEET_SHOP_EVENTS.listBlockedProfiles); }
  unblockProfile(r: ProfileTargetRequest) { return this.emit<{ profileId: string }>(SWEET_SHOP_EVENTS.unblockProfile, r); }
  reportProfile(r: ReportProfileRequest) { return this.emit<{ reportId: string }>(SWEET_SHOP_EVENTS.reportProfile, r); }
  activateAdvertisement(r: ActivateAdvertisementRequest) { return this.emit<{ endsAt: string }>(SWEET_SHOP_EVENTS.activateAdvertisement, r); }
  enterRealtimeCafe(r: EnterRealtimeCafeRequest) { this.currentRealtimeCafe = r; return this.emit<{ players: SweetShopRealtimePlayer[]; chatMessages?: SweetShopCafeChatEvent[] }>('sweet_shop:realtime:enter', r); }
  leaveRealtimeCafe() { this.currentRealtimeCafe = null; return this.emit<Record<string, never>>('sweet_shop:realtime:leave'); }
  moveRealtimeCafe(r: MoveRealtimeCafeRequest) { this.socket.emit('sweet_shop:realtime:move', { ...r, token: this.token, guestId: this.guestId }); }
  onRealtimePresence(listener: (event: SweetShopRealtimeEvent) => void) { this.socket.on('sweet_shop:realtime:presence', listener); return () => { this.socket.off('sweet_shop:realtime:presence', listener); }; }
  onCafeOpenState(listener: (event: SweetShopCafeOpenEvent) => void) {
    this.socket.on('sweet_shop:cafe-street:open-state', listener);
    const reconnect = () => listener({ profileId: '', isOpen: true });
    this.socket.on('connect', reconnect);
    return () => { this.socket.off('sweet_shop:cafe-street:open-state', listener); this.socket.off('connect', reconnect); };
  }
  onCafeDisplayChanged(listener: (event: SweetShopCafeDisplayEvent) => void) {
    this.socket.on('sweet_shop:cafe:display-changed', listener);
    return () => { this.socket.off('sweet_shop:cafe:display-changed', listener); };
  }
  sendCafeChat(message: string) { return this.emit<{ cafeProfileId: string; participantCount: number }>('sweet_shop:cafe:chat-send', { message }); }
  onCafeChat(listener: (event: SweetShopCafeChatEvent) => void) { this.socket.on('sweet_shop:cafe:chat-message', listener); return () => { this.socket.off('sweet_shop:cafe:chat-message', listener); }; }
  onCafePurchase(listener: (event: SweetShopCafePurchaseEvent) => void) { this.socket.on('sweet_shop:cafe:purchase-notice', listener); return () => { this.socket.off('sweet_shop:cafe:purchase-notice', listener); }; }
  onCafeAccessRevoked(listener: (event: SweetShopCafeAccessRevokedEvent) => void) { this.socket.on(SWEET_SHOP_EVENTS.cafeAccessRevoked, listener); return () => { this.socket.off(SWEET_SHOP_EVENTS.cafeAccessRevoked, listener); }; }
}

export function createSweetShopGateway(): SweetShopGateway {
  return new SocketSweetShopGateway();
}
