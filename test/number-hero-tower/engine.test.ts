import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGES, canDefeat, choiceCountFor, createChoices, createScoreUpdate, toPublicChoice } from '../../number-hero-tower/src/game/engine.ts';

test('용사 숫자는 적 공격력보다 클 때만 승리한다', () => {
  assert.equal(canDefeat(10, 9), true);
  assert.equal(canDefeat(10, 10), false);
  assert.equal(canDefeat(10, 11), false);
});

test('같은 스테이지와 경로는 항상 같은 선택지를 만든다', () => {
  assert.deepEqual(createChoices(3, 'root-1', 3, STAGES[3]), createChoices(3, 'root-1', 3, STAGES[3]));
});

test('선택지는 공격력 오름차순이며 보상 범위를 지킨다', () => {
  const stage = STAGES[4];
  const choices = createChoices(4, 'route', 3, stage);
  assert.deepEqual(choices.map((choice) => choice.attack), [...choices].map((choice) => choice.attack).sort((a, b) => a - b));
  assert.ok(choices.every((choice) => choice.reward >= stage.rewardMin && choice.reward <= stage.rewardMax));
});

test('공개 선택지에는 숨은 보상과 다음 선택지 수가 없다', () => {
  const visible = toPublicChoice(createChoices(1, 'root', 1)[0]);
  assert.equal('reward' in visible, false);
  assert.equal('nextChoiceCount' in visible, false);
});

test('경로 폭별 선택지 개수 범위를 지킨다', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.ok([2, 3].includes(choiceCountFor('wide', `wide-${index}`)));
    assert.ok([1, 2].includes(choiceCountFor('tight', `tight-${index}`)));
    assert.ok([1, 2, 3].includes(choiceCountFor('general', `general-${index}`)));
  }
});

test('점수 기록에 스테이지와 클리어 상태를 포함한다', () => {
  assert.deepEqual(createScoreUpdate(88, 6, true, 4), { stageId: 4, currentScore: 88, floorsCleared: 6, cleared: true });
});

test('10개 스테이지는 고유 보스와 상승하는 난이도를 가진다', () => {
  assert.equal(STAGES.length, 10);
  assert.equal(new Set(STAGES.map((stage) => stage.bossName)).size, 10);
  assert.ok(STAGES.every((stage, index) => index === 0 || stage.bossAttack > STAGES[index - 1].bossAttack));
});
