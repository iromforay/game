// 10-23 C4-3: 4장 전투 화면 표시 규칙 — 고정·파편 남음·골무 보호 표식, 골무 보호 중인 박음이는 피해 0 대상(자동 진행이 노리지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetState, unitTags } from '../src/battle/battleView.ts';
import type { BattleSnapshot, BattleUnit } from '../src/net/battleTypes.ts';

const unit = (o: Partial<BattleUnit>): BattleUnit => ({ unitId: 'x', side: 'wild', ownerPlayerId: null, participantSlot: 0, characterCode: 'frozen_sewn_doll', name: '얼어붙은 박음이', col: 5, row: 3, hp: 8, maxHp: 8, ap: 1, maxAp: 1, stunned: false, inactive: false, statuses: [], ...o }) as BattleUnit;
const snap = (units: BattleUnit[]) => ({ units }) as unknown as BattleSnapshot;

test('표식: 고정된 아군은 "고정", 파편이 남은 박음이는 "파편 남음", 보호 중인 박음이는 "골무 보호"', () => {
  assert.ok(unitTags(unit({ side: 'party', statuses: [{ kind: 'pinned', turnsLeft: 99, movePenalty: 0, sourceUnitId: 'frost_machine', appliedRound: 2 }] })).includes('고정'));
  assert.ok(unitTags(unit({ stunned: true, reviving: true })).includes('파편 남음'));
  assert.ok(unitTags(unit({ guarded: true })).includes('골무 보호'));
});

test('공격 대상: 골무 보호 중인 박음이는 zero(공격은 되지만 피해 0), 보호가 풀리면 ok', () => {
  assert.equal(targetState(snap([]), unit({ guarded: true })), 'zero');
  assert.equal(targetState(snap([]), unit({ guarded: false })), 'ok');
});

test('라벨: 공격 대상이 아닌 서리 미싱 본체는 HP 없이 이름과 상태만(일반 화면·작은 화면)', async () => {
  const { unitLabel } = await import('../src/battle/battleView.ts');
  const m = unit({ characterCode: 'frost_machine', name: '서리 미싱', targetable: false, maxHp: 1, hp: 1, phase: 'bound' });
  assert.equal(unitLabel(m, false), '서리 미싱 (결박)');
  assert.equal(unitLabel(m, true), '서리 미싱\n결박');
});
