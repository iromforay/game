import assert from 'node:assert/strict';
import test from 'node:test';
import { canDefeat, choiceCountFor, createChoices, createScoreUpdate, toPublicChoice } from './engine.ts';

test('용사 숫자가 적보다 클 때만 승리한다', () => {
  assert.equal(canDefeat(10, 9), true);
  assert.equal(canDefeat(10, 10), false);
  assert.equal(canDefeat(10, 11), false);
});

test('현재 합산 점수를 중간 기록으로 만든다', () => {
  assert.deepEqual(createScoreUpdate(31, 3), { stageId: 1, currentScore: 31, floorsCleared: 3, cleared: false });
});

test('경로 뱃지는 약속된 선택 범위를 지킨다', () => {
  for (let i = 0; i < 100; i += 1) {
    assert.ok([2, 3].includes(choiceCountFor('wide', `w-${i}`)));
    assert.ok([1, 2].includes(choiceCountFor('tight', `t-${i}`)));
    assert.ok([1, 2, 3].includes(choiceCountFor('general', `g-${i}`)));
  }
});

test('선택 화면 데이터에는 보상과 실제 선택지 수가 없다', () => {
  const visible = toPublicChoice(createChoices(1, 'root', 3)[0]);
  assert.equal('reward' in visible, false);
  assert.equal('nextChoiceCount' in visible, false);
});

test('같은 경로는 같은 탑을 만든다', () => {
  assert.deepEqual(createChoices(3, 'root-1', 3), createChoices(3, 'root-1', 3));
});
