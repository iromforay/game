import assert from 'node:assert/strict';
import test from 'node:test';
import { ENEMY_DEFS, WAVES } from '../../tower-defense/src/config/enemies.ts';
import { MAX_TOWER_LEVEL, TOWER_DEFS, sellValue, statMultiplier, upgradeCost } from '../../tower-defense/src/config/towers.ts';

test('모든 타워는 전투에 필요한 양수 능력치를 가진다', () => {
  for (const tower of Object.values(TOWER_DEFS)) {
    assert.ok(tower.cost > 0, tower.id);
    assert.ok(tower.range > 0, tower.id);
    assert.ok(tower.damage > 0, tower.id);
    assert.ok(tower.fireRate > 0, tower.id);
    assert.ok(tower.projectileSpeed > 0, tower.id);
  }
});

test('특수 타워는 고유 효과 설정을 가진다', () => {
  assert.ok((TOWER_DEFS.splash.splashRadius ?? 0) > 0);
  assert.ok((TOWER_DEFS.storm.splashRadius ?? 0) > 0);
  assert.ok((TOWER_DEFS.slow.slowFactor ?? 1) > 0 && (TOWER_DEFS.slow.slowFactor ?? 1) < 1);
  assert.ok((TOWER_DEFS.slow.slowDuration ?? 0) > 0);
});

test('업그레이드는 능력치를 높이고 비용과 판매가를 일관되게 계산한다', () => {
  const tower = TOWER_DEFS.basic;
  assert.equal(MAX_TOWER_LEVEL, 2);
  assert.equal(statMultiplier(1), 1);
  assert.equal(statMultiplier(2), 1.6);
  assert.equal(upgradeCost(tower, 1), 40);
  assert.equal(sellValue(tower, 1), 30);
  assert.equal(sellValue(tower, 2), 54);
});

test('적 유형은 서로 다른 체력·속도 특성을 가진다', () => {
  assert.ok(ENEMY_DEFS.fast.speed > ENEMY_DEFS.grunt.speed);
  assert.ok(ENEMY_DEFS.tank.hp > ENEMY_DEFS.grunt.hp);
  assert.ok(ENEMY_DEFS.boss.hp > ENEMY_DEFS.tank.hp);
  assert.ok(Object.values(ENEMY_DEFS).every((enemy) => enemy.reward > 0));
});

test('최종 웨이브에는 보스가 정확히 한 마리 등장한다', () => {
  assert.equal(WAVES.length, 10);
  const bosses = WAVES.at(-1)!.groups.filter((group) => group.type === 'boss');
  assert.equal(bosses.length, 1);
  assert.equal(bosses[0].count, 1);
});
