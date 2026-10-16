import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  INGREDIENTS, RECIPES, type IngredientId, type ListingAudience, type RecipeId,
  type SweetShopCafeState, type SweetShopCafeSummary, type SweetShopGateway, type SweetShopRealtimePlayer,
  type SweetShopResult, type SweetShopVisitedCafe,
} from 'sweet-shop-contracts';
import { dessertPriceRange } from './shopGateway';
import playerChefImage from './assets/player-pastry-chef.png';
import cafeBackground from './assets/cafe-workshop-background.png';
import cafeDoorImage from './assets/facility-cafe-door.png';
import cookingCounterImage from './assets/facility-cooking-counter.png';
import dessertBoxImage from './assets/facility-dessert-box.png';
import displayStandImage from './assets/facility-display-stand.png';
import ingredientStorageImage from './assets/facility-ingredient-storage.png';
import noticeBoardImage from './assets/facility-notice-board.png';
import orderBoardImage from './assets/facility-order-board.png';
import recipeBookImage from './assets/facility-recipe-book.png';
import cafeStreetBackground from './assets/cafe-street-background.png';
import cafeStreetShop from './assets/cafe-street-shop.png';
import ingredientFlour from './assets/ingredient-flour.png';
import ingredientSugar from './assets/ingredient-sugar.png';
import ingredientEgg from './assets/ingredient-egg.png';
import ingredientMilk from './assets/ingredient-milk.png';
import ingredientButter from './assets/ingredient-butter.png';
import ingredientStrawberry from './assets/ingredient-strawberry.png';
import ingredientCocoa from './assets/ingredient-cocoa.png';
import ingredientHoney from './assets/ingredient-honey.png';
import ingredientCream from './assets/ingredient-cream.png';
import ingredientVanilla from './assets/ingredient-vanilla.png';
import ingredientCaramel from './assets/ingredient-caramel.png';
import dessertButterCookie from './assets/dessert-butter-cookie.png';
import dessertMilkPudding from './assets/dessert-milk-pudding.png';
import dessertStrawberryMacaron from './assets/dessert-strawberry-macaron.png';
import dessertChocoCupcake from './assets/dessert-choco-cupcake.png';
import dessertHoneyCake from './assets/dessert-honey-cake.png';
import dessertVanillaCreamPuff from './assets/dessert-vanilla-cream-puff.png';
import dessertBerryTart from './assets/dessert-berry-tart.png';
import dessertCaramelEclair from './assets/dessert-caramel-eclair.png';
import dessertRoyalChocoGateau from './assets/dessert-royal-choco-gateau.png';
import dessertStarlightCelebrationCake from './assets/dessert-starlight-celebration-cake.png';
import { CAFE_FACILITIES, MAP_HEIGHT, MAP_WIDTH } from './cafeMap';

const INGREDIENT_ICON: Record<IngredientId, string> = { flour: ingredientFlour, sugar: ingredientSugar, egg: ingredientEgg, milk: ingredientMilk, butter: ingredientButter, strawberry: ingredientStrawberry, cocoa: ingredientCocoa, honey: ingredientHoney, cream: ingredientCream, vanilla: ingredientVanilla, caramel: ingredientCaramel };
const RECIPE_ICON: Record<RecipeId, string> = { 'butter-cookie': dessertButterCookie, 'milk-pudding': dessertMilkPudding, 'strawberry-macaron': dessertStrawberryMacaron, 'choco-cupcake': dessertChocoCupcake, 'honey-cake': dessertHoneyCake, 'vanilla-cream-puff': dessertVanillaCreamPuff, 'berry-tart': dessertBerryTart, 'caramel-eclair': dessertCaramelEclair, 'royal-choco-gateau': dessertRoyalChocoGateau, 'starlight-celebration-cake': dessertStarlightCelebrationCake };
const AssetIcon = ({ src, alt = '' }: { src: string; alt?: string }) => <img className="item-art" src={src} alt={alt} draggable={false} />;
const QUALITY_NAME = { normal: '보통', good: '좋음', excellent: '훌륭함', premium: '최고급' } as const;
const QUALITY_ORDER = ['normal', 'good', 'excellent', 'premium'] as const;
const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

interface Props {
  facilityId: string;
  cafe: SweetShopCafeState;
  gateway: SweetShopGateway;
  now: number;
  onRefresh: () => Promise<void>;
  onMessage: (message: string, good?: boolean) => void;
  onNavigate: (facilityId: string) => void;
  onEnterCafeStreet: () => void;
}

export function ShopFacilityPanel(props: Props) {
  if (props.facilityId === 'order-board') return <OrderPanel {...props} />;
  if (props.facilityId === 'cooking-counter') return <CookingPanel {...props} />;
  if (props.facilityId === 'ingredient-storage') return <InventoryPanel {...props} initialTab="ingredients" />;
  if (props.facilityId === 'dessert-box') return <InventoryPanel {...props} initialTab="desserts" />;
  if (props.facilityId === 'recipe-book') return <InventoryPanel {...props} initialTab="recipes" />;
  if (props.facilityId === 'display-stand') return <DisplayStandPanel {...props} />;
  if (props.facilityId === 'notice-board') return <SalesPanel {...props} />;
  if (props.facilityId === 'cafe-door') return props.cafe.tutorial.firstCookingCompleted
    ? <div className="facility-notice street-exit-notice"><span>🏘️</span><strong>카페 거리로 나갈까요?</strong><p>이웃 카페를 둘러보고 디저트를 구매할 수 있습니다.</p><button className="primary-action" onClick={props.onEnterCafeStreet}>카페 거리로 나가기 →</button></div>
    : <div className="facility-notice"><span>🚪</span><strong>첫 디저트를 먼저 완성해요</strong><p>버터 쿠키를 한 번 완성하면 카페 거리가 열립니다.</p><button className="primary-action" onClick={() => props.onNavigate('order-board')}>첫 재료 주문하기</button></div>;
  return <p>아직 사용할 수 없는 시설입니다.</p>;
}

function OrderPanel({ cafe, gateway, now, onRefresh, onMessage }: Props) {
  const [quantities, setQuantities] = useState<Partial<Record<IngredientId, number>>>({});
  const [selectedRecipeId, setSelectedRecipeId] = useState<RecipeId>(cafe.unlockedRecipes[0] ?? 'butter-cookie');
  const [recipeQuantity, setRecipeQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const deliveries = cafe.deliveries.filter((item) => item.status !== 'RECEIVED');
  const selectedRecipe = RECIPES.find((recipe) => recipe.id === selectedRecipeId) ?? RECIPES[0];
  const recipeCart = Object.entries(selectedRecipe.ingredients).map(([ingredientId, amount]) => {
    const ingredient = INGREDIENTS.find((item) => item.id === ingredientId)!;
    const required = (amount ?? 0) * recipeQuantity;
    const owned = cafe.ingredients[ingredient.id] ?? 0;
    const incoming = deliveries.filter((delivery) => delivery.ingredientId === ingredient.id).reduce((sum, delivery) => sum + delivery.quantity, 0);
    const missing = Math.max(0, required - owned - incoming);
    return { ingredient, required, owned, incoming, missing, price: missing * ingredient.unitPrice };
  });
  const recipeCartPrice = recipeCart.reduce((sum, item) => sum + item.price, 0);
  const act = async (promise: Promise<SweetShopResult<unknown>>) => {
    setBusy(true); const result = await promise; onMessage(result.message ?? (result.ok ? '완료했습니다.' : '처리하지 못했습니다.'), result.ok); await onRefresh(); setBusy(false);
  };
  const orderCookieSet = async () => {
    setBusy(true);
    const items: [IngredientId, number][] = [['flour', 2], ['sugar', 1], ['butter', 1]];
    for (const [ingredientId, quantity] of items) {
      const result = await gateway.orderIngredients({ requestId: id(), ingredientId, quantity });
      if (!result.ok) { onMessage(result.message ?? '주문하지 못했습니다.'); await onRefresh(); setBusy(false); return; }
    }
    onMessage('버터 쿠키 재료를 한 번에 주문했어요! 배송 바구니를 확인하세요.', true);
    await onRefresh(); setBusy(false);
  };
  const orderRecipeCart = async () => {
    if (recipeCartPrice > cafe.profile.gold) { onMessage('장바구니의 부족 재료를 주문하기에 골드가 부족합니다.'); return; }
    const missingItems = recipeCart.filter((item) => item.missing > 0);
    if (!missingItems.length) { onMessage(`${selectedRecipe.name} ${recipeQuantity}개를 만들 재료가 이미 준비되어 있습니다.`, true); return; }
    setBusy(true);
    for (const { ingredient, missing } of missingItems) {
      const result = await gateway.orderIngredients({ requestId: id(), ingredientId: ingredient.id, quantity: missing });
      if (!result.ok) { onMessage(result.message ?? `${ingredient.name}을 주문하지 못했습니다.`); await onRefresh(); setBusy(false); return; }
    }
    onMessage(`${selectedRecipe.name} ${recipeQuantity}개분 부족 재료를 한 번에 주문했습니다!`, true);
    await onRefresh(); setBusy(false);
  };
  return <div className="shop-panel-content">
    <div className="panel-summary"><span>보유 골드</span><strong>🪙 {cafe.profile.gold}</strong></div>
    <button className="starter-order" disabled={busy || cafe.profile.gold < 14} onClick={() => void orderCookieSet()}><span>🍪</span><div><strong>처음이라면 이걸 주문하세요!</strong><small>버터 쿠키 1개 분량 · 밀가루 2 + 설탕 1 + 버터 1</small></div><b>14G</b></button>
    <section className="recipe-cart">
      <div className="recipe-cart-title"><div><strong>레시피 자동 장바구니</strong><small>보유 재료와 배송 중인 재료를 제외한 부족분만 주문합니다.</small></div><span><AssetIcon src={RECIPE_ICON[selectedRecipe.id]} alt={selectedRecipe.name} /></span></div>
      <div className="recipe-cart-controls"><select aria-label="주문할 레시피" value={selectedRecipeId} onChange={(event) => setSelectedRecipeId(event.target.value as RecipeId)}>{RECIPES.filter((recipe) => cafe.unlockedRecipes.includes(recipe.id)).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}</select><div className="quantity-stepper"><button onClick={() => setRecipeQuantity(Math.max(1, recipeQuantity - 1))}>−</button><b>{recipeQuantity}개분</b><button onClick={() => setRecipeQuantity(Math.min(10, recipeQuantity + 1))}>＋</button></div></div>
      <div className="recipe-cart-items">{recipeCart.map(({ ingredient, required, owned, incoming, missing }) => <article className={missing ? 'missing' : 'ready'} key={ingredient.id}><i><AssetIcon src={INGREDIENT_ICON[ingredient.id]} alt={ingredient.name} /></i><div><strong>{ingredient.name}</strong><small>필요 {required} · 보유 {owned}{incoming > 0 ? ` · 배송 ${incoming}` : ''}</small></div><b>{missing ? `부족 ${missing}` : '준비됨'}</b></article>)}</div>
      <div className="recipe-cart-total"><span>부족 재료 합계</span><strong>{recipeCartPrice}G</strong><button className="primary-action" disabled={busy || recipeCartPrice === 0 || cafe.profile.gold < recipeCartPrice} onClick={() => void orderRecipeCart()}>{recipeCartPrice === 0 ? '재료 준비 완료' : '부족분 한 번에 주문'}</button></div>
    </section>
    <h3>재료별 직접 주문</h3>
    <div className="order-grid">{INGREDIENTS.map((item) => {
      const quantity = quantities[item.id] ?? 1; const price = item.unitPrice * quantity;
      return <article className="cute-card" key={item.id}>
        <i><AssetIcon src={INGREDIENT_ICON[item.id]} alt={item.name} /></i><div><strong>{item.name}</strong><small>개당 {item.unitPrice}G · {item.deliverySeconds}초</small></div>
        <div className="quantity-stepper"><button onClick={() => setQuantities({ ...quantities, [item.id]: Math.max(1, quantity - 1) })}>−</button><b>{quantity}</b><button onClick={() => setQuantities({ ...quantities, [item.id]: Math.min(20, quantity + 1) })}>＋</button></div>
        <button className="primary-action" disabled={busy || cafe.profile.gold < price} onClick={() => void act(gateway.orderIngredients({ requestId: id(), ingredientId: item.id, quantity }))}>{price}G 주문</button>
      </article>;
    })}</div>
    <h3>배송 바구니</h3>
    {!deliveries.length && <div className="empty-box">🧺<span>기다리는 배송이 없어요</span></div>}
    {deliveries.map((delivery) => {
      const ingredient = INGREDIENTS.find((item) => item.id === delivery.ingredientId)!;
      const seconds = Math.max(0, Math.ceil((Date.parse(delivery.arrivesAt) - now) / 1000)); const ready = seconds === 0;
      return <div className={`delivery-row ${ready ? 'ready' : ''}`} key={delivery.id}><span><AssetIcon src={INGREDIENT_ICON[delivery.ingredientId]} alt={ingredient.name} /></span><b>{ingredient.name} ×{delivery.quantity}<small>{QUALITY_NAME[delivery.quality]} 품질</small></b><em>{ready ? '도착!' : `${seconds}초`}</em><button disabled={!ready || busy} onClick={() => void act(gateway.receiveDelivery({ requestId: id(), deliveryId: delivery.id }))}>받기</button></div>;
    })}
  </div>;
}

function InventoryPanel({ cafe, gateway, onRefresh, onMessage, initialTab }: Props & { initialTab: 'ingredients' | 'desserts' | 'recipes' }) {
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const ingredientSlots = Object.values(cafe.ingredients).filter((quantity) => (quantity ?? 0) > 0).length;
  return <div className="shop-panel-content">
    <nav className="inventory-tabs"><button className={tab === 'ingredients' ? 'active' : ''} onClick={() => setTab('ingredients')}>재료 상자</button><button className={tab === 'desserts' ? 'active' : ''} onClick={() => setTab('desserts')}>디저트 상자</button><button className={tab === 'recipes' ? 'active' : ''} onClick={() => setTab('recipes')}>레시피</button></nav>
    {tab === 'ingredients' && <><div className="slot-meter"><span>보관 슬롯</span><b>{ingredientSlots}/{cafe.storage.ingredientSlotLimit}</b></div><div className="inventory-grid">{INGREDIENTS.map((item) => <article className={(cafe.ingredients[item.id] ?? 0) ? 'filled' : 'empty'} key={item.id}><i><AssetIcon src={INGREDIENT_ICON[item.id]} alt={item.name} /></i><strong>{item.name}</strong><b>×{cafe.ingredients[item.id] ?? 0}</b><small className="quality-stock">{QUALITY_ORDER.map((quality) => { const count = cafe.ingredientQualities[item.id]?.[quality] ?? 0; return count > 0 ? `${QUALITY_NAME[quality]} ${count}` : null; }).filter(Boolean).join(' · ') || '보유 없음'}</small></article>)}</div></>}
    {tab === 'desserts' && <><div className="slot-meter"><span>디저트 슬롯</span><b>{cafe.desserts.length}/{cafe.storage.dessertSlotLimit}</b></div>{cafe.buff && <div className="buff-banner">✨ {cafe.buff.sourceDessertName} 효과 · Lv.{cafe.buff.eligibleRecipeLevel} 이하 품질 +{cafe.buff.qualityBonus}</div>}<div className="inventory-grid dessert-grid">{cafe.desserts.map((item) => <article className="filled" key={item.id}><i><AssetIcon src={RECIPE_ICON[item.recipeId]} alt={item.name} /></i><strong>{item.name}</strong><small>{QUALITY_NAME[item.quality]} · Lv.{item.level}</small><b>×{item.quantity}</b>{item.source === 'npc-cafe' && <button disabled={busy} onClick={() => { setBusy(true); void gateway.eatDessert({ requestId: id(), dessertId: item.id }).then(async (result) => { onMessage(result.message ?? '디저트를 먹었습니다.', result.ok); await onRefresh(); setBusy(false); }); }}>먹기</button>}</article>)}{!cafe.desserts.length && <div className="empty-box wide">🎁<span>완성한 디저트가 없어요</span></div>}</div></>}
    {tab === 'recipes' && <RecipeList cafe={cafe} />}
  </div>;
}

function DisplayStandPanel({ cafe, gateway, onRefresh, onMessage }: Props) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [audiences, setAudiences] = useState<Record<string, ListingAudience>>({});
  const [busy, setBusy] = useState(false);
  const crafted = cafe.desserts.filter((item) => item.source === 'crafted');
  const act = async (promise: Promise<SweetShopResult<unknown>>) => { setBusy(true); const result = await promise; onMessage(result.message ?? '처리했습니다.', result.ok); await onRefresh(); setBusy(false); };
  const renderZone = (audience: ListingAudience, title: string, description: string) => {
    const listings = cafe.listings.filter((listing) => listing.audience === audience);
    return <section className={`display-zone display-zone-${audience}`}><header><div><strong>{title}</strong><small>{description}</small></div><b>{listings.length}개</b></header><div className="listing-grid">{listings.map((listing) => {
      const [min, max] = dessertPriceRange(listing.recipeId, listing.quality); const price = prices[listing.id] ?? listing.unitPrice; const otherAudience: ListingAudience = audience === 'friends' ? 'everyone' : 'friends';
      return <article className="listing-card active" key={listing.id}><i><AssetIcon src={RECIPE_ICON[listing.recipeId]} alt={listing.name} /></i><div><strong>{listing.name}</strong><small>{QUALITY_NAME[listing.quality]} · ×{listing.quantity}</small></div><b>{listing.unitPrice}G</b><input aria-label={`${listing.name} 가격`} type="range" min={min} max={max} value={price} onChange={(event) => setPrices({ ...prices, [listing.id]: Number(event.target.value) })}/><small>{min}~{max}G · 수정 {price}G</small><button className="move-listing" disabled={busy} onClick={() => void act(gateway.updateListing({ requestId: id(), listingId: listing.id, quantity: listing.quantity, unitPrice: price, audience: otherAudience }))}>{otherAudience === 'friends' ? '친구 전용으로 이동' : '모두에게 판매로 이동'}</button><div className="listing-actions"><button disabled={busy || price === listing.unitPrice} onClick={() => void act(gateway.updateListing({ requestId: id(), listingId: listing.id, quantity: listing.quantity, unitPrice: price, audience }))}>가격 변경</button><button className="secondary" disabled={busy} onClick={() => void act(gateway.removeListing({ requestId: id(), listingId: listing.id }))}>회수</button></div></article>;
    })}{!listings.length && <div className="empty-display">＋<small>이 구역은 비어 있어요</small></div>}</div></section>;
  };
  return <div className="shop-panel-content display-panel">
    <div className="slot-meter"><span>판매대</span><b>{cafe.listings.length}/3칸</b></div>
    {renderZone('friends', '👥 친구에게만 팔기', 'NPC는 이 구역의 상품을 구매하지 않습니다.')}
    {renderZone('everyone', '🌎 모두에게 팔기', '플레이어와 NPC가 모두 구매할 수 있습니다.')}
    <h3>진열할 디저트</h3>
    {!crafted.length && <div className="empty-box">🧁<span>직접 만든 디저트가 없습니다.</span></div>}
    <div className="sellable-list">{crafted.map((dessert) => {
      const [min, max] = dessertPriceRange(dessert.recipeId, dessert.quality); const price = prices[dessert.id] ?? Math.round((min + max) / 2); const quantity = Math.min(quantities[dessert.id] ?? 1, dessert.quantity);
      const audience = audiences[dessert.id] ?? 'friends';
      return <article key={dessert.id}><i><AssetIcon src={RECIPE_ICON[dessert.recipeId]} alt={dessert.name} /></i><div><strong>{dessert.name}</strong><small>{QUALITY_NAME[dessert.quality]} · 보유 {dessert.quantity}개 · 권장 {min}~{max}G</small></div><div className="quantity-stepper"><button onClick={() => setQuantities({ ...quantities, [dessert.id]: Math.max(1, quantity - 1) })}>−</button><b>{quantity}</b><button onClick={() => setQuantities({ ...quantities, [dessert.id]: Math.min(dessert.quantity, quantity + 1) })}>＋</button></div><input aria-label={`${dessert.name} 판매가격`} type="number" min={min} max={max} value={price} onChange={(event) => setPrices({ ...prices, [dessert.id]: Number(event.target.value) })}/><div className="audience-choice"><button className={audience === 'friends' ? 'selected' : ''} onClick={() => setAudiences({ ...audiences, [dessert.id]: 'friends' })}>친구만</button><button className={audience === 'everyone' ? 'selected' : ''} onClick={() => setAudiences({ ...audiences, [dessert.id]: 'everyone' })}>모두</button></div><button disabled={busy || cafe.listings.length >= 3 || price < min || price > max} onClick={() => void act(gateway.createListing({ requestId: id(), dessertId: dessert.id, quantity, unitPrice: price, audience }))}>선택 구역에 진열</button></article>;
    })}</div>
    <p className="npc-sale-note">NPC 손님은 ‘모두에게 팔기’ 구역만 이용합니다. 친구 전용 상품은 실제 플레이어를 위해 그대로 남습니다.</p>
  </div>;
}

function SalesPanel({ cafe, gateway, onRefresh, onMessage }: Props) {
  const [busy, setBusy] = useState(false);
  const [ownGuestbook, setOwnGuestbook] = useState<SweetShopVisitedCafe['guestbook']>([]);
  const [blockedProfiles, setBlockedProfiles] = useState<SweetShopCafeSummary[]>([]);
  const refreshGuestbook = async () => { const result = await gateway.visitCafe({ cafeProfileId: cafe.profile.profileId }); if (result.ok) setOwnGuestbook(result.data?.guestbook ?? []); };
  const refreshBlocked = async () => { const result = await gateway.listBlockedProfiles(); if (result.ok) setBlockedProfiles(result.data ?? []); };
  useEffect(() => { void refreshGuestbook(); void refreshBlocked(); }, [cafe.profile.profileId]);
  const advertise = async (hours: 1 | 3 | 6) => {
    setBusy(true);
    const result = await gateway.activateAdvertisement({ requestId: id(), hours });
    onMessage(result.message ?? (result.ok ? '알림노트 광고를 시작했습니다.' : '광고를 시작하지 못했습니다.'), result.ok);
    if (result.ok) await onRefresh();
    setBusy(false);
  };
  return <div className="shop-panel-content"><section className="advertisement-box"><div><strong>📣 알림노트 광고</strong><small>진열 상품이 있는 동안 카페 거리 상단에 먼저 노출됩니다.</small></div><div>{([[1, 20], [3, 50], [6, 90]] as const).map(([hours, cost]) => <button disabled={busy || !cafe.listings.length || cafe.profile.gold < cost} key={hours} onClick={() => void advertise(hours)}>{hours}시간 · {cost}G</button>)}</div>{!cafe.listings.length && <p>판매 상품을 먼저 진열해주세요.</p>}</section><section className="owner-guestbook"><h3>💌 방문 방명록</h3>{ownGuestbook.map((note) => <article key={note.id}><div><strong>{note.stickerCode} {note.visitorName}</strong><small>{note.messageCode}</small></div><div className="guestbook-replies">{['💖', '🍪', '✨'].map((sticker) => <button className={note.replyStickerCode === sticker ? 'selected' : ''} disabled={busy} key={sticker} onClick={async () => { setBusy(true); const result = await gateway.replyGuestbook({ requestId: id(), guestbookId: note.id, replyStickerCode: sticker }); onMessage(result.message ?? '답장을 남겼습니다.', result.ok); if (result.ok) await refreshGuestbook(); setBusy(false); }}>{sticker}</button>)}</div>{note.replyStickerCode && <em>내 답장 {note.replyStickerCode}</em>}</article>)}{!ownGuestbook.length && <div className="empty-box">📭<span>아직 방문 방명록이 없어요.</span></div>}</section><section className="blocked-profile-list"><h3>🚫 차단 목록</h3>{blockedProfiles.map((profile) => <article key={profile.profileId}><span>{profile.ownerName}</span><button disabled={busy} onClick={async () => { setBusy(true); const result = await gateway.unblockProfile({ requestId: id(), profileId: profile.profileId }); onMessage(result.message ?? '차단을 해제했습니다.', result.ok); if (result.ok) await refreshBlocked(); setBusy(false); }}>차단 해제</button></article>)}{!blockedProfiles.length && <small>차단한 사용자가 없습니다.</small>}</section><div className="panel-summary"><span>누적 판매</span><strong>🪙 {cafe.sales.reduce((sum, sale) => sum + sale.totalPrice, 0)}G</strong></div><div className="sales-list">{cafe.sales.map((sale) => <article key={sale.id}><span>💌</span><div><strong>{sale.buyerName}님이 {sale.dessertName} 구매</strong><small>{new Date(sale.soldAt).toLocaleTimeString()} · ×{sale.quantity}</small></div><b>+{sale.totalPrice}G</b></article>)}{!cafe.sales.length && <div className="empty-box">📭<span>아직 판매 소식이 없어요.</span></div>}</div></div>;
}

type CafeStreetProps = Pick<Props, 'cafe' | 'gateway' | 'onRefresh' | 'onMessage'>;

const VISITED_CAFE_IMAGES: Record<string, string> = {
  'order-board': orderBoardImage,
  'ingredient-storage': ingredientStorageImage,
  'recipe-book': recipeBookImage,
  'cooking-counter': cookingCounterImage,
  'dessert-box': dessertBoxImage,
  'display-stand': displayStandImage,
  'notice-board': noticeBoardImage,
  'cafe-door': cafeDoorImage,
};

function CafeStreetPanel({ cafe, gateway, onRefresh, onMessage }: CafeStreetProps) {
  const [cafes, setCafes] = useState<SweetShopCafeSummary[]>([]); const [visited, setVisited] = useState<SweetShopVisitedCafe | null>(null); const [busy, setBusy] = useState(false);
  const [reportReason, setReportReason] = useState<'spam' | 'abuse' | 'inappropriate' | 'other'>('inappropriate');
  const [walker, setWalker] = useState({ x: 50, y: 64 });
  const [visitorPosition, setVisitorPosition] = useState({ x: 684, y: 1476 });
  const [realtimePlayers, setRealtimePlayers] = useState<SweetShopRealtimePlayer[]>([]);
  const [friendDisplayOpen, setFriendDisplayOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ nickname: string; message: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  useEffect(() => {
    let active = true;
    const refreshStreet = () => { void gateway.listCafeStreet().then((result) => { if (active && result.ok) setCafes(result.data ?? []); }); };
    refreshStreet();
    const unsubscribe = gateway.onCafeOpenState((event) => {
      if (!event.profileId || event.isOpen) refreshStreet();
      else setCafes((current) => current.filter((item) => item.profileId !== event.profileId));
    });
    return () => { active = false; unsubscribe(); };
  }, [gateway]);
  useEffect(() => gateway.onRealtimePresence((event) => {
    if (event.type === 'snapshot') setRealtimePlayers(event.players);
    else if (event.type === 'left' && event.profileId) setRealtimePlayers((current) => current.filter((item) => item.profileId !== event.profileId));
    else if (event.player) setRealtimePlayers((current) => [...current.filter((item) => item.profileId !== event.player!.profileId), event.player!]);
  }), [gateway]);
  useEffect(() => gateway.onCafeDisplayChanged((event) => {
    if (!visited || event.profileId !== visited.profileId) return;
    void gateway.visitCafe({ cafeProfileId: visited.profileId }).then((result) => {
      if (result.ok && result.data) setVisited(result.data);
    });
  }), [gateway, visited?.profileId]);
  useEffect(() => gateway.onCafeChat((event) => {
    if (!visited || event.cafeProfileId !== visited.profileId) return;
    setChatMessages((current) => [...current.slice(-9), { nickname: event.nickname, message: event.message }]);
  }), [gateway, visited?.profileId, cafe.profile.profileId]);
  useEffect(() => gateway.onCafeAccessRevoked((event) => { if (!visited || event.profileId !== visited.profileId) return; setVisited(null); setRealtimePlayers([]); onMessage(event.message); }), [gateway, visited?.profileId, onMessage]);
  useEffect(() => {
    if (!visited) return;
    let active = true;
    void gateway.enterRealtimeCafe({ cafeProfileId: visited.profileId, x: 684, y: 1476 }).then((presence) => {
      if (active) { setRealtimePlayers(presence.data?.players ?? []); setChatMessages((presence.data?.chatMessages ?? []).map((item) => ({ nickname: item.nickname, message: item.message }))); }
    });
    return () => { active = false; setRealtimePlayers([]); void gateway.leaveRealtimeCafe(); };
  }, [gateway, visited?.profileId]);
  const visit = async (profileId: string) => { setBusy(true); const result = await gateway.visitCafe({ cafeProfileId: profileId }); if (result.ok) { setVisited(result.data ?? null); setFriendDisplayOpen(false); setVisitorPosition({ x: 684, y: 1476 }); } else onMessage(result.message ?? '카페를 방문하지 못했습니다.'); setBusy(false); };
  const buy = async (listingId: string) => {
    if (!visited) return;
    setBusy(true);
    const result = await gateway.buyDessert({ requestId: id(), listingId, quantity: 1 });
    onMessage(result.message ?? (result.ok ? '구매했습니다.' : '구매하지 못했습니다.'), result.ok);
    if (result.ok) {
      await onRefresh();
      const refreshed = await gateway.visitCafe({ cafeProfileId: visited.profileId });
      if (refreshed.ok && refreshed.data) setVisited(refreshed.data);
      else setFriendDisplayOpen(false);
    }
    setBusy(false);
  };
  if (visited) {
    const owner = realtimePlayers.find((item) => item.isOwner);
    const moveVisitor = (event: ReactPointerEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button')) return;
      const box = event.currentTarget.getBoundingClientRect();
      const xRatio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)); const yRatio = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      const position = { x: Math.round(144 + xRatio * 1008), y: Math.round(972 + yRatio * 612) }; setVisitorPosition(position); gateway.moveRealtimeCafe(position);
    };
    const xPercent = (value: number) => `${(value / MAP_WIDTH) * 100}%`;
    const yPercent = (value: number) => `${(value / MAP_HEIGHT) * 100}%`;
    return <div className="shop-panel-content visited-cafe"><button className="back-to-street" onClick={() => { void gateway.leaveRealtimeCafe(); setVisited(null); setRealtimePlayers([]); }}>← 카페 거리</button><div className="visited-owner"><span>{visited.icon}</span><div><strong>[{visited.ownerName}]달콤상점</strong><small>Lv.{visited.level} · {owner ? '주인 접속 중' : '주인 오프라인'}</small></div><div className="social-profile-actions"><button disabled={busy} onClick={async () => { if (!window.confirm('이 사용자를 차단할까요? 카페 거리에서도 보이지 않습니다.')) return; setBusy(true); const targetId = visited.profileId; const result = await gateway.blockProfile({ requestId: id(), profileId: targetId }); onMessage(result.message ?? '차단했습니다.', result.ok); if (result.ok) { setVisited(null); setCafes((items) => items.filter((item) => item.profileId !== targetId)); } setBusy(false); }}>차단</button><select value={reportReason} onChange={(event) => setReportReason(event.target.value as typeof reportReason)}><option value="spam">스팸</option><option value="abuse">욕설·괴롭힘</option><option value="inappropriate">부적절한 콘텐츠</option><option value="other">기타</option></select><button disabled={busy} onClick={async () => { const detail = reportReason === 'other' ? window.prompt('신고 내용을 입력해주세요.', '') ?? undefined : undefined; if (reportReason === 'other' && !detail) return; const result = await gateway.reportProfile({ requestId: id(), profileId: visited.profileId, reasonCode: reportReason, detail }); onMessage(result.message ?? '신고했습니다.', result.ok); }}>신고</button></div></div>
      <div className="visitor-live-zone" style={{ backgroundImage: `url(${cafeBackground})` }} onPointerDown={moveVisitor}>
        <div className="visitor-kitchen-shade"><span>🥣 주방 · 주인 전용</span></div>
        {CAFE_FACILITIES.map((facility) => <div className={`visitor-cafe-facility visitor-cafe-facility-${facility.id} ${facility.id === 'display-stand' ? 'is-interactive' : ''}`} key={facility.id} role={facility.id === 'display-stand' ? 'button' : undefined} tabIndex={facility.id === 'display-stand' ? 0 : undefined} aria-label={facility.id === 'display-stand' ? '친구 카페 판매대 열기' : undefined} onPointerDown={facility.id === 'display-stand' ? (event) => event.stopPropagation() : undefined} onClick={facility.id === 'display-stand' ? () => setFriendDisplayOpen(true) : undefined} onKeyDown={facility.id === 'display-stand' ? (event) => { if (event.key === 'Enter' || event.key === ' ') setFriendDisplayOpen(true); } : undefined} style={{ left: `${(facility.x / 18) * 100}%`, top: `${(facility.y / 24) * 100}%`, width: `${(facility.width / 18) * 100}%`, height: `${(facility.height / 24) * 100}%` }}><img src={VISITED_CAFE_IMAGES[facility.id]} alt={facility.name}/>{facility.id === 'display-stand' && <><div className="visitor-display-stock">{visited.listings.slice(0, 3).map((listing) => <span key={listing.id}><AssetIcon src={RECIPE_ICON[listing.recipeId]} alt={listing.name} /></span>)}</div><b>상품 보기</b></>}</div>)}
        <div className="visitor-counter-rope">여기부터 홀 · 손님 이용 가능</div>
        {owner && <div className="remote-cafe-player owner" style={{ left: xPercent(owner.x), top: yPercent(owner.y) }}><span>👩‍🍳</span><b>{owner.nickname}</b></div>}
        <div className="remote-cafe-player visitor" style={{ left: xPercent(visitorPosition.x), top: yPercent(visitorPosition.y) }}><img src={playerChefImage} alt="내 캐릭터"/><b>나</b></div>
      </div>
      <p className="visitor-boundary-note">손님은 홀에서만 이동할 수 있습니다. 판매대를 눌러 상품을 구매할 수 있습니다.</p><section className="cafe-social-box"><h3>💌 방명록</h3><div className="guestbook-actions">{[['맛있어 보여요!','🧁'],['또 놀러 올게요!','💖'],['멋진 카페예요!','✨']].map(([messageCode, stickerCode]) => <button disabled={busy} key={messageCode} onClick={async () => { setBusy(true); const result = await gateway.createGuestbook({ requestId: id(), cafeProfileId: visited.profileId, messageCode, stickerCode }); onMessage(result.message ?? '방명록을 남겼습니다.', result.ok); const refreshed = await gateway.visitCafe({ cafeProfileId: visited.profileId }); if (refreshed.ok && refreshed.data) setVisited(refreshed.data); setBusy(false); }}>{stickerCode} {messageCode}</button>)}</div><div className="guestbook-list">{(visited.guestbook ?? []).map((note) => <p key={note.id}><b>{note.stickerCode} {note.visitorName}</b><span>{note.messageCode}</span></p>)}{!(visited.guestbook ?? []).length && <small>첫 인사를 남겨보세요.</small>}</div><h3>💬 카페 채팅</h3><div className="cafe-chat-log">{chatMessages.map((item, index) => <p key={`${item.nickname}-${index}`}><b>{item.nickname}</b> {item.message}</p>)}</div><form onSubmit={(event) => { event.preventDefault(); const message = chatInput.trim(); if (!message) return; gateway.sendCafeChat(message); setChatInput(''); }}><input maxLength={80} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="카페에 인사하기"/><button>전송</button></form></section>{friendDisplayOpen && <div className="visitor-shop-backdrop" onPointerDown={(event) => event.stopPropagation()}><section className="visitor-shop-modal" role="dialog" aria-modal="true" aria-label="친구 카페 판매 상품"><header><div><small>{visited.ownerName}님의 판매대</small><h3>오늘의 달콤한 디저트</h3></div><button type="button" onClick={() => setFriendDisplayOpen(false)}>×</button></header><div className="visitor-listings">{visited.listings.map((listing) => <article key={listing.id}><i><AssetIcon src={RECIPE_ICON[listing.recipeId]} alt={listing.name} /></i><div><strong>{listing.name}</strong><small>{QUALITY_NAME[listing.quality]} · Lv.{listing.level} · 남은 수량 {listing.quantity}</small></div><b>{listing.unitPrice}G</b><button disabled={busy || cafe.profile.gold < listing.unitPrice} onClick={() => void buy(listing.id)}>구매</button></article>)}{!visited.listings.length && <div className="empty-box">🧺<span>판매 중인 디저트가 없습니다.</span></div>}</div><p className="buff-help">구매한 디저트는 내 카페의 디저트 상자에서 먹을 수 있습니다.</p></section></div>}</div>;
  }
  const rows = Math.max(2, Math.ceil(cafes.length / 2));
  const mapHeight = Math.max(540, 190 + rows * 210);
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const box = event.currentTarget.getBoundingClientRect();
    setWalker({ x: Math.max(12, Math.min(88, ((event.clientX - box.left) / box.width) * 100)), y: Math.max(65, Math.min(mapHeight - 45, event.clientY - box.top)) });
  };
  const enter = (item: SweetShopCafeSummary, index: number) => {
    if (busy) return;
    const left = index % 2 === 0; const row = Math.floor(index / 2);
    setWalker({ x: left ? 30 : 70, y: 162 + row * 210 });
    window.setTimeout(() => void visit(item.profileId), 520);
  };
  return <div className="street-map-wrap">
    <div className="street-map-help"><span>길을 터치해 이동</span><strong>카페 입구를 누르면 방문해요</strong></div>
    <div className="street-map" style={{ height: mapHeight, backgroundImage: `url(${cafeStreetBackground})` }} onPointerDown={move}>
      <div className="street-path" />
      {cafes.map((item, index) => {
        const left = index % 2 === 0; const row = Math.floor(index / 2);
        return <button type="button" disabled={busy} className={`street-cafe ${left ? 'left' : 'right'}`} style={{ top: 46 + row * 210 }} key={item.profileId} onClick={() => enter(item, index)}>
          <img className="street-cafe-building" src={cafeStreetShop} alt="" aria-hidden="true"/>
          <span className="street-cafe-window">{index % 3 === 0 ? '🍓' : index % 3 === 1 ? '🍪' : '🧁'} {item.representativeDessert}</span>
          {item.advertised && <em className="street-ad-badge">📣 광고 중</em>}
          <strong>[{item.ownerName}]달콤상점</strong>
          <small>Lv.{item.level} · {item.listingCount}개 판매 중</small>
        </button>;
      })}
      {!cafes.length && <div className="street-empty"><span>🏘️</span><strong>아직 문을 연 이웃 카페가 없어요</strong><small>판매 상품이 등록되면 이 거리에 카페가 생깁니다.</small></div>}
      <div className="street-walker" style={{ left: `${walker.x}%`, top: walker.y }}><i /><img src={playerChefImage} alt="내 파티시에" /></div>
    </div>
  </div>;
}

export function CafeStreetScreen(props: CafeStreetProps & { onExit: () => void }) {
  return <section className="cafe-street-screen" onPointerDown={(event) => event.stopPropagation()}>
    <header><button type="button" onClick={props.onExit}>← 내 공방</button><div><small>SWEET CAFE STREET</small><h2>달콤한 카페 거리</h2><p>이웃 카페의 진열대를 둘러보세요.</p></div><strong>🪙 {props.cafe.profile.gold}</strong></header>
    <CafeStreetPanel {...props} />
  </section>;
}

function RecipeList({ cafe }: { cafe: SweetShopCafeState }) {
  return <div className="recipe-list">{RECIPES.map((recipe) => {
    const unlocked = cafe.unlockedRecipes.includes(recipe.id); const progress = cafe.recipeProgress[recipe.id];
    return <article className={`recipe-card ${unlocked ? '' : 'locked'}`} key={recipe.id}><i>{unlocked ? <AssetIcon src={RECIPE_ICON[recipe.id]} alt={recipe.name} /> : '❔'}</i><div><strong>{unlocked ? recipe.name : '아직 모르는 레시피'}</strong><small>{unlocked ? `${recipe.cookSeconds}초 · 제작 ${progress?.craftCount ?? 0}회` : '레시피를 발견하면 정보가 열려요'}</small>{unlocked && <p>{Object.entries(recipe.ingredients).map(([ingredientId, quantity]) => `${INGREDIENTS.find((item) => item.id === ingredientId)?.name} ${quantity}`).join(' · ')}</p>}</div><b>{unlocked ? `숙련 ${progress?.masteryExperience ?? 0}` : '🔒'}</b></article>;
  })}</div>;
}

function CookingPanel({ cafe, gateway, now, onRefresh, onMessage, onNavigate }: Props) {
  const [busy, setBusy] = useState(false);
  const queue = cafe.cookingJobs.filter((item) => item.status !== 'RECEIVED').sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const active = queue.find((item) => item.status === 'COOKING') ?? queue.find((item) => item.status === 'COMPLETED' || item.status === 'WAITING_FOR_SPACE') ?? queue[0];
  const progress = useMemo(() => active ? Math.max(0, Math.min(100, ((now - Date.parse(active.startedAt)) / (Date.parse(active.completesAt) - Date.parse(active.startedAt))) * 100)) : 0, [active, now]);
  const act = async (promise: Promise<SweetShopResult<unknown>>) => { setBusy(true); const result = await promise; onMessage(result.message ?? '처리했습니다.', result.ok); await onRefresh(); setBusy(false); };
  const queueFull = queue.length >= 5;
  const ingredientCount = Object.values(cafe.ingredients).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
  return <div className="shop-panel-content">
    <div className="cooking-queue-summary"><span>조리 대기열</span><strong>{queue.length}/5</strong></div>
    {active && (() => { const recipe = RECIPES.find((item) => item.id === active.recipeId)!; const ready = active.status === 'COMPLETED' || active.status === 'WAITING_FOR_SPACE'; return <div className="cooking-active"><div className={`macaron-progress ${ready ? 'complete' : ''}`}><div className="macaron-fill" style={{ height: `${progress}%` }} /><span><AssetIcon src={RECIPE_ICON[recipe.id]} alt={recipe.name} /></span></div><strong>{ready ? `${recipe.name} 완성!` : active.status === 'QUEUED' ? `${recipe.name} 대기 중` : '달콤하게 조리 중...'}</strong><b>{active.status === 'QUEUED' ? '대기' : `${Math.floor(progress)}%`}</b><small className="cooking-quality-preview">재료 +{(active.ingredientQualityBonus ?? 0).toFixed(2)} · 숙련 +{(active.masteryQualityBonus ?? 0).toFixed(2)}{(active.buffQualityBonus ?? 0) > 0 ? ` · 버프 +${active.buffQualityBonus}등급` : ''}</small>{ready && <button className="primary-action" disabled={busy} onClick={() => void act(gateway.receiveCooking({ requestId: id(), cookingId: active.id }))}>디저트 상자에 담기</button>}</div>; })()}
    <div className="cooking-queue-slots">{Array.from({ length: 5 }, (_, index) => { const job = queue[index]; const recipe = job && RECIPES.find((item) => item.id === job.recipeId); const ready = job?.status === 'COMPLETED' || job?.status === 'WAITING_FOR_SPACE'; return <div className={`cooking-queue-slot ${job ? job.status.toLowerCase() : 'empty'}`} key={job?.id ?? `empty-${index}`}><b>{index + 1}</b>{job && recipe ? <><i><AssetIcon src={RECIPE_ICON[recipe.id]} alt={recipe.name} /></i><span>{recipe.name}</span><small>{ready ? '완성' : job.status === 'COOKING' ? '조리 중' : '대기'}</small>{ready && <button disabled={busy} onClick={() => void act(gateway.receiveCooking({ requestId: id(), cookingId: job.id }))}>담기</button>}</> : <span>빈 슬롯</span>}</div>; })}</div>
    {ingredientCount === 0
      ? <div className="cooking-guide"><span>🧺</span><strong>조리할 재료가 없어요</strong><p>재료 주문 게시판에서 재료를 주문한 후 조리가 가능합니다.</p><button type="button" onClick={() => onNavigate('order-board')}>재료 주문하러 가기 →</button></div>
      : <div className="cooking-guide compact"><span>💡</span><p>재료가 부족한 메뉴는 <b>재료 주문 게시판</b>에서 필요한 수량을 주문하세요.</p><button type="button" onClick={() => onNavigate('order-board')}>주문 게시판</button></div>}
    <div className="recipe-list cooking-list">{RECIPES.map((recipe) => {
    const unlocked = cafe.unlockedRecipes.includes(recipe.id);
    const enough = unlocked && Object.entries(recipe.ingredients).every(([ingredientId, quantity]) => (cafe.ingredients[ingredientId as IngredientId] ?? 0) >= (quantity ?? 0));
    return <article className={`recipe-card ${unlocked ? '' : 'locked'} ${unlocked && !enough ? 'short' : ''}`} key={recipe.id}><i>{unlocked ? <AssetIcon src={RECIPE_ICON[recipe.id]} alt={recipe.name} /> : '❔'}</i><div><strong>{unlocked ? recipe.name : '???'}</strong><small>{unlocked ? `${recipe.cookSeconds}초` : '미획득 레시피'}</small>{unlocked && <p>{Object.entries(recipe.ingredients).map(([ingredientId, quantity]) => { const ingredient = INGREDIENTS.find((item) => item.id === ingredientId)!; const have = cafe.ingredients[ingredientId as IngredientId] ?? 0; return <span className={have < (quantity ?? 0) ? 'missing' : ''} key={ingredientId}>{ingredient.name} {have}/{quantity} </span>; })}</p>}</div>{unlocked ? <button disabled={!enough || busy || queueFull} onClick={() => void act(gateway.startCooking({ requestId: id(), recipeId: recipe.id, quantity: 1 }))}>{queueFull ? '대기열 가득' : enough ? '대기열 추가' : '재료 부족'}</button> : <b>🔒</b>}</article>;
  })}</div></div>;
}
