import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { SweetShopCafeState } from 'sweet-shop-contracts';
import {
  CAFE_FACILITIES, findPath, isWalkable, MAP_HEIGHT, MAP_WIDTH, nearestWalkable,
  TILE_SIZE, tileCenter, type CafeFacility, type TilePoint, worldToTile,
} from './cafeMap';
import { LocalSweetShopGateway } from './shopGateway';
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
  const gateway = useMemo(() => new LocalSweetShopGateway(), []);
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

  useEffect(() => { void gateway.loadCafe().then(setCafe); }, [gateway]);

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
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { ...gesture.current, mode: 'tap', startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, tapFacilityId, tapCharacter };
    } else if (pointers.current.size === 2) {
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
    if (gesture.current.mode === 'tap' && Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 10) gesture.current.mode = 'pan';
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
    if (pointers.current.size === 0) gesture.current.mode = 'idle';
    else gesture.current.mode = 'blocked';
  };

  const characterWorld = tileCenter(character);
  return (
    <main className="sweet-shop-game">
      <header className="sweet-shop-header">
        <button type="button" onClick={onExit}>← 허브</button>
        <div><small>GAME 04 · CAFE</small><h1>{cafe?.profile.cafeName ?? '달콤상점'}</h1></div>
        <strong>🪙 {cafe?.profile.gold ?? 0}</strong>
      </header>

      <div ref={viewportRef} className="cafe-viewport" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        <div className="cafe-world" style={{ width: MAP_WIDTH, height: MAP_HEIGHT, transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})` }}>
          <div className="cafe-wall cafe-wall-left" /><div className="cafe-wall cafe-wall-right" />
          <div className="cafe-title-rug">SWEET WORKSHOP</div>
          {CAFE_FACILITIES.map((facility) => (
            <div key={facility.id} data-facility-id={facility.id} className={`cafe-facility cafe-facility-${facility.id}`} style={{ left: facility.x * TILE_SIZE, top: facility.y * TILE_SIZE, width: facility.width * TILE_SIZE, height: facility.height * TILE_SIZE }}>
              <span aria-hidden="true">{facility.icon}</span><b>{facility.name}</b>
            </div>
          ))}
          {CAFE_FACILITIES.map((facility) => {
            const point = tileCenter(facility.access);
            return <div key={`${facility.id}-access`} className="facility-access" style={{ left: point.x, top: point.y }}>◆</div>;
          })}
          <div data-character className={`cafe-character cafe-character-${direction} ${path.length ? 'is-walking' : ''}`} style={{ left: characterWorld.x, top: characterWorld.y }} aria-label="나의 캐릭터"><span>🧑‍🍳</span><i /></div>
        </div>

        <div className="camera-controls">
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={centerOnCharacter}>⌖<small>내 위치</small></button>
          <output>{Math.round(camera.zoom * 100)}%</output>
        </div>

        {!tutorialSeen && <aside className="cafe-tutorial"><strong>공방 조작법</strong><p>바닥이나 시설을 짧게 터치하세요.<br />드래그하면 화면 이동, 두 손가락으로 확대·축소합니다.</p><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setTutorialSeen(true)}>알겠어요</button></aside>}

        {openFacility && <section className="facility-panel" role="dialog" aria-modal="true" aria-label={openFacility.name} onPointerDown={(event) => event.stopPropagation()}>
          <button className="facility-close" type="button" onClick={() => setOpenFacility(null)}>×</button>
          <span>{openFacility.icon}</span><h2>{openFacility.name}</h2><p>{openFacility.description}</p>
          <button type="button" onClick={() => setOpenFacility(null)}>확인</button>
        </section>}
      </div>
      <footer>싱글 개발 모드 · 소켓 전송 없음</footer>
    </main>
  );
}
