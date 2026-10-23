import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAINT_ZONES,
  REQUIRED_PAINTED_ZONES,
  DEFAULT_TUNING,
  TUNING_POINT_BUDGET,
  addPaintedZone,
  changeTuning,
  chooseUnpaintedZone,
  hasWon,
  resolveWeaponStats,
  spentTuningPoints,
  type PaintZone,
} from '../../color-blasters/src/gameLogic.ts';

test('같은 부위는 중복 도색되지 않는다', () => {
  const first = addPaintedZone(new Set<PaintZone>(), 'torso');
  const duplicate = addPaintedZone(first, 'torso');

  assert.equal(first.size, 1);
  assert.equal(duplicate.size, 1);
  assert.equal(duplicate, first);
});

test('무기 튜닝은 능력별 3단계와 총 6포인트를 넘지 않는다', () => {
  let tuning = { ...DEFAULT_TUNING };
  for (let index = 0; index < 5; index += 1) tuning = changeTuning(tuning, 'accuracy', 1);
  assert.equal(tuning.accuracy, 3);

  for (let index = 0; index < 5; index += 1) tuning = changeTuning(tuning, 'capacity', 1);
  assert.equal(spentTuningPoints(tuning), TUNING_POINT_BUDGET);
  assert.equal(changeTuning(tuning, 'fireRate', 1), tuning);
});

test('용량 튜닝은 최대 페인트량을 증가시킨다', () => {
  const base = resolveWeaponStats(DEFAULT_TUNING);
  const tuned = resolveWeaponStats({ ...DEFAULT_TUNING, capacity: 2 });
  assert.equal(tuned.maxPaint, base.maxPaint + 6);
});

test('페인트 러시는 서로 다른 네 부위를 칠하면 승리한다', () => {
  let painted: ReadonlySet<PaintZone> = new Set();
  for (const zone of PAINT_ZONES.slice(0, REQUIRED_PAINTED_ZONES - 1)) {
    painted = addPaintedZone(painted, zone);
  }
  assert.equal(hasWon(painted), false);

  painted = addPaintedZone(painted, PAINT_ZONES[REQUIRED_PAINTED_ZONES - 1]!);
  assert.equal(hasWon(painted), true);
});

test('AI는 우선 아직 칠하지 않은 부위를 선택한다', () => {
  const painted = new Set<PaintZone>(['head', 'torso', 'leftArm', 'rightArm', 'leftLeg']);
  assert.equal(chooseUnpaintedZone(painted, () => 0.5), 'rightLeg');
});
