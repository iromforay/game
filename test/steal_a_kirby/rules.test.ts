import assert from 'node:assert/strict';
import test from 'node:test';
import { GRADES, getGrade } from '../../steal_a_kirby/src/config/grades.ts';
import { FLOOR_STAIRS, STAIR_INPUT_LOCK_MS, STAIR_MARKER_RADIUS, STAIR_TRIGGER_RADIUS } from '../../steal_a_kirby/src/config/stairs.ts';

test('커비 등급은 1부터 6까지 빠짐없이 존재한다', () => {
  assert.deepEqual(GRADES.map((grade) => grade.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(GRADES.map((grade) => grade.name)).size, GRADES.length);
});

test('등급이 높아질수록 구매가와 수익이 증가한다', () => {
  assert.ok(GRADES.every((grade, index) => index === 0 || grade.buyPrice > GRADES[index - 1].buyPrice));
  assert.ok(GRADES.every((grade, index) => index === 0 || grade.incomePerTick > GRADES[index - 1].incomePerTick));
});

test('판매가는 구매가보다 낮고 양수다', () => {
  assert.ok(GRADES.every((grade) => grade.sellPrice > 0 && grade.sellPrice < grade.buyPrice));
});

test('존재하는 등급을 조회하고 알 수 없는 등급은 거부한다', () => {
  assert.equal(getGrade(3).name, '레어');
  assert.throws(() => getGrade(999), /unknown gradeId/);
});

test('세 층의 계단은 서로 왕복 가능한 층으로 연결된다', () => {
  assert.deepEqual(Object.keys(FLOOR_STAIRS), ['1', '2', '3']);
  for (const [floorText, stairs] of Object.entries(FLOOR_STAIRS)) {
    const floor = Number(floorText);
    for (const stair of stairs) {
      assert.notEqual(stair.targetFloor, floor);
      assert.ok(FLOOR_STAIRS[stair.targetFloor].some((reverse) => reverse.targetFloor === floor && reverse.shaft === stair.shaft));
    }
  }
  assert.ok(STAIR_TRIGGER_RADIUS < STAIR_MARKER_RADIUS);
  assert.ok(STAIR_INPUT_LOCK_MS > 0);
});
