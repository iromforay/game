import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGate, gateLabel, representativeCount, swarmPenetration } from '../src/model.ts';

test('게이트 계산은 실제 숫자에 정확히 반영된다', () => {
  assert.equal(applyGate(700, { operation: 'add', value: 300 }), 1000);
  assert.equal(applyGate(700, { operation: 'multiply', value: 2 }), 1400);
  assert.equal(applyGate(700, { operation: 'subtract', value: 900 }), 0);
  assert.equal(applyGate(751, { operation: 'divide', value: 2 }), 375);
});

test('잡몹 관통력은 병력에 따라 증가하고 상한을 지킨다', () => {
  assert.equal(swarmPenetration(100), 3);
  assert.ok(swarmPenetration(1500) > swarmPenetration(100));
  assert.equal(swarmPenetration(100000), 12);
});

test('게이트 문구와 대표 병력 수는 큰 숫자에서도 안정적이다', () => {
  assert.equal(gateLabel({ operation: 'multiply', value: 3 }), '×3');
  assert.equal(representativeCount(0), 0);
  assert.ok(representativeCount(5000) <= 84);
  assert.ok(representativeCount(400) > representativeCount(100));
});
