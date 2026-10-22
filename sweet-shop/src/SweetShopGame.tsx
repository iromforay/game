import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SweetShopCafeState, SweetShopRealtimePlayer } from 'sweet-shop-contracts';
import {
  CAFE_FACILITIES, findPath, isWalkable, MAP_HEIGHT, MAP_WIDTH, nearestWalkable,
  TILE_SIZE, tileCenter, type CafeFacility, type TilePoint, worldToTile,
} from './cafeMap';
import { createSweetShopGateway } from './shopGateway';
import { CafeStreetScreen, ShopFacilityPanel } from './ShopFacilityPanel';
import cafeBackground from './assets/cafe-workshop-background.png';
import cafeDoorImage from './assets/facility-cafe-door.png';
import cookingCounterImage from './assets/facility-cooking-counter.png';
import dessertBoxImage from './assets/facility-dessert-box.png';
import displayStandImage from './assets/facility-display-stand.png';
import ingredientStorageImage from './assets/facility-ingredient-storage.png';
import noticeBoardImage from './assets/facility-notice-board.png';
import orderBoardImage from './assets/facility-order-board.png';
import recipeBookImage from './assets/facility-recipe-book.png';
import playerChefImage from './assets/player-pastry-chef.png';
import { appearanceForBuyer } from './customerNpcs';
import './styles.css';

export interface SweetShopGameProps { onExit?: () => void; }

interface CameraState { x: number; y: number; zoom: number; }
interface SceneSave { character: TilePoint; camera: CameraState; tutorialSeen: boolean; lastFacilityId?: string; }
interface PointerPosition { x: number; y: number; }

const SCENE_STORAGE_KEY = 'sweet-shop-cafe-scene-v1';
const DEFAULT_CHARACTER = { x: 9, y: 14 };
const DEFAULT_CAMERA = { x: 260, y: 700, zoom: 1 };
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.5;
const COOKING_BUFF_DURATION_MS = 3 * 60 * 1000;
const FACILITY_IMAGES: Record<string, string> = {
  'order-board': orderBoardImage,
  'ingredient-storage': ingredientStorageImage,
  'recipe-book': recipeBookImage,
  'cooking-counter': cookingCounterImage,
  'dessert-box': dessertBoxImage,
  'display-stand': displayStandImage,
  'notice-board': noticeBoardImage,
  'cafe-door': cafeDoorImage,
};

function loadScene(): SceneSave {
  try {
    const value = JSON.parse(localStorage.getItem(SCENE_STORAGE_KEY) ?? '') as Partial<SceneSave>;
    const character = value.character && isWalkable(value.character) ? value.character : DEFAULT_CHARACTER;
    const camera = value.camera ?? DEFAULT_CAMERA;
    return {
      character,
      camera: { x: Number(camera.x) || 0, y: Number(camera.y) || 0, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(camera.zoom) || 1)) },
      tutorialSeen: value.tutorialSeen === true,
      lastFacilityId: value.lastFacilityId,
    };
  } catch { return { character: DEFAULT_CHARACTER, camera: DEFAULT_CAMERA, tutorialSeen: false }; }
}

export function SweetShopGame({ onExit }: SweetShopGameProps) {
  const gateway = useMemo(() => createSweetShopGateway(), []);
  const initialScene = useMemo(loadScene, []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, PointerPosition>());
  const gesture = useRef({ mode: 'idle' as 'idle' | 'tap' | 'pan' | 'pinch' | 'blocked', startX: 0, startY: 0, lastX: 0, lastY: 0, baseDistance: 0, baseZoom: 1, anchorWorldX: 0, anchorWorldY: 0, tapFacilityId: null as string | null, tapCharacter: false });
  const cameraRef = useRef(initialScene.camera);
  const [cafe, setCafe] = useState<SweetShopCafeState | null>(null);
  const [character, setCharacter] = useState<TilePoint>(initialScene.character);
  const [direction, setDirection] = useState<'up' | 'down' | 'left' | 'right'>('down');
  const [path, setPath] = useState<TilePoint[]>([]);
  const [camera, setCameraState] = useState<CameraState>(initialScene.camera);
  const [pendingFacility, setPendingFacility] = useState<CafeFacility | null>(null);
  const [openFacility, setOpenFacility] = useState<CafeFacility | null>(null);
  const [tutorialSeen, setTutorialSeen] = useState(initialScene.tutorialSeen);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [streetOpen, setStreetOpen] = useState(false);
  const [npcVisit, setNpcVisit] = useState<{ saleId: string; buyerName: string; dessertName: string; totalPrice: number } | null>(null);
  const [onlineVisitors, setOnlineVisitors] = useState<SweetShopRealtimePlayer[]>([]);
  const [hostChatOpen, setHostChatOpen] = useState(false);
  const [hostChatInput, setHostChatInput] = useState('');
  const [hostChatMessages, setHostChatMessages] = useState<Array<{ profileId: string; nickname: string; message: string }>>([]);
  const knownSaleId = useRef<string | null | undefined>(undefined);

  const refreshCafe = useCallback(async () => { setCafe(await gateway.loadCafe()); }, [gateway]);
  const showMessage = useCallback((text: string, good = false) => {
    setMessage({ text, good });
    window.setTimeout(() => setMessage((current) => current?.text === text ? null : current), 2600);
  }, []);

  useEffect(() => {
    if (!cafe || streetOpen) return;
    const position = tileCenter(character);
    void gateway.enterRealtimeCafe({ cafeProfileId: '', x: position.x, y: position.y }).then((result) => { setOnlineVisitors((result.data?.players ?? []).filter((item) => !item.isOwner)); setHostChatMessages((result.data?.chatMessages ?? []).map((item) => ({ profileId: item.profileId, nickname: item.nickname, message: item.message }))); });
    return () => { setOnlineVisitors([]); void gateway.leaveRealtimeCafe(); };
  }, [cafe?.profile.profileId, gateway, streetOpen]);

  useEffect(() => gateway.onRealtimePresence((event) => {
    if (event.type === 'left' && event.profileId) setOnlineVisitors((current) => current.filter((item) => item.profileId !== event.profileId));
    else if (event.player && !event.player.isOwner) setOnlineVisitors((current) => [...current.filter((item) => item.profileId !== event.player!.profileId), event.player!]);
  }), [gateway]);

  useEffect(() => gateway.onCafePurchase((event) => {
    if (!cafe || event.profileId !== cafe.profile.profileId) return;
    showMessage(`${event.dessertName} 판매 완료! +${event.totalPrice}G`, true);
    void refreshCafe();
  }), [cafe?.profile.profileId, gateway, refreshCafe, showMessage]);

  useEffect(() => gateway.onCafeChat((event) => {
    if (!cafe || streetOpen || event.cafeProfileId !== cafe.profile.profileId) return;
    setHostChatMessages((current) => [...current.slice(-19), { profileId: event.profileId, nickname: event.nickname, message: event.message }]);
    showMessage(`💬 ${event.nickname}: ${event.message}`, true);
  }), [cafe?.profile.profileId, gateway, showMessage, streetOpen]);

  useEffect(() => {
    if (!cafe || streetOpen) return;
    const position = tileCenter(character);
    gateway.moveRealtimeCafe(position);
  }, [cafe?.profile.profileId, character.x, character.y, gateway, streetOpen]);

  const clampCamera = useCallback((next: CameraState): CameraState => {
    const viewport = viewportRef.current;
    const width = viewport?.clientWidth ?? 390;
    const height = viewport?.clientHeight ?? 700;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom));
    return {
      zoom,
      x: Math.max(0, Math.min(Math.max(0, MAP_WIDTH - width / zoom), next.x)),
      y: Math.max(0, Math.min(Math.max(0, MAP_HEIGHT - height / zoom), next.y)),
    };
  }, []);

  const setCamera = useCallback((next: CameraState) => {
    const clamped = clampCamera(next);
    cameraRef.current = clamped;
    setCameraState(clamped);
  }, [clampCamera]);

  const centerOnCharacter = useCallback(() => {
    const viewport = viewportRef.current;
    const center = tileCenter(character);
    const current = cameraRef.current;
    setCamera({
      ...current,
      x: center.x - (viewport?.clientWidth ?? 390) / (2 * current.zoom),
      y: center.y - (viewport?.clientHeight ?? 700) / (2 * current.zoom),
    });
  }, [character, setCamera]);

  useEffect(() => { void refreshCafe(); }, [refreshCafe]);

  useEffect(() => {
    if (cafe?.tutorial.firstCookingCompleted) setTutorialSeen(true);
  }, [cafe?.tutorial.firstCookingCompleted]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refreshCafe();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [openFacility?.id, refreshCafe]);

  useEffect(() => {
    const latestSale = cafe?.sales[0];
    if (knownSaleId.current === undefined) {
      knownSaleId.current = latestSale?.id ?? null;
      return;
    }
    if (!latestSale || latestSale.id === knownSaleId.current) return;
    knownSaleId.current = latestSale.id;
    setNpcVisit({ saleId: latestSale.id, buyerName: latestSale.buyerName, dessertName: latestSale.dessertName, totalPrice: latestSale.totalPrice });
    showMessage(`${latestSale.buyerName}님이 ${latestSale.dessertName}을 구매했습니다! +${latestSale.totalPrice}G`, true);
  }, [cafe?.sales, showMessage]);

  useEffect(() => {
    if (!npcVisit) return;
    const timer = window.setTimeout(() => setNpcVisit((current) => current?.saleId === npcVisit.saleId ? null : current), 2600);
    return () => window.clearTimeout(timer);
  }, [npcVisit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const save: SceneSave = { character, camera, tutorialSeen, lastFacilityId: openFacility?.id };
      try { localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(save)); } catch { /* 저장 불가 환경 */ }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [camera, character, openFacility, tutorialSeen]);

  useEffect(() => {
    if (!path.length) return;
    const timer = window.setTimeout(() => {
      setPath((currentPath) => {
        if (!currentPath.length) return currentPath;
        const next = currentPath[0];
        setCharacter((current) => {
          if (next.x > current.x) setDirection('right');
          else if (next.x < current.x) setDirection('left');
          else if (next.y > current.y) setDirection('down');
          else if (next.y < current.y) setDirection('up');
          return next;
        });
        return currentPath.slice(1);
      });
    }, 105);
    return () => window.clearTimeout(timer);
  }, [path]);

  useEffect(() => {
    if (!path.length && pendingFacility) {
      setOpenFacility(pendingFacility);
      setPendingFacility(null);
    }
  }, [path, pendingFacility]);

  useEffect(() => {
    const onResize = () => setCamera(cameraRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setCamera]);

  const moveTo = useCallback((destination: TilePoint, facility: CafeFacility | null = null) => {
    const goal = nearestWalkable(destination);
    if (!goal) return;
    const nextPath = findPath(character, goal);
    if (!nextPath.length && (goal.x !== character.x || goal.y !== character.y)) return;
    setOpenFacility(null);
    setPendingFacility(facility);
    setPath(nextPath);
  }, [character]);

  const goToFacility = useCallback((facilityId: string) => {
    const facility = CAFE_FACILITIES.find((item) => item.id === facilityId);
    if (facility) moveTo(facility.access, facility);
  }, [moveTo]);

  const handleTap = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const facilityId = gesture.current.tapFacilityId ?? target.closest<HTMLElement>('[data-facility-id]')?.dataset.facilityId;
    if (facilityId) {
      const facility = CAFE_FACILITIES.find((item) => item.id === facilityId);
      if (facility) moveTo(facility.access, facility);
      return;
    }
    if (gesture.current.tapCharacter || target.closest('[data-character]')) {
      setPath([]); setPendingFacility(null); setOpenFacility(null);
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    const worldX = currentCamera.x + (event.clientX - rect.left) / currentCamera.zoom;
    const worldY = currentCamera.y + (event.clientY - rect.top) / currentCamera.zoom;
    moveTo(worldToTile(worldX, worldY));
  }, [moveTo]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tapFacilityId = target.closest<HTMLElement>('[data-facility-id]')?.dataset.facilityId ?? null;
    const tapCharacter = target.closest('[data-character]') !== null;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { ...gesture.current, mode: 'tap', startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, tapFacilityId, tapCharacter };
    } else if (pointers.current.size === 2) {
      for (const pointerId of pointers.current.keys()) {
        if (!event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.setPointerCapture(pointerId);
      }
      const [a, b] = [...pointers.current.values()];
      const rect = viewportRef.current!.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const current = cameraRef.current;
      gesture.current = {
        ...gesture.current,
        mode: 'pinch',
        baseDistance: Math.hypot(a.x - b.x, a.y - b.y),
        baseZoom: current.zoom,
        anchorWorldX: current.x + midX / current.zoom,
        anchorWorldY: current.y + midY / current.zoom,
      };
    }
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = viewportRef.current!.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.current.baseZoom * distance / Math.max(1, gesture.current.baseDistance)));
      setCamera({ zoom: nextZoom, x: gesture.current.anchorWorldX - midX / nextZoom, y: gesture.current.anchorWorldY - midY / nextZoom });
      return;
    }
    if (gesture.current.mode === 'tap' && Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 10) {
      gesture.current.mode = 'pan';
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (gesture.current.mode === 'pan') {
      const current = cameraRef.current;
      setCamera({ ...current, x: current.x - (event.clientX - gesture.current.lastX) / current.zoom, y: current.y - (event.clientY - gesture.current.lastY) / current.zoom });
    }
    gesture.current.lastX = event.clientX;
    gesture.current.lastY = event.clientY;
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasTap = pointers.current.size === 1 && gesture.current.mode === 'tap';
    pointers.current.delete(event.pointerId);
    if (wasTap) handleTap(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size === 0) gesture.current.mode = 'idle';
    else gesture.current.mode = 'blocked';
  };

  const pointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPendingFacility(null);
    gesture.current.mode = pointers.current.size ? 'blocked' : 'idle';
  };

  const characterWorld = tileCenter(character);
  const buffRemainingMs = cafe?.buff ? Math.max(0, Date.parse(cafe.buff.endsAt) - now) : 0;
  const buffRemainingSeconds = Math.ceil(buffRemainingMs / 1000);
  const buffProgress = Math.max(0, Math.min(100, (buffRemainingMs / COOKING_BUFF_DURATION_MS) * 100));
  const buffTimeLabel = `${Math.floor(buffRemainingSeconds / 60)}:${String(buffRemainingSeconds % 60).padStart(2, '0')}`;
  const activeDeliveries = cafe?.deliveries.filter((item) => item.status !== 'RECEIVED') ?? [];
  const activeCooking = cafe?.cookingJobs.find((item) => item.status !== 'RECEIVED');
  const firstCookingTutorialCompleted = cafe?.tutorial.firstCookingCompleted === true;
  const cookieReady = !!cafe && (cafe.ingredients.flour ?? 0) >= 2 && (cafe.ingredients.sugar ?? 0) >= 1 && (cafe.ingredients.butter ?? 0) >= 1;
  const guide = cafe?.desserts.some((item) => item.source === 'crafted')
    ? { icon: '🎉', title: '첫 디저트 완성!', text: '디저트 상자에서 완성품을 확인하세요.', facilityId: 'dessert-box', action: '상자 열기' }
    : activeCooking
      ? { icon: '🩷', title: '디저트가 조리 중이에요', text: '조리대에서 마카롱 진행률을 확인하세요.', facilityId: 'cooking-counter', action: '조리 확인' }
      : cookieReady
        ? { icon: '🥣', title: '재료가 준비됐어요!', text: '조리대로 가서 버터 쿠키를 만들어보세요.', facilityId: 'cooking-counter', action: '조리하러 가기' }
        : activeDeliveries.length
          ? { icon: '🧺', title: '재료가 배송 중이에요', text: '도착한 재료는 배송 바구니에서 직접 받아주세요.', facilityId: 'order-board', action: '배송 확인' }
          : { icon: '📋', title: '첫 주문부터 시작해요', text: '버터 쿠키 재료 묶음을 주문하면 바로 시작할 수 있어요.', facilityId: 'order-board', action: '재료 주문하기' };
  return (
    <main className="sweet-shop-game">
      <header className="sweet-shop-header">
        <button type="button" onClick={streetOpen ? () => setStreetOpen(false) : onExit}>{streetOpen ? '← 공방' : '← 허브'}</button>
        <div className="sweet-shop-heading"><small>GAME 04 · CAFE {cafe && !firstCookingTutorialCompleted && <em className="tutorial-label">첫 조리 안내 중</em>}</small><h1>{streetOpen ? '달콤한 카페 거리' : cafe?.profile.cafeName ?? '달콤상점'}</h1>{cafe?.buff && buffRemainingMs > 0 && <div className="header-buff-timer" aria-label={`조리 품질 ${cafe.buff.qualityBonus}등급 상승 버프 ${buffTimeLabel} 남음`}><div><span>✨ 조리 품질 +{cafe.buff.qualityBonus}</span><b>{buffTimeLabel}</b></div><i><span style={{ width: `${buffProgress}%` }} /></i></div>}</div>
        <strong>🪙 {cafe?.profile.gold ?? 0}</strong>
      </header>

      <div ref={viewportRef} className="cafe-viewport" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}>
        {streetOpen && cafe ? <CafeStreetScreen cafe={cafe} gateway={gateway} onRefresh={refreshCafe} onMessage={showMessage} onExit={() => setStreetOpen(false)} /> : <>
        <div className="cafe-world" style={{ width: MAP_WIDTH, height: MAP_HEIGHT, backgroundImage: `url(${cafeBackground})`, transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})` }}>
          <div className="cafe-title-rug">SWEET WORKSHOP</div>
          {CAFE_FACILITIES.map((facility) => (
            <button key={facility.id} type="button" data-facility-id={facility.id} aria-label={`${facility.name}로 이동`} onClick={(event) => { if (event.detail === 0) goToFacility(facility.id); }} className={`cafe-facility cafe-facility-${facility.id}`} style={{ left: facility.x * TILE_SIZE, top: facility.y * TILE_SIZE, width: facility.width * TILE_SIZE, height: facility.height * TILE_SIZE }}>
              <img src={FACILITY_IMAGES[facility.id]} alt="" aria-hidden="true" draggable={false}/><b>{facility.name}</b>
              {facility.id === 'display-stand' && <div className="display-stock-preview" aria-hidden="true">{['🍪', '🧁', '🍰'].map((icon, index) => <span className={index < (cafe?.listings.length ?? 0) ? 'filled' : ''} key={icon}>{icon}</span>)}</div>}
              {facility.id === 'order-board' && <em>재료 주문</em>}
              {facility.id === 'cooking-counter' && <em>{activeCooking ? '조리 확인' : cookieReady ? '만들기 가능!' : '조리하기'}</em>}
              {facility.id === 'display-stand' && cafe && <em>{cafe.listings.length}/3 진열</em>}
              {facility.id === 'notice-board' && cafe && cafe.sales.length > 0 && <em>판매 {cafe.sales.length}건</em>}
              {facility.id === 'cafe-door' && <em>카페 거리</em>}
            </button>
          ))}
          {CAFE_FACILITIES.map((facility) => {
            const point = tileCenter(facility.access);
            return <div key={`${facility.id}-access`} className="facility-access" style={{ left: point.x, top: point.y }}>◆</div>;
          })}
          <div data-character className={`cafe-character cafe-character-${direction} ${path.length ? 'is-walking' : ''}`} style={{ left: characterWorld.x, top: characterWorld.y }} aria-label="나의 캐릭터"><img src={playerChefImage} alt="나의 제빵사" draggable={false}/><i /></div>
          {onlineVisitors.map((visitor) => <div className="cafe-online-visitor" key={visitor.profileId} style={{ left: visitor.x, top: visitor.y }}><b>{visitor.nickname}</b><img src={playerChefImage} alt={`${visitor.nickname} 손님`} draggable={false}/><i /></div>)}
          {npcVisit && (() => {
            const appearance = appearanceForBuyer(npcVisit.buyerName);
            const door = CAFE_FACILITIES.find((facility) => facility.id === 'cafe-door')!;
            const point = tileCenter(door.access);
            return (
              <div className="cafe-npc-visitor" style={{ left: point.x, top: point.y }} aria-label={`${npcVisit.buyerName} 손님`}>
                <div className="cafe-npc-bubble"><strong>{npcVisit.buyerName}</strong><span>“{npcVisit.dessertName}, 잘 먹을게요!”</span><b>+{npcVisit.totalPrice}G</b></div>
                <img src={appearance.image} alt={`${npcVisit.buyerName} 손님`} draggable={false}/><i />
              </div>
            );
          })()}
        </div>

        <div className="camera-controls">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={centerOnCharacter}>⌖<small>내 위치</small></button>
          <output>{Math.round(camera.zoom * 100)}%</output>
        </div>

        <aside className={`host-cafe-chat ${hostChatOpen ? 'is-open' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
          <button className="host-chat-toggle" type="button" onClick={() => setHostChatOpen((current) => !current)}>💬<span>카페 채팅</span>{onlineVisitors.length > 0 && <b>{onlineVisitors.length}</b>}</button>
          {hostChatOpen && <div className="host-chat-panel"><header><strong>내 카페 채팅</strong><small>접속 손님 {onlineVisitors.length}명</small></header><div className="host-chat-log">{hostChatMessages.map((item, index) => <p key={`${item.profileId}-${index}`}><b>{item.profileId === cafe?.profile.profileId ? '나' : item.nickname}</b><span>{item.message}</span></p>)}{!hostChatMessages.length && <small>방문객과 인사를 나눠보세요.</small>}</div><form onSubmit={(event) => { event.preventDefault(); const message = hostChatInput.trim(); if (!message) return; gateway.sendCafeChat(message); setHostChatInput(''); }}><input maxLength={80} value={hostChatInput} onChange={(event) => setHostChatInput(event.target.value)} placeholder="메시지 입력"/><button type="submit">전송</button></form></div>}
        </aside>

        {tutorialSeen && !firstCookingTutorialCompleted && !openFacility && <aside className="first-quest" onPointerDown={(event) => event.stopPropagation()}><span>{guide.icon}</span><div><strong>첫 조리 · {guide.title}</strong><small>{guide.text}</small></div><button type="button" onClick={() => goToFacility(guide.facilityId)}>{guide.action} →</button></aside>}

        {!tutorialSeen && <aside className="cafe-tutorial"><strong>공방 조작법</strong><p>바닥이나 시설을 짧게 터치하세요.<br />드래그하면 화면 이동, 두 손가락으로 확대·축소합니다.</p><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setTutorialSeen(true)}>알겠어요</button></aside>}

        {message && <div className={`shop-toast ${message.good ? 'good' : ''}`}>{message.good ? '✨' : '💭'} {message.text}</div>}

        {openFacility && cafe && <section className={`facility-panel facility-panel-${openFacility.id}`} role="dialog" aria-modal="true" aria-label={openFacility.name} onPointerDown={(event) => event.stopPropagation()}>
          <button className="facility-close" type="button" onClick={() => setOpenFacility(null)}>×</button>
          <header className="facility-panel-title"><span>{openFacility.icon}</span><div><small>SWEET WORKSHOP</small><h2>{openFacility.name}</h2></div></header>
          <ShopFacilityPanel facilityId={openFacility.id} cafe={cafe} gateway={gateway} now={now} onRefresh={refreshCafe} onMessage={showMessage} onNavigate={goToFacility} onEnterCafeStreet={() => { setOpenFacility(null); setStreetOpen(true); }} />
        </section>}
        </>}
      </div>
      <footer>{streetOpen ? '카페 거리 · 이웃의 달콤상점을 직접 방문해보세요' : '달콤상점 · 비동기 온라인 카페 운영 중'}</footer>
    </main>
  );
}
