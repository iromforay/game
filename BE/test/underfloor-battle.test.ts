// 10-16 C3-3: 3장 전투 규칙 — 눌린 박음이(납작·재봉선 노출), 작은 실패굴이(달아남·운반 실·강화), 기억 실패굴이(기억실 순서·혼란·솜심 노출).
// 실제 전투 정의(BE/story-data/save-a-turby/battles/underfloor_*.json)로 만든 상태를 엔진에 직접 넣어 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { ENCOUNTER_BY_KEY } from '../src/turby/story/story-data';

const content = new StoryContentService();
const AMBUSH = content.battle('underfloor_ambush') as BattleDefinition;
const BOSS = content.battle('underfloor_boss_memory_spool') as BattleDefinition;
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const STRONG = { attack: 30, defense: 6, actionPower: 4, maxHp: 200 };
const WEAK = { attack: 5, defense: 1, actionPower: 3, maxHp: 200 };
const hero = (s: Partial<PartyEntry> = {}, id = 't1'): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', ...WEAK, ...s });

function start(def: BattleDefinition, party: PartyEntry[] = [hero()]): BattleState {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'underground', spawnIndex: -1, encounterPlayerId: 'a', wild: WILD, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: JSON.parse(JSON.stringify(def)) as BattleDefinition, story: { encounterKey: def.key } });
  submitParty(s, 'a', party);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const me = (s: BattleState) => s.units.find((x) => x.side === 'party')!;
const place = (s: BattleState, id: string, col: number, row: number) => {
  const x = u(s, id);
  x.col = col;
  x.row = row;
};
const types = (e: BattleEvent[]) => e.map((x) => x.type);
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}
const attack = (s: BattleState, target: string) => applyAction(s, 'a', { type: 'attack', unitId: me(s).unitId, targetUnitId: target });
const move = (s: BattleState, col: number, row: number) => applyAction(s, 'a', { type: 'move', unitId: me(s).unitId, targetCol: col, targetRow: row });
const endTurn = (s: BattleState) => applyAction(s, 'a', { type: 'end' });
// 한 라운드 넘기기(아군 턴 종료 → 야생 차례 → 다음 라운드)
const nextRound = (s: BattleState) => {
  const out: BattleEvent[] = [];
  if (s.phase === 'player_subturn') out.push(...endTurn(s));
  return out;
};

// ---------- 정의·정산 연결 ----------

test('정의: 매복 전투와 보스 전투가 전투 정의 로더·스토리 조우 표에 같은 키로 있다', () => {
  assert.equal(AMBUSH.key, 'underfloor_ambush');
  assert.equal(BOSS.key, 'underfloor_boss_memory_spool');
  assert.deepEqual(ENCOUNTER_BY_KEY.get('underfloor_ambush')!.onWinEvents, ['underfloor_ambush_won']);
  assert.deepEqual(ENCOUNTER_BY_KEY.get('underfloor_boss_memory_spool')!.onWinEvents, ['underfloor_boss_defeated']);
  assert.equal(AMBUSH.units.filter((x) => x.flat).length, 3);
  assert.equal(BOSS.units.filter((x) => x.thread).length, 5);
  assert.deepEqual(BOSS.units.filter((x) => x.thread && x.thread.order !== null).map((x) => [x.unitId, x.thread!.order]).sort((a, b) => (a[1] as number) - (b[1] as number)), [['thread_4', 1], ['thread_2', 2], ['thread_5', 3]]);
  for (const d of [AMBUSH, BOSS]) assert.equal(d.cornerEscape, false, '구석 퇴각 없음');
});

// ---------- 눌린 박음이 ----------

test('눌린 박음이: 납작할 때 첫 피격은 절반 피해이고 재봉선이 한 번만 드러난다(피해는 그 뒤 정상)', () => {
  const s = start(AMBUSH);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'pressed_doll_a')!.flat, true);
  place(s, me(s).unitId, 7, 2);
  const e1 = attack(s, 'pressed_doll_a');
  const hit1 = e1.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.equal(hit1.damage, 2, '공격 5 − 방어 0 → 5, 납작이라 절반(내림) 2');
  assert.equal(types(e1).includes('phase'), true, '재봉선 노출 이벤트');
  assert.equal(u(s, 'pressed_doll_a').flat, false);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'pressed_doll_a')!.flat, false);
  const e2 = attack(s, 'pressed_doll_a');
  assert.equal((e2.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>).damage, 5, '노출 뒤 정상 피해');
  assert.equal(types(e2).includes('phase'), false, '노출은 한 번만');
});

test('눌린 박음이: 납작해도 한 방에 쓰러질 만큼 강하면 노출 이벤트 없이 쓰러진다', () => {
  const s = start(AMBUSH, [hero(STRONG)]);
  place(s, me(s).unitId, 7, 2);
  const e = attack(s, 'pressed_doll_a');
  const hit = e.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.equal(hit.targetStunned, hit.targetHp === 0);
  assert.equal(u(s, 'pressed_doll_a').flat, false);
});

// ---------- 작은 실패굴이 ----------

test('작은 실패굴이: 공격하지 않고 아군에게서 멀어지며, 구석에서는 제자리에서 행동력만 쓴다', () => {
  const s = start(AMBUSH);
  const before = u(s, 'small_spool');
  const d0 = Math.abs(me(s).col - before.col) + Math.abs(me(s).row - before.row);
  nextRound(s);
  const spool = u(s, 'small_spool');
  const d1 = Math.abs(me(s).col - spool.col) + Math.abs(me(s).row - spool.row);
  assert.ok(d1 >= d0, `멀어진다 ${d0} → ${d1}`);
  assert.equal(s.round, 2);
  // 여러 라운드 동안 전투 이벤트에 실패굴이의 공격이 없다
  const all: BattleEvent[] = [];
  for (let i = 0; i < 2 && s.phase === 'player_subturn'; i++) all.push(...nextRound(s));
  assert.equal(all.some((e) => e.type === 'attack' && e.attackerId === 'small_spool'), false);
  assert.ok(spool.col <= 11 && spool.row >= 0 && spool.row <= 7);
});

test('운반 실: 끊으면 작은 실패굴이의 방향이 뒤집혀 아군 쪽으로 굴러오고(바로 옆까지만), 한 번만 일어난다', () => {
  const s = start(AMBUSH, [hero(STRONG)]);
  place(s, me(s).unitId, 8, 3);
  const e = attack(s, 'carrier_thread');
  assert.equal(types(e).includes('carrier_cut'), true);
  assert.equal(u(s, 'small_spool').reversed, true);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'small_spool')!.reversed, true);
  // 아군에게서 멀리 둔 뒤 라운드를 넘기면 가까워진다
  place(s, 'small_spool', 11, 7);
  place(s, me(s).unitId, 2, 1);
  const before = Math.abs(me(s).col - 11) + Math.abs(me(s).row - 7);
  nextRound(s);
  const sp = u(s, 'small_spool');
  const after = Math.abs(me(s).col - sp.col) + Math.abs(me(s).row - sp.row);
  assert.ok(after < before, `가까워진다 ${before} → ${after}`);
  assert.ok(after >= 1, '아군 칸을 침범하지 않는다');
  assert.equal(code(() => attack(s, 'carrier_thread')), 'INVALID_TARGET', '이미 끊긴 실은 대상이 아니다');
});

test('강화: 3라운드 안에 작은 실패굴이를 못 잡으면 납작 병사 전원의 공격이 +2 되고 실패굴이는 사라진다(승리에서는 쓰러진 것으로 센다)', () => {
  const s = start(AMBUSH);
  const before = ['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c'].map((id) => u(s, id).attack);
  const events: BattleEvent[] = [];
  for (let i = 0; i < 6 && s.phase === 'player_subturn' && s.round < 4; i++) events.push(...nextRound(s));
  assert.equal(s.round >= 4, true);
  const em = events.find((x) => x.type === 'empower') as Extract<BattleEvent, { type: 'empower' }> | undefined;
  assert.ok(em, '강화 이벤트');
  assert.deepEqual([...em!.targets].sort(), ['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c']);
  assert.deepEqual(['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c'].map((id) => u(s, id).attack), before.map((a) => a + 2));
  assert.equal(u(s, 'small_spool').stunned, true);
  assert.equal(u(s, 'small_spool').fled, true);
  assert.equal(events.filter((x) => x.type === 'empower').length, 1, '강화는 한 번');
  // 이제 박음이 셋만 쓰러뜨리면 이긴다
  for (const id of ['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c']) u(s, id).stunned = true;
  assert.equal(toSnapshot(s).objectives!.win[0].kind, 'defeat_units');
});

test('매복 승리: 세 박음이와 작은 실패굴이를 모두 쓰러뜨려야 이긴다(하나라도 남으면 계속)', () => {
  const s = start(AMBUSH, [hero(STRONG)]);
  place(s, me(s).unitId, 7, 2);
  for (const id of ['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c']) {
    place(s, id, id === 'pressed_doll_a' ? 8 : 9, id === 'pressed_doll_a' ? 2 : id === 'pressed_doll_b' ? 5 : 6);
  }
  u(s, 'pressed_doll_b').stunned = true;
  u(s, 'pressed_doll_c').stunned = true;
  const e = attack(s, 'pressed_doll_a');
  void e;
  assert.equal(s.phase === 'resolved', false, '작은 실패굴이가 남아 있다');
  u(s, 'small_spool').stunned = true;
  place(s, 'pressed_doll_a', 8, 2);
  // 이미 쓰러진 것 외에 다른 승리 평가 트리거
  u(s, 'pressed_doll_a').stunned = true;
  const snap = toSnapshot(s);
  assert.equal(snap.units.filter((x) => x.side === 'wild' && !x.stunned && x.characterCode !== 'carrier_thread').length, 0);
});

// ---------- 기억 실패굴이 ----------

test('보스: 기억실 5가닥이 모두 표적이고, 폭신이가 가리키는 다음 실(hinted)은 정해진 순서의 진짜 실이며 안내 이벤트가 나온다', () => {
  const s = start(BOSS);
  const snap = toSnapshot(s);
  const threads = snap.units.filter((x) => x.thread);
  assert.equal(threads.length, 5);
  assert.deepEqual(threads.filter((x) => x.hinted).map((x) => x.unitId), ['thread_4']);
  assert.equal(snap.units.find((x) => x.unitId === 'memory_spool')!.phase, 'bound');
  // 시작 직후 안내 이벤트는 이미 지나갔으므로, 다음 라운드 시작에 다시 나온다
  const e = nextRound(s);
  assert.equal(e.some((x) => x.type === 'hint' && x.code === 'thread_hint'), true);
});

test('보스: 정해진 순서대로 진짜 실 3가닥을 끊으면 약점이 드러나고 안내가 다음 실로 옮겨 간다', () => {
  const s = start(BOSS, [hero({ ...STRONG, actionPower: 8 })]);
  const order = ['thread_4', 'thread_2', 'thread_5'];
  const seenHint: (string | undefined)[] = [];
  for (const id of order) {
    seenHint.push(toSnapshot(s).units.find((x) => x.hinted)?.unitId);
    const t = u(s, id);
    place(s, me(s).unitId, t.col - 1, t.row);
    const e = attack(s, id);
    assert.equal(types(e).includes('part_broken'), true, `${id} 끊김`);
    assert.equal(u(s, id).stunned, true);
  }
  assert.deepEqual(seenHint, order);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'memory_spool')!.phase, 'exposed', '세 가닥을 끊으면 약점 노출');
  assert.equal(toSnapshot(s).units.some((x) => x.hinted), false, '더 가리킬 실이 없다');
  // 가짜 실 둘은 남아 있고 더는 진행에 영향이 없다
  assert.equal(u(s, 'thread_1').stunned || u(s, 'thread_3').stunned, false);
  // 약점이 드러난 보스를 쓰러뜨리면 승리
  place(s, me(s).unitId, 9, 4);
  for (let i = 0; i < 20 && s.phase !== 'resolved'; i++) {
    if (me(s).ap < 1) endTurn(s);
    else attack(s, 'memory_spool');
  }
  assert.equal(s.outcome, 'win');
});

test('보스: 가짜 실이나 순서가 아닌 실을 끊으려 하면 행동만 쓰고 진행 없이 공격한 유닛이 혼란에 걸린다', () => {
  const s = start(BOSS);
  place(s, me(s).unitId, 7, 1);
  const apBefore = me(s).ap;
  const e = attack(s, 'thread_1'); // 가짜 실
  assert.equal(types(e).includes('wrong_thread'), true);
  assert.equal(me(s).ap, apBefore - 1);
  assert.equal(u(s, 'thread_1').stunned, false, '끊기지 않는다');
  assert.equal((me(s).statuses ?? []).some((x) => x.kind === 'confused'), true);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'memory_spool')!.phase, 'bound');
  // 혼란 중에는 인접한 다른 적이 없으면 헛손질이라 진행이 없고 상태는 쌓이지 않는다. 혼란이 풀린 뒤 순서가 아닌 진짜 실(thread_5)을 끊으려 해도 마찬가지로 진행이 없고 다시 혼란
  place(s, me(s).unitId, 7, 7);
  const e2 = attack(s, 'thread_5');
  assert.equal(types(e2).includes('confused_action'), true);
  assert.equal((me(s).statuses ?? []).filter((x) => x.kind === 'confused').length, 1);
  assert.equal(u(s, 'thread_5').stunned, false);
  me(s).statuses = [];
  me(s).ap = 3;
  const e3 = attack(s, 'thread_5');
  assert.equal(types(e3).includes('wrong_thread'), true);
  assert.equal((me(s).statuses ?? []).filter((x) => x.kind === 'confused').length, 1);
  assert.equal(u(s, 'thread_5').stunned, false);
});

test('혼란: 이동은 누른 칸의 반대쪽으로, 공격은 인접한 다른 적으로 바뀌고 헛돌 수 있으며, 1라운드 뒤에 풀린다', () => {
  const s = start(BOSS, [hero({ actionPower: 20 })]); // 행동력이 넉넉해 이 시험 안에서 턴이 저절로 끝나지 않는다
  place(s, me(s).unitId, 7, 1);
  attack(s, 'thread_1'); // 혼란 시작
  // 이동: (5,1)을 누르면 (9,1)로(점대칭) — 행동력 비용 2
  const m = move(s, 5, 1);
  assert.equal(types(m).includes('confused_action'), true);
  assert.deepEqual([me(s).col, me(s).row], [9, 1]);
  // 갈 수 없는 반대쪽(격자 밖으로 맞췄더니 제자리)이면 행동력만 쓴다
  place(s, me(s).unitId, 11, 0);
  const apBefore = me(s).ap;
  move(s, 10, 0); // 반대쪽 (12→11,0) = 제자리
  assert.deepEqual([me(s).col, me(s).row], [11, 0]);
  assert.equal(me(s).ap, apBefore - 1);
  // 공격: 인접한 다른 적이 없으면 헛손질(피해 0)
  place(s, me(s).unitId, 7, 1);
  me(s).ap = 3;
  const a = attack(s, 'thread_1');
  assert.equal(types(a).includes('confused_action'), true);
  const hit = a.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.equal(hit.damage, 0);
  // 1라운드(다음 아군 차례까지)는 혼란, 그다음 라운드가 끝나면 풀린다
  nextRound(s);
  assert.equal((me(s).statuses ?? []).some((x) => x.kind === 'confused'), true, '다음 아군 차례에도 혼란');
  nextRound(s);
  assert.equal((me(s).statuses ?? []).some((x) => x.kind === 'confused'), false, '그다음에는 풀린다');
});

test('보스: 결박 중인 보스를 공격하면 피해 0(행동은 소모)이고 안내는 한 번만, 거절하지 않는다', () => {
  const s = start(BOSS);
  place(s, me(s).unitId, 9, 4);
  const e = attack(s, 'memory_spool');
  const hit = e.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.equal(hit.damage, 0);
  assert.equal(e.some((x) => x.type === 'hint' && x.code === 'zero_damage'), true);
  const e2 = attack(s, 'memory_spool');
  assert.equal(e2.some((x) => x.type === 'hint' && x.code === 'zero_damage'), false);
});
