export const SWEET_SHOP_EVENTS = {
  loadCafe: 'sweet_shop:cafe:load',
  orderIngredients: 'sweet_shop:ingredient:order',
  receiveDelivery: 'sweet_shop:delivery:receive',
  startCooking: 'sweet_shop:cooking:start',
  receiveCooking: 'sweet_shop:cooking:receive',
  completeFirstCookingTutorial: 'sweet_shop:tutorial:first-cooking:complete',
  createListing: 'sweet_shop:listing:create',
  updateListing: 'sweet_shop:listing:update',
  removeListing: 'sweet_shop:listing:remove',
  visitCafe: 'sweet_shop:cafe:visit',
  buyDessert: 'sweet_shop:dessert:buy',
  eatDessert: 'sweet_shop:dessert:eat',
  createGuestbook: 'sweet_shop:guestbook:create',
} as const;

export type SweetShopEvent = (typeof SWEET_SHOP_EVENTS)[keyof typeof SWEET_SHOP_EVENTS];
export type IngredientId = 'flour' | 'sugar' | 'egg' | 'milk' | 'butter' | 'strawberry';
export type RecipeId = 'butter-cookie' | 'strawberry-macaron' | 'milk-pudding';
export type DessertQuality = 'normal' | 'good' | 'excellent' | 'premium';
export type DeliveryStatus = 'ORDERED' | 'ARRIVED' | 'WAITING_FOR_SPACE' | 'RECEIVED';
export type CookingStatus = 'COOKING' | 'COMPLETED' | 'WAITING_FOR_SPACE' | 'RECEIVED';

export interface IngredientDefinition {
  id: IngredientId;
  name: string;
  unitPrice: number;
  deliverySeconds: number;
}

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  cookSeconds: number;
  ingredients: Partial<Record<IngredientId, number>>;
}

export const INGREDIENTS: readonly IngredientDefinition[] = [
  { id: 'flour', name: '밀가루', unitPrice: 3, deliverySeconds: 10 },
  { id: 'sugar', name: '설탕', unitPrice: 2, deliverySeconds: 10 },
  { id: 'egg', name: '달걀', unitPrice: 4, deliverySeconds: 15 },
  { id: 'milk', name: '우유', unitPrice: 5, deliverySeconds: 15 },
  { id: 'butter', name: '버터', unitPrice: 6, deliverySeconds: 20 },
  { id: 'strawberry', name: '딸기', unitPrice: 8, deliverySeconds: 20 },
] as const;

export const RECIPES: readonly RecipeDefinition[] = [
  { id: 'butter-cookie', name: '버터 쿠키', cookSeconds: 20, ingredients: { flour: 2, sugar: 1, butter: 1 } },
  { id: 'strawberry-macaron', name: '딸기 마카롱', cookSeconds: 30, ingredients: { flour: 1, sugar: 2, egg: 1, strawberry: 2 } },
  { id: 'milk-pudding', name: '우유 푸딩', cookSeconds: 25, ingredients: { sugar: 1, egg: 1, milk: 2 } },
] as const;

export interface SweetShopCafeState {
  profile: {
    cafeName: string;
    level: number;
    experience: number;
    gold: number;
  };
  storage: {
    ingredientSlotLimit: number;
    dessertSlotLimit: number;
  };
  tutorial: {
    firstCookingCompleted: boolean;
  };
  ingredients: Partial<Record<IngredientId, number>>;
  unlockedRecipes: RecipeId[];
  deliveries: SweetShopDelivery[];
  cookingJobs: SweetShopCookingJob[];
  desserts: SweetShopDessert[];
  recipeProgress: Partial<Record<RecipeId, SweetShopRecipeProgress>>;
  updatedAt: string;
}

export interface SweetShopDelivery {
  id: string;
  ingredientId: IngredientId;
  quantity: number;
  totalPrice: number;
  orderedAt: string;
  arrivesAt: string;
  status: DeliveryStatus;
}

export interface SweetShopCookingJob {
  id: string;
  recipeId: RecipeId;
  quantity: number;
  startedAt: string;
  completesAt: string;
  status: CookingStatus;
}

export interface SweetShopDessert {
  id: string;
  recipeId: RecipeId;
  name: string;
  quantity: number;
  quality: DessertQuality;
  createdAt: string;
}

export interface SweetShopRecipeProgress {
  masteryExperience: number;
  craftCount: number;
  bestQuality: DessertQuality | null;
}

export interface OrderIngredientsRequest {
  requestId: string;
  ingredientId: IngredientId;
  quantity: number;
}

export interface ReceiveDeliveryRequest { requestId: string; deliveryId: string; }
export interface StartCookingRequest { requestId: string; recipeId: RecipeId; quantity: number; }
export interface ReceiveCookingRequest { requestId: string; cookingId: string; }
export interface CompleteFirstCookingTutorialRequest { requestId: string; }
export interface CreateListingRequest { requestId: string; dessertId: string; quantity: number; unitPrice: number; }
export interface UpdateListingRequest { requestId: string; listingId: string; quantity: number; unitPrice: number; }
export interface RemoveListingRequest { requestId: string; listingId: string; }
export interface VisitCafeRequest { cafeAccountId: string; }
export interface BuyDessertRequest { requestId: string; listingId: string; quantity: number; }
export interface EatDessertRequest { requestId: string; dessertId: string; }
export interface CreateGuestbookRequest { requestId: string; cafeAccountId: string; messageCode: string; stickerCode?: string; }

export interface SweetShopResult<T> {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
}

export interface SweetShopGateway {
  loadCafe(): Promise<SweetShopCafeState>;
  orderIngredients(request: OrderIngredientsRequest): Promise<SweetShopResult<{ deliveryId: string }>>;
  receiveDelivery(request: ReceiveDeliveryRequest): Promise<SweetShopResult<SweetShopCafeState>>;
  startCooking(request: StartCookingRequest): Promise<SweetShopResult<{ cookingId: string; completesAt: string }>>;
  receiveCooking(request: ReceiveCookingRequest): Promise<SweetShopResult<{ dessertId: string }>>;
  completeFirstCookingTutorial(request: CompleteFirstCookingTutorialRequest): Promise<SweetShopResult<SweetShopCafeState>>;
  createListing(request: CreateListingRequest): Promise<SweetShopResult<{ listingId: string }>>;
  updateListing(request: UpdateListingRequest): Promise<SweetShopResult<{ listingId: string }>>;
  removeListing(request: RemoveListingRequest): Promise<SweetShopResult<{ listingId: string }>>;
  visitCafe(request: VisitCafeRequest): Promise<SweetShopResult<SweetShopCafeState>>;
  buyDessert(request: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>>;
  eatDessert(request: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>>;
  createGuestbook(request: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>>;
}
