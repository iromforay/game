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

test('C4-6 RQA-08: 작은 화면은 박음이·윗실·밑실을 줄인 이름으로, 큰 화면은 원래 이름', async () => {
  const { unitLabel } = await import('../src/battle/battleView.ts');
  assert.equal(unitLabel(unit({ guarded: true }), true), '박음이\n8/8 · 골무 보호');
  assert.equal(unitLabel(unit({ guarded: true }), false), '얼어붙은 박음이 HP 8/8 (골무 보호)');
  assert.equal(unitLabel(unit({ characterCode: 'upper_thread', name: '윗실(얼음 극세사)', hp: 1, maxHp: 1 }), true), '윗실\n1/1');
  assert.equal(unitLabel(unit({ characterCode: 'lower_thread', name: '밑실', hp: 1, maxHp: 1 }), true), '밑실\n1/1');
});

test('C4-6 RQA-08: 라벨은 다른 유닛 그림을 피해 자리를 찾고(자기 그림은 무시), 피할 자리가 없으면 라벨끼리만 피한다', async () => {
  const { resolveLabels } = await import('../src/battle/battleView.ts');
  const bounds = { x: 0, y: 0, w: 800, h: 600 };
  // 바로 아래 칸에 다른 유닛 그림 → 아래(선호) 대신 비킨 자리
  const a = resolveLabels([{ id: 'a', cx: 400, anchorY: 200, w: 100, h: 40, pref: 'below' }], bounds, 30, [{ id: 'a', x0: 370, y0: 170, x1: 430, y1: 230 }, { id: 'b', x0: 370, y0: 250, x1: 430, y1: 310 }]).get('a')!;
  const rect = { x0: a.cx - 50, x1: a.cx + 50, y0: a.top, y1: a.top + 40 };
  assert.ok(!(rect.x0 < 432 && rect.x1 > 368 && rect.y0 < 312 && rect.y1 > 248), JSON.stringify(a));
  // 그림 없음 → 기존과 같다
  assert.deepEqual(resolveLabels([{ id: 'a', cx: 400, anchorY: 200, w: 100, h: 40, pref: 'below' }], bounds, 30).get('a'), { cx: 400, top: 230 });
  // 사방이 그림으로 막히면 그래도 라벨 자리는 정한다(라벨끼리만 피함)
  const wall = [{ id: 'z', x0: 0, y0: 0, x1: 800, y1: 600 }];
  assert.deepEqual(resolveLabels([{ id: 'a', cx: 400, anchorY: 200, w: 100, h: 40, pref: 'below' }], bounds, 30, wall).get('a'), { cx: 400, top: 230 });
});
