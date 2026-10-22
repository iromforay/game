import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGate, gateLabel, representativeCount, swarmPenetration } from '../../number-gate-runner/src/model.ts';
import { RUNNER_CHAPTERS, RUNNER_STAGES, runnerStage } from '../../number-gate-runner/src/stages.ts';

test('사칙연산 게이트가 실제 병력에 정확히 반영된다', () => {
  assert.equal(applyGate(700, { operation: 'add', value: 300 }), 1000);
  assert.equal(applyGate(700, { operation: 'multiply', value: 2 }), 1400);
  assert.equal(applyGate(700, { operation: 'subtract', value: 900 }), 0);
  assert.equal(applyGate(751, { operation: 'divide', value: 2 }), 375);
});

test('게이트 문구는 연산 종류를 올바르게 표시한다', () => {
  assert.equal(gateLabel({ operation: 'add', value: 30 }), '+30');
  assert.equal(gateLabel({ operation: 'subtract', value: 5 }), '−5');
  assert.equal(gateLabel({ operation: 'multiply', value: 3 }), '×3');
  assert.equal(gateLabel({ operation: 'divide', value: 2 }), '÷2');
});

test('화면 대표 병력과 관통력은 상한을 지킨다', () => {
  assert.equal(representativeCount(0), 0);
  assert.ok(representativeCount(5000) <= 84);
  assert.equal(swarmPenetration(100000), 12);
});

test('두 챕터는 각각 10개의 고유 스테이지를 가진다', () => {
  assert.equal(RUNNER_CHAPTERS.length, 2);
  assert.equal(RUNNER_STAGES.length, 20);
  assert.equal(new Set(RUNNER_STAGES.map((stage) => stage.id)).size, 20);
  assert.equal(RUNNER_STAGES.filter((stage) => stage.chapter === 1).length, 10);
  assert.equal(RUNNER_STAGES.filter((stage) => stage.chapter === 2).length, 10);
});

test('스테이지가 진행될수록 시작 병력과 위협도가 증가한다', () => {
  for (const chapter of [1, 2] as const) {
    const stages = RUNNER_STAGES.filter((stage) => stage.chapter === chapter);
    assert.ok(stages.every((stage, index) => index === 0 || stage.startCount > stages[index - 1].startCount));
    assert.ok(stages.every((stage, index) => index === 0 || stage.threat > stages[index - 1].threat));
  }
});

test('챕터와 번호로 정확한 스테이지를 조회한다', () => {
  assert.equal(runnerStage(1, 1).id, 1);
  assert.equal(runnerStage(2, 10).id, 20);
  assert.equal(runnerStage(1, 999).id, 1);
});
