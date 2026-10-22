import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAVE_KEY,
  clearSave,
  createInitialSave,
  loadSave,
  normalizeSave,
  parseSaveJson,
  saveGame,
} from '../../spin-gather-king/src/save.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const installWindow = () => {
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  return localStorage;
};

test('최초 저장 데이터는 플레이 가능한 기본 상태를 제공한다', () => {
  const save = createInitialSave();

  assert.equal(save.schemaVersion, 1);
  assert.equal(save.revision, 0);
  assert.equal(save.bladeCount, 1);
  assert.equal(save.equippedBladeId, 'basic');
  assert.deepEqual(save.unlockedBladeIds, ['basic']);
  assert.ok(Object.values(save.resources).every((count) => count === 0));
});

test('손상되거나 범위를 벗어난 수치는 안전한 범위로 보정한다', () => {
  const save = normalizeSave({
    resources: { wood: -10, stone: 12.9, iron: '7', ice: Number.POSITIVE_INFINITY },
    bladeCount: 99,
    fenceWood: 100,
    baseHp: 9999,
    baseUpgradeWood: -1,
    turretLevel: 0,
  });

  assert.equal(save.resources.wood, 0);
  assert.equal(save.resources.stone, 12);
  assert.equal(save.resources.iron, 7);
  assert.equal(save.resources.ice, 0);
  assert.equal(save.bladeCount, 5);
  assert.equal(save.fenceWood, 12);
  assert.equal(save.baseLevel, 1);
  assert.equal(save.baseHp, 200);
  assert.equal(save.baseUpgradeWood, 0);
  assert.equal(save.turretLevel, 1);
});

test('구버전 사막 관문 돌 진행도를 단풍나무 진행도로 이관한다', () => {
  const save = normalizeSave({
    eastUnlockWood: 200,
    eastUnlockStone: 100,
  });

  assert.equal(save.eastUnlockLog, 100);
  assert.equal(save.eastUnlocked, true);
});

test('설산과 폭풍 지대는 재료 조건을 충족하면 해금 상태를 복원한다', () => {
  const save = normalizeSave({
    snowUnlockStone: 200,
    snowUnlockIron: 100,
    stormUnlockCrystal: 200,
    stormUnlockOil: 100,
  });

  assert.equal(save.snowUnlocked, true);
  assert.equal(save.stormUnlocked, true);
});

test('알 수 없는 칼날은 제거하고 기본 칼날을 항상 유지한다', () => {
  const save = normalizeSave({
    equippedBladeId: 'unknown',
    unlockedBladeIds: ['hwarak', 'hwarak', 'unknown'],
  });

  assert.equal(save.equippedBladeId, 'basic');
  assert.deepEqual(save.unlockedBladeIds, ['basic', 'hwarak']);
});

test('JSON 가져오기는 유효한 저장을 정규화하고 잘못된 JSON을 거부한다', () => {
  const save = parseSaveJson(JSON.stringify({ resources: { wood: 15 } }));

  assert.equal(save.resources.wood, 15);
  assert.throws(() => parseSaveJson('{broken'), SyntaxError);
  assert.throws(() => parseSaveJson('null'), /객체 형식/);
});

test('저장할 때 revision을 증가시키고 다시 불러올 수 있다', () => {
  const localStorage = installWindow();
  const initial = createInitialSave();
  initial.resources.wood = 23;

  const saved = saveGame(initial);
  const loaded = loadSave();

  assert.equal(saved.revision, 1);
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.resources.wood, 23);
  assert.ok(localStorage.getItem(SAVE_KEY));
});

test('손상된 로컬 저장은 초기 상태로 복구하고 삭제할 수 있다', () => {
  const localStorage = installWindow();
  localStorage.setItem(SAVE_KEY, '{broken');

  assert.deepEqual(loadSave(), createInitialSave());

  clearSave();
  assert.equal(localStorage.getItem(SAVE_KEY), null);
});
