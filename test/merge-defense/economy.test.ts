import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../hub/src/mergeDefenseEconomy.ts', import.meta.url), 'utf8');
const cost = (upgrade: string) => {
  const match = source.match(new RegExp(`${upgrade}: \\[(.*?)\\]`));
  assert.ok(match, `${upgrade} 비용표가 필요합니다`);
  return match[1].split(',').map((value) => Number(value.trim()));
};

test('새 프로필은 기본 직업만 열리고 진행 수치는 0이다', () => {
  assert.match(source, /silver:\s*0/);
  assert.match(source, /warriorUnlocked:\s*1/);
  assert.match(source, /archerUnlocked:\s*1/);
  assert.match(source, /spellbladeUnlocked:\s*0/);
  assert.match(source, /highestClearedStage:\s*0/);
});

test('공격력 강화 비용은 레벨에 따라 증가한다', () => {
  assert.deepEqual(cost('attack'), [50, 100, 200, 400, 800, 1200, 1800, 2500]);
});

test('시작 코인과 소환 할인 비용표가 독립적으로 유지된다', () => {
  assert.deepEqual(cost('startCoin'), [100, 250, 500, 900, 1500]);
  assert.deepEqual(cost('summonDiscount'), [200, 450, 900, 1600, 2600]);
});

test('최대 레벨 강화는 null을 반환하도록 구현되어 있다', () => {
  assert.match(source, /COSTS\[upgrade\]\[level\]\s*\?\?\s*null/);
});
