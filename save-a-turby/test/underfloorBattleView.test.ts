// 10-16 C3-3: 3장 전투 화면 판정 — 기억실(순서와 무관하게 누를 수 있음, 다음 실 표시), 납작·재봉선 노출 표식, 혼란, 끊어진 실 숨김
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAttack, isHiddenUnit, targetState, unitLabel, unitTags } from '../src/battle/battleView.ts';
import type { BattleSnapshot, BattleUnit } from '../src/net/battleTypes.ts';

const base = (over: Partial<BattleUnit>): BattleUnit => ({ unitId: 'x', side: 'wild', ownerPlayerId: null, participantSlot: 0, characterCode: 'x', name: 'x', col: 5, row: 5, hp: 1, maxHp: 1, ap: 0, maxAp: 0, stunned: false, inactive: false, ...over });
const hero = (col: number, row: number, over: Partial<BattleUnit> = {}) => base({ unitId: 'p1-0', side: 'party', ownerPlayerId: '1', participantSlot: 1, characterCode: 'nubi', name: '누비', col, row, hp: 20, maxHp: 20, ap: 3, maxAp: 3, ...over });
const snap = (units: BattleUnit[]): BattleSnapshot => ({ battleId: 'b', version: 1, phase: 'player_subturn', round: 1, stageCode: 'underground', spawnIndex: -1, wildCharacterCode: 'x', wildName: 'x', encounterPlayerId: '1', grid: { cols: 12, rows: 8 }, partyLimit: 3, currentPlayerId: '1', expiresAt: null, serverNow: 0, outcome: null, participants: [], units, blocked: [] });
const thread = (id: string, over: Partial<BattleUnit> = {}) => base({ unitId: id, characterCode: 'memory_thread', name: '기억실', thread: true, canAct: false, ...over } as Partial<BattleUnit>);

test('기억실: 순서가 아닌 실도 누를 수 있다(서버가 혼란으로 처리) — 진짜 실의 부위 순서 제한을 화면이 걸지 않는다', () => {
  const a = thread('thread_4', { partOf: 'memory_spool', breakOrder: 1, col: 9, row: 6, hinted: true });
  const b = thread('thread_2', { partOf: 'memory_spool', breakOrder: 2, col: 9, row: 2 });
  const decoy = thread('thread_1', { col: 8, row: 1 });
  const s = snap([hero(8, 2), a, b, decoy]);
  assert.equal(targetState(s, b), 'ok', '순서가 아닌 진짜 실');
  assert.equal(targetState(s, decoy), 'ok', '가짜 실');
  assert.equal(canAttack(s, s.units[0], b), true);
});

test('표식: 다음 실만 표시하고, 납작·재봉선 노출·운반 실 끊김·혼란을 서버 값 그대로 보여 준다', () => {
  assert.deepEqual(unitTags(thread('thread_4', { hinted: true })), ['다음 실']);
  assert.deepEqual(unitTags(thread('thread_2')), []);
  assert.deepEqual(unitTags(base({ unitId: 'pressed_doll_a', flat: true })), ['납작']);
  assert.deepEqual(unitTags(base({ unitId: 'pressed_doll_a', flat: false })), ['재봉선 노출']);
  assert.deepEqual(unitTags(base({ unitId: 'small_spool', reversed: true })), ['운반 실 끊김']);
  assert.deepEqual(unitTags(hero(1, 1, { statuses: [{ kind: 'confused', turnsLeft: 1, movePenalty: 0, sourceUnitId: 'thread_1', appliedRound: 1 }] })), ['혼란']);
});

test('라벨: 기억실은 번호가 붙고 다음 실에는 표시가 붙으며(HP 생략), 작은 화면에서는 한 줄이다', () => {
  assert.equal(unitLabel(thread('thread_4', { hinted: true }), true), '기억실 4 ▶');
  assert.equal(unitLabel(thread('thread_2'), true), '기억실 2');
  assert.equal(unitLabel(thread('thread_4', { hinted: true }), false), '기억실 4 (다음 실)');
});

test('숨김: 끊어진 기억실·운반 실은 그림·이름표를 숨기고, 끊기지 않은 실은 보인다', () => {
  assert.equal(isHiddenUnit(thread('thread_2', { stunned: true })), true);
  assert.equal(isHiddenUnit(thread('thread_2')), false);
  assert.equal(isHiddenUnit(base({ unitId: 'carrier_thread', characterCode: 'carrier_thread', stunned: true })), true);
  assert.equal(isHiddenUnit(base({ unitId: 'carrier_thread', characterCode: 'carrier_thread' })), false);
  assert.equal(isHiddenUnit(base({ unitId: 'pressed_doll_a', characterCode: 'pressed_sewn_doll', stunned: true })), false, '쓰러진 박음이는 흐리게 남는다');
});
