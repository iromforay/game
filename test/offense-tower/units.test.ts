import assert from 'node:assert/strict';
import test from 'node:test';
import { UNIT_DEFS, damageMultiplier } from '../../offense-tower/src/config/units.ts';

test('공격 유닛은 체력·속도·보상·생성 대기시간이 모두 양수다', () => {
  for (const unit of Object.values(UNIT_DEFS)) {
    assert.ok(unit.hp > 0, unit.id);
    assert.ok(unit.speed > 0, unit.id);
    assert.ok(unit.reward > 0, unit.id);
    assert.ok(unit.spawnCooldown > 0, unit.id);
  }
});

test('각 유닛의 저항 타워와 약점 타워는 서로 다르다', () => {
  for (const unit of Object.values(UNIT_DEFS)) assert.notEqual(unit.resistantTo, unit.vulnerableTo, unit.id);
});

test('상성 피해 배율은 저항 0.5배, 약점 1.5배, 일반 1배다', () => {
  const swarm = UNIT_DEFS.swarm;
  assert.equal(damageMultiplier(swarm, swarm.resistantTo), 0.5);
  assert.equal(damageMultiplier(swarm, swarm.vulnerableTo), 1.5);
  assert.equal(damageMultiplier(swarm, 'slow'), 1);
});

test('물량·탱커·스피드 유닛의 역할별 특징이 유지된다', () => {
  assert.ok(UNIT_DEFS.tank.hp > UNIT_DEFS.swarm.hp);
  assert.ok(UNIT_DEFS.speed.speed > UNIT_DEFS.swarm.speed);
  assert.ok(UNIT_DEFS.swarm.spawnCooldown < UNIT_DEFS.tank.spawnCooldown);
});
