import {
  INGREDIENTS, RECIPES, type BuyDessertRequest, type CreateGuestbookRequest,
  type CompleteFirstCookingTutorialRequest, type CreateListingRequest, type DessertQuality, type EatDessertRequest,
  type IngredientId, type OrderIngredientsRequest, type ReceiveCookingRequest,
  type ReceiveDeliveryRequest, type RemoveListingRequest, type StartCookingRequest,
  type SweetShopCafeState, type SweetShopGateway, type SweetShopResult,
  type UpdateListingRequest, type VisitCafeRequest,
} from 'sweet-shop-contracts';

export const SWEET_SHOP_SERVER_URL: string =
  import.meta.env?.VITE_SWEET_SHOP_SERVER_URL ?? 'http://localhost:3005';

const STORAGE_KEY = 'sweet-shop-local-state-v1';
const QUALITY_ORDER: DessertQuality[] = ['normal', 'good', 'excellent', 'premium'];

function initialState(): SweetShopCafeState {
  return {
    profile: { cafeName: '나의 달콤상점', level: 1, experience: 0, gold: 100 },
    storage: { ingredientSlotLimit: 12, dessertSlotLimit: 12 }, ingredients: {},
    tutorial: { firstCookingCompleted: false },
    unlockedRecipes: ['butter-cookie'], deliveries: [], cookingJobs: [], desserts: [],
    recipeProgress: { 'butter-cookie': { masteryExperience: 0, craftCount: 0, bestQuality: null } },
    updatedAt: new Date().toISOString(),
  };
}

function settle(state: SweetShopCafeState): SweetShopCafeState {
  const now = Date.now();
  return {
    ...state,
    deliveries: state.deliveries.map((item) => item.status === 'ORDERED' && Date.parse(item.arrivesAt) <= now ? { ...item, status: 'ARRIVED' } : item),
    cookingJobs: state.cookingJobs.map((item) => item.status === 'COOKING' && Date.parse(item.completesAt) <= now ? { ...item, status: 'COMPLETED' } : item),
    updatedAt: new Date().toISOString(),
  };
}

function normalize(value: Partial<SweetShopCafeState>): SweetShopCafeState {
  const base = initialState();
  return settle({
    ...base, ...value, profile: { ...base.profile, ...value.profile }, storage: { ...base.storage, ...value.storage }, tutorial: { ...base.tutorial, ...value.tutorial },
    ingredients: value.ingredients ?? {}, unlockedRecipes: value.unlockedRecipes?.length ? value.unlockedRecipes : base.unlockedRecipes,
    deliveries: value.deliveries ?? [], cookingJobs: value.cookingJobs ?? [], desserts: value.desserts ?? [],
    recipeProgress: value.recipeProgress ?? base.recipeProgress,
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
    if (state.cookingJobs.some((item) => item.status !== 'RECEIVED')) return fail('COUNTER_BUSY', '진행 중인 조리를 먼저 완료해주세요.');
    for (const [id, amount] of Object.entries(recipe.ingredients)) if ((state.ingredients[id as IngredientId] ?? 0) < (amount ?? 0) * request.quantity) return fail('NOT_ENOUGH_INGREDIENTS', '필요한 재료가 부족합니다.');
    for (const [id, amount] of Object.entries(recipe.ingredients)) state.ingredients[id as IngredientId] = (state.ingredients[id as IngredientId] ?? 0) - (amount ?? 0) * request.quantity;
    const startedAt = new Date(); const completesAt = new Date(startedAt.getTime() + recipe.cookSeconds * 1000).toISOString(); const cookingId = makeId('cooking');
    state.cookingJobs.push({ id: cookingId, recipeId: recipe.id, quantity: request.quantity, startedAt: startedAt.toISOString(), completesAt, status: 'COOKING' });
    this.save(state); return { ok: true, data: { cookingId, completesAt }, message: `${recipe.name} 조리를 시작했습니다.` };
  }

  async receiveCooking(request: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>> {
    const state = await this.loadCafe(); const job = state.cookingJobs.find((item) => item.id === request.cookingId);
    if (!job || job.status === 'RECEIVED') return fail('COOKING_NOT_FOUND', '받을 디저트가 없습니다.');
    if (Date.parse(job.completesAt) > Date.now()) return fail('COOKING_NOT_READY', '아직 조리 중입니다.');
    if (state.desserts.length >= state.storage.dessertSlotLimit) { job.status = 'WAITING_FOR_SPACE'; this.save(state); return fail('DESSERT_STORAGE_FULL', '디저트 상자에 빈칸이 없습니다.'); }
    const recipe = RECIPES.find((item) => item.id === job.recipeId)!;
    const progress = state.recipeProgress[job.recipeId] ?? { masteryExperience: 0, craftCount: 0, bestQuality: null };
    const quality = QUALITY_ORDER[progress.craftCount >= 4 ? 1 : 0]; const dessertId = makeId('dessert');
    state.desserts.push({ id: dessertId, recipeId: job.recipeId, name: recipe.name, quantity: job.quantity, quality, createdAt: new Date().toISOString() });
    const completesTutorial = job.recipeId === 'butter-cookie' && !state.tutorial.firstCookingCompleted;
    state.recipeProgress[job.recipeId] = { masteryExperience: progress.masteryExperience + 10 * job.quantity, craftCount: progress.craftCount + job.quantity, bestQuality: !progress.bestQuality || QUALITY_ORDER.indexOf(quality) > QUALITY_ORDER.indexOf(progress.bestQuality) ? quality : progress.bestQuality };
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

  createListing(_r: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.later(); }
  updateListing(_r: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.later(); }
  removeListing(_r: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.later(); }
  visitCafe(_r: VisitCafeRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.later(); }
  buyDessert(_r: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.later(); }
  eatDessert(_r: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>> { return this.later(); }
  createGuestbook(_r: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.later(); }
  private async later<T>(): Promise<SweetShopResult<T>> { return fail('NOT_AVAILABLE', '먼저 디저트를 만들며 카페 영업을 준비해주세요.'); }
  private save(state: SweetShopCafeState) { state.updatedAt = new Date().toISOString(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 저장 실패 무시 */ } }
}

export class SocketSweetShopGateway implements SweetShopGateway {
  readonly serverUrl = SWEET_SHOP_SERVER_URL;
  async loadCafe(): Promise<SweetShopCafeState> { throw new Error('달콤상점 멀티플레이는 아직 비활성화되어 있습니다.'); }
  async orderIngredients(_r: OrderIngredientsRequest): Promise<SweetShopResult<{ deliveryId: string }>> { return this.disabled(); }
  receiveDelivery(_r: ReceiveDeliveryRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.disabled(); }
  startCooking(_r: StartCookingRequest): Promise<SweetShopResult<{ cookingId: string; completesAt: string }>> { return this.disabled(); }
  receiveCooking(_r: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.disabled(); }
  completeFirstCookingTutorial(_r: CompleteFirstCookingTutorialRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.disabled(); }
  createListing(_r: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  updateListing(_r: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  removeListing(_r: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  visitCafe(_r: VisitCafeRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.disabled(); }
  buyDessert(_r: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.disabled(); }
  eatDessert(_r: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>> { return this.disabled(); }
  createGuestbook(_r: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.disabled(); }
  private async disabled<T>(): Promise<SweetShopResult<T>> { return fail('MULTIPLAYER_DISABLED', '달콤상점 멀티플레이는 아직 비활성화되어 있습니다.'); }
}
