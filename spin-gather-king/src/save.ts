export type ResourceType = 'wood' | 'log' | 'stone' | 'iron' | 'ice' | 'crystal' | 'oil' | 'lightning' | 'meat' | 'shell';
export type BladeId = 'basic' | 'moonseong' | 'hwarak' | 'seongun' | 'noegwang' | 'seolhwa';

export interface GameSave {
  schemaVersion: 1;
  revision: number;
  savedAt: string;
  resources: Record<ResourceType, number>;
  bladeCount: 1 | 2 | 3 | 4 | 5;
  baseLevel: 0 | 1 | 2 | 3;
  baseHp: number;
  equippedBladeId: BladeId;
  unlockedBladeIds: BladeId[];
  fenceWood: number;
  baseUpgradeWood: number;
  baseUpgradeStone: number;
  baseUpgradeShell: number;
  base3Wood: number;
  base3Stone: number;
  base3Ice: number;
  base3Shell: number;
  desertBaseLevel: 1 | 2 | 3;
  desertBaseHp: number;
  desertBase2Wood: number;
  desertBase2Stone: number;
  desertBase3Wood: number;
  desertBase3Iron: number;
  desertEntered: boolean;
  desertSpawnRuleVersion: number;
  snowUnlocked: boolean;
  snowEntered: boolean;
  snowUnlockStone: number;
  snowUnlockIron: number;
  snowBaseLevel: 1 | 2 | 3;
  snowBaseHp: number;
  meadowTurretWood: number;
  meadowTurretShell: number;
  desertTurretStone: number;
  desertTurretIron: number;
  snowTurretIce: number;
  snowTurretCrystal: number;
  turretLevel: 1 | 2 | 3;
  turretOilProgress: number;
  turretLightningProgress: number;
  stormUnlocked: boolean;
  stormUnlockCrystal: number;
  stormUnlockOil: number;
  eastUnlocked: boolean;
  eastUnlockWood: number;
  eastUnlockStone: number;
  eastUnlockLog: number;
  quarryWood: number;
  bladeSlotProgress: number;
  bladeStoneProgress: number;
  bladeShellProgress: number;
  moonseongProgress: number;
  seongunProgress: number;
  hwarakProgress: number;
  noegwangProgress: number;
  seolhwaProgress: number;
}

export const SAVE_KEY = 'spin-gather-king:save:v1';

export const createInitialSave = (): GameSave => ({
  schemaVersion: 1,
  revision: 0,
  savedAt: new Date(0).toISOString(),
  resources: { wood: 0, log: 0, stone: 0, iron: 0, ice: 0, crystal: 0, oil: 0, lightning: 0, meat: 0, shell: 0 },
  bladeCount: 1,
  baseLevel: 0,
  baseHp: 100,
  equippedBladeId: 'basic',
  unlockedBladeIds: ['basic'],
  fenceWood: 0,
  baseUpgradeWood: 0,
  baseUpgradeStone: 0,
  baseUpgradeShell: 0,
  base3Wood: 0,
  base3Stone: 0,
  base3Ice: 0,
  base3Shell: 0,
  desertBaseLevel: 1,
  desertBaseHp: 200,
  desertBase2Wood: 0,
  desertBase2Stone: 0,
  desertBase3Wood: 0,
  desertBase3Iron: 0,
  desertEntered: false,
  desertSpawnRuleVersion: 1,
  snowUnlocked: false,
  snowEntered: false,
  snowUnlockStone: 0,
  snowUnlockIron: 0,
  snowBaseLevel: 1,
  snowBaseHp: 200,
  meadowTurretWood: 0,
  meadowTurretShell: 0,
  desertTurretStone: 0,
  desertTurretIron: 0,
  snowTurretIce: 0,
  snowTurretCrystal: 0,
  turretLevel: 1,
  turretOilProgress: 0,
  turretLightningProgress: 0,
  stormUnlocked: false,
  stormUnlockCrystal: 0,
  stormUnlockOil: 0,
  eastUnlocked: false,
  eastUnlockWood: 0,
  eastUnlockStone: 0,
  eastUnlockLog: 0,
  quarryWood: 0,
  bladeSlotProgress: 0,
  bladeStoneProgress: 0,
  bladeShellProgress: 0,
  moonseongProgress: 0,
  seongunProgress: 0,
  hwarakProgress: 0,
  noegwangProgress: 0,
  seolhwaProgress: 0,
});

const asCount = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(0, Math.floor(number)));
};

const isBladeId = (value: unknown): value is BladeId => (
  value === 'basic' || value === 'moonseong' || value === 'hwarak' || value === 'seongun' || value === 'noegwang' || value === 'seolhwa'
);

export const normalizeSave = (value: unknown): GameSave => {
  if (!value || typeof value !== 'object') throw new Error('저장 데이터가 객체 형식이 아닙니다.');
  const source = value as Partial<GameSave>;
  const resources = source.resources && typeof source.resources === 'object' ? source.resources : { wood: 0, stone: 0 };
  const bladeCount = asCount(source.bladeCount, 5) || 1;
  const fenceWood = asCount(source.fenceWood, 12);
  const baseLevel = source.baseLevel === undefined ? (fenceWood >= 12 ? 1 : 0) : asCount(source.baseLevel, 3);
  const eastUnlockWood = asCount(source.eastUnlockWood, 200);
  const eastUnlockStone = asCount(source.eastUnlockStone, 100);
  // The desert gate originally consumed stone. Preserve that completed progress
  // after the meadow material was changed to maple wood.
  const eastUnlockLog = Math.max(
    asCount(source.eastUnlockLog, 100),
    asCount(source.eastUnlockStone, 100),
  );
  const baseMaxHp = baseLevel === 3 ? 500 : baseLevel === 2 ? 350 : baseLevel === 1 ? 200 : 100;
  const desertBaseLevel = Math.max(1, asCount(source.desertBaseLevel, 3)) as GameSave['desertBaseLevel'];
  const desertBaseMaxHp = desertBaseLevel === 3 ? 500 : desertBaseLevel === 2 ? 350 : 200;
  const snowBaseLevel = Math.max(1, asCount(source.snowBaseLevel, 3)) as GameSave['snowBaseLevel'];
  const snowBaseMaxHp = snowBaseLevel === 3 ? 500 : snowBaseLevel === 2 ? 350 : 200;
  const unlocked: BladeId[] = Array.isArray(source.unlockedBladeIds)
    ? source.unlockedBladeIds.filter(isBladeId)
    : ['basic'];
  if (!unlocked.includes('basic')) unlocked.unshift('basic');
  const equipped = isBladeId(source.equippedBladeId) ? source.equippedBladeId : 'basic';

  return {
    schemaVersion: 1,
    revision: asCount(source.revision),
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : new Date().toISOString(),
    resources: {
      wood: asCount((resources as Record<string, unknown>).wood),
      log: asCount((resources as Record<string, unknown>).log),
      stone: asCount((resources as Record<string, unknown>).stone),
      iron: asCount((resources as Record<string, unknown>).iron),
      ice: asCount((resources as Record<string, unknown>).ice),
      crystal: asCount((resources as Record<string, unknown>).crystal),
      oil: asCount((resources as Record<string, unknown>).oil),
      lightning: asCount((resources as Record<string, unknown>).lightning),
      meat: asCount((resources as Record<string, unknown>).meat),
      shell: asCount((resources as Record<string, unknown>).shell),
    },
    bladeCount: bladeCount as GameSave['bladeCount'],
    baseLevel: baseLevel as GameSave['baseLevel'],
    baseHp: source.baseHp === undefined ? baseMaxHp : asCount(source.baseHp, baseMaxHp),
    equippedBladeId: equipped,
    unlockedBladeIds: [...new Set(unlocked)],
    fenceWood,
    baseUpgradeWood: asCount(source.baseUpgradeWood, 40),
    baseUpgradeStone: asCount(source.baseUpgradeStone, 25),
    baseUpgradeShell: asCount(source.baseUpgradeShell, 15),
    base3Wood: asCount(source.base3Wood, 80),
    base3Stone: asCount(source.base3Stone, 60),
    base3Ice: asCount(source.base3Ice, 30),
    base3Shell: asCount(source.base3Shell, 35),
    desertBaseLevel,
    desertBaseHp: source.desertBaseHp === undefined ? desertBaseMaxHp : asCount(source.desertBaseHp, desertBaseMaxHp),
    desertBase2Wood: asCount(source.desertBase2Wood, 40),
    desertBase2Stone: asCount(source.desertBase2Stone, 20),
    desertBase3Wood: asCount(source.desertBase3Wood, 80),
    desertBase3Iron: asCount(source.desertBase3Iron, 30),
    desertEntered: source.desertEntered === true,
    desertSpawnRuleVersion: asCount(source.desertSpawnRuleVersion, 1),
    snowUnlocked: source.snowUnlocked === true || (asCount(source.snowUnlockStone, 200) >= 200 && asCount(source.snowUnlockIron, 100) >= 100),
    snowEntered: source.snowEntered === true,
    snowUnlockStone: asCount(source.snowUnlockStone, 200),
    snowUnlockIron: asCount(source.snowUnlockIron, 100),
    snowBaseLevel,
    snowBaseHp: source.snowBaseHp === undefined ? snowBaseMaxHp : asCount(source.snowBaseHp, snowBaseMaxHp),
    meadowTurretWood: asCount(source.meadowTurretWood, 50),
    meadowTurretShell: asCount(source.meadowTurretShell, 20),
    desertTurretStone: asCount(source.desertTurretStone, 50),
    desertTurretIron: asCount(source.desertTurretIron, 20),
    snowTurretIce: asCount(source.snowTurretIce, 50),
    snowTurretCrystal: asCount(source.snowTurretCrystal, 20),
    turretLevel: Math.max(1, asCount(source.turretLevel, 3)) as GameSave['turretLevel'],
    turretOilProgress: asCount(source.turretOilProgress, 30),
    turretLightningProgress: asCount(source.turretLightningProgress, 30),
    stormUnlocked: source.stormUnlocked === true || (asCount(source.stormUnlockCrystal, 200) >= 200 && asCount(source.stormUnlockOil, 100) >= 100),
    stormUnlockCrystal: asCount(source.stormUnlockCrystal, 200),
    stormUnlockOil: asCount(source.stormUnlockOil, 100),
    eastUnlocked: source.eastUnlocked === true || (eastUnlockWood >= 200 && eastUnlockLog >= 100),
    eastUnlockWood,
    eastUnlockStone,
    eastUnlockLog,
    quarryWood: asCount(source.quarryWood, 18),
    bladeSlotProgress: asCount(source.bladeSlotProgress, 65),
    bladeStoneProgress: asCount(source.bladeStoneProgress, 35),
    bladeShellProgress: asCount(source.bladeShellProgress, 35),
    moonseongProgress: asCount(source.moonseongProgress, 70),
    seongunProgress: asCount(source.seongunProgress, 50),
    hwarakProgress: asCount(source.hwarakProgress, 50),
    noegwangProgress: asCount(source.noegwangProgress, 60),
    seolhwaProgress: asCount(source.seolhwaProgress, 50),
  };
};

export const loadSave = (): GameSave => {
  const raw = window.localStorage.getItem(SAVE_KEY);
  if (!raw) return createInitialSave();
  try {
    return normalizeSave(JSON.parse(raw));
  } catch {
    return createInitialSave();
  }
};

export const saveGame = (save: GameSave): GameSave => {
  const next = normalizeSave({
    ...save,
    revision: save.revision + 1,
    savedAt: new Date().toISOString(),
  });
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  return next;
};

export const parseSaveJson = (raw: string): GameSave => normalizeSave(JSON.parse(raw));

export const clearSave = () => window.localStorage.removeItem(SAVE_KEY);
