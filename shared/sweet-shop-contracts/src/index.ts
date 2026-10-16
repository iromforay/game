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
  replyGuestbook: 'sweet_shop:guestbook:reply',
  listCafeStreet: 'sweet_shop:cafe-street:list',
  enterRealtimeCafe: 'sweet_shop:realtime:enter',
  leaveRealtimeCafe: 'sweet_shop:realtime:leave',
  moveRealtimeCafe: 'sweet_shop:realtime:move',
  realtimePresence: 'sweet_shop:realtime:presence',
  cafeOpenState: 'sweet_shop:cafe-street:open-state',
  cafeDisplayChanged: 'sweet_shop:cafe:display-changed',
  cafeChatSend: 'sweet_shop:cafe:chat-send',
  cafeChatMessage: 'sweet_shop:cafe:chat-message',
  cafePurchaseNotice: 'sweet_shop:cafe:purchase-notice',
  cafeAccessRevoked: 'sweet_shop:cafe:access-revoked',
  activateAdvertisement: 'sweet_shop:advertisement:activate',
  listFriends: 'sweet_shop:friend:list',
  addFriend: 'sweet_shop:friend:add',
  removeFriend: 'sweet_shop:friend:remove',
  blockProfile: 'sweet_shop:profile:block',
  listBlockedProfiles: 'sweet_shop:profile:blocked-list',
  unblockProfile: 'sweet_shop:profile:unblock',
  reportProfile: 'sweet_shop:profile:report',
} as const;

export type SweetShopEvent = (typeof SWEET_SHOP_EVENTS)[keyof typeof SWEET_SHOP_EVENTS];
export type IngredientId = 'flour' | 'sugar' | 'egg' | 'milk' | 'butter' | 'strawberry' | 'cocoa' | 'honey' | 'cream' | 'vanilla' | 'caramel';
export type RecipeId = 'butter-cookie' | 'milk-pudding' | 'strawberry-macaron' | 'choco-cupcake' | 'honey-cake' | 'vanilla-cream-puff' | 'berry-tart' | 'caramel-eclair' | 'royal-choco-gateau' | 'starlight-celebration-cake';
export type DessertQuality = 'normal' | 'good' | 'excellent' | 'premium';
export type DeliveryStatus = 'ORDERED' | 'ARRIVED' | 'WAITING_FOR_SPACE' | 'RECEIVED';
export type CookingStatus = 'QUEUED' | 'COOKING' | 'COMPLETED' | 'WAITING_FOR_SPACE' | 'RECEIVED';

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
  level: number;
  basePrice: number;
}

export const INGREDIENTS: readonly IngredientDefinition[] = [
  { id: 'flour', name: '밀가루', unitPrice: 3, deliverySeconds: 10 },
  { id: 'sugar', name: '설탕', unitPrice: 2, deliverySeconds: 10 },
  { id: 'egg', name: '달걀', unitPrice: 4, deliverySeconds: 15 },
  { id: 'milk', name: '우유', unitPrice: 5, deliverySeconds: 15 },
  { id: 'butter', name: '버터', unitPrice: 6, deliverySeconds: 20 },
  { id: 'strawberry', name: '딸기', unitPrice: 8, deliverySeconds: 20 },
  { id: 'cocoa', name: '코코아', unitPrice: 9, deliverySeconds: 25 },
  { id: 'honey', name: '꿀', unitPrice: 10, deliverySeconds: 25 },
  { id: 'cream', name: '생크림', unitPrice: 11, deliverySeconds: 30 },
  { id: 'vanilla', name: '바닐라', unitPrice: 13, deliverySeconds: 30 },
  { id: 'caramel', name: '캐러멜', unitPrice: 15, deliverySeconds: 35 },
] as const;

export const RECIPES: readonly RecipeDefinition[] = [
  { id: 'butter-cookie', name: '버터 쿠키', cookSeconds: 10, ingredients: { flour: 2, sugar: 1, butter: 1 }, level: 1, basePrice: 24 },
  { id: 'milk-pudding', name: '우유 푸딩', cookSeconds: 12.5, ingredients: { sugar: 1, egg: 1, milk: 2 }, level: 2, basePrice: 34 },
  { id: 'strawberry-macaron', name: '딸기 마카롱', cookSeconds: 15, ingredients: { flour: 1, sugar: 2, egg: 1, strawberry: 2 }, level: 3, basePrice: 48 },
  { id: 'choco-cupcake', name: '초코 컵케이크', cookSeconds: 17.5, ingredients: { flour: 2, sugar: 1, egg: 1, milk: 1, cocoa: 1 }, level: 4, basePrice: 62 },
  { id: 'honey-cake', name: '허니 케이크', cookSeconds: 20, ingredients: { flour: 2, egg: 1, milk: 1, butter: 1, honey: 1 }, level: 5, basePrice: 80 },
  { id: 'vanilla-cream-puff', name: '바닐라 슈크림', cookSeconds: 22.5, ingredients: { flour: 2, egg: 2, milk: 1, cream: 1, vanilla: 1 }, level: 6, basePrice: 102 },
  { id: 'berry-tart', name: '베리 크림 타르트', cookSeconds: 25, ingredients: { flour: 2, sugar: 1, butter: 1, strawberry: 2, cream: 1 }, level: 7, basePrice: 128 },
  { id: 'caramel-eclair', name: '캐러멜 에클레어', cookSeconds: 27.5, ingredients: { flour: 2, egg: 2, milk: 1, cream: 1, caramel: 1 }, level: 8, basePrice: 158 },
  { id: 'royal-choco-gateau', name: '로열 쇼콜라 가토', cookSeconds: 30, ingredients: { flour: 3, sugar: 2, egg: 2, butter: 1, cocoa: 2, cream: 1 }, level: 9, basePrice: 196 },
  { id: 'starlight-celebration-cake', name: '별빛 축제 케이크', cookSeconds: 35, ingredients: { flour: 3, sugar: 2, egg: 2, butter: 2, strawberry: 2, honey: 1, cream: 2, vanilla: 1 }, level: 10, basePrice: 250 },
] as const;

export interface SweetShopCafeState {
  profile: {
    profileId: string;
    ownerName: string;
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
  listings: SweetShopListing[];
  sales: SweetShopSale[];
  buff: SweetShopCookingBuff | null;
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
  level: number;
  makerName: string;
  source: 'crafted' | 'npc-cafe';
}

export interface SweetShopListing {
  id: string;
  dessertId: string;
  recipeId: RecipeId;
  name: string;
  quality: DessertQuality;
  quantity: number;
  unitPrice: number;
  listedAt: string;
  nextNpcPurchaseAt: string;
}

export interface SweetShopSale {
  id: string;
  listingId: string;
  dessertName: string;
  quantity: number;
  totalPrice: number;
  buyerName: string;
  soldAt: string;
}

export interface SweetShopCookingBuff {
  sourceDessertName: string;
  qualityBonus: 1 | 2;
  eligibleRecipeLevel: number;
  endsAt: string;
}

export interface SweetShopCafeSummary {
  profileId: string;
  cafeName: string;
  ownerName: string;
  icon: string;
  level: number;
  representativeDessert: string;
  listingCount: number;
  advertised?: boolean;
}

export interface SweetShopVisitedCafe extends SweetShopCafeSummary {
  greeting: string;
  listings: Array<{
    id: string;
    recipeId: RecipeId;
    name: string;
    quality: DessertQuality;
    level: number;
    quantity: number;
    unitPrice: number;
  }>;
  guestbook: Array<{ id: string; visitorName: string; messageCode: string; stickerCode?: string; replyStickerCode?: string; createdAt: string }>;
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
export interface VisitCafeRequest { cafeProfileId: string; }
export interface BuyDessertRequest { requestId: string; listingId: string; quantity: number; }
export interface EatDessertRequest { requestId: string; dessertId: string; }
export interface CreateGuestbookRequest { requestId: string; cafeProfileId: string; messageCode: string; stickerCode?: string; }
export interface ReplyGuestbookRequest { requestId: string; guestbookId: string; replyStickerCode: string; }
export interface ProfileTargetRequest { requestId: string; profileId: string; }
export interface ReportProfileRequest extends ProfileTargetRequest { reasonCode: 'spam' | 'abuse' | 'inappropriate' | 'other'; detail?: string; }
export interface ActivateAdvertisementRequest { requestId: string; hours: 1 | 3 | 6; }
export interface SweetShopRealtimePlayer { profileId: string; nickname: string; cafeProfileId: string; isOwner: boolean; x: number; y: number; }
export interface EnterRealtimeCafeRequest { cafeProfileId: string; x: number; y: number; }
export interface MoveRealtimeCafeRequest { x: number; y: number; }
export interface SweetShopRealtimeEvent { type: 'snapshot' | 'joined' | 'moved' | 'left'; players: SweetShopRealtimePlayer[]; player?: SweetShopRealtimePlayer; profileId?: string; }
export interface SweetShopCafeOpenEvent { profileId: string; isOpen: boolean; }
export interface SweetShopCafeDisplayEvent { profileId: string; }
export interface SweetShopCafeChatEvent { profileId: string; cafeProfileId: string; nickname: string; message: string; sentAt: string; }
export interface SweetShopCafePurchaseEvent { profileId: string; dessertName: string; totalPrice: number; }
export interface SweetShopCafeAccessRevokedEvent { profileId: string; message: string; }

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
  listCafeStreet(): Promise<SweetShopResult<SweetShopCafeSummary[]>>;
  visitCafe(request: VisitCafeRequest): Promise<SweetShopResult<SweetShopVisitedCafe>>;
  buyDessert(request: BuyDessertRequest): Promise<SweetShopResult<{ dessertId: string }>>;
  eatDessert(request: EatDessertRequest): Promise<SweetShopResult<{ buffEndsAt: string }>>;
  createGuestbook(request: CreateGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>>;
  replyGuestbook(request: ReplyGuestbookRequest): Promise<SweetShopResult<{ guestbookId: string }>>;
  listFriends(): Promise<SweetShopResult<SweetShopCafeSummary[]>>;
  addFriend(request: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>>;
  removeFriend(request: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>>;
  blockProfile(request: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>>;
  listBlockedProfiles(): Promise<SweetShopResult<SweetShopCafeSummary[]>>;
  unblockProfile(request: ProfileTargetRequest): Promise<SweetShopResult<{ profileId: string }>>;
  reportProfile(request: ReportProfileRequest): Promise<SweetShopResult<{ reportId: string }>>;
  activateAdvertisement(request: ActivateAdvertisementRequest): Promise<SweetShopResult<{ endsAt: string }>>;
  enterRealtimeCafe(request: EnterRealtimeCafeRequest): Promise<SweetShopResult<{ players: SweetShopRealtimePlayer[]; chatMessages?: SweetShopCafeChatEvent[] }>>;
  leaveRealtimeCafe(): Promise<SweetShopResult<Record<string, never>>>;
  moveRealtimeCafe(request: MoveRealtimeCafeRequest): void;
  onRealtimePresence(listener: (event: SweetShopRealtimeEvent) => void): () => void;
  onCafeOpenState(listener: (event: SweetShopCafeOpenEvent) => void): () => void;
  onCafeDisplayChanged(listener: (event: SweetShopCafeDisplayEvent) => void): () => void;
  sendCafeChat(message: string): Promise<SweetShopResult<{ cafeProfileId: string; participantCount: number }>>;
  onCafeChat(listener: (event: SweetShopCafeChatEvent) => void): () => void;
  onCafePurchase(listener: (event: SweetShopCafePurchaseEvent) => void): () => void;
  onCafeAccessRevoked(listener: (event: SweetShopCafeAccessRevokedEvent) => void): () => void;
}
