import { useEffect, useMemo, useState } from 'react';
import {
  INGREDIENTS, RECIPES, type IngredientId, type RecipeId,
  type SweetShopCafeState, type SweetShopCafeSummary, type SweetShopResult, type SweetShopVisitedCafe,
} from 'sweet-shop-contracts';
import { dessertPriceRange, type LocalSweetShopGateway } from './shopGateway';

const INGREDIENT_ICON: Record<IngredientId, string> = { flour: '🌾', sugar: '🍬', egg: '🥚', milk: '🥛', butter: '🧈', strawberry: '🍓' };
const RECIPE_ICON: Record<RecipeId, string> = { 'butter-cookie': '🍪', 'strawberry-macaron': '🩷', 'milk-pudding': '🍮', 'choco-cupcake': '🧁', 'honey-cake': '🍰' };
const QUALITY_NAME = { normal: '보통', good: '좋음', excellent: '훌륭함', premium: '최고급' } as const;
const id = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

interface Props {
  facilityId: string;
  cafe: SweetShopCafeState;
  gateway: LocalSweetShopGateway;
  now: number;
  onRefresh: () => Promise<void>;
  onMessage: (message: string, good?: boolean) => void;
  onNavigate: (facilityId: string) => void;
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
    ? <CafeStreetPanel {...props} />
    : <div className="facility-notice"><span>🚪</span><strong>첫 디저트를 먼저 완성해요</strong><p>버터 쿠키를 한 번 완성하면 카페 거리가 열립니다.</p><button className="primary-action" onClick={() => props.onNavigate('order-board')}>첫 재료 주문하기</button></div>;
  return <p>아직 사용할 수 없는 시설입니다.</p>;
}

function OrderPanel({ cafe, gateway, now, onRefresh, onMessage }: Props) {
  const [quantities, setQuantities] = useState<Partial<Record<IngredientId, number>>>({});
  const [busy, setBusy] = useState(false);
  const deliveries = cafe.deliveries.filter((item) => item.status !== 'RECEIVED');
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
  return <div className="shop-panel-content">
    <div className="panel-summary"><span>보유 골드</span><strong>🪙 {cafe.profile.gold}</strong></div>
    <button className="starter-order" disabled={busy || cafe.profile.gold < 14} onClick={() => void orderCookieSet()}><span>🍪</span><div><strong>처음이라면 이걸 주문하세요!</strong><small>버터 쿠키 1개 분량 · 밀가루 2 + 설탕 1 + 버터 1</small></div><b>14G</b></button>
    <div className="order-grid">{INGREDIENTS.map((item) => {
      const quantity = quantities[item.id] ?? 1; const price = item.unitPrice * quantity;
      return <article className="cute-card" key={item.id}>
        <i>{INGREDIENT_ICON[item.id]}</i><div><strong>{item.name}</strong><small>개당 {item.unitPrice}G · {item.deliverySeconds}초</small></div>
        <div className="quantity-stepper"><button onClick={() => setQuantities({ ...quantities, [item.id]: Math.max(1, quantity - 1) })}>−</button><b>{quantity}</b><button onClick={() => setQuantities({ ...quantities, [item.id]: Math.min(20, quantity + 1) })}>＋</button></div>
        <button className="primary-action" disabled={busy || cafe.profile.gold < price} onClick={() => void act(gateway.orderIngredients({ requestId: id(), ingredientId: item.id, quantity }))}>{price}G 주문</button>
      </article>;
    })}</div>
    <h3>배송 바구니</h3>
    {!deliveries.length && <div className="empty-box">🧺<span>기다리는 배송이 없어요</span></div>}
    {deliveries.map((delivery) => {
      const ingredient = INGREDIENTS.find((item) => item.id === delivery.ingredientId)!;
      const seconds = Math.max(0, Math.ceil((Date.parse(delivery.arrivesAt) - now) / 1000)); const ready = seconds === 0;
      return <div className={`delivery-row ${ready ? 'ready' : ''}`} key={delivery.id}><span>{INGREDIENT_ICON[delivery.ingredientId]}</span><b>{ingredient.name} ×{delivery.quantity}</b><em>{ready ? '도착!' : `${seconds}초`}</em><button disabled={!ready || busy} onClick={() => void act(gateway.receiveDelivery({ requestId: id(), deliveryId: delivery.id }))}>받기</button></div>;
    })}
  </div>;
}

function InventoryPanel({ cafe, gateway, onRefresh, onMessage, initialTab }: Props & { initialTab: 'ingredients' | 'desserts' | 'recipes' }) {
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const ingredientSlots = Object.values(cafe.ingredients).filter((quantity) => (quantity ?? 0) > 0).length;
  return <div className="shop-panel-content">
    <nav className="inventory-tabs"><button className={tab === 'ingredients' ? 'active' : ''} onClick={() => setTab('ingredients')}>재료 상자</button><button className={tab === 'desserts' ? 'active' : ''} onClick={() => setTab('desserts')}>디저트 상자</button><button className={tab === 'recipes' ? 'active' : ''} onClick={() => setTab('recipes')}>레시피</button></nav>
    {tab === 'ingredients' && <><div className="slot-meter"><span>보관 슬롯</span><b>{ingredientSlots}/{cafe.storage.ingredientSlotLimit}</b></div><div className="inventory-grid">{INGREDIENTS.map((item) => <article className={(cafe.ingredients[item.id] ?? 0) ? 'filled' : 'empty'} key={item.id}><i>{INGREDIENT_ICON[item.id]}</i><strong>{item.name}</strong><b>×{cafe.ingredients[item.id] ?? 0}</b></article>)}</div></>}
    {tab === 'desserts' && <><div className="slot-meter"><span>디저트 슬롯</span><b>{cafe.desserts.length}/{cafe.storage.dessertSlotLimit}</b></div>{cafe.buff && <div className="buff-banner">✨ {cafe.buff.sourceDessertName} 효과 · Lv.{cafe.buff.eligibleRecipeLevel} 이하 품질 +{cafe.buff.qualityBonus}</div>}<div className="inventory-grid dessert-grid">{cafe.desserts.map((item) => <article className="filled" key={item.id}><i>{RECIPE_ICON[item.recipeId]}</i><strong>{item.name}</strong><small>{QUALITY_NAME[item.quality]} · Lv.{item.level}</small><b>×{item.quantity}</b>{item.source === 'npc-cafe' && <button disabled={busy} onClick={() => { setBusy(true); void gateway.eatDessert({ requestId: id(), dessertId: item.id }).then(async (result) => { onMessage(result.message ?? '디저트를 먹었습니다.', result.ok); await onRefresh(); setBusy(false); }); }}>먹기</button>}</article>)}{!cafe.desserts.length && <div className="empty-box wide">🎁<span>완성한 디저트가 없어요</span></div>}</div></>}
    {tab === 'recipes' && <RecipeList cafe={cafe} />}
  </div>;
}

function DisplayStandPanel({ cafe, gateway, onRefresh, onMessage }: Props) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const crafted = cafe.desserts.filter((item) => item.source === 'crafted');
  const act = async (promise: Promise<SweetShopResult<unknown>>) => { setBusy(true); const result = await promise; onMessage(result.message ?? '처리했습니다.', result.ok); await onRefresh(); setBusy(false); };
  return <div className="shop-panel-content display-panel">
    <div className="slot-meter"><span>판매대</span><b>{cafe.listings.length}/3칸</b></div>
    <section className="listing-grid">{cafe.listings.map((listing) => {
      const [min, max] = dessertPriceRange(listing.recipeId, listing.quality); const price = prices[listing.id] ?? listing.unitPrice;
      return <article className="listing-card active" key={listing.id}><i>{RECIPE_ICON[listing.recipeId]}</i><div><strong>{listing.name}</strong><small>{QUALITY_NAME[listing.quality]} · ×{listing.quantity}</small></div><b>{listing.unitPrice}G</b><input aria-label={`${listing.name} 가격`} type="range" min={min} max={max} value={price} onChange={(event) => setPrices({ ...prices, [listing.id]: Number(event.target.value) })}/><small>{min}~{max}G · 수정 {price}G</small><div className="listing-actions"><button disabled={busy || price === listing.unitPrice} onClick={() => void act(gateway.updateListing({ requestId: id(), listingId: listing.id, quantity: listing.quantity, unitPrice: price }))}>가격 변경</button><button className="secondary" disabled={busy} onClick={() => void act(gateway.removeListing({ requestId: id(), listingId: listing.id }))}>회수</button></div></article>;
    })}{Array.from({ length: Math.max(0, 3 - cafe.listings.length) }, (_, index) => <div className="empty-display" key={index}>＋<small>빈 판매칸</small></div>)}</section>
    <h3>진열할 디저트</h3>
    {!crafted.length && <div className="empty-box">🧁<span>직접 만든 디저트가 없습니다.</span></div>}
    <div className="sellable-list">{crafted.map((dessert) => {
      const [min, max] = dessertPriceRange(dessert.recipeId, dessert.quality); const price = prices[dessert.id] ?? Math.round((min + max) / 2); const quantity = Math.min(quantities[dessert.id] ?? 1, dessert.quantity);
      return <article key={dessert.id}><i>{RECIPE_ICON[dessert.recipeId]}</i><div><strong>{dessert.name}</strong><small>{QUALITY_NAME[dessert.quality]} · 보유 {dessert.quantity}개 · 권장 {min}~{max}G</small></div><div className="quantity-stepper"><button onClick={() => setQuantities({ ...quantities, [dessert.id]: Math.max(1, quantity - 1) })}>−</button><b>{quantity}</b><button onClick={() => setQuantities({ ...quantities, [dessert.id]: Math.min(dessert.quantity, quantity + 1) })}>＋</button></div><input aria-label={`${dessert.name} 판매가격`} type="number" min={min} max={max} value={price} onChange={(event) => setPrices({ ...prices, [dessert.id]: Number(event.target.value) })}/><button disabled={busy || cafe.listings.length >= 3 || price < min || price > max} onClick={() => void act(gateway.createListing({ requestId: id(), dessertId: dessert.id, quantity, unitPrice: price }))}>진열하기</button></article>;
    })}</div>
    <p className="npc-sale-note">손님은 약 12초마다 진열 상품을 한 개씩 구매합니다. 판매대나 알림노트에서 판매 내역을 확인하세요.</p>
  </div>;
}

function SalesPanel({ cafe }: Props) {
  return <div className="shop-panel-content"><div className="panel-summary"><span>누적 판매</span><strong>🪙 {cafe.sales.reduce((sum, sale) => sum + sale.totalPrice, 0)}G</strong></div><div className="sales-list">{cafe.sales.map((sale) => <article key={sale.id}><span>💌</span><div><strong>{sale.buyerName}님이 {sale.dessertName} 구매</strong><small>{new Date(sale.soldAt).toLocaleTimeString()} · ×{sale.quantity}</small></div><b>+{sale.totalPrice}G</b></article>)}{!cafe.sales.length && <div className="empty-box">📭<span>아직 판매 소식이 없어요.</span></div>}</div></div>;
}

function CafeStreetPanel({ cafe, gateway, onRefresh, onMessage }: Props) {
  const [cafes, setCafes] = useState<SweetShopCafeSummary[]>([]); const [visited, setVisited] = useState<SweetShopVisitedCafe | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { void gateway.listCafeStreet().then((result) => { if (result.ok) setCafes(result.data ?? []); }); }, [gateway]);
  const visit = async (accountId: string) => { setBusy(true); const result = await gateway.visitCafe({ cafeAccountId: accountId }); if (result.ok) setVisited(result.data ?? null); else onMessage(result.message ?? '카페를 방문하지 못했습니다.'); setBusy(false); };
  const buy = async (listingId: string) => { setBusy(true); const result = await gateway.buyDessert({ requestId: id(), listingId, quantity: 1 }); onMessage(result.message ?? '구매했습니다.', result.ok); await onRefresh(); setBusy(false); };
  if (visited) return <div className="shop-panel-content visited-cafe"><button className="back-to-street" onClick={() => setVisited(null)}>← 카페 거리</button><div className="visited-owner"><span>{visited.icon}</span><div><strong>{visited.cafeName}</strong><small>Lv.{visited.level} · {visited.ownerName}</small></div></div><p>{visited.greeting}</p><div className="visitor-listings">{visited.listings.map((listing) => <article key={listing.id}><i>{RECIPE_ICON[listing.recipeId]}</i><div><strong>{listing.name}</strong><small>{QUALITY_NAME[listing.quality]} · Lv.{listing.level} · 남은 수량 {listing.quantity}</small></div><b>{listing.unitPrice}G</b><button disabled={busy || cafe.profile.gold < listing.unitPrice} onClick={() => void buy(listing.id)}>구매</button></article>)}</div><p className="buff-help">다른 카페의 디저트를 구매한 뒤 디저트 상자에서 먹으면, 디저트 레벨 이하의 조리 품질이 상승합니다.</p></div>;
  return <div className="shop-panel-content cafe-street"><div className="panel-summary"><span>카페 거리</span><strong>보유 🪙 {cafe.profile.gold}</strong></div>{cafes.map((item) => <button disabled={busy} key={item.accountId} onClick={() => void visit(item.accountId)}><span>{item.icon}</span><div><strong>{item.cafeName}</strong><small>Lv.{item.level} {item.ownerName} · 대표 {item.representativeDessert}</small></div><b>{item.listingCount}개 판매 중 →</b></button>)}</div>;
}

function RecipeList({ cafe }: { cafe: SweetShopCafeState }) {
  return <div className="recipe-list">{RECIPES.map((recipe) => {
    const unlocked = cafe.unlockedRecipes.includes(recipe.id); const progress = cafe.recipeProgress[recipe.id];
    return <article className={`recipe-card ${unlocked ? '' : 'locked'}`} key={recipe.id}><i>{unlocked ? RECIPE_ICON[recipe.id] : '❔'}</i><div><strong>{unlocked ? recipe.name : '아직 모르는 레시피'}</strong><small>{unlocked ? `${recipe.cookSeconds}초 · 제작 ${progress?.craftCount ?? 0}회` : '레시피를 발견하면 정보가 열려요'}</small>{unlocked && <p>{Object.entries(recipe.ingredients).map(([ingredientId, quantity]) => `${INGREDIENTS.find((item) => item.id === ingredientId)?.name} ${quantity}`).join(' · ')}</p>}</div><b>{unlocked ? `숙련 ${progress?.masteryExperience ?? 0}` : '🔒'}</b></article>;
  })}</div>;
}

function CookingPanel({ cafe, gateway, now, onRefresh, onMessage, onNavigate }: Props) {
  const [busy, setBusy] = useState(false);
  const active = cafe.cookingJobs.find((item) => item.status !== 'RECEIVED');
  const progress = useMemo(() => active ? Math.max(0, Math.min(100, ((now - Date.parse(active.startedAt)) / (Date.parse(active.completesAt) - Date.parse(active.startedAt))) * 100)) : 0, [active, now]);
  const act = async (promise: Promise<SweetShopResult<unknown>>) => { setBusy(true); const result = await promise; onMessage(result.message ?? '처리했습니다.', result.ok); await onRefresh(); setBusy(false); };
  if (active) {
    const recipe = RECIPES.find((item) => item.id === active.recipeId)!; const ready = progress >= 100;
    return <div className="shop-panel-content cooking-active"><div className={`macaron-progress ${ready ? 'complete' : ''}`}><div className="macaron-fill" style={{ height: `${progress}%` }} /><span>{RECIPE_ICON[recipe.id]}</span></div><strong>{ready ? `${recipe.name} 완성!` : '달콤하게 조리 중...'}</strong><b>{Math.floor(progress)}%</b><button className="primary-action" disabled={!ready || busy} onClick={() => void act(gateway.receiveCooking({ requestId: id(), cookingId: active.id }))}>{ready ? '디저트 상자에 담기' : '조리 중'}</button></div>;
  }
  const ingredientCount = Object.values(cafe.ingredients).reduce((sum, quantity) => sum + (quantity ?? 0), 0);
  return <div className="shop-panel-content">
    {ingredientCount === 0
      ? <div className="cooking-guide"><span>🧺</span><strong>조리할 재료가 없어요</strong><p>재료 주문 게시판에서 재료를 주문한 후 조리가 가능합니다.</p><button type="button" onClick={() => onNavigate('order-board')}>재료 주문하러 가기 →</button></div>
      : <div className="cooking-guide compact"><span>💡</span><p>재료가 부족한 메뉴는 <b>재료 주문 게시판</b>에서 필요한 수량을 주문하세요.</p><button type="button" onClick={() => onNavigate('order-board')}>주문 게시판</button></div>}
    <div className="recipe-list cooking-list">{RECIPES.map((recipe) => {
    const unlocked = cafe.unlockedRecipes.includes(recipe.id);
    const enough = unlocked && Object.entries(recipe.ingredients).every(([ingredientId, quantity]) => (cafe.ingredients[ingredientId as IngredientId] ?? 0) >= (quantity ?? 0));
    return <article className={`recipe-card ${unlocked ? '' : 'locked'} ${unlocked && !enough ? 'short' : ''}`} key={recipe.id}><i>{unlocked ? RECIPE_ICON[recipe.id] : '❔'}</i><div><strong>{unlocked ? recipe.name : '???'}</strong><small>{unlocked ? `${recipe.cookSeconds}초` : '미획득 레시피'}</small>{unlocked && <p>{Object.entries(recipe.ingredients).map(([ingredientId, quantity]) => { const ingredient = INGREDIENTS.find((item) => item.id === ingredientId)!; const have = cafe.ingredients[ingredientId as IngredientId] ?? 0; return <span className={have < (quantity ?? 0) ? 'missing' : ''} key={ingredientId}>{ingredient.name} {have}/{quantity} </span>; })}</p>}</div>{unlocked ? <button disabled={!enough || busy} onClick={() => void act(gateway.startCooking({ requestId: id(), recipeId: recipe.id, quantity: 1 }))}>{enough ? '만들기' : '재료 부족'}</button> : <b>🔒</b>}</article>;
  })}</div></div>;
}
