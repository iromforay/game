import type {
  BuyDessertRequest, CreateGuestbookRequest, CreateListingRequest, EatDessertRequest,
  OrderIngredientsRequest, ReceiveCookingRequest, ReceiveDeliveryRequest, RemoveListingRequest,
  StartCookingRequest, SweetShopCafeState, SweetShopGateway, SweetShopResult, UpdateListingRequest,
  VisitCafeRequest,
} from 'sweet-shop-contracts';

// 허브에서 빌드하므로 접속 주소는 hub/.env를 단일 설정 원본으로 사용한다.
export const SWEET_SHOP_SERVER_URL: string =
  import.meta.env.VITE_SWEET_SHOP_SERVER_URL ?? 'http://localhost:3005';

const STORAGE_KEY = 'sweet-shop-local-state-v1';
const DEFAULT_STATE: SweetShopCafeState = {
  profile: { cafeName: '나의 달콤상점', level: 1, experience: 0, gold: 100 },
  storage: { ingredientSlotLimit: 12, dessertSlotLimit: 12 },
  ingredients: {},
  unlockedRecipes: ['butter-cookie'],
  updatedAt: new Date(0).toISOString(),
};

export class LocalSweetShopGateway implements SweetShopGateway {
  async loadCafe(): Promise<SweetShopCafeState> {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as SweetShopCafeState;
    } catch { /* 저장을 사용할 수 없는 환경에서는 기본 상태로 진행한다. */ }
    const initial = { ...DEFAULT_STATE, updatedAt: new Date().toISOString() };
    this.save(initial);
    return initial;
  }

  async orderIngredients(_request: OrderIngredientsRequest): Promise<SweetShopResult<{ deliveryId: string }>> {
    return { ok: false, code: 'PHASE_0_ONLY', message: '재료 주문은 2단계에서 활성화됩니다.' };
  }

  receiveDelivery(_request: ReceiveDeliveryRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.phase0(); }
  startCooking(_request: StartCookingRequest): Promise<SweetShopResult<{ cookingId: string; completesAt: string }>> { return this.phase0(); }
  receiveCooking(_request: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.phase0(); }
  createListing(_request: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.phase0(); }
  updateListing(_request: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.phase0(); }
  removeListing(_request: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.phase0(); }
  visitCafe(_request: VisitCafeRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.phase0(); }
  buyDessert(_request: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.phase0(); }
  eatDessert(_request: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>> { return this.phase0(); }
  createGuestbook(_request: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.phase0(); }

  private async phase0<T>(): Promise<SweetShopResult<T>> {
    return { ok: false, code: 'PHASE_0_ONLY', message: '이 기능은 다음 개발 단계에서 활성화됩니다.' };
  }

  private save(state: SweetShopCafeState) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 로컬 저장 실패는 플레이를 막지 않는다. */ }
  }
}

export class SocketSweetShopGateway implements SweetShopGateway {
  readonly serverUrl = SWEET_SHOP_SERVER_URL;

  async loadCafe(): Promise<SweetShopCafeState> {
    throw new Error('달콤상점 멀티플레이는 아직 비활성화되어 있습니다.');
  }

  async orderIngredients(_request: OrderIngredientsRequest): Promise<SweetShopResult<{ deliveryId: string }>> {
    return this.disabled();
  }

  receiveDelivery(_request: ReceiveDeliveryRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.disabled(); }
  startCooking(_request: StartCookingRequest): Promise<SweetShopResult<{ cookingId: string; completesAt: string }>> { return this.disabled(); }
  receiveCooking(_request: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.disabled(); }
  createListing(_request: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  updateListing(_request: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  removeListing(_request: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>> { return this.disabled(); }
  visitCafe(_request: VisitCafeRequest): Promise<SweetShopResult<SweetShopCafeState>> { return this.disabled(); }
  buyDessert(_request: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>> { return this.disabled(); }
  eatDessert(_request: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>> { return this.disabled(); }
  createGuestbook(_request: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>> { return this.disabled(); }

  private async disabled<T>(): Promise<SweetShopResult<T>> {
    return { ok: false, code: 'MULTIPLAYER_DISABLED', message: '달콤상점 멀티플레이는 아직 비활성화되어 있습니다.' };
  }
}
