import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { clearSave, createInitialSave, loadSave, parseSaveJson, saveGame, SAVE_KEY, type BladeId, type GameSave, type ResourceType } from './save';
import './styles.css';

interface SpinGatherKingGameProps { onExit?: () => void }
interface Position { x: number; y: number }
interface ResourceNode { id: string; type: 'wood' | 'log' | 'stone' | 'iron' | 'ice' | 'crystal'; variant?: 'pebble' | 'boulder' | 'ice-pillar' | 'crystal-pillar' | 'maple-tree' | 'cactus' | 'iron-rock'; x: number; y: number; hp: number; maxHp: number; active: boolean; respawnAt: number }
interface Mob { id: string; type: 'ladybug' | 'spider' | 'polar-bear'; map: 1 | 2 | 3; x: number; y: number; spawnX: number; spawnY: number; hp: number; maxHp: number; active: boolean; respawnAt: number; lastAttackAt: number }
interface JoystickState { active: boolean; pointerId: number; dx: number; dy: number }

const MAP_SCALE = 2;
const MAP_REFERENCE_SIZE = 3920;
const MAP_WIDTH = MAP_REFERENCE_SIZE * 2;
const MAP_HEIGHT = MAP_REFERENCE_SIZE * 2;
const MAP1_WIDTH = MAP_WIDTH;
const MAP2_WIDTH = MAP_WIDTH;
const MAP3_WIDTH = MAP_WIDTH;
const WORLD_WIDTH = MAP1_WIDTH + MAP2_WIDTH + MAP3_WIDTH;
const WORLD_HEIGHT = MAP_HEIGHT;
const CAMERA_ZOOM = 1.2;
// 낮아진 카메라 배율에서도 키 입력이 즉각적이고 충분히 빠르게 보이도록 보정한다.
const PLAYER_SPEED = 900;
const ROTATION_MS = 800;
const RESOURCE_DEPOSIT_MS = 90;
const BLADE_DEPOSIT_PER_TICK = 4;
const EAST_DEPOSIT_PER_TICK = 8;
const STATION_INTERACTION_RADIUS = 760;
const BASE_INTERACTION_RADIUS = 1050;
const GATE_INTERACTION_RADIUS = 760;
const BLADE_INNER_PX = 42;
const BLADE_OUTER_PX = 112;
const NODE_HIT_PX = 42;
const MOB_HIT_PX = 54;
const WOOD_PER_BUNDLE = 20;
const FENCE_WOOD_COST = 12;
const BASE_LEVEL_2_COST = { wood: 40, shell: 15 } as const;
const BASE_LEVEL_3_COST = { wood: 80, shell: 35 } as const;
const DESERT_BASE_LEVEL_2_COST = { wood: 40, stone: 20 } as const;
const DESERT_BASE_LEVEL_3_COST = { wood: 80, iron: 30 } as const;
const EAST_UNLOCK_COST = { wood: 200, log: 100 } as const;
const SNOW_UNLOCK_COST = { stone: 200, iron: 100 } as const;
const TURRET_COSTS = { 1: { primary: 50, rare: 20 }, 2: { primary: 50, rare: 20 }, 3: { primary: 50, rare: 20 } } as const;
const TURRET_RANGE = 1900;
const TURRET_FIRE_MS = 900;
const EAST_GATE_X = MAP1_WIDTH;
const SNOW_GATE_X = MAP1_WIDTH + MAP2_WIDTH;
const EAST_UNLOCK_PAD: Position = { x: EAST_GATE_X - 100, y: 450 * MAP_SCALE };
const SNOW_UNLOCK_PAD: Position = { x: SNOW_GATE_X - 100, y: 450 * MAP_SCALE };
const BLADE_COSTS: Record<number, { wood: number; shell: number }> = {
  1: { wood: 5, shell: 0 },
  2: { wood: 8, shell: 0 },
  3: { wood: 15, shell: 0 },
  4: { wood: 20, shell: 5 },
  5: { wood: 30, shell: 10 },
  6: { wood: 45, shell: 20 },
  7: { wood: 65, shell: 35 },
};
const BLADE_LABELS: Record<BladeId, string> = { basic: '기본검', moonseong: '월성검', seongun: '성운검' };
// 기지 안에서 기능별 동선이 겹치지 않도록 칼날 확장은 위쪽,
// 검 해금·장착 받침대는 아래쪽 좌우에 배치한다.
const BASE_BUILD_POINT: Position = { x: MAP1_WIDTH / 2, y: MAP_HEIGHT - 640 };
const MAP_BASE_POINTS: Record<1 | 2 | 3, Position> = {
  1: BASE_BUILD_POINT,
  2: { x: MAP1_WIDTH + MAP2_WIDTH / 2, y: MAP_HEIGHT - 640 },
  3: { x: SNOW_GATE_X + MAP3_WIDTH / 2, y: MAP_HEIGHT - 640 },
};
const PLAYER_START_POINT: Position = { x: MAP1_WIDTH / 2, y: MAP_HEIGHT - 980 };
const BLADE_UPGRADE_PAD: Position = { x: MAP1_WIDTH / 2 - 760, y: MAP_HEIGHT - 1560 };
const BASE_UPGRADE_PAD: Position = { x: MAP1_WIDTH / 2 + 760, y: MAP_HEIGHT - 1560 };
const DESERT_BASE_UPGRADE_PAD: Position = { x: MAP1_WIDTH + MAP2_WIDTH / 2 + 760, y: MAP_HEIGHT - 1560 };
const TURRET_PADS: Record<1 | 2 | 3, Position> = {
  1: { x: MAP_BASE_POINTS[1].x - 650, y: MAP_BASE_POINTS[1].y - 260 },
  2: { x: MAP_BASE_POINTS[2].x - 650, y: MAP_BASE_POINTS[2].y - 260 },
  3: { x: MAP_BASE_POINTS[3].x - 650, y: MAP_BASE_POINTS[3].y - 260 },
};
const PEDESTALS: Record<Exclude<BladeId, 'basic'>, Position> = {
  moonseong: { x: MAP1_WIDTH / 2 - 1520, y: MAP_HEIGHT - 720 },
  seongun: { x: MAP1_WIDTH / 2 + 1520, y: MAP_HEIGHT - 720 },
};
const mapPoint = (point: Position, map: 1 | 2 | 3): Position => ({ x: point.x + (map - 1) * MAP_WIDTH, y: point.y });
const availableMaps = (save: GameSave): (1 | 2 | 3)[] => save.snowUnlocked ? [1, 2, 3] : save.eastUnlocked ? [1, 2] : [1];
const BASE_MAX_HP = [100, 200, 350, 500] as const;
const BASE_DEFENSE = [0, .25, .5, .65] as const;
const BASE_SAFE_RADIUS = 1200;

const INITIAL_NODES: ResourceNode[] = [
  { id: 'tree-1', type: 'wood', x: 90, y: 110, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-2', type: 'wood', x: 310, y: 95, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-3', type: 'wood', x: 600, y: 135, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-4', type: 'wood', x: 875, y: 110, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-5', type: 'wood', x: 165, y: 325, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-6', type: 'wood', x: 475, y: 305, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-7', type: 'wood', x: 790, y: 355, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-8', type: 'wood', x: 55, y: 545, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-9', type: 'wood', x: 535, y: 540, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'tree-10', type: 'wood', x: 920, y: 560, hp: 4, maxHp: 4, active: true, respawnAt: 0 },
  { id: 'rock-1', type: 'stone', variant: 'pebble', x: 190, y: 125, hp: 2, maxHp: 2, active: true, respawnAt: 0 },
  { id: 'rock-2', type: 'stone', variant: 'boulder', x: 450, y: 135, hp: 6, maxHp: 6, active: true, respawnAt: 0 },
  { id: 'rock-3', type: 'stone', variant: 'pebble', x: 735, y: 100, hp: 2, maxHp: 2, active: true, respawnAt: 0 },
  { id: 'rock-4', type: 'stone', variant: 'boulder', x: 300, y: 340, hp: 6, maxHp: 6, active: true, respawnAt: 0 },
  { id: 'rock-5', type: 'stone', variant: 'pebble', x: 635, y: 330, hp: 2, maxHp: 2, active: true, respawnAt: 0 },
  { id: 'rock-6', type: 'stone', variant: 'boulder', x: 930, y: 315, hp: 6, maxHp: 6, active: true, respawnAt: 0 },
  { id: 'rock-7', type: 'stone', variant: 'pebble', x: 70, y: 450, hp: 2, maxHp: 2, active: true, respawnAt: 0 },
  { id: 'rock-8', type: 'stone', variant: 'boulder', x: 695, y: 540, hp: 6, maxHp: 6, active: true, respawnAt: 0 },
  { id: 'ice-1', type: 'ice', variant: 'ice-pillar', x: 1080, y: 140, hp: 8, maxHp: 8, active: true, respawnAt: 0 },
  { id: 'ice-2', type: 'ice', variant: 'ice-pillar', x: 1280, y: 350, hp: 8, maxHp: 8, active: true, respawnAt: 0 },
  { id: 'ice-3', type: 'ice', variant: 'ice-pillar', x: 1560, y: 180, hp: 8, maxHp: 8, active: true, respawnAt: 0 },
  { id: 'ice-4', type: 'ice', variant: 'ice-pillar', x: 1780, y: 650, hp: 8, maxHp: 8, active: true, respawnAt: 0 },
];

const INITIAL_MOBS: Mob[] = [
  { id: 'ladybug-1', type: 'ladybug', map: 1, x: 870, y: 160, spawnX: 870, spawnY: 160, hp: 7, maxHp: 7, active: true, respawnAt: 0, lastAttackAt: 0 },
  { id: 'ladybug-2', type: 'ladybug', map: 1, x: 760, y: 410, spawnX: 760, spawnY: 410, hp: 7, maxHp: 7, active: true, respawnAt: 0, lastAttackAt: 0 },
  { id: 'bear-1', type: 'polar-bear', map: 3, x: 1220, y: 260, spawnX: 1220, spawnY: 260, hp: 14, maxHp: 14, active: true, respawnAt: 0, lastAttackAt: 0 },
  { id: 'bear-2', type: 'polar-bear', map: 3, x: 1680, y: 520, spawnX: 1680, spawnY: 520, hp: 14, maxHp: 14, active: true, respawnAt: 0, lastAttackAt: 0 },
];

const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const distanceToSegment = (point: Position, start: Position, end: Position) => {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared));
  return Math.hypot(point.x - (start.x + segmentX * projection), point.y - (start.y + segmentY * projection));
};
const MEADOW_TREE_POINTS: Position[] = [
  { x: 620, y: 720 }, { x: 1780, y: 560 }, { x: 3020, y: 880 }, { x: 4540, y: 620 }, { x: 5900, y: 900 }, { x: 7180, y: 650 },
  { x: 900, y: 2050 }, { x: 2220, y: 1840 }, { x: 3540, y: 2200 }, { x: 4920, y: 1900 }, { x: 6280, y: 2140 }, { x: 7420, y: 1880 },
  { x: 520, y: 3420 }, { x: 1660, y: 3740 }, { x: 2900, y: 3300 }, { x: 4380, y: 3650 }, { x: 5740, y: 3360 }, { x: 7040, y: 3700 },
  { x: 840, y: 5020 }, { x: 2060, y: 4740 }, { x: 3320, y: 5200 }, { x: 4780, y: 4860 }, { x: 6120, y: 5160 }, { x: 7300, y: 4820 },
  { x: 560, y: 6420 }, { x: 1840, y: 6120 }, { x: 3080, y: 6580 }, { x: 4820, y: 6240 }, { x: 6160, y: 6520 }, { x: 7320, y: 6200 },
];
const MEADOW_BEETLE_POINTS: Position[] = [
  { x: 1280, y: 1320 }, { x: 3820, y: 1180 }, { x: 6500, y: 1460 },
  { x: 2100, y: 3040 }, { x: 5260, y: 2920 }, { x: 7140, y: 4180 },
  { x: 1120, y: 5480 }, { x: 5580, y: 5740 }, { x: 3900, y: 6480 },
];
const MEADOW_MAPLE_TREE_POINTS: Position[] = [
  { x: 1180, y: 2580 }, { x: 6720, y: 2680 }, { x: 2460, y: 4480 },
  { x: 6240, y: 4580 }, { x: 1560, y: 6660 }, { x: 6900, y: 6540 },
];
const DESERT_CACTUS_POINTS: Position[] = [
  { x: 620, y: 720 }, { x: 1840, y: 520 }, { x: 3260, y: 960 }, { x: 4720, y: 620 }, { x: 6100, y: 1060 }, { x: 7240, y: 680 },
  { x: 980, y: 2420 }, { x: 2440, y: 2020 }, { x: 3980, y: 2640 }, { x: 5580, y: 2180 }, { x: 7040, y: 2820 },
  { x: 720, y: 4200 }, { x: 2080, y: 4740 }, { x: 3540, y: 3940 }, { x: 5140, y: 4620 }, { x: 6820, y: 4260 },
  { x: 1080, y: 6240 }, { x: 2860, y: 5860 }, { x: 4780, y: 6420 }, { x: 6760, y: 6020 },
];
const DESERT_ROCK_POINTS: Position[] = [
  { x: 1240, y: 1260 }, { x: 2700, y: 1380 }, { x: 5360, y: 1280 }, { x: 6860, y: 1780 },
  { x: 1540, y: 3380 }, { x: 3200, y: 3160 }, { x: 5920, y: 3520 },
  { x: 760, y: 5480 }, { x: 3880, y: 5480 }, { x: 6300, y: 5560 },
];
const DESERT_IRON_POINTS: Position[] = [
  { x: 2240, y: 2860 }, { x: 4980, y: 2960 }, { x: 1820, y: 5260 }, { x: 5520, y: 6120 },
];
const DESERT_SPIDER_POINTS: Position[] = [
  { x: 920, y: 1780 }, { x: 3720, y: 1120 }, { x: 6640, y: 1460 },
  { x: 2460, y: 3820 }, { x: 5180, y: 4100 }, { x: 6900, y: 5300 },
];
const SNOW_ICE_POINTS: Position[] = [
  { x: 660, y: 760 }, { x: 1880, y: 620 }, { x: 3360, y: 980 }, { x: 5120, y: 680 }, { x: 6940, y: 980 },
  { x: 1120, y: 2520 }, { x: 2760, y: 2220 }, { x: 4540, y: 2760 }, { x: 6500, y: 2440 },
  { x: 820, y: 4460 }, { x: 2380, y: 5080 }, { x: 4260, y: 4280 }, { x: 6280, y: 4840 },
  { x: 1460, y: 6420 }, { x: 3620, y: 6040 }, { x: 5960, y: 6440 },
];
const SNOW_CRYSTAL_POINTS: Position[] = [
  { x: 2240, y: 1480 }, { x: 5740, y: 1760 }, { x: 3480, y: 3540 }, { x: 6900, y: 3820 }, { x: 2060, y: 5740 },
];
const cloneNodes = (): ResourceNode[] => [...INITIAL_NODES.flatMap((node) => {
  if (node.type === 'ice') return [{ ...node, x: SNOW_GATE_X + (node.x - 980) * MAP_SCALE, y: node.y * MAP_SCALE }];
  if (node.type === 'stone') return [];
  return [];
}), ...cloneMeadowTrees(), ...cloneMapleTrees(), ...cloneDesertNodes(), ...cloneSnowNodes()];
const cloneMeadowTrees = () => MEADOW_TREE_POINTS.filter((point) => distance(point, BASE_BUILD_POINT) >= BASE_SAFE_RADIUS).map((point, index) => ({
  id: `tree-meadow-${index + 1}`, type: 'wood' as const, x: point.x, y: point.y,
  hp: 4, maxHp: 4, active: true, respawnAt: 0,
}));
const cloneMapleTrees = () => MEADOW_MAPLE_TREE_POINTS.filter((point) => distance(point, BASE_BUILD_POINT) >= BASE_SAFE_RADIUS).map((point, index) => ({
  id: `maple-tree-meadow-${index + 1}`, type: 'log' as const, variant: 'maple-tree' as const,
  x: point.x, y: point.y, hp: 10, maxHp: 10, active: true, respawnAt: 0,
}));
const cloneDesertNodes = (): ResourceNode[] => [
  ...DESERT_CACTUS_POINTS.map((point, index) => ({ id: `cactus-desert-${index + 1}`, type: 'wood' as const, variant: 'cactus' as const, x: MAP1_WIDTH + point.x, y: point.y, hp: 5, maxHp: 5, active: true, respawnAt: 0 })),
  ...DESERT_ROCK_POINTS.map((point, index) => ({ id: `rock-desert-${index + 1}`, type: 'stone' as const, variant: index % 3 ? 'pebble' as const : 'boulder' as const, x: MAP1_WIDTH + point.x, y: point.y, hp: index % 3 ? 4 : 8, maxHp: index % 3 ? 4 : 8, active: true, respawnAt: 0 })),
  ...DESERT_IRON_POINTS.map((point, index) => ({ id: `iron-desert-${index + 1}`, type: 'iron' as const, variant: 'iron-rock' as const, x: MAP1_WIDTH + point.x, y: point.y, hp: 12, maxHp: 12, active: true, respawnAt: 0 })),
];
const cloneSnowNodes = (): ResourceNode[] => [
  ...SNOW_ICE_POINTS.map((point, index) => ({ id: `ice-snow-${index + 1}`, type: 'ice' as const, variant: 'ice-pillar' as const, x: SNOW_GATE_X + point.x, y: point.y, hp: 8, maxHp: 8, active: true, respawnAt: 0 })),
  ...SNOW_CRYSTAL_POINTS.map((point, index) => ({ id: `crystal-snow-${index + 1}`, type: 'crystal' as const, variant: 'crystal-pillar' as const, x: SNOW_GATE_X + point.x, y: point.y, hp: 14, maxHp: 14, active: true, respawnAt: 0 })),
];
const cloneMobs = () => INITIAL_MOBS.flatMap((mob) => {
  if (mob.type === 'polar-bear') {
    const mapOffset = SNOW_GATE_X - 980 * MAP_SCALE;
    return [{ ...mob, x: mob.x * MAP_SCALE + mapOffset, y: mob.y * MAP_SCALE, spawnX: mob.spawnX * MAP_SCALE + mapOffset, spawnY: mob.spawnY * MAP_SCALE }];
  }
  return [];
}).concat(MEADOW_BEETLE_POINTS.filter((point) => distance(point, BASE_BUILD_POINT) >= BASE_SAFE_RADIUS).map((point, index) => ({
  id: `ladybug-meadow-${index + 1}`, type: 'ladybug' as const, map: 1 as const, x: point.x, y: point.y,
  spawnX: point.x, spawnY: point.y, hp: 7, maxHp: 7, active: true, respawnAt: 0, lastAttackAt: 0,
}))).concat(DESERT_SPIDER_POINTS.map((point, index) => ({
  id: `spider-desert-${index + 1}`, type: 'spider' as const, map: 2 as const,
  x: MAP1_WIDTH + point.x, y: point.y, spawnX: MAP1_WIDTH + point.x, spawnY: point.y,
  hp: 10, maxHp: 10, active: true, respawnAt: 0, lastAttackAt: 0,
})));

export function SpinGatherKingGame({ onExit }: SpinGatherKingGameProps) {
  const worldRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<Position>({ ...PLAYER_START_POINT });
  const destinationRef = useRef<Position | null>(null);
  const keysRef = useRef(new Set<string>());
  const joystickRef = useRef<JoystickState>({ active: false, pointerId: -1, dx: 0, dy: 0 });
  const lastFrameRef = useRef(0);
  const stageScaleRef = useRef(590 / MAP_REFERENCE_SIZE);
  const bladeHitTimesRef = useRef(new Map<string, number>());
  const equipProgressRef = useRef(0);
  const nodesRef = useRef<ResourceNode[]>(cloneNodes());
  const mobsRef = useRef<Mob[]>(cloneMobs());
  const lastRespawnRef = useRef(0);
  const lastTurretShotRef = useRef<Record<1 | 2 | 3, number>>({ 1: 0, 2: 0, 3: 0 });
  const saveRef = useRef<GameSave>(loadSave());
  const loadedRef = useRef(false);
  const [save, setSave] = useState(saveRef.current);
  const [position, setPosition] = useState(positionRef.current);
  const [viewportSize, setViewportSize] = useState({ width: 1450, height: 590 });
  const [nodes, setNodes] = useState(nodesRef.current);
  const [mobs, setMobs] = useState(mobsRef.current);
  const [notice, setNotice] = useState('주변 자원에 가까이 가면 칼날이 자동으로 채집합니다.');
  const [hitNodeId, setHitNodeId] = useState<string | null>(null);
  const [hitMobId, setHitMobId] = useState<string | null>(null);
  const [mobImpact, setMobImpact] = useState<{ id: number; x: number; y: number; defeated: boolean } | null>(null);
  const [hitBurst, setHitBurst] = useState<{ id: number; x: number; y: number; blade: BladeId } | null>(null);
  const [turretShots, setTurretShots] = useState<Array<{ id: string; from: Position; to: Position }>>([]);
  const [joystickVisual, setJoystickVisual] = useState({ active: false, x: 88, y: 604, dx: 0, dy: 0 });
  const [equipTarget, setEquipTarget] = useState<BladeId | null>(null);
  const [equipProgress, setEquipProgress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(saveRef.current, null, 2));
  const [settingsMessage, setSettingsMessage] = useState('');
  const [milestone, setMilestone] = useState('');
  const previousProgressRef = useRef({ baseLevel: saveRef.current.baseLevel, bladeCount: saveRef.current.bladeCount, unlockedCount: saveRef.current.unlockedBladeIds.length, eastUnlocked: saveRef.current.eastUnlocked });
  const fenceBuilt = save.baseLevel >= 1;
  const safeDesertBaseLevel = save.desertBaseLevel ?? 1;
  const safeDesertBaseHp = save.desertBaseHp ?? BASE_MAX_HP[safeDesertBaseLevel];
  const safeSnowBaseLevel = save.snowBaseLevel ?? 1;
  const safeSnowBaseHp = save.snowBaseHp ?? BASE_MAX_HP[safeSnowBaseLevel];
  const currentMap = position.x < MAP1_WIDTH ? 1 : position.x < SNOW_GATE_X ? 2 : 3;
  const baseDefeated = currentMap === 1 ? fenceBuilt && save.baseHp <= 0 : currentMap === 2 ? save.eastUnlocked && save.desertEntered && safeDesertBaseHp <= 0 : save.snowUnlocked && save.snowEntered && safeSnowBaseHp <= 0;
  const desertUnlockReady = save.eastUnlockWood >= EAST_UNLOCK_COST.wood && save.eastUnlockLog >= EAST_UNLOCK_COST.log;

  useEffect(() => {
    const previous = previousProgressRef.current;
    let message = '';
    if (save.baseLevel > previous.baseLevel) message = save.baseLevel === 1 ? '1단계 목재 기지 완성!' : '2단계 석재 기지 완성!';
    else if (save.bladeCount > previous.bladeCount) message = `칼날 ${save.bladeCount}개 확장!`;
    else if (save.unlockedBladeIds.length > previous.unlockedCount) {
      const newest = save.unlockedBladeIds.at(-1) ?? 'basic';
      message = `${BLADE_LABELS[newest]} 해금!`;
    } else if (!previous.eastUnlocked && save.eastUnlocked) message = '동쪽 확장 지역 개방!';
    previousProgressRef.current = { baseLevel: save.baseLevel, bladeCount: save.bladeCount, unlockedCount: save.unlockedBladeIds.length, eastUnlocked: save.eastUnlocked };
    if (!message) return;
    setMilestone(message);
    setNotice(message);
    const timer = window.setTimeout(() => setMilestone(''), 1800);
    return () => window.clearTimeout(timer);
  }, [save.baseLevel, save.bladeCount, save.unlockedBladeIds, save.eastUnlocked]);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const element = worldRef.current;
    if (!element) return;
    const updateViewport = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!loadedRef.current) { loadedRef.current = true; return; }
    const timer = window.setTimeout(() => { saveRef.current = saveGame(saveRef.current); }, 350);
    return () => window.clearTimeout(timer);
  }, [save]);
  useEffect(() => {
    const persist = () => { saveRef.current = saveGame(saveRef.current); };
    const visibility = () => { if (document.visibilityState === 'hidden') persist(); };
    const storage = (event: StorageEvent) => {
      if (event.key !== SAVE_KEY || !event.newValue) return;
      try { setSave(parseSaveJson(event.newValue)); setNotice('다른 탭에서 수정한 저장값을 반영했습니다.'); } catch { /* invalid external data */ }
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('pagehide', persist); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', storage); };
  }, []);

  const patchSave = useCallback((updater: (current: GameSave) => GameSave) => setSave((current) => updater(current)), []);

  useEffect(() => {
    if (!save.eastUnlocked || save.desertBaseLevel !== undefined) return;
    patchSave((current) => parseSaveJson(JSON.stringify(current)));
  }, [patchSave, save.desertBaseLevel, save.eastUnlocked]);

  useEffect(() => {
    if (!save.eastUnlocked || (save.desertSpawnRuleVersion ?? 0) >= 1) return;
    patchSave((current) => ({
      ...current,
      desertEntered: false,
      desertBaseHp: BASE_MAX_HP[current.desertBaseLevel ?? 1],
      desertSpawnRuleVersion: 1,
    }));
    const dormant = mobsRef.current.map((mob) => mob.map === 2
      ? { ...mob, x: mob.spawnX, y: mob.spawnY, hp: mob.maxHp, active: true, respawnAt: 0, lastAttackAt: 0 }
      : mob);
    mobsRef.current = dormant;
    setMobs(dormant);
    setNotice('사막 진입 규칙을 수정해 기지를 완전히 복구했습니다.');
  }, [patchSave, save.desertSpawnRuleVersion, save.eastUnlocked]);

  useEffect(() => {
    if (!save.eastUnlocked || currentMap !== 2 || save.desertEntered) return;
    patchSave((current) => ({
      ...current,
      desertEntered: true,
      // Earlier builds allowed off-screen spiders to drain this base. The first
      // legitimate entry starts the desert with a fully repaired local base.
      desertBaseHp: BASE_MAX_HP[current.desertBaseLevel ?? 1],
    }));
    const activated = mobsRef.current.map((mob) => mob.map === 2
      ? { ...mob, x: mob.spawnX, y: mob.spawnY, hp: mob.maxHp, active: true, respawnAt: 0, lastAttackAt: 0 }
      : mob);
    mobsRef.current = activated;
    setMobs(activated);
    setNotice('사막에 진입했습니다! 사막 거미가 나타납니다.');
  }, [currentMap, patchSave, save.desertEntered, save.eastUnlocked]);

  useEffect(() => {
    if (!save.snowUnlocked || currentMap !== 3 || save.snowEntered) return;
    patchSave((current) => ({ ...current, snowEntered: true, snowBaseHp: BASE_MAX_HP[current.snowBaseLevel ?? 1] }));
    const activated = mobsRef.current.map((mob) => mob.map === 3
      ? { ...mob, x: mob.spawnX, y: mob.spawnY, hp: mob.maxHp, active: true, respawnAt: 0, lastAttackAt: 0 }
      : mob);
    mobsRef.current = activated;
    setMobs(activated);
    setNotice('설원에 진입했습니다! 북극곰이 나타납니다.');
  }, [currentMap, patchSave, save.snowEntered, save.snowUnlocked]);

  useEffect(() => {
    if (save.eastUnlocked || !desertUnlockReady) return;
    patchSave((current) => current.eastUnlocked ? current : { ...current, eastUnlocked: true });
    setNotice('사막 맵 개방 완료!');
  }, [desertUnlockReady, patchSave, save.eastUnlocked]);

  const objective = useMemo(() => {
    if (!fenceBuilt) return `나무를 모아 안전구역 울타리 완성 ${save.fenceWood}/${FENCE_WOOD_COST}`;
    if (save.bladeCount < 4) return `1단계 기지에서 칼날 4개 달성 · 현재 ${save.bladeCount}개`;
    if (save.baseLevel < 2) return `초원 기지 2단계 · 나무 ${save.baseUpgradeWood}/${BASE_LEVEL_2_COST.wood} · 갑각 ${save.baseUpgradeShell}/${BASE_LEVEL_2_COST.shell}`;
    if (save.baseLevel < 3) return `초원 기지 3단계 · 나무 ${save.base3Wood}/${BASE_LEVEL_3_COST.wood} · 갑각 ${save.base3Shell}/${BASE_LEVEL_3_COST.shell}`;
    if (save.bladeCount >= 8 && save.unlockedBladeIds.includes('moonseong') && save.unlockedBladeIds.includes('seongun') && !save.eastUnlocked) return `사막 개방 · 나무 ${save.eastUnlockWood}/200 · 단풍목 ${save.eastUnlockLog}/100`;
    if (save.eastUnlocked && !save.snowUnlocked) return `설원 개방 · 돌 ${save.snowUnlockStone ?? 0}/200 · 철광석 ${save.snowUnlockIron ?? 0}/100`;
    if (save.snowUnlocked && !save.snowEntered) return '설원 경계를 넘어 첫 진입을 완료하세요.';
    if (save.bladeCount >= 8 && save.unlockedBladeIds.includes('moonseong') && save.unlockedBladeIds.includes('seongun')) return 'MVP 목표 완료! 2단계 기지와 8개의 칼날로 자유롭게 채집하세요.';
    return `검을 해금하고 바꿔 보세요 · 현재 ${BLADE_LABELS[save.equippedBladeId]} ${save.bladeCount}개`;
  }, [fenceBuilt, save]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)) return;
      if ((event.target as HTMLElement)?.matches('input, textarea')) return;
      event.preventDefault(); keysRef.current.add(event.key.toLowerCase()); destinationRef.current = null;
    };
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const harvest = useCallback((now: number) => {
    const gathered: Record<ResourceType, number> = { wood: 0, log: 0, stone: 0, iron: 0, ice: 0, crystal: 0, meat: 0, shell: 0 };
    const struck: ResourceNode[] = [];
    const baseAngle = now / ROTATION_MS * Math.PI * 2;
    const stageScale = Math.max(.05, stageScaleRef.current);
    const bladeInnerRadius = BLADE_INNER_PX / stageScale;
    const bladeOuterRadius = BLADE_OUTER_PX / stageScale;
    const nodeHitRadius = NODE_HIT_PX / stageScale;
    let changed = false;
    const nextNodes = nodesRef.current.map((node) => {
      if (!node.active || distance(positionRef.current, node) > bladeOuterRadius + nodeHitRadius) return node;
      let hitCount = 0;
      for (let bladeIndex = 0; bladeIndex < saveRef.current.bladeCount; bladeIndex += 1) {
        const angle = baseAngle + bladeIndex * Math.PI * 2 / saveRef.current.bladeCount;
        const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
        const start = { x: positionRef.current.x + direction.x * bladeInnerRadius, y: positionRef.current.y + direction.y * bladeInnerRadius };
        const end = { x: positionRef.current.x + direction.x * bladeOuterRadius, y: positionRef.current.y + direction.y * bladeOuterRadius };
        if (distanceToSegment(node, start, end) > nodeHitRadius) continue;
        const hitKey = `${node.id}:${bladeIndex}`;
        const previousHit = bladeHitTimesRef.current.get(hitKey) ?? -ROTATION_MS;
        if (now - previousHit < ROTATION_MS * .72) continue;
        bladeHitTimesRef.current.set(hitKey, now);
        hitCount += 1;
      }
      if (hitCount === 0) return node;
      changed = true;
      struck.push(node);
      const nextHp = node.hp - hitCount;
      if (nextHp > 0) return { ...node, hp: nextHp };
      gathered[node.type] += node.type === 'wood' ? 3 : node.type === 'log' ? 1 : node.type === 'iron' ? 2 : node.type === 'ice' ? 3 : node.type === 'crystal' ? 1 : node.variant === 'pebble' ? 1 : 3;
      return { ...node, hp: 0, active: false, respawnAt: now + 3600 };
    });
    if (!changed) return;
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    if (struck.length > 0) {
      const target = struck[0];
      setHitNodeId(target.id); setHitBurst({ id: now, x: target.x, y: target.y, blade: saveRef.current.equippedBladeId });
      window.setTimeout(() => setHitNodeId((current) => current === target.id ? null : current), 140);
      window.setTimeout(() => setHitBurst((current) => current?.id === now ? null : current), 650);
    }
    if (gathered.wood || gathered.log || gathered.stone || gathered.iron || gathered.ice || gathered.crystal) {
      patchSave((current) => ({ ...current, resources: { ...current.resources, wood: current.resources.wood + gathered.wood, log: current.resources.log + gathered.log, stone: current.resources.stone + gathered.stone, iron: current.resources.iron + gathered.iron, ice: current.resources.ice + gathered.ice, crystal: (current.resources.crystal ?? 0) + gathered.crystal } }));
      setNotice(gathered.wood ? `나무 +${gathered.wood}` : gathered.log ? `단풍목 +${gathered.log}` : gathered.stone ? `돌 +${gathered.stone}` : gathered.iron ? `철광석 +${gathered.iron}` : gathered.ice ? `얼음 +${gathered.ice}` : `수정 +${gathered.crystal}`);
    }
  }, [patchSave]);

  const updateMobs = useCallback((now: number, delta: number) => {
    let changed = false;
    const rewards = { meat: 0, shell: 0 };
    let meadowBaseDamage = 0;
    let desertBaseDamage = 0;
    let snowBaseDamage = 0;
    const stageScale = Math.max(.05, stageScaleRef.current);
    const bladeInnerRadius = BLADE_INNER_PX / stageScale;
    const bladeOuterRadius = BLADE_OUTER_PX / stageScale;
    const mobHitRadius = MOB_HIT_PX / stageScale;
    const playerMap: 1 | 2 | 3 = positionRef.current.x < MAP1_WIDTH ? 1 : positionRef.current.x < SNOW_GATE_X ? 2 : 3;
    const turretInstalled: Record<1 | 2 | 3, boolean> = {
      1: (saveRef.current.meadowTurretWood ?? 0) >= TURRET_COSTS[1].primary && (saveRef.current.meadowTurretShell ?? 0) >= TURRET_COSTS[1].rare,
      2: (saveRef.current.desertTurretStone ?? 0) >= TURRET_COSTS[2].primary && (saveRef.current.desertTurretIron ?? 0) >= TURRET_COSTS[2].rare,
      3: (saveRef.current.snowTurretIce ?? 0) >= TURRET_COSTS[3].primary && (saveRef.current.snowTurretCrystal ?? 0) >= TURRET_COSTS[3].rare,
    };
    const turretTargets = new Map<number, string>();
    ([1, 2, 3] as const).forEach((map) => {
      if (!turretInstalled[map] || now - lastTurretShotRef.current[map] < TURRET_FIRE_MS) return;
      const target = mobsRef.current.find((mob) => mob.map === map && mob.active && distance(mob, MAP_BASE_POINTS[map]) <= TURRET_RANGE);
      if (target) {
        turretTargets.set(map, target.id); lastTurretShotRef.current[map] = now;
        const id = `${map}-${now}`;
        setTurretShots((current) => [...current, { id, from: TURRET_PADS[map], to: { x: target.x, y: target.y } }]);
        window.setTimeout(() => setTurretShots((current) => current.filter((shot) => shot.id !== id)), 420);
      }
    });
    const nextMobs = mobsRef.current.map((mob) => {
      if (mob.map === 2 && (!saveRef.current.eastUnlocked || !saveRef.current.desertEntered)) return mob;
      if (mob.map === 3 && (!saveRef.current.snowUnlocked || !saveRef.current.snowEntered)) return mob;
      if (!mob.active) {
        if (mob.map !== playerMap) return mob;
        if (now < mob.respawnAt) return mob;
        changed = true;
        return { ...mob, x: mob.spawnX, y: mob.spawnY, hp: mob.maxHp, active: true, respawnAt: 0, lastAttackAt: 0 };
      }
      let hp = mob.hp;
      if (turretTargets.get(mob.map) === mob.id) hp -= 1;
      if (distance(positionRef.current, mob) <= bladeOuterRadius + mobHitRadius) {
        const baseAngle = now / ROTATION_MS * Math.PI * 2;
        for (let bladeIndex = 0; bladeIndex < saveRef.current.bladeCount; bladeIndex += 1) {
          const angle = baseAngle + bladeIndex * Math.PI * 2 / saveRef.current.bladeCount;
          const direction = { x: Math.sin(angle), y: -Math.cos(angle) };
          const start = { x: positionRef.current.x + direction.x * bladeInnerRadius, y: positionRef.current.y + direction.y * bladeInnerRadius };
          const end = { x: positionRef.current.x + direction.x * bladeOuterRadius, y: positionRef.current.y + direction.y * bladeOuterRadius };
          if (distanceToSegment(mob, start, end) > mobHitRadius) continue;
          const hitKey = `mob:${mob.id}:${bladeIndex}`;
          const previousHit = bladeHitTimesRef.current.get(hitKey) ?? -ROTATION_MS;
          if (now - previousHit < ROTATION_MS * .72) continue;
          bladeHitTimesRef.current.set(hitKey, now);
          hp -= 1;
        }
      }
      if (hp <= 0) {
        changed = true;
        setHitMobId(mob.id); setMobImpact({ id: now, x: mob.x, y: mob.y, defeated: true });
        window.setTimeout(() => setHitMobId((current) => current === mob.id ? null : current), 260);
        window.setTimeout(() => setMobImpact((current) => current?.id === now ? null : current), 720);
        if (mob.type === 'polar-bear') rewards.meat += 2; else rewards.shell += mob.type === 'spider' ? 2 : 1;
        return { ...mob, hp: 0, active: false, respawnAt: now + 5200 };
      }
      if (hp < mob.hp) {
        setHitMobId(mob.id); setMobImpact({ id: now, x: mob.x, y: mob.y, defeated: false });
        window.setTimeout(() => setHitMobId((current) => current === mob.id ? null : current), 180);
        window.setTimeout(() => setMobImpact((current) => current?.id === now ? null : current), 480);
      }
      const mobBaseBuilt = mob.map === 1 ? fenceBuilt : mob.map === 2 ? saveRef.current.eastUnlocked : saveRef.current.snowUnlocked;
      if (!mobBaseBuilt) return hp === mob.hp ? mob : { ...mob, hp };
      const baseTarget = MAP_BASE_POINTS[mob.map];
      const baseDistance = distance(mob, baseTarget);
      if (baseDistance <= BASE_SAFE_RADIUS) {
        const safeDistance = Math.max(1, baseDistance);
        const directionX = baseDistance === 0 ? 0 : (mob.x - baseTarget.x) / safeDistance;
        const directionY = baseDistance === 0 ? -1 : (mob.y - baseTarget.y) / safeDistance;
        const boundaryX = baseTarget.x + directionX * BASE_SAFE_RADIUS;
        const boundaryY = baseTarget.y + directionY * BASE_SAFE_RADIUS;
        const attackInterval = mob.map === playerMap ? 1000 : 5000;
        if (now - mob.lastAttackAt >= attackInterval) {
          const rawDamage = mob.type === 'polar-bear' ? 10 : mob.type === 'spider' ? 7 : 4;
          const targetLevel = mob.map === 1 ? saveRef.current.baseLevel : mob.map === 2 ? (saveRef.current.desertBaseLevel ?? 1) : (saveRef.current.snowBaseLevel ?? 1);
          const damage = Math.max(1, Math.round(rawDamage * (1 - BASE_DEFENSE[targetLevel])));
          if (mob.map === 1) meadowBaseDamage += damage;
          else if (mob.map === 2) desertBaseDamage += damage;
          else snowBaseDamage += damage;
          changed = true;
          return { ...mob, x: boundaryX, y: boundaryY, hp, lastAttackAt: now };
        }
        if (baseDistance < BASE_SAFE_RADIUS || hp < mob.hp) {
          changed = true;
          return { ...mob, x: boundaryX, y: boundaryY, hp };
        }
        return mob;
      }
      const activeSpeed = mob.type === 'polar-bear' ? 24 : mob.type === 'spider' ? 30 : 34;
      const speed = activeSpeed * (mob.map === playerMap ? 1 : .14);
      const mapMinX = (mob.map - 1) * MAP_WIDTH + 48;
      const mapMaxX = mob.map * MAP_WIDTH - 48;
      const x = Math.max(mapMinX, Math.min(mapMaxX, mob.x + (baseTarget.x - mob.x) / baseDistance * speed * delta));
      const y = mob.y + (baseTarget.y - mob.y) / baseDistance * speed * delta;
      changed = true;
      return { ...mob, x, y, hp };
    });
    if (changed) { mobsRef.current = nextMobs; setMobs(nextMobs); }
    if (rewards.meat || rewards.shell) patchSave((current) => ({ ...current, resources: { ...current.resources, meat: current.resources.meat + rewards.meat, shell: current.resources.shell + rewards.shell } }));
    if (rewards.meat) setNotice(`북극곰 퇴치 · 고기 +${rewards.meat}`);
    else if (rewards.shell) setNotice(`갑각 몬스터 퇴치 · 갑각 +${rewards.shell}`);
    if (meadowBaseDamage || desertBaseDamage || snowBaseDamage) patchSave((current) => ({
      ...current,
      baseHp: Math.max(0, current.baseHp - meadowBaseDamage),
      desertBaseHp: Math.max(0, (current.desertBaseHp ?? BASE_MAX_HP[current.desertBaseLevel ?? 1]) - desertBaseDamage),
      snowBaseHp: Math.max(0, (current.snowBaseHp ?? BASE_MAX_HP[current.snowBaseLevel ?? 1]) - snowBaseDamage),
    }));
  }, [fenceBuilt, patchSave]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const playerMap: 1 | 2 | 3 = positionRef.current.x < MAP1_WIDTH ? 1 : positionRef.current.x < SNOW_GATE_X ? 2 : 3;
      if (distance(positionRef.current, TURRET_PADS[playerMap]) >= STATION_INTERACTION_RADIUS) return;
      patchSave((current) => {
        const resources = { ...current.resources };
        let primary = playerMap === 1 ? current.meadowTurretWood ?? 0 : playerMap === 2 ? current.desertTurretStone ?? 0 : current.snowTurretIce ?? 0;
        let rare = playerMap === 1 ? current.meadowTurretShell ?? 0 : playerMap === 2 ? current.desertTurretIron ?? 0 : current.snowTurretCrystal ?? 0;
        if (primary >= 50 && rare >= 20) return current;
        let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (primary < 50) {
            const amount = playerMap === 1 ? resources.wood : playerMap === 2 ? resources.stone : resources.ice;
            if (amount <= 0) break;
            primary += 1; deposited += 1;
            if (playerMap === 1) resources.wood -= 1; else if (playerMap === 2) resources.stone -= 1; else resources.ice -= 1;
          } else if (rare < 20) {
            const amount = playerMap === 1 ? resources.shell : playerMap === 2 ? resources.iron : resources.crystal;
            if ((amount ?? 0) <= 0) break;
            rare += 1; deposited += 1;
            if (playerMap === 1) resources.shell -= 1; else if (playerMap === 2) resources.iron -= 1; else resources.crystal -= 1;
          }
        }
        if (!deposited) return current;
        if (playerMap === 1) return { ...current, resources, meadowTurretWood: primary, meadowTurretShell: rare };
        if (playerMap === 2) return { ...current, resources, desertTurretStone: primary, desertTurretIron: rare };
        return { ...current, resources, snowTurretIce: primary, snowTurretCrystal: rare };
      });
    }, RESOURCE_DEPOSIT_MS);
    return () => window.clearInterval(timer);
  }, [patchSave]);

  useEffect(() => {
    let frame = 0;
    const tick = (now: number) => {
      const last = lastFrameRef.current || now;
      const delta = Math.min(.035, (now - last) / 1000);
      lastFrameRef.current = now;
      if (baseDefeated) { frame = requestAnimationFrame(tick); return; }
      const current = positionRef.current;
      let dx = joystickRef.current.active ? joystickRef.current.dx : 0;
      let dy = joystickRef.current.active ? joystickRef.current.dy : 0;
      const keys = keysRef.current;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      const target = destinationRef.current;
      if (dx === 0 && dy === 0 && target) {
        const targetDistance = distance(current, target);
        if (targetDistance < 6) destinationRef.current = null;
        else { dx = (target.x - current.x) / targetDistance; dy = (target.y - current.y) / targetDistance; }
      }
      if (dx !== 0 || dy !== 0) {
        const magnitude = Math.min(1, Math.hypot(dx, dy)) || 1;
        const movementMaxX = saveRef.current.snowUnlocked ? WORLD_WIDTH - 34 : saveRef.current.eastUnlocked ? SNOW_GATE_X - 45 : EAST_GATE_X - 45;
        const next = { x: Math.max(34, Math.min(movementMaxX, current.x + dx / magnitude * PLAYER_SPEED * magnitude * delta)), y: Math.max(50, Math.min(WORLD_HEIGHT - 28, current.y + dy / magnitude * PLAYER_SPEED * magnitude * delta)) };
        positionRef.current = next; setPosition(next);
      }
      let activePedestal: BladeId | null = null;
      if (fenceBuilt) availableMaps(saveRef.current).forEach((map) => (Object.entries(PEDESTALS) as [Exclude<BladeId, 'basic'>, Position][]).forEach(([blade, point]) => {
        if (saveRef.current.unlockedBladeIds.includes(blade) && saveRef.current.equippedBladeId !== blade && distance(positionRef.current, mapPoint(point, map)) < STATION_INTERACTION_RADIUS) activePedestal = blade;
      }));
      if (activePedestal) {
        equipProgressRef.current = Math.min(3000, equipProgressRef.current + delta * 1000);
        setEquipTarget(activePedestal); setEquipProgress(equipProgressRef.current / 3000);
        if (equipProgressRef.current >= 3000) {
          const blade = activePedestal;
          patchSave((currentSave) => ({ ...currentSave, equippedBladeId: blade! }));
          setNotice(`${BLADE_LABELS[blade]} 장착 완료!`); equipProgressRef.current = 0; setEquipProgress(0);
        }
      } else { equipProgressRef.current = 0; setEquipTarget(null); setEquipProgress(0); }
      harvest(now);
      updateMobs(now, delta);
      if (now - lastRespawnRef.current >= 250) {
        lastRespawnRef.current = now;
        const respawned = nodesRef.current.map((node) => !node.active && now >= node.respawnAt ? { ...node, active: true, hp: node.maxHp, respawnAt: 0 } : node);
        if (respawned.some((node, index) => node !== nodesRef.current[index])) {
          nodesRef.current = respawned;
          setNodes(respawned);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [baseDefeated, fenceBuilt, harvest, patchSave, updateMobs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentPosition = positionRef.current;
      const nearFence = distance(currentPosition, BASE_BUILD_POINT) < BASE_INTERACTION_RADIUS;
      const nearBladeUpgrade = availableMaps(saveRef.current).some((map) => distance(currentPosition, mapPoint(BLADE_UPGRADE_PAD, map)) < STATION_INTERACTION_RADIUS);
      const nearBaseUpgrade = distance(currentPosition, BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS;
      const nearMoonseong = availableMaps(saveRef.current).some((map) => distance(currentPosition, mapPoint(PEDESTALS.moonseong, map)) < STATION_INTERACTION_RADIUS);
      const nearSeongun = availableMaps(saveRef.current).some((map) => distance(currentPosition, mapPoint(PEDESTALS.seongun, map)) < STATION_INTERACTION_RADIUS);
      const nearEastUnlock = distance(currentPosition, EAST_UNLOCK_PAD) < GATE_INTERACTION_RADIUS;
      const nearSnowUnlock = distance(currentPosition, SNOW_UNLOCK_PAD) < GATE_INTERACTION_RADIUS;
      const nearBaseRepair = distance(currentPosition, BASE_BUILD_POINT) < BASE_INTERACTION_RADIUS;
      const nearDesertBase = distance(currentPosition, MAP_BASE_POINTS[2]) < BASE_INTERACTION_RADIUS;
      const nearSnowBase = distance(currentPosition, MAP_BASE_POINTS[3]) < BASE_INTERACTION_RADIUS;
      const nearDesertBaseUpgrade = distance(currentPosition, DESERT_BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS;
      patchSave((current) => {
      if (!fenceBuilt && nearFence && current.resources.wood > 0) {
        const fenceWood = Math.min(FENCE_WOOD_COST, current.fenceWood + 1);
        return { ...current, resources: { ...current.resources, wood: current.resources.wood - 1 }, fenceWood, baseLevel: fenceWood >= FENCE_WOOD_COST ? 1 : current.baseLevel, baseHp: fenceWood >= FENCE_WOOD_COST ? BASE_MAX_HP[1] : current.baseHp };
      }
      if (fenceBuilt && current.bladeCount >= 4 && current.baseLevel < 2 && nearBaseUpgrade) {
        let woodProgress = current.baseUpgradeWood;
        let shellProgress = current.baseUpgradeShell;
        const resources = { ...current.resources };
        let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (woodProgress < BASE_LEVEL_2_COST.wood && resources.wood > 0) {
            woodProgress += 1; resources.wood -= 1; deposited += 1;
          } else if (shellProgress < BASE_LEVEL_2_COST.shell && resources.shell > 0) {
            shellProgress += 1; resources.shell -= 1; deposited += 1;
          } else break;
        }
        if (deposited === 0) return current;
        const complete = woodProgress >= BASE_LEVEL_2_COST.wood && shellProgress >= BASE_LEVEL_2_COST.shell;
        return { ...current, resources, baseLevel: complete ? 2 : current.baseLevel, baseHp: complete ? BASE_MAX_HP[2] : current.baseHp, baseUpgradeWood: woodProgress, baseUpgradeShell: shellProgress };
      }
      if (current.baseLevel === 2 && nearBaseUpgrade) {
        let wood = current.base3Wood; let shell = current.base3Shell;
        const resources = { ...current.resources };
        let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (wood < BASE_LEVEL_3_COST.wood && resources.wood > 0) { wood += 1; resources.wood -= 1; deposited += 1; }
          else if (shell < BASE_LEVEL_3_COST.shell && resources.shell > 0) { shell += 1; resources.shell -= 1; deposited += 1; }
          else break;
        }
        if (deposited === 0) return current;
        const complete = wood >= BASE_LEVEL_3_COST.wood && shell >= BASE_LEVEL_3_COST.shell;
        return { ...current, resources, baseLevel: complete ? 3 : current.baseLevel, baseHp: complete ? BASE_MAX_HP[3] : current.baseHp, base3Wood: wood, base3Shell: shell };
      }
      if (fenceBuilt && nearBladeUpgrade && current.bladeCount < 8) {
        const cost = BLADE_COSTS[current.bladeCount];
        let woodProgress = current.bladeSlotProgress;
        let shellProgress = current.bladeShellProgress;
        const resources = { ...current.resources };
        let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (woodProgress < cost.wood && resources.wood > 0) {
            woodProgress += 1;
            resources.wood -= 1;
            deposited += 1;
          } else if (shellProgress < cost.shell && resources.shell > 0) {
            shellProgress += 1;
            resources.shell -= 1;
            deposited += 1;
          } else break;
        }
        if (deposited === 0) return current;
        const complete = woodProgress >= cost.wood && shellProgress >= cost.shell;
        return {
          ...current,
          resources,
          bladeCount: complete ? (current.bladeCount + 1) as GameSave['bladeCount'] : current.bladeCount,
          bladeSlotProgress: complete ? 0 : woodProgress,
          bladeShellProgress: complete ? 0 : shellProgress,
        };
      }
      if (fenceBuilt && nearMoonseong && !current.unlockedBladeIds.includes('moonseong') && current.resources.wood > 0) {
        const progress = current.moonseongProgress + 1;
        return { ...current, resources: { ...current.resources, wood: current.resources.wood - 1 }, moonseongProgress: Math.min(70, progress), unlockedBladeIds: progress >= 70 ? [...current.unlockedBladeIds, 'moonseong'] : current.unlockedBladeIds };
      }
      if (fenceBuilt && nearSeongun && !current.unlockedBladeIds.includes('seongun') && current.resources.stone > 0) {
        const progress = current.seongunProgress + 1;
        return { ...current, resources: { ...current.resources, stone: current.resources.stone - 1 }, seongunProgress: Math.min(50, progress), unlockedBladeIds: progress >= 50 ? [...current.unlockedBladeIds, 'seongun'] : current.unlockedBladeIds };
      }
      if (!current.eastUnlocked && nearEastUnlock) {
        if (current.eastUnlockWood >= EAST_UNLOCK_COST.wood && current.eastUnlockLog >= EAST_UNLOCK_COST.log) {
          return { ...current, eastUnlocked: true };
        }
        let woodProgress = current.eastUnlockWood;
        let logProgress = current.eastUnlockLog;
        const resources = { ...current.resources };
        let deposited = 0;
        while (deposited < EAST_DEPOSIT_PER_TICK) {
          if (woodProgress < EAST_UNLOCK_COST.wood && resources.wood > 0) {
            woodProgress += 1; resources.wood -= 1; deposited += 1;
          } else if (logProgress < EAST_UNLOCK_COST.log && resources.log > 0) {
            logProgress += 1; resources.log -= 1; deposited += 1;
          } else break;
        }
        if (deposited === 0) return current;
        const eastUnlocked = woodProgress >= EAST_UNLOCK_COST.wood && logProgress >= EAST_UNLOCK_COST.log;
        return { ...current, resources, eastUnlocked, eastUnlockWood: woodProgress, eastUnlockLog: logProgress };
      }
      if (current.eastUnlocked && !current.snowUnlocked && nearSnowUnlock) {
        let stone = current.snowUnlockStone ?? 0; let iron = current.snowUnlockIron ?? 0;
        const resources = { ...current.resources }; let deposited = 0;
        while (deposited < EAST_DEPOSIT_PER_TICK) {
          if (stone < SNOW_UNLOCK_COST.stone && resources.stone > 0) { stone += 1; resources.stone -= 1; deposited += 1; }
          else if (iron < SNOW_UNLOCK_COST.iron && resources.iron > 0) { iron += 1; resources.iron -= 1; deposited += 1; }
          else break;
        }
        if (!deposited) return current;
        const snowUnlocked = stone >= SNOW_UNLOCK_COST.stone && iron >= SNOW_UNLOCK_COST.iron;
        return { ...current, resources, snowUnlocked, snowUnlockStone: stone, snowUnlockIron: iron };
      }
      if (current.eastUnlocked && (current.desertBaseLevel ?? 1) === 1 && nearDesertBaseUpgrade) {
        let wood = current.desertBase2Wood ?? 0; let stone = current.desertBase2Stone ?? 0;
        const resources = { ...current.resources }; let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (wood < DESERT_BASE_LEVEL_2_COST.wood && resources.wood > 0) { wood += 1; resources.wood -= 1; deposited += 1; }
          else if (stone < DESERT_BASE_LEVEL_2_COST.stone && resources.stone > 0) { stone += 1; resources.stone -= 1; deposited += 1; }
          else break;
        }
        if (!deposited) return current;
        const complete = wood >= DESERT_BASE_LEVEL_2_COST.wood && stone >= DESERT_BASE_LEVEL_2_COST.stone;
        return { ...current, resources, desertBaseLevel: complete ? 2 : 1, desertBaseHp: complete ? BASE_MAX_HP[2] : (current.desertBaseHp ?? BASE_MAX_HP[1]), desertBase2Wood: wood, desertBase2Stone: stone };
      }
      if (current.eastUnlocked && current.desertBaseLevel === 2 && nearDesertBaseUpgrade) {
        let wood = current.desertBase3Wood ?? 0; let iron = current.desertBase3Iron ?? 0;
        const resources = { ...current.resources }; let deposited = 0;
        while (deposited < BLADE_DEPOSIT_PER_TICK) {
          if (wood < DESERT_BASE_LEVEL_3_COST.wood && resources.wood > 0) { wood += 1; resources.wood -= 1; deposited += 1; }
          else if (iron < DESERT_BASE_LEVEL_3_COST.iron && resources.iron > 0) { iron += 1; resources.iron -= 1; deposited += 1; }
          else break;
        }
        if (!deposited) return current;
        const complete = wood >= DESERT_BASE_LEVEL_3_COST.wood && iron >= DESERT_BASE_LEVEL_3_COST.iron;
        return { ...current, resources, desertBaseLevel: complete ? 3 : 2, desertBaseHp: complete ? BASE_MAX_HP[3] : current.desertBaseHp, desertBase3Wood: wood, desertBase3Iron: iron };
      }
      const baseMaxHp = BASE_MAX_HP[current.baseLevel];
      if (current.baseLevel >= 1 && current.baseHp > 0 && nearBaseRepair && current.baseHp < baseMaxHp && current.resources.wood > 0) {
        return { ...current, resources: { ...current.resources, wood: current.resources.wood - 1 }, baseHp: Math.min(baseMaxHp, current.baseHp + 5) };
      }
      const desertLevel = current.desertBaseLevel ?? 1;
      const desertHp = current.desertBaseHp ?? BASE_MAX_HP[desertLevel];
      const desertBaseMaxHp = BASE_MAX_HP[desertLevel];
      if (current.eastUnlocked && desertHp > 0 && nearDesertBase && desertHp < desertBaseMaxHp && current.resources.wood > 0) {
        return { ...current, resources: { ...current.resources, wood: current.resources.wood - 1 }, desertBaseHp: Math.min(desertBaseMaxHp, desertHp + 5) };
      }
      const snowLevel = current.snowBaseLevel ?? 1;
      const snowHp = current.snowBaseHp ?? BASE_MAX_HP[snowLevel];
      if (current.snowEntered && snowHp > 0 && nearSnowBase && snowHp < BASE_MAX_HP[snowLevel] && current.resources.ice > 0) {
        return { ...current, resources: { ...current.resources, ice: current.resources.ice - 1 }, snowBaseHp: Math.min(BASE_MAX_HP[snowLevel], snowHp + 5) };
      }
      return current;
      });
    }, RESOURCE_DEPOSIT_MS);
    return () => window.clearInterval(timer);
  }, [fenceBuilt, patchSave]);

  const worldPoint = (event: PointerEvent<HTMLElement>): Position | null => {
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: cameraLeft + (event.clientX - bounds.left) / bounds.width * visibleWorldWidth,
      y: cameraTop + (event.clientY - bounds.top) / bounds.height * visibleWorldHeight,
    };
  };
  const moveFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, textarea, .sgk-settings, .sgk-base-panel')) return;
    const bounds = worldRef.current?.getBoundingClientRect(); const point = worldPoint(event);
    if (!bounds || !point) return;
    const isJoystickZone = event.clientX < bounds.left + bounds.width * .32 && event.clientY > bounds.top + bounds.height * .58;
    if (isJoystickZone) {
      event.currentTarget.setPointerCapture(event.pointerId);
      joystickRef.current = { active: true, pointerId: event.pointerId, dx: 0, dy: 0 }; destinationRef.current = null;
      setJoystickVisual({ active: true, x: event.clientX - bounds.left, y: event.clientY - bounds.top, dx: 0, dy: 0 }); return;
    }
    destinationRef.current = point;
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!joystickRef.current.active || joystickRef.current.pointerId !== event.pointerId) return;
    const bounds = worldRef.current?.getBoundingClientRect(); if (!bounds) return;
    const rawX = event.clientX - bounds.left - joystickVisual.x; const rawY = event.clientY - bounds.top - joystickVisual.y;
    const radius = Math.max(38, Math.min(bounds.width, bounds.height) * .075); const length = Math.hypot(rawX, rawY); const scale = length > radius ? radius / length : 1;
    const dx = rawX * scale / radius; const dy = rawY * scale / radius;
    joystickRef.current = { ...joystickRef.current, dx, dy }; setJoystickVisual((current) => ({ ...current, dx: rawX * scale, dy: rawY * scale }));
  };
  const endJoystick = (event: PointerEvent<HTMLDivElement>) => {
    if (joystickRef.current.pointerId !== event.pointerId) return;
    joystickRef.current = { active: false, pointerId: -1, dx: 0, dy: 0 }; setJoystickVisual((current) => ({ ...current, active: false, dx: 0, dy: 0 }));
  };

  const updateResource = (type: ResourceType, value: number) => patchSave((current) => ({ ...current, resources: { ...current.resources, [type]: Math.max(0, Math.floor(value || 0)) } }));
  const applyJson = () => { try { const parsed = parseSaveJson(jsonDraft); setSave(parsed); setSettingsMessage('JSON을 게임에 적용했습니다.'); } catch (error) { setSettingsMessage(error instanceof Error ? error.message : 'JSON 형식을 확인하세요.'); } };
  const reloadStorage = () => { const loaded = loadSave(); setSave(loaded); setJsonDraft(JSON.stringify(loaded, null, 2)); setSettingsMessage('localStorage의 최신 값을 불러왔습니다.'); };
  const reset = () => {
    clearSave(); const initial = createInitialSave(); saveRef.current = initial; setSave(initial); setJsonDraft(JSON.stringify(initial, null, 2));
    positionRef.current = { ...PLAYER_START_POINT }; destinationRef.current = null; bladeHitTimesRef.current.clear(); setPosition(positionRef.current); nodesRef.current = cloneNodes(); setNodes(nodesRef.current); mobsRef.current = cloneMobs(); setMobs(mobsRef.current); setNotice('진행을 초기화했습니다.');
  };
  const restartMeadow = () => {
    patchSave((current) => ({ ...current, baseHp: BASE_MAX_HP[current.baseLevel] }));
    positionRef.current = { ...PLAYER_START_POINT };
    destinationRef.current = null;
    setPosition(positionRef.current);
    mobsRef.current = cloneMobs();
    setMobs(mobsRef.current);
    setNotice('초원 기지를 복구하고 다시 시작합니다.');
  };
  const restartDesert = () => {
    patchSave((current) => ({ ...current, desertBaseHp: BASE_MAX_HP[current.desertBaseLevel ?? 1] }));
    positionRef.current = { x: MAP_BASE_POINTS[2].x, y: MAP_BASE_POINTS[2].y - 340 };
    destinationRef.current = null;
    setPosition(positionRef.current);
    mobsRef.current = cloneMobs();
    setMobs(mobsRef.current);
    setNotice('사막 기지를 복구하고 다시 시작합니다.');
  };
  const restartSnow = () => {
    patchSave((current) => ({ ...current, snowBaseHp: BASE_MAX_HP[current.snowBaseLevel ?? 1] }));
    positionRef.current = { x: MAP_BASE_POINTS[3].x, y: MAP_BASE_POINTS[3].y - 340 };
    destinationRef.current = null; setPosition(positionRef.current);
    mobsRef.current = cloneMobs(); setMobs(mobsRef.current);
    setNotice('설원 기지를 복구하고 다시 시작합니다.');
  };

  const woodBundleCount = Math.floor(save.resources.wood / WOOD_PER_BUNDLE);
  const looseWoodCount = save.resources.wood % WOOD_PER_BUNDLE;
  const stageScale = viewportSize.height / MAP_REFERENCE_SIZE;
  stageScaleRef.current = stageScale;
  const visibleWorldWidth = viewportSize.width / (stageScale * CAMERA_ZOOM);
  const visibleWorldHeight = viewportSize.height / (stageScale * CAMERA_ZOOM);
  const cameraLeft = Math.max(0, Math.min(WORLD_WIDTH - visibleWorldWidth, position.x - visibleWorldWidth / 2));
  const cameraTop = Math.max(0, Math.min(WORLD_HEIGHT - visibleWorldHeight, position.y - visibleWorldHeight / 2));
  const fencePoint = BASE_BUILD_POINT;
  const activeDeposit = !fenceBuilt && save.resources.wood > 0 && distance(position, fencePoint) < BASE_INTERACTION_RADIUS
    ? { point: fencePoint, type: 'wood' as const }
    : fenceBuilt && save.bladeCount >= 4 && save.baseLevel < 2 && distance(position, BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS
      ? save.baseUpgradeWood < BASE_LEVEL_2_COST.wood && save.resources.wood > 0
        ? { point: BASE_UPGRADE_PAD, type: 'wood' as const }
        : save.baseUpgradeShell < BASE_LEVEL_2_COST.shell && save.resources.shell > 0
          ? { point: BASE_UPGRADE_PAD, type: 'shell' as const }
          : null
    : save.baseLevel === 2 && distance(position, BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS
      ? save.base3Wood < BASE_LEVEL_3_COST.wood && save.resources.wood > 0
        ? { point: BASE_UPGRADE_PAD, type: 'wood' as const }
        : save.base3Shell < BASE_LEVEL_3_COST.shell && save.resources.shell > 0
            ? { point: BASE_UPGRADE_PAD, type: 'shell' as const }
            : null
    : fenceBuilt && save.bladeCount < 8 && distance(position, BLADE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS
      ? (() => {
          const cost = BLADE_COSTS[save.bladeCount];
          if (save.bladeSlotProgress < cost.wood && save.resources.wood > 0) return { point: BLADE_UPGRADE_PAD, type: 'wood' as const };
          if (save.bladeShellProgress < cost.shell && save.resources.shell > 0) return { point: BLADE_UPGRADE_PAD, type: 'shell' as const };
          return null;
        })()
      : fenceBuilt && !save.unlockedBladeIds.includes('moonseong') && save.resources.wood > 0 && distance(position, PEDESTALS.moonseong) < STATION_INTERACTION_RADIUS
        ? { point: PEDESTALS.moonseong, type: 'wood' as const }
        : fenceBuilt && !save.unlockedBladeIds.includes('seongun') && save.resources.stone > 0 && distance(position, PEDESTALS.seongun) < STATION_INTERACTION_RADIUS
          ? { point: PEDESTALS.seongun, type: 'stone' as const }
          : !save.eastUnlocked && distance(position, EAST_UNLOCK_PAD) < GATE_INTERACTION_RADIUS
            ? save.eastUnlockWood < EAST_UNLOCK_COST.wood && save.resources.wood > 0
              ? { point: EAST_UNLOCK_PAD, type: 'wood' as const }
              : save.eastUnlockLog < EAST_UNLOCK_COST.log && save.resources.log > 0
                ? { point: EAST_UNLOCK_PAD, type: 'log' as const }
                : null
            : null;

  const currentBase = currentMap === 1
    ? { name: '초원 기지', level: save.baseLevel, hp: save.baseHp, defense: BASE_DEFENSE[save.baseLevel] }
    : currentMap === 2
      ? { name: '사막 기지', level: safeDesertBaseLevel, hp: safeDesertBaseHp, defense: BASE_DEFENSE[safeDesertBaseLevel] }
      : save.snowUnlocked ? { name: '설원 기지', level: safeSnowBaseLevel, hp: safeSnowBaseHp, defense: BASE_DEFENSE[safeSnowBaseLevel] } : null;
  const pedestalEntries = Object.entries(PEDESTALS) as [Exclude<BladeId, 'basic'>, Position][];

  return <main className={`sgk-shell blade-${save.equippedBladeId}`}>
    <header className="sgk-header"><button type="button" className="sgk-exit" onClick={onExit ?? (() => history.back())}>← 허브</button><div><span className="sgk-kicker">GAME 07 · MVP</span><h1>빙글 채집왕</h1></div><button type="button" className="sgk-settings-button" onClick={() => { setSettingsOpen(true); setJsonDraft(JSON.stringify(save, null, 2)); }}>MVP 설정</button></header>
    <section className="sgk-hud"><div className="sgk-objective"><small>현재 목표</small><strong>{objective}</strong></div>{currentBase && <div className="sgk-base-hud"><small>{currentBase.name} · {currentBase.level}단계</small><strong>HP {currentBase.hp}/{BASE_MAX_HP[currentBase.level]}</strong><span>방어력 {Math.round(currentBase.defense * 100)}%</span><em><b style={{ width: `${currentBase.hp / BASE_MAX_HP[currentBase.level] * 100}%` }} /></em></div>}</section>
    <section className="sgk-world-frame"><div ref={worldRef} className="sgk-world" onPointerDown={moveFromPointer} onPointerMove={pointerMove} onPointerUp={endJoystick} onPointerCancel={endJoystick} role="application" aria-label="빙글 채집왕 플레이 맵">
      <div className="sgk-item-count"><span><i className="wood-chip" />나무 <strong>{save.resources.wood}</strong></span><span><i className="log-chip" />단풍목 <strong>{save.resources.log}</strong></span><span><i className="stone-chip" />돌 <strong>{save.resources.stone}</strong></span><span><i className="shell-chip" />갑각 <strong>{save.resources.shell}</strong></span>{save.eastUnlocked && <span><i className="iron-chip" />철광석 <strong>{save.resources.iron}</strong></span>}{save.snowUnlocked && <><span><i className="ice-chip" />얼음 <strong>{save.resources.ice}</strong></span><span><i className="crystal-chip" />수정 <strong>{save.resources.crystal ?? 0}</strong></span></>}</div>
      {milestone && <div className="sgk-milestone">{milestone}</div>}
      <div className="sgk-stage" style={{ width: `${WORLD_WIDTH * stageScale}px`, height: `${WORLD_HEIGHT * stageScale}px`, transform: `translate(${-cameraLeft * stageScale * CAMERA_ZOOM}px, ${-cameraTop * stageScale * CAMERA_ZOOM}px) scale(${CAMERA_ZOOM})` }}>
      <div className="sgk-map1" />
      <div className="sgk-map2" />
      <div className="sgk-map3" />
      <div className="sgk-zone-label forest">맵 1 · 초원<small>나무 → 나무 · 단풍나무 → 단풍목</small></div>
      <div className="sgk-zone-label desert">맵 2 · 사막<small>선인장 → 나무 · 바위 → 돌 · 철광 바위 → 철광석</small></div>
      <div className="sgk-zone-label snowfield">맵 3 · 설원<small>얼음 기둥 → 얼음 · 수정 기둥 → 수정</small></div>
      <div className={`sgk-east-lock ${save.eastUnlocked ? 'open' : ''}`} style={{ left: `${EAST_GATE_X / WORLD_WIDTH * 100}%` }} />
      <div className={`sgk-east-gate ${save.eastUnlocked ? 'open' : ''}`} style={{ left: `${EAST_GATE_X / WORLD_WIDTH * 100}%` }} />
      {!save.eastUnlocked && <div className="east-unlock-pad" style={{ left: `${EAST_UNLOCK_PAD.x / WORLD_WIDTH * 100}%`, top: `${EAST_UNLOCK_PAD.y / WORLD_HEIGHT * 100}%`, '--build-progress': `${(save.eastUnlockWood + save.eastUnlockLog) / (EAST_UNLOCK_COST.wood + EAST_UNLOCK_COST.log) * 100}%` } as React.CSSProperties}><i>→</i><strong>사막 맵 개방</strong><small>나무 {save.eastUnlockWood}/200 · 단풍목 {save.eastUnlockLog}/100</small></div>}
      <div className={`sgk-east-lock snow-lock ${save.snowUnlocked ? 'open' : ''}`} style={{ left: `${SNOW_GATE_X / WORLD_WIDTH * 100}%` }} />
      <div className={`sgk-east-gate snow-gate ${save.snowUnlocked ? 'open' : ''}`} style={{ left: `${SNOW_GATE_X / WORLD_WIDTH * 100}%` }} />
      {save.eastUnlocked && !save.snowUnlocked && <div className="east-unlock-pad snow-unlock-pad" style={{ left: `${SNOW_UNLOCK_PAD.x / WORLD_WIDTH * 100}%`, top: `${SNOW_UNLOCK_PAD.y / WORLD_HEIGHT * 100}%`, '--build-progress': `${((save.snowUnlockStone ?? 0) + (save.snowUnlockIron ?? 0)) / (SNOW_UNLOCK_COST.stone + SNOW_UNLOCK_COST.iron) * 100}%` } as React.CSSProperties}><i>❄</i><strong>설원 맵 개방</strong><small>돌 {save.snowUnlockStone ?? 0}/200 · 철광석 {save.snowUnlockIron ?? 0}/100</small></div>}
      <div className={`sgk-safe-zone base-level-${save.baseLevel} ${fenceBuilt ? 'built' : ''}`} aria-label={save.baseLevel === 3 ? '초원 갑각 목책 기지' : `초원 기지 ${save.baseLevel}단계`} style={{ left: `${BASE_BUILD_POINT.x / WORLD_WIDTH * 100}%`, top: `${BASE_BUILD_POINT.y / WORLD_HEIGHT * 100}%`, '--fence-progress': `${save.fenceWood / FENCE_WOOD_COST * 100}%` } as React.CSSProperties}><span className="fence top" /><span className="fence left" /><span className="fence right" /></div>
      <div className="base-vitals" style={{ left: `${BASE_BUILD_POINT.x / WORLD_WIDTH * 100}%`, top: `${BASE_BUILD_POINT.y / WORLD_HEIGHT * 100}%` }}><strong>초원 기지 {save.baseLevel}단계 · HP {save.baseHp}/{BASE_MAX_HP[save.baseLevel]}</strong><small>방어력 {Math.round(BASE_DEFENSE[save.baseLevel] * 100)}% · 기지 안에서 나무로 자동 수리</small><span><b style={{ width: `${save.baseHp / BASE_MAX_HP[save.baseLevel] * 100}%` }} /></span></div>
      {save.eastUnlocked && <><div className={`sgk-safe-zone desert-base base-level-${safeDesertBaseLevel} built`} aria-label={`사막 기지 ${safeDesertBaseLevel}단계`} style={{ left: `${MAP_BASE_POINTS[2].x / WORLD_WIDTH * 100}%`, top: `${MAP_BASE_POINTS[2].y / WORLD_HEIGHT * 100}%` }} /><div className="base-vitals desert-vitals" style={{ left: `${MAP_BASE_POINTS[2].x / WORLD_WIDTH * 100}%`, top: `${MAP_BASE_POINTS[2].y / WORLD_HEIGHT * 100}%` }}><strong>사막 기지 {safeDesertBaseLevel}단계 · HP {safeDesertBaseHp}/{BASE_MAX_HP[safeDesertBaseLevel]}</strong><small>방어력 {Math.round(BASE_DEFENSE[safeDesertBaseLevel] * 100)}% · 나무로 자동 수리</small><span><b style={{ width: `${safeDesertBaseHp / BASE_MAX_HP[safeDesertBaseLevel] * 100}%` }} /></span></div></>}
      {save.snowUnlocked && <div className={`sgk-safe-zone snow-base base-level-${safeSnowBaseLevel} built`} aria-label={`설원 기지 ${safeSnowBaseLevel}단계`} style={{ left: `${MAP_BASE_POINTS[3].x / WORLD_WIDTH * 100}%`, top: `${MAP_BASE_POINTS[3].y / WORLD_HEIGHT * 100}%` }} />}
      {nodes.map((node) => <div key={node.id} className={`sgk-node ${node.type} ${node.variant ?? ''} ${(node.x >= EAST_GATE_X && !save.eastUnlocked) || (node.x >= SNOW_GATE_X && !save.snowUnlocked) ? 'map2-locked' : ''} ${node.active ? '' : 'depleted'} ${hitNodeId === node.id ? 'hit' : ''}`} style={{ left: `${node.x / WORLD_WIDTH * 100}%`, top: `${node.y / WORLD_HEIGHT * 100}%` }}>{node.type === 'wood' ? <><i className="tree-crown" /><i className="tree-trunk" /></> : <i className="rock-body" />}{node.active && node.hp < node.maxHp && <span className="node-hp"><b style={{ width: `${node.hp / node.maxHp * 100}%` }} /></span>}{!node.active && <span className="respawn-mark">↻</span>}</div>)}
      {mobs.map((mob) => (mob.map === 1 || (mob.map === 2 && save.desertEntered) || (mob.map === 3 && save.snowEntered)) && <div key={mob.id} className={`sgk-mob ${mob.type} ${hitMobId === mob.id ? 'hit' : ''} ${mob.active ? '' : 'defeated'}`} style={{ left: `${mob.x / WORLD_WIDTH * 100}%`, top: `${mob.y / WORLD_HEIGHT * 100}%` }}>{mob.active && mob.hp < mob.maxHp && <span className="node-hp"><b style={{ width: `${mob.hp / mob.maxHp * 100}%` }} /></span>}</div>)}
      {mobImpact && <div key={`mob-impact-${mobImpact.id}`} className={`mob-impact ${mobImpact.defeated ? 'finisher' : ''}`} style={{ left: `${mobImpact.x / WORLD_WIDTH * 100}%`, top: `${mobImpact.y / WORLD_HEIGHT * 100}%` }}><i>✦</i><b>{mobImpact.defeated ? '퇴치!' : '-1'}</b></div>}
      {hitBurst && <div key={`blade-burst-${hitBurst.id}`} className={`blade-burst ${hitBurst.blade}`} style={{ left: `${hitBurst.x / WORLD_WIDTH * 100}%`, top: `${hitBurst.y / WORLD_HEIGHT * 100}%` }}>{hitBurst.blade === 'seongun' ? '✦' : hitBurst.blade === 'moonseong' ? '☾' : '✧'}</div>}
      {fenceBuilt && save.bladeCount >= 4 && save.baseLevel < 3 && (() => { const upgradingThird = save.baseLevel === 2; const progress = upgradingThird ? (save.base3Wood + save.base3Shell) / (BASE_LEVEL_3_COST.wood + BASE_LEVEL_3_COST.shell) : (save.baseUpgradeWood + save.baseUpgradeShell) / (BASE_LEVEL_2_COST.wood + BASE_LEVEL_2_COST.shell); const nearby = distance(position, BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS; return <div className={`base-upgrade-pad station-pad ${nearby ? 'nearby' : ''}`} style={{ left: `${BASE_UPGRADE_PAD.x / WORLD_WIDTH * 100}%`, top: `${BASE_UPGRADE_PAD.y / WORLD_HEIGHT * 100}%`, '--build-progress': `${progress * 100}%` } as React.CSSProperties}><i>⌂</i><strong>{`초원 기지 ${save.baseLevel + 1}단계`}</strong><small>{upgradingThird ? `나무 ${save.base3Wood}/${BASE_LEVEL_3_COST.wood} · 갑각 ${save.base3Shell}/${BASE_LEVEL_3_COST.shell}` : `나무 ${save.baseUpgradeWood}/${BASE_LEVEL_2_COST.wood} · 갑각 ${save.baseUpgradeShell}/${BASE_LEVEL_2_COST.shell}`}</small></div>; })()}
      {fenceBuilt && save.baseLevel >= 3 && <div className="base-upgrade-pad station-pad compact-station complete" style={{ left: `${BASE_UPGRADE_PAD.x / WORLD_WIDTH * 100}%`, top: `${BASE_UPGRADE_PAD.y / WORLD_HEIGHT * 100}%`, '--build-progress': '100%' } as React.CSSProperties}><i>⌂</i><strong>초원 기지 3단계</strong><small>최종 강화 완료</small></div>}
      {save.eastUnlocked && safeDesertBaseLevel < 3 && (() => { const third = safeDesertBaseLevel === 2; const wood2 = save.desertBase2Wood ?? 0; const stone2 = save.desertBase2Stone ?? 0; const wood3 = save.desertBase3Wood ?? 0; const iron3 = save.desertBase3Iron ?? 0; const total = third ? DESERT_BASE_LEVEL_3_COST.wood + DESERT_BASE_LEVEL_3_COST.iron : DESERT_BASE_LEVEL_2_COST.wood + DESERT_BASE_LEVEL_2_COST.stone; const progress = third ? wood3 + iron3 : wood2 + stone2; const nearby = distance(position, DESERT_BASE_UPGRADE_PAD) < STATION_INTERACTION_RADIUS; return <div className={`base-upgrade-pad desert-upgrade station-pad ${nearby ? 'nearby' : ''}`} style={{ left: `${DESERT_BASE_UPGRADE_PAD.x / WORLD_WIDTH * 100}%`, top: `${DESERT_BASE_UPGRADE_PAD.y / WORLD_HEIGHT * 100}%`, '--build-progress': `${progress / total * 100}%` } as React.CSSProperties}><i>⌂</i><strong>{`사막 기지 ${safeDesertBaseLevel + 1}단계`}</strong><small>{third ? `나무 ${wood3}/80 · 철광석 ${iron3}/30` : `나무 ${wood2}/40 · 돌 ${stone2}/20`}</small></div>; })()}
      {([1, 2, 3] as const).map((map) => {
        if ((map === 2 && !save.eastUnlocked) || (map === 3 && !save.snowUnlocked) || (map === 1 && !fenceBuilt)) return null;
        const primary = map === 1 ? save.meadowTurretWood ?? 0 : map === 2 ? save.desertTurretStone ?? 0 : save.snowTurretIce ?? 0;
        const rare = map === 1 ? save.meadowTurretShell ?? 0 : map === 2 ? save.desertTurretIron ?? 0 : save.snowTurretCrystal ?? 0;
        const installed = primary >= 50 && rare >= 20;
        const labels = map === 1 ? ['나무', '갑각'] : map === 2 ? ['돌', '철광석'] : ['얼음', '수정'];
        const nearby = distance(position, TURRET_PADS[map]) < STATION_INTERACTION_RADIUS;
        if (installed) return <div key={`turret-${map}`} className={`sgk-turret ${nearby ? 'nearby' : ''}`} aria-label={`${map}번 맵 자동 방어 포탑`} style={{ left: `${TURRET_PADS[map].x / WORLD_WIDTH * 100}%`, top: `${TURRET_PADS[map].y / WORLD_HEIGHT * 100}%` }}><i /><small>자동 방어 중</small></div>;
        return <div key={`turret-${map}`} className={`turret-pad station-pad ${nearby ? 'nearby' : ''}`} style={{ left: `${TURRET_PADS[map].x / WORLD_WIDTH * 100}%`, top: `${TURRET_PADS[map].y / WORLD_HEIGHT * 100}%`, '--build-progress': `${(primary + rare) / 70 * 100}%` } as React.CSSProperties}><i>⌁</i><strong>포탑 설치</strong><small>{`${labels[0]} ${primary}/50 · ${labels[1]} ${rare}/20`}</small></div>;
      })}
      {fenceBuilt && availableMaps(save).map((map) => { const point = mapPoint(BLADE_UPGRADE_PAD, map); const cost = save.bladeCount < 8 ? BLADE_COSTS[save.bladeCount] : null; const totalProgress = cost ? save.bladeSlotProgress + save.bladeShellProgress : 1; const totalCost = cost ? cost.wood + cost.shell : 1; const nearby = distance(position, point) < STATION_INTERACTION_RADIUS; return <div key={`blade-count-${map}`} className={`blade-upgrade-pad station-pad compact-station ${nearby ? 'nearby' : ''} ${save.bladeCount >= 8 ? 'complete' : ''}`} style={{ left: `${point.x / WORLD_WIDTH * 100}%`, top: `${point.y / WORLD_HEIGHT * 100}%`, '--build-progress': save.bladeCount >= 8 ? '100%' : `${totalProgress / totalCost * 100}%` } as React.CSSProperties}><i>✦</i><strong>칼날 {save.bladeCount}개</strong><small>{!cost ? '최대 확장' : cost.shell > 0 ? `나무 ${save.bladeSlotProgress}/${cost.wood} · 갑각 ${save.bladeShellProgress}/${cost.shell}` : `나무 ${save.bladeSlotProgress}/${cost.wood}`}</small></div>; })}
      {fenceBuilt && availableMaps(save).flatMap((map) => pedestalEntries.map(([blade, sourcePoint]) => { const point = mapPoint(sourcePoint, map); const unlocked = save.unlockedBladeIds.includes(blade); const equipped = save.equippedBladeId === blade; const progress = blade === 'moonseong' ? save.moonseongProgress : save.seongunProgress; const cost = blade === 'moonseong' ? 70 : 50; const changing = equipTarget === blade; const ringProgress = unlocked ? changing ? equipProgress * 100 : equipped ? 100 : 0 : progress / cost * 100; const nearby = distance(position, point) < STATION_INTERACTION_RADIUS; const remaining = Math.max(0, 3 - equipProgress * 3).toFixed(1); return <div key={`${blade}-${map}`} className={`blade-pedestal station-pad compact-station ${blade} ${nearby ? 'nearby interacting' : ''} ${unlocked ? 'unlocked' : 'locked'} ${equipped ? 'equipped' : ''}`} style={{ left: `${point.x / WORLD_WIDTH * 100}%`, top: `${point.y / WORLD_HEIGHT * 100}%`, '--build-progress': `${ringProgress}%` } as React.CSSProperties}><i>{blade === 'moonseong' ? '☾' : '✦'}</i><strong>{BLADE_LABELS[blade]}</strong><small>{equipped ? '현재 장착' : unlocked ? changing ? `변경 중 · ${remaining}초` : '3초 유지하여 변경' : `${blade === 'moonseong' ? '나무' : '돌'} ${progress}/${cost}`}</small></div>; }))}
      {activeDeposit && <div className={`resource-stream ${activeDeposit.type}`} style={{ left: `${activeDeposit.point.x / WORLD_WIDTH * 100}%`, top: `${activeDeposit.point.y / WORLD_HEIGHT * 100}%` }}><i /><i /><i /></div>}
      {turretShots.map((shot) => <div key={shot.id} className="turret-shot" style={{ left: `${shot.from.x / WORLD_WIDTH * 100}%`, top: `${shot.from.y / WORLD_HEIGHT * 100}%`, '--shot-x': `${(shot.to.x - shot.from.x) * stageScale}px`, '--shot-y': `${(shot.to.y - shot.from.y) * stageScale}px` } as React.CSSProperties}><i /></div>)}
      <div className="sgk-player" data-blade-count={save.bladeCount} style={{ left: `${position.x / WORLD_WIDTH * 100}%`, top: `${position.y / WORLD_HEIGHT * 100}%` }}><div className="blade-orbit">{Array.from({ length: save.bladeCount }, (_, index) => <span key={index} style={{ '--angle': `${index * 360 / save.bladeCount}deg` } as React.CSSProperties}><i /></span>)}</div><div className="player-shadow" /><div className="player-body"><i /><b>채집왕</b></div>{woodBundleCount > 0 && <div className="carried-bundles" aria-label={`목재 ${WOOD_PER_BUNDLE}개 묶음 ${woodBundleCount}개`}>{Array.from({ length: Math.min(woodBundleCount, 3) }, (_, index) => <i key={index} />)}{woodBundleCount > 3 && <b>×{woodBundleCount}</b>}</div>}{looseWoodCount > 0 && <div className="carried-wood" aria-label={`낱개 목재 ${looseWoodCount}개`}>{Array.from({ length: looseWoodCount }, (_, index) => <i key={index} />)}</div>}</div>
      </div>
      <div className="joystick-hint">이곳을 드래그</div>{joystickVisual.active && <div className="floating-stick" style={{ left: joystickVisual.x, top: joystickVisual.y }}><i style={{ transform: `translate(${joystickVisual.dx}px, ${joystickVisual.dy}px)` }} /></div>}
      {baseDefeated && <div className="sgk-game-over"><div><span>기지 파괴</span><h2>{currentMap === 3 ? '설원 방어 실패' : currentMap === 2 ? '사막 방어 실패' : '초원 방어 실패'}</h2><p>현재 맵의 기지 HP가 모두 소진되었습니다.</p><button type="button" onClick={currentMap === 3 ? restartSnow : currentMap === 2 ? restartDesert : restartMeadow}>{currentMap === 3 ? '설원 다시 시작' : currentMap === 2 ? '사막 다시 시작' : '초원 다시 시작'}</button></div></div>}
    </div></section>
    <footer className="sgk-footer"><p>{notice}</p><span>왼쪽 아래 드래그 또는 화면 클릭 이동 · WASD·방향키 지원</span></footer>
    {settingsOpen && <div className="sgk-settings-backdrop" onPointerDown={() => setSettingsOpen(false)}><section className="sgk-settings" onPointerDown={(event) => event.stopPropagation()}><header><div><small>MVP TEST PANEL</small><h2>진행 상태 수동 설정</h2></div><button type="button" onClick={() => setSettingsOpen(false)}>닫기</button></header><div className="settings-grid"><label>나무 수량<input type="number" min="0" value={save.resources.wood} onChange={(event) => updateResource('wood', Number(event.target.value))} /></label><label>돌 수량<input type="number" min="0" value={save.resources.stone} onChange={(event) => updateResource('stone', Number(event.target.value))} /></label><label>철광석 수량<input type="number" min="0" value={save.resources.iron} onChange={(event) => updateResource('iron', Number(event.target.value))} /></label><fieldset><legend>칼날 수</legend>{([1, 2, 3, 4, 5, 6, 7, 8] as const).map((count) => <button key={count} type="button" className={save.bladeCount === count ? 'selected' : ''} onClick={() => patchSave((current) => ({ ...current, bladeCount: count }))}>{count}</button>)}</fieldset><fieldset><legend>칼 등급</legend>{(['basic', 'moonseong', 'seongun'] as BladeId[]).map((blade) => <button key={blade} type="button" className={save.equippedBladeId === blade ? 'selected' : ''} onClick={() => patchSave((current) => ({ ...current, equippedBladeId: blade }))}>{BLADE_LABELS[blade]}</button>)}</fieldset></div><label className="json-editor">저장 JSON<textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} /></label>{settingsMessage && <p className="settings-message">{settingsMessage}</p>}<div className="settings-actions"><button type="button" onClick={() => setJsonDraft(JSON.stringify(save, null, 2))}>현재값 보기</button><button type="button" onClick={applyJson}>JSON 적용</button><button type="button" onClick={reloadStorage}>저장값 다시 불러오기</button><button type="button" className="danger" onClick={reset}>진행 초기화</button></div></section></div>}
  </main>;
}
