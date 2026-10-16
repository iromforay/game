import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import playerImage from './assets/player-paper-sword.png';
import { collectDungeonResource, completeDungeonZone, deployDungeonRobot, fetchDungeonSave, hasDungeonAccount, saveDungeonProgress, settleDungeonRobots, type DungeonRobotAssignment, type DungeonRobotSettlement, type DungeonSaveData } from './saveClient';
import './styles.css';

interface MyRoomDungeonGameProps { onExit?: () => void; }
interface Position { x: number; y: number; }
type ResourceId = 'paper' | 'tape' | 'screw' | 'battery' | 'plastic' | 'clockwork' | 'motor' |
  'cloth' | 'metal' | 'wire' | 'circuit' | 'dust' | 'mystery' | 'room-core';
type StageId = '1-1' | '1-2' | '1-3' | '1-4' | '1-5';
interface HarvestObject { id: string; name: string; sprite: number; position: Position; hp: number; maxHp: number; resource: ResourceId; quantity: number; destroyed: boolean; }
interface Drop { id: string; resource: ResourceId; quantity: number; position: Position; }

const START_POSITION: Position = { x: 48, y: 82 };
const START_CAMERA: Position = { x: 50, y: 70 };
const CHAPTER_START_POSITION: Position = { x: 50, y: 79 };
const ATTACK_DAMAGE = 12;
const SAVE_KEY = 'my-room-dungeon:save:v1';
const RESOURCE_INFO: Record<ResourceId, { name: string; icon: string }> = {
  paper: { name: '종이', icon: '▱' }, tape: { name: '테이프', icon: '◉' },
  screw: { name: '작은 나사', icon: '✦' }, battery: { name: '건전지', icon: '▮' },
  plastic: { name: '플라스틱', icon: '◆' }, clockwork: { name: '태엽 부품', icon: '⚙' }, motor: { name: '소형 모터', icon: '◍' },
  cloth: { name: '천', icon: '▧' }, metal: { name: '금속 조각', icon: '◇' }, wire: { name: '전선', icon: '⌁' },
  circuit: { name: '회로', icon: '▦' }, dust: { name: '먼지 결정', icon: '✧' }, mystery: { name: '수수께끼 부품', icon: '?' },
  'room-core': { name: '방의 코어', icon: '✹' },
};
const STAGES: Record<StageId, { name: string; objects: HarvestObject[] }> = {
  '1-1': { name: '책상 아래', objects: [
    { id: 'paper-1', name: '구겨진 종이 뭉치', sprite: 0, position: { x: 43, y: 59 }, hp: 24, maxHp: 24, resource: 'paper', quantity: 8, destroyed: false },
    { id: 'parcel-1', name: '테이프 상자', sprite: 1, position: { x: 35, y: 69 }, hp: 36, maxHp: 36, resource: 'tape', quantity: 4, destroyed: false },
    { id: 'parts-1', name: '작은 부품통', sprite: 2, position: { x: 56, y: 65 }, hp: 48, maxHp: 48, resource: 'screw', quantity: 3, destroyed: false },
    { id: 'remote-1', name: '고장 난 리모컨', sprite: 3, position: { x: 61, y: 76 }, hp: 36, maxHp: 36, resource: 'battery', quantity: 1, destroyed: false },
    { id: 'box-1', name: '대형 종이상자', sprite: 4, position: { x: 31, y: 54 }, hp: 72, maxHp: 72, resource: 'paper', quantity: 20, destroyed: false },
  ]},
  '1-2': { name: '장난감 상자', objects: [
    { id: 'blocks-1', name: '플라스틱 블록 더미', sprite: 0, position: { x: 40, y: 57 }, hp: 48, maxHp: 48, resource: 'plastic', quantity: 10, destroyed: false },
    { id: 'toy-car-1', name: '망가진 장난감 자동차', sprite: 3, position: { x: 58, y: 68 }, hp: 72, maxHp: 72, resource: 'screw', quantity: 4, destroyed: false },
    { id: 'spring-toy-1', name: '태엽 장난감', sprite: 2, position: { x: 35, y: 72 }, hp: 84, maxHp: 84, resource: 'clockwork', quantity: 3, destroyed: false },
    { id: 'mini-motor-1', name: '모터 장난감', sprite: 1, position: { x: 63, y: 55 }, hp: 96, maxHp: 96, resource: 'motor', quantity: 1, destroyed: false },
    { id: 'giant-toy-1', name: '대형 태엽 장난감', sprite: 4, position: { x: 29, y: 51 }, hp: 132, maxHp: 132, resource: 'clockwork', quantity: 6, destroyed: false },
  ]},
  '1-3': { name: '옷장', objects: [
    { id: 'old-shirt-1', name: '낡은 셔츠 더미', sprite: 0, position: { x: 41, y: 58 }, hp: 72, maxHp: 72, resource: 'cloth', quantity: 12, destroyed: false },
    { id: 'hanger-1', name: '부러진 옷걸이', sprite: 2, position: { x: 57, y: 63 }, hp: 84, maxHp: 84, resource: 'plastic', quantity: 7, destroyed: false },
    { id: 'sewing-box-1', name: '오래된 반짇고리', sprite: 3, position: { x: 34, y: 72 }, hp: 96, maxHp: 96, resource: 'metal', quantity: 4, destroyed: false },
    { id: 'taped-box-1', name: '봉인된 수납함', sprite: 1, position: { x: 64, y: 72 }, hp: 108, maxHp: 108, resource: 'tape', quantity: 6, destroyed: false },
    { id: 'clothes-pile-1', name: '커다란 옷더미', sprite: 4, position: { x: 29, y: 51 }, hp: 156, maxHp: 156, resource: 'cloth', quantity: 24, destroyed: false },
  ]},
  '1-4': { name: '컴퓨터 책상', objects: [
    { id: 'cable-bundle-1', name: '엉킨 케이블 뭉치', sprite: 0, position: { x: 42, y: 57 }, hp: 96, maxHp: 96, resource: 'wire', quantity: 10, destroyed: false },
    { id: 'keyboard-1', name: '고장 난 키보드', sprite: 1, position: { x: 58, y: 68 }, hp: 120, maxHp: 120, resource: 'plastic', quantity: 9, destroyed: false },
    { id: 'speaker-1', name: '낡은 스피커', sprite: 2, position: { x: 35, y: 72 }, hp: 132, maxHp: 132, resource: 'motor', quantity: 2, destroyed: false },
    { id: 'power-box-1', name: '전원 장치', sprite: 3, position: { x: 64, y: 55 }, hp: 144, maxHp: 144, resource: 'circuit', quantity: 3, destroyed: false },
    { id: 'old-computer-1', name: '오래된 컴퓨터 본체', sprite: 4, position: { x: 29, y: 51 }, hp: 216, maxHp: 216, resource: 'metal', quantity: 14, destroyed: false },
  ]},
  '1-5': { name: '침대 밑', objects: [
    { id: 'dust-clump-1', name: '꿈틀대는 먼지 뭉치', sprite: 0, position: { x: 43, y: 58 }, hp: 120, maxHp: 120, resource: 'dust', quantity: 8, destroyed: false },
    { id: 'lost-box-1', name: '잊힌 비밀 상자', sprite: 1, position: { x: 57, y: 69 }, hp: 156, maxHp: 156, resource: 'mystery', quantity: 2, destroyed: false },
    { id: 'metal-case-1', name: '녹슨 금속 케이스', sprite: 2, position: { x: 35, y: 73 }, hp: 168, maxHp: 168, resource: 'metal', quantity: 10, destroyed: false },
    { id: 'hidden-device-1', name: '정체불명 장치', sprite: 3, position: { x: 64, y: 56 }, hp: 204, maxHp: 204, resource: 'circuit', quantity: 5, destroyed: false },
    { id: 'room-core-1', name: '방의 심장', sprite: 4, position: { x: 29, y: 50 }, hp: 300, maxHp: 300, resource: 'room-core', quantity: 1, destroyed: false },
  ]},
};

const freshStageObjects = (stageId: StageId) => STAGES[stageId].objects.map((object) => ({ ...object, position: { ...object.position } }));

function hasBatchim(word: string) {
  const last = word.charCodeAt(word.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
}

function loadSave(): DungeonSaveData {
  const fallback: DungeonSaveData = { inventory: {}, discovered: [], craftedBots: 0, craftedSwords: 1, clearedZones: [], robotAssignments: {} };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DungeonSaveData>;
    return {
      inventory: parsed.inventory ?? {},
      discovered: Array.isArray(parsed.discovered) ? parsed.discovered : [],
      craftedBots: Math.max(0, Number(parsed.craftedBots ?? 0)),
      craftedSwords: Math.max(1, Number(parsed.craftedSwords ?? 1)),
      clearedZones: Array.isArray(parsed.clearedZones) ? parsed.clearedZones : [],
      robotAssignments: parsed.robotAssignments ?? {},
    };
  } catch {
    return fallback;
  }
}

export function MyRoomDungeonGame({ onExit }: MyRoomDungeonGameProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const collectedByApiRef = useRef(false);
  const savedGame = useRef(loadSave()).current;
  const [position, setPosition] = useState(START_POSITION);
  const [cameraPosition, setCameraPosition] = useState(START_CAMERA);
  const [facing, setFacing] = useState<'left' | 'right'>('right');
  const [phase, setPhase] = useState<'idle' | 'moving' | 'approaching' | 'attacking'>('idle');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);
  const [activeStage, setActiveStage] = useState<StageId>('1-1');
  const [objects, setObjects] = useState(() => freshStageObjects('1-1'));
  const [drops, setDrops] = useState<Drop[]>([]);
  const [inventory, setInventory] = useState<Partial<Record<ResourceId, number>>>(savedGame.inventory);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [discovered, setDiscovered] = useState<Set<ResourceId>>(() => new Set(savedGame.discovered));
  const [discovery, setDiscovery] = useState<ResourceId | null>(null);
  const [pickupText, setPickupText] = useState<string | null>(null);
  const [view, setView] = useState<'world' | 'chapter' | 'stage' | 'chapter2'>('chapter');
  const [chapterPosition, setChapterPosition] = useState(CHAPTER_START_POSITION);
  const [chapterFacing, setChapterFacing] = useState<'left' | 'right'>('right');
  const [chapterMoving, setChapterMoving] = useState(false);
  const [chapterNotice, setChapterNotice] = useState('방 안을 걸어 원하는 장소로 이동하세요.');
  const chapterTravelTimerRef = useRef<number | null>(null);
  const [worldPosition, setWorldPosition] = useState<Position>({ x: 50, y: 88 });
  const [worldFacing, setWorldFacing] = useState<'left' | 'right'>('right');
  const [worldMoving, setWorldMoving] = useState(false);
  const [worldNotice, setWorldNotice] = useState('집 안을 걸어 다음 장소로 이동하세요.');
  const worldTravelTimerRef = useRef<number | null>(null);
  const zoneCompletionSentRef = useRef(new Set(savedGame.clearedZones ?? []));
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<'robot' | 'weapon' | 'bag'>('robot');
  const [craftedBots, setCraftedBots] = useState(savedGame.craftedBots);
  const [craftedSwords, setCraftedSwords] = useState(savedGame.craftedSwords);
  const [clearedZones, setClearedZones] = useState<Set<string>>(() => new Set(savedGame.clearedZones ?? []));
  const [robotAssignments, setRobotAssignments] = useState<Record<string, DungeonRobotAssignment>>(savedGame.robotAssignments ?? {});
  const [robotDeployOpen, setRobotDeployOpen] = useState(false);
  const [workbenchNotice, setWorkbenchNotice] = useState<string | null>(null);
  const [autoCollectResult, setAutoCollectResult] = useState<(DungeonRobotSettlement & { initial: boolean }) | null>(null);
  const [chapterCompleteOpen, setChapterCompleteOpen] = useState(false);
  const robotSettlementBusyRef = useRef(false);
  const [serverReady, setServerReady] = useState(!hasDungeonAccount());
  const [saveStatus, setSaveStatus] = useState<'local' | 'loading' | 'saved' | 'offline'>(hasDungeonAccount() ? 'loading' : 'local');

  const setCameraFor = (next: Position) => {
    const viewport = mapRef.current?.getBoundingClientRect();
    const world = worldRef.current?.getBoundingClientRect();
    if (!viewport || !world) return;
    const limitX = (viewport.width / world.width) * 50;
    const limitY = (viewport.height / world.height) * 50;
    setCameraPosition({ x: Math.min(100 - limitX, Math.max(limitX, next.x)), y: Math.min(100 - limitY, Math.max(limitY, next.y)) });
  };

  const moveTo = (next: Position, nextPhase: 'moving' | 'approaching') => {
    setFacing(next.x < position.x ? 'left' : 'right');
    setDestination(next); setPosition(next); setCameraFor(next); setPhase(nextPhase);
  };

  const moveToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const world = worldRef.current?.getBoundingClientRect();
    if (!world) return;
    setTargetId(null);
    moveTo({
      x: Math.min(97, Math.max(3, ((event.clientX - world.left) / world.width) * 100)),
      y: Math.min(97, Math.max(3, ((event.clientY - world.top) / world.height) * 100)),
    }, 'moving');
  };

  const selectObject = (event: PointerEvent<HTMLButtonElement>, object: HarvestObject) => {
    event.stopPropagation();
    if (targetId === object.id) { setTargetId(null); setPhase('idle'); return; }
    setTargetId(object.id);
    moveTo({ x: object.position.x, y: Math.min(94, object.position.y + 5.5) }, 'approaching');
  };

  useEffect(() => {
    if (phase !== 'approaching' || !targetId) return;
    const timer = window.setTimeout(() => setPhase('attacking'), 720);
    return () => window.clearTimeout(timer);
  }, [phase, targetId]);

  useEffect(() => {
    if (phase !== 'attacking' || !targetId) return;
    const timer = window.setInterval(() => setObjects((current) => current.map((object) => object.id === targetId ? { ...object, hp: Math.max(0, object.hp - ATTACK_DAMAGE) } : object)), 580);
    return () => window.clearInterval(timer);
  }, [phase, targetId]);

  useEffect(() => {
    if (!targetId) return;
    const object = objects.find((item) => item.id === targetId);
    if (!object || object.hp > 0 || object.destroyed) return;
    setObjects((current) => current.map((item) => item.id === object.id ? { ...item, destroyed: true } : item));
    setPhase('idle'); setTargetId(null);
    const drop: Drop = { id: `drop-${object.id}`, resource: object.resource, quantity: object.quantity, position: object.position };
    setDrops((current) => [...current, drop]);
    window.setTimeout(() => {
      setDrops((current) => current.filter((item) => item.id !== drop.id));
      // 획득 수량은 /collect가 서버에서 누적한다. 이어지는 상태 감지 PUT으로 중복 반영하지 않는다.
      collectedByApiRef.current = hasDungeonAccount();
      setInventory((current) => ({ ...current, [drop.resource]: (current[drop.resource] ?? 0) + drop.quantity }));
      if (hasDungeonAccount()) {
        setSaveStatus('loading');
        collectDungeonResource(drop.resource, drop.quantity)
          .then(() => setSaveStatus('saved'))
          .catch(() => setSaveStatus('offline'));
      }
      const info = RESOURCE_INFO[drop.resource];
      setPickupText(`${info.name} ×${drop.quantity}`);
      window.setTimeout(() => setPickupText(null), 1700);
      if (!discovered.has(drop.resource)) { setDiscovered((current) => new Set(current).add(drop.resource)); setDiscovery(drop.resource); }
    }, 1400);
  }, [objects, targetId, discovered]);

  const hydrateRemote = useCallback((remote: DungeonSaveData) => {
    setInventory(remote.inventory);
    setDiscovered(new Set(remote.discovered));
    setCraftedBots(remote.craftedBots);
    setCraftedSwords(remote.craftedSwords);
    setClearedZones(new Set(remote.clearedZones ?? []));
    setRobotAssignments(remote.robotAssignments ?? {});
    zoneCompletionSentRef.current = new Set(remote.clearedZones ?? []);
  }, []);

  const runRobotSettlement = useCallback(async (initial: boolean) => {
    if (!hasDungeonAccount() || robotSettlementBusyRef.current) return;
    robotSettlementBusyRef.current = true;
    try {
      const remote = await settleDungeonRobots();
      hydrateRemote(remote);
      if (remote.settlement.cycles > 0) setAutoCollectResult({ ...remote.settlement, initial });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('offline');
    } finally {
      robotSettlementBusyRef.current = false;
    }
  }, [hydrateRemote]);

  useEffect(() => {
    if (!hasDungeonAccount()) return;
    let cancelled = false;
    fetchDungeonSave().then(async (remote) => {
      if (cancelled) return;
      if (remote.isNew) {
        await saveDungeonProgress(savedGame);
      } else {
        hydrateRemote(remote);
        await runRobotSettlement(true);
      }
      if (!cancelled) { setServerReady(true); setSaveStatus('saved'); }
    }).catch(() => {
      if (!cancelled) { setServerReady(true); setSaveStatus('offline'); }
    });
    return () => { cancelled = true; };
  }, [savedGame, hydrateRemote, runRobotSettlement]);

  useEffect(() => {
    if (!serverReady || !hasDungeonAccount()) return;
    const timer = window.setInterval(() => { void runRobotSettlement(false); }, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void runRobotSettlement(false); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [serverReady, runRobotSettlement, Boolean(robotAssignments['1-1'])]);

  useEffect(() => {
    const saveData: DungeonSaveData = {
      inventory,
      discovered: [...discovered],
      craftedBots,
      craftedSwords,
      clearedZones: [...clearedZones],
      robotAssignments,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    if (collectedByApiRef.current) {
      collectedByApiRef.current = false;
      return;
    }
    if (!serverReady || !hasDungeonAccount()) return;
    setSaveStatus('loading');
    const timer = window.setTimeout(() => {
      saveDungeonProgress(saveData).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('offline'));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [inventory, discovered, craftedBots, craftedSwords, clearedZones, robotAssignments, serverReady]);

  useEffect(() => {
    if (zoneCompletionSentRef.current.has(activeStage) || drops.length > 0 || !objects.every((object) => object.destroyed)) return;
    zoneCompletionSentRef.current.add(activeStage);
    setClearedZones((current) => new Set(current).add(activeStage));
    const nextStage = ({ '1-1': '1-2', '1-2': '1-3', '1-3': '1-4', '1-4': '1-5' } as Partial<Record<StageId, StageId>>)[activeStage];
    setPickupText(nextStage ? `${activeStage} 전체 채집 완료 · ${nextStage} 해금!` : '챕터 1 전체 채집 완료!');
    window.setTimeout(() => setPickupText(null), 2600);
    if (activeStage === '1-5') window.setTimeout(() => setChapterCompleteOpen(true), 700);
    if (hasDungeonAccount()) {
      completeDungeonZone(activeStage).catch(() => setSaveStatus('offline'));
    }
  }, [objects, drops, activeStage]);

  const activeTarget = targetId ? objects.find((object) => object.id === targetId) : undefined;
  const inventoryEntries = (Object.entries(inventory) as [ResourceId, number][]).filter(([, quantity]) => quantity > 0);
  const canCraftBot = (inventory.paper ?? 0) >= 20 && (inventory.tape ?? 0) >= 8 && (inventory.screw ?? 0) >= 2 && (inventory.battery ?? 0) >= 1;
  const canCraftSword = (inventory.paper ?? 0) >= 15 && (inventory.tape ?? 0) >= 3;

  const spendResources = (cost: Partial<Record<ResourceId, number>>) => {
    if (!Object.entries(cost).every(([id, amount]) => (inventory[id as ResourceId] ?? 0) >= (amount ?? 0))) return false;
    setInventory((current) => {
      const next = { ...current };
      Object.entries(cost).forEach(([id, amount]) => {
        const resourceId = id as ResourceId;
        const remaining = (next[resourceId] ?? 0) - (amount ?? 0);
        if (remaining > 0) next[resourceId] = remaining;
        else delete next[resourceId];
      });
      return next;
    });
    return true;
  };

  const enterStage = (stageId: StageId) => {
    setActiveStage(stageId); setObjects(freshStageObjects(stageId)); setDrops([]); setTargetId(null); setPhase('idle');
    setPosition(START_POSITION); setCameraPosition(START_CAMERA); setView('stage');
  };

  const moveInChapter = (next: Position, onArrival?: () => void) => {
    if (chapterTravelTimerRef.current !== null) window.clearTimeout(chapterTravelTimerRef.current);
    setChapterFacing(next.x < chapterPosition.x ? 'left' : 'right');
    setChapterPosition(next);
    setChapterMoving(true);
    setChapterNotice(onArrival ? '목적지로 이동 중…' : '방 안을 이동 중…');
    chapterTravelTimerRef.current = window.setTimeout(() => {
      setChapterMoving(false);
      setChapterNotice('방 안을 걸어 원하는 장소로 이동하세요.');
      onArrival?.();
    }, 720);
  };

  const moveChapterToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const map = event.currentTarget.getBoundingClientRect();
    moveInChapter({
      x: Math.min(94, Math.max(6, ((event.clientX - map.left) / map.width) * 100)),
      y: Math.min(92, Math.max(10, ((event.clientY - map.top) / map.height) * 100)),
    });
  };

  const moveInWorld = (next: Position, onArrival?: () => void) => {
    if (worldTravelTimerRef.current !== null) window.clearTimeout(worldTravelTimerRef.current);
    setWorldFacing(next.x < worldPosition.x ? 'left' : 'right');
    setWorldPosition(next); setWorldMoving(true); setWorldNotice('이동 중…');
    worldTravelTimerRef.current = window.setTimeout(() => {
      setWorldMoving(false); setWorldNotice('집 안을 걸어 다음 장소로 이동하세요.'); onArrival?.();
    }, 850);
  };

  const moveWorldToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const map = event.currentTarget.getBoundingClientRect();
    moveInWorld({
      x: Math.min(92, Math.max(8, ((event.clientX - map.left) / map.width) * 100)),
      y: Math.min(90, Math.max(12, ((event.clientY - map.top) / map.height) * 100)),
    });
  };

  const visitLockedWorldArea = (name: string) => {
    setWorldNotice(`${name}은 챕터 1 전체 클리어 후 들어갈 수 있습니다.`);
    window.setTimeout(() => setWorldNotice('집 안을 걸어 다음 장소로 이동하세요.'), 2200);
  };

  const visitLockedArea = (name: string) => {
    setChapterNotice(`${name}은 아직 잠겨 있습니다.`);
    window.setTimeout(() => setChapterNotice('방 안을 걸어 원하는 장소로 이동하세요.'), 1800);
  };

  const deployRobotToDesk = () => {
    if (craftedBots < 1 || robotAssignments['1-1']) return;
    if (!hasDungeonAccount()) {
      setCraftedBots((count) => count - 1);
      setRobotAssignments((current) => ({ ...current, '1-1': { robotId: 'paper-box', status: 'working', remainingUses: 5, startedAt: new Date().toISOString() } }));
      setRobotDeployOpen(false);
      return;
    }
    setSaveStatus('loading');
    deployDungeonRobot('1-1').then((remote) => {
      setCraftedBots(remote.craftedBots);
      setRobotAssignments(remote.robotAssignments ?? {});
      setRobotDeployOpen(false);
      setSaveStatus('saved');
    }).catch(() => setSaveStatus('offline'));
  };

  const autoCollectPopup = autoCollectResult && <div className="auto-result-backdrop"><section className="auto-result-panel" role="dialog" aria-modal="true" aria-label="자동 수집 결과">
    <small>AUTO COLLECT</small><h2>{autoCollectResult.initial ? '돌아온 사이 수집 완료!' : '자동 수집 완료!'}</h2>
    <p>{autoCollectResult.initial ? '채집봇이 게임 밖에서도 열심히 모아 두었습니다.' : '종이상자 채집봇이 자원을 가져왔습니다.'}</p>
    <div className="auto-result-rewards"><span><i className="resource-icon resource-paper"/><b>종이 ×{autoCollectResult.rewards.paper}</b></span><span><i className="resource-icon resource-tape"/><b>테이프 ×{autoCollectResult.rewards.tape}</b></span></div>
    <strong>1분 수집 × {autoCollectResult.cycles}회</strong>
    {autoCollectResult.robotExpired && <em>모든 작업을 마쳐 채집봇이 소멸했습니다.</em>}
    <button type="button" onClick={() => setAutoCollectResult(null)}>확인</button>
  </section></div>;

  const chapterCompletePopup = chapterCompleteOpen && <div className="chapter-complete-backdrop"><section className="chapter-complete-panel" role="dialog" aria-modal="true" aria-label="챕터 1 완료">
    <small>CHAPTER 1 COMPLETE</small><h2>내 방 정복 완료!</h2>
    <div className="chapter-complete-core"><i className="resource-icon resource-room-core"/><b>방의 코어 ×1</b></div>
    <p>책상 아래부터 침대 밑까지<br/>모든 채집 구역을 정리했습니다.</p>
    <button type="button" onClick={() => { setChapterCompleteOpen(false); setView('world'); }}>전체 맵으로 나가기</button>
  </section></div>;

  if (view === 'world') return <main className="room-dungeon-shell"><section className="room-dungeon-game world-home">
    <header className="room-dungeon-hud"><button type="button" className="room-exit-button" onClick={onExit}>‹</button><div className="room-title-group"><span>HOUSE WORLD · CHAPTER MAP</span><strong>우리 집</strong></div><div className="room-resource-preview"><span>✹</span> {inventory['room-core'] ?? 0}</div></header>
    <div className="house-world-map" onPointerDown={moveWorldToPointer}>
      <div className="house-world-title"><small>OPEN WORLD</small><b>집 전체 맵</b></div>
      <button type="button" className="world-location world-bedroom is-cleared" onPointerDown={(event) => { event.stopPropagation(); moveInWorld({x:25,y:68}, () => setView('chapter')); }}><b>CHAPTER 1</b><strong>내 방</strong><span>다시 들어가기</span></button>
      <button type="button" className={`world-location world-kitchen ${clearedZones.has('1-5') ? 'is-open' : 'is-locked'}`} onPointerDown={(event) => { event.stopPropagation(); moveInWorld({x:74,y:20}, () => clearedZones.has('1-5') ? setView('chapter2') : visitLockedWorldArea('챕터 2 주방')); }}><b>CHAPTER 2</b><strong>주방</strong><span>{clearedZones.has('1-5') ? '새로운 채집 구역' : '1-5 클리어 필요'}</span></button>
      <div className={`world-player facing-${worldFacing} ${worldMoving ? 'is-moving' : ''}`} style={{left:`${worldPosition.x}%`,top:`${worldPosition.y}%`}}><span/><img src={playerImage} alt="집 안을 이동하는 탐험가" draggable={false}/></div>
      <div className="world-move-guide">{worldNotice}</div>
    </div>
    <footer className="room-dungeon-footer"><button type="button" className="footer-slot is-selected"><span>⌂</span>전체 맵</button><button type="button" className="footer-slot" onClick={() => setInventoryOpen(true)}><span>▦</span>가방</button><button type="button" className="footer-slot" onClick={() => { setView('chapter'); setWorkbenchOpen(true); }}><span>⚒</span>작업대</button><button type="button" className={`footer-slot ${robotAssignments['1-1'] ? 'is-selected' : ''}`} disabled={!clearedZones.has('1-1')} onClick={() => { setView('chapter'); setRobotDeployOpen(true); }}><span>♙</span>{robotAssignments['1-1'] ? '수집 중' : '자동 채집'}</button></footer>
    {inventoryOpen && <InventoryPanel entries={inventoryEntries} onClose={() => setInventoryOpen(false)} />}
    {autoCollectPopup}
  </section></main>;

  if (view === 'chapter2') return <main className="room-dungeon-shell"><section className="room-dungeon-game chapter-two-preview">
    <header className="room-dungeon-hud"><button type="button" className="room-exit-button" onClick={() => setView('world')}>‹</button><div className="room-title-group"><span>CHAPTER 2 · NEW AREA</span><strong>주방</strong></div><div className="room-resource-preview"><span>✹</span> {inventory['room-core'] ?? 0}</div></header>
    <div className="chapter-two-entry"><div className="chapter-two-sign"><small>CHAPTER 2</small><h2>주방에 도착했다!</h2><p>전체 맵을 통해 챕터 2에 정상적으로 진입했습니다.<br/>2-1 채집 구역은 다음 개발에서 연결됩니다.</p><button type="button" onClick={() => setView('world')}>전체 맵으로 돌아가기</button></div></div>
  </section></main>;

  if (view === 'chapter') return <main className="room-dungeon-shell"><section className="room-dungeon-game chapter-home">
    <header className="room-dungeon-hud"><button type="button" className="room-exit-button" onClick={onExit}>‹</button><div className="room-title-group"><span>CHAPTER 1 · {saveStatus === 'saved' ? '서버 저장됨' : saveStatus === 'loading' ? '저장 중' : saveStatus === 'offline' ? '로컬 백업' : '게스트 저장'}</span><strong>내 방</strong></div><div className="room-resource-preview"><span>●</span> 0</div></header>
    <div className="chapter-home-map" onPointerDown={moveChapterToPointer}>
      <div className="chapter-map-title"><small>CHAPTER 1</small><b>내 방 오픈월드</b></div>
      <button type="button" className="chapter-location location-desk is-open" onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:24,y:27}, () => enterStage('1-1')); }}><b>1-1</b><span>책상 아래</span><em>{clearedZones.has('1-1') ? '다시 채집' : '채집 가능'}</em></button>
      <button type="button" className="chapter-location location-bench is-open" onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:24,y:73}, () => setWorkbenchOpen(true)); }}><b>⚙</b><span>나의 작업대</span><em>제작·강화</em></button>
      <button type="button" className={`chapter-location location-toys ${clearedZones.has('1-1') ? 'is-open' : 'is-locked'}`} onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:72,y:28}, () => clearedZones.has('1-1') ? enterStage('1-2') : visitLockedArea('장난감 상자')); }}><b>1-2</b><span>장난감 상자</span><em>{clearedZones.has('1-1') ? clearedZones.has('1-2') ? '다시 채집' : '채집 가능' : '1-1 클리어 필요'}</em></button>
      <button type="button" className={`chapter-location location-closet ${clearedZones.has('1-2') ? 'is-open' : 'is-locked'}`} onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:82,y:48}, () => clearedZones.has('1-2') ? enterStage('1-3') : visitLockedArea('옷장')); }}><b>1-3</b><span>옷장</span><em>{clearedZones.has('1-2') ? clearedZones.has('1-3') ? '다시 채집' : '채집 가능' : '1-2 클리어 필요'}</em></button>
      <button type="button" className={`chapter-location location-computer ${clearedZones.has('1-3') ? 'is-open' : 'is-locked'}`} onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:66,y:67}, () => clearedZones.has('1-3') ? enterStage('1-4') : visitLockedArea('컴퓨터 책상')); }}><b>1-4</b><span>컴퓨터 책상</span><em>{clearedZones.has('1-3') ? clearedZones.has('1-4') ? '다시 채집' : '채집 가능' : '1-3 클리어 필요'}</em></button>
      <button type="button" className={`chapter-location location-bed ${clearedZones.has('1-4') ? 'is-open' : 'is-locked'}`} onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:80,y:84}, () => clearedZones.has('1-4') ? enterStage('1-5') : visitLockedArea('침대 밑')); }}><b>1-5</b><span>침대 밑</span><em>{clearedZones.has('1-4') ? clearedZones.has('1-5') ? '다시 채집' : '채집 가능' : '1-4 클리어 필요'}</em></button>
      <button type="button" className="chapter-location location-door is-open" onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:50,y:12}, () => setView('world')); }}><b>↥</b><span>나가기</span><em>전체 맵으로 이동</em></button>
      {clearedZones.has('1-1') && <button type="button" className={`auto-collect-pad ${robotAssignments['1-1'] ? 'is-working' : ''}`} onPointerDown={(event) => { event.stopPropagation(); moveInChapter({x:38,y:35}, () => setRobotDeployOpen(true)); }}><i className="mini-craft craft-robot"/><span>{robotAssignments['1-1'] ? '자동 수집 중' : '채집봇 배치'}</span><em>{robotAssignments['1-1'] ? `남은 작업 ${robotAssignments['1-1'].remainingUses}회` : `보유 ${craftedBots}대`}</em></button>}
      <div className={`chapter-player facing-${chapterFacing} ${chapterMoving ? 'is-moving' : ''}`} style={{left:`${chapterPosition.x}%`,top:`${chapterPosition.y}%`}}><span/><img src={playerImage} alt="내 방의 탐험가" draggable={false}/></div>
      <div className="chapter-move-guide">{chapterNotice}</div>
    </div>
    <footer className="room-dungeon-footer"><button type="button" className="footer-slot is-selected"><span>⌂</span>내 방</button><button type="button" className="footer-slot" onClick={() => setInventoryOpen(true)}><span>▦</span>가방</button><button type="button" className="footer-slot" onClick={() => setWorkbenchOpen(true)}><span>⚒</span>작업대</button><button type="button" className={`footer-slot ${robotAssignments['1-1'] ? 'is-selected' : ''}`} disabled={!clearedZones.has('1-1')} onClick={() => setRobotDeployOpen(true)}><span>♙</span>{robotAssignments['1-1'] ? '수집 중' : '자동 채집'}</button></footer>
    {workbenchOpen && <div className="panel-backdrop" onPointerDown={() => setWorkbenchOpen(false)}><section className="workbench-panel" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><small>MY WORKBENCH</small><h2>나의 작업대</h2></div><button type="button" onClick={() => setWorkbenchOpen(false)}>×</button></header>
      <nav><button className={workbenchTab === 'robot' ? 'active' : ''} onClick={() => setWorkbenchTab('robot')}>채집봇</button><button className={workbenchTab === 'weapon' ? 'active' : ''} onClick={() => setWorkbenchTab('weapon')}>무기</button><button className={workbenchTab === 'bag' ? 'active' : ''} onClick={() => setWorkbenchTab('bag')}>가방</button></nav>
      {workbenchTab === 'bag' ? <div className="workbench-bag"><div className="workbench-bag-summary"><b>보유 자원</b><span>{inventoryEntries.length}/32칸 사용</span></div><InventoryGrid entries={inventoryEntries} /><div className="owned-equipment"><div><i className="mini-craft craft-robot"/><span>종이상자 채집봇</span><b>×{craftedBots}</b></div><div><i className="mini-craft craft-sword"/><span>종이검 Lv.1</span><b>×{craftedSwords}</b></div></div><p>작업대를 나가지 않고 제작 재료와 장비를 확인할 수 있습니다.</p></div>
      : workbenchTab === 'robot' ? <div className="recipe-card"><div className="craft-art craft-robot"><span className="owned-count">보유 {craftedBots}대</span></div><div className="recipe-info"><small>기본형 · 사용 5회</small><h3>종이상자 채집봇</h3><p>책상 아래에서 종이와 테이프를 자동 수집합니다.</p><div className="recipe-cost">{([['paper',20],['tape',8],['screw',2],['battery',1]] as [ResourceId,number][]).map(([id,n]) => <span className={(inventory[id] ?? 0) < n ? 'is-short' : 'is-ready'} key={id}><i className={`resource-icon resource-${id}`}/>{inventory[id] ?? 0}/{n}</span>)}</div><button type="button" disabled={!canCraftBot} onClick={() => { if (spendResources({paper:20,tape:8,screw:2,battery:1})) { setCraftedBots((n) => n + 1); setWorkbenchNotice('종이상자 채집봇 생산 완료!'); window.setTimeout(() => setWorkbenchNotice(null), 1800); } }}>{canCraftBot ? '종이상자 채집봇 생산' : '재료 부족'}</button></div></div>
      : <div className="recipe-card"><div className="craft-art craft-sword">{craftedSwords > 0 && <span className="owned-badge">보유 중</span>}</div><div className="recipe-info"><small>A등급 · Lv.1</small><h3>종이검 {craftedSwords > 0 && <span className="title-owned">보유 중</span>}</h3><p>종이를 여러 겹 접어 만든 공격력 중심의 기본 검입니다.</p><div className="recipe-cost">{([['paper',15],['tape',3]] as [ResourceId,number][]).map(([id,n]) => <span className={(inventory[id] ?? 0) < n ? 'is-short' : 'is-ready'} key={id}><i className={`resource-icon resource-${id}`}/>{inventory[id] ?? 0}/{n}</span>)}</div><button type="button" disabled={craftedSwords > 0 || !canCraftSword} onClick={() => { if (spendResources({paper:15,tape:3})) { setCraftedSwords(1); setWorkbenchNotice('종이검 제작 완료!'); window.setTimeout(() => setWorkbenchNotice(null), 1800); } }}>{craftedSwords > 0 ? '보유 중' : canCraftSword ? '종이검 제작' : '재료 부족'}</button></div></div>}
      {workbenchNotice && <div className="workbench-notice">✓ {workbenchNotice}</div>}
    </section></div>}
    {inventoryOpen && <InventoryPanel entries={inventoryEntries} onClose={() => setInventoryOpen(false)} />}
    {robotDeployOpen && <div className="panel-backdrop" onPointerDown={() => setRobotDeployOpen(false)}><section className="robot-deploy-panel" onPointerDown={(event) => event.stopPropagation()}><header><div><small>AUTO COLLECT</small><h2>1-1 채집봇 배치</h2></div><button type="button" onClick={() => setRobotDeployOpen(false)}>×</button></header>{robotAssignments['1-1'] ? <div className="robot-working-card"><i className="mini-craft craft-robot"/><strong>종이상자 채집봇 작업 중</strong><span>남은 작업 {robotAssignments['1-1'].remainingUses}회</span></div> : <div className="robot-choice-card"><i className="mini-craft craft-robot"/><div><strong>종이상자 채집봇</strong><span>보유 {craftedBots}대 · 사용 5회</span></div><button type="button" disabled={craftedBots < 1} onClick={deployRobotToDesk}>{craftedBots > 0 ? '1-1에 배치' : '보유 봇 없음'}</button></div>}</section></div>}
    {autoCollectPopup}
    {chapterCompletePopup}
  </section></main>;

  return <main className="room-dungeon-shell"><section className="room-dungeon-game" aria-label="내 방이 던전">
    <header className="room-dungeon-hud">
      <button type="button" className="room-exit-button" onClick={onExit}>‹</button>
      <div className="room-title-group"><span>CHAPTER 1 · {activeStage} · {saveStatus === 'saved' ? '서버 저장됨' : saveStatus === 'loading' ? '저장 중' : saveStatus === 'offline' ? '로컬 백업' : '게스트 저장'}</span><strong>{STAGES[activeStage].name}</strong></div>
      <div className="room-resource-preview"><span>●</span> 0</div>
    </header>

    <div ref={mapRef} className="room-map" onPointerDown={moveToPointer}>
      <div ref={worldRef} className="room-world" style={{ transform: `translate(-${cameraPosition.x}%, -${cameraPosition.y}%)` }}>
        <div className="zone-sign zone-sign-desk"><b>{activeStage}</b><span>{STAGES[activeStage].name}</span></div>
        <div className="workbench-pin"><span>⚙</span><b>나의 작업대</b></div>
        <button type="button" className="stage-exit" onPointerDown={(event) => event.stopPropagation()} onClick={() => setView('chapter')}><span>⌂</span><b>채집구역 나가기</b><small>내 방으로 돌아가기</small></button>
        {objects.map((object) => !object.destroyed && <button type="button" key={object.id}
          className={`harvest-object sprite-${object.sprite} ${targetId === object.id ? 'is-targeted' : ''} ${phase === 'attacking' && targetId === object.id ? 'is-hit' : ''}`}
          style={{ left: `${object.position.x}%`, top: `${object.position.y}%` }} onPointerDown={(event) => selectObject(event, object)}>
          <span className="object-sprite" />
          {targetId === object.id && <span className="object-health"><i style={{ width: `${(object.hp / object.maxHp) * 100}%` }} /></span>}
          <span className="object-name">{object.name}</span>
          {phase === 'attacking' && targetId === object.id && <strong className="damage-number">-{ATTACK_DAMAGE}</strong>}
        </button>)}
        {drops.map((drop) => <div key={drop.id} className="resource-drop" style={{ left: `${drop.position.x}%`, top: `${drop.position.y}%` }}><i className={`resource-icon resource-${drop.resource}`} /><b>×{drop.quantity}</b></div>)}
        {destination && <div className="move-marker" style={{ left: `${destination.x}%`, top: `${destination.y}%` }} />}
        <div className={`room-player facing-${facing} ${phase !== 'idle' ? `is-${phase}` : ''}`} style={{ left: `${position.x}%`, top: `${position.y}%` }}>
          <div className="player-shadow" /><img src={playerImage} alt="종이검을 든 탐험가" draggable={false} />{phase === 'attacking' && <span className="sword-swish" />}
        </div>
      </div>
      {activeTarget && <div className="target-banner"><b>{activeTarget.name}</b><span>{phase === 'attacking' ? '자동 공격 중' : '접근 중'}</span></div>}
      {pickupText && <div className="pickup-toast">획득! <b>{pickupText}</b></div>}
      {!targetId && !pickupText && <div className="move-guide"><span className="tap-icon">＋</span>사물 선택 또는 빈 바닥 이동</div>}
    </div>

    <footer className="room-dungeon-footer">
      <button type="button" className="footer-slot is-selected"><span>⌂</span>탐험</button>
      <button type="button" className={`footer-slot ${inventoryOpen ? 'is-selected' : ''}`} onClick={() => setInventoryOpen(true)}><span>▦</span>가방</button>
      <button type="button" className="footer-slot" disabled><span>⚒</span>작업대</button>
      <button type="button" className="footer-slot" disabled><span>♙</span>자동 채집</button>
    </footer>

    {inventoryOpen && <InventoryPanel entries={inventoryEntries} onClose={() => setInventoryOpen(false)} />}

    {discovery && <div className="panel-backdrop discovery-backdrop"><section className="discovery-card">
      <small>NEW RESOURCE</small><h2>찾았다!</h2><div className="discovery-icon"><i className={`resource-icon resource-${discovery}`} /></div><strong>{RESOURCE_INFO[discovery].name}</strong>
      <p>{hasBatchim(RESOURCE_INFO[discovery].name) ? '을' : '를'} 발견하고 얻었다.</p><button type="button" onClick={() => setDiscovery(null)}>확인</button>
    </section></div>}
    {autoCollectPopup}
    {chapterCompletePopup}
  </section></main>;
}

function InventoryPanel({ entries, onClose }: { entries: [ResourceId, number][]; onClose: () => void }) {
  return <div className="panel-backdrop" onPointerDown={onClose}><section className="inventory-panel" onPointerDown={(event) => event.stopPropagation()}>
    <header><div><small>INVENTORY</small><h2>가방</h2></div><button type="button" onClick={onClose}>×</button></header>
    <InventoryGrid entries={entries} />
    <p>자원은 한 칸에 최대 1,000개까지 보관됩니다.</p>
  </section></div>;
}

function InventoryGrid({ entries }: { entries: [ResourceId, number][] }) {
  return <div className="inventory-grid">{Array.from({ length: 32 }, (_, index) => { const entry = entries[index]; return <div className={`inventory-slot ${entry ? 'has-item' : ''}`} key={index}>{entry && <><i className={`resource-icon resource-${entry[0]}`} /><b>{RESOURCE_INFO[entry[0]].name}</b><em>×{entry[1]}</em></>}</div>; })}</div>;
}
