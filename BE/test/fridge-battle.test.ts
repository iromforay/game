// 10-23 C4-3: 4장 전투 규칙 — 얼어붙은 박음이(얼음 칸·미끄러짐·파편 재결합), 골무막이(실밥·곁 보호), 서리 미싱(바늘 예고·고정·연결 실·가느리 해제·밑실→윗실).
// 실제 전투 정의(BE/story-data/save-a-turby/battles/fridge_*.json)로 만든 상태를 엔진에 직접 넣어 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { ENCOUNTER_BY_KEY } from '../src/turby/story/story-data';

const content = new StoryContentService();
const GUARD = content.battle('fridge_frozen_guard') as BattleDefinition;
const BOSS = content.battle('fridge_boss_frost_machine') as BattleDefinition;
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const STRONG = { attack: 30, defense: 6, actionPower: 6, maxHp: 200 };
const hero = (s: Partial<PartyEntry> = {}, id = 't1'): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', attack: 5, defense: 1, actionPower: 3, maxHp: 200, ...s });

function start(def: BattleDefinition, party: PartyEntry[] = [hero()], players: string[] = ['a']): BattleState {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'ice', spawnIndex: -1, encounterPlayerId: players[0], wild: WILD, rules: RULES, participants: players.map((p, i) => ({ playerId: p, nickname: p, slot: i + 1, connected: true })), definition: JSON.parse(JSON.stringify(def)) as BattleDefinition, story: { encounterKey: def.key } });
  submitParty(s, players[0], party);
  for (const p of players.slice(1)) submitParty(s, p, [hero({}, `${p}-t1`)]);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const mine = (s: BattleState, owner = 'a', i = 0) => s.units.filter((x) => x.side === 'party' && x.ownerPlayerId === owner)[i];
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
const attackBy = (s: BattleState, unitId: string, target: string, owner = 'a') => applyAction(s, owner, { type: 'attack', unitId, targetUnitId: target });
const moveBy = (s: BattleState, unitId: string, col: number, row: number, owner = 'a') => applyAction(s, owner, { type: 'move', unitId, targetCol: col, targetRow: row });
// 모든 참전자가 차례를 넘겨 한 라운드를 보낸다(야생 차례 포함)
function nextRound(s: BattleState): BattleEvent[] {
  const out: BattleEvent[] = [];
  const r = s.round;
  for (let i = 0; i < 5 && s.round === r && s.phase === 'player_subturn'; i++) out.push(...applyAction(s, s.turnOrder[s.subturnIndex], { type: 'end' }));
  return out;
}

// ---------- 정의 ----------

test('정의: 저장고 앞 전투·서리 미싱이 로더·스토리 조우 표에 같은 키로 있고, 승리 사건이 계약대로다', () => {
  assert.deepEqual(ENCOUNTER_BY_KEY.get('fridge_frozen_guard')!.onWinEvents, ['fridge_frozen_guard_won']);
  assert.deepEqual(ENCOUNTER_BY_KEY.get('fridge_boss_frost_machine')!.onWinEvents, ['fridge_boss_defeated']);
  assert.deepEqual(GUARD.objectives!.win, [{ kind: 'defeat_units', unitIds: ['frozen_doll_a', 'frozen_doll_b', 'thimble_guard'] }]);
  assert.deepEqual(BOSS.objectives!.win, [{ kind: 'defeat_units', unitIds: ['upper_thread'] }], '윗실을 끊으면 정지(파괴 아님)');
  for (const d of [GUARD, BOSS]) assert.equal(d.cornerEscape, false);
  // 기믹마다 첫 등장 한 줄 안내(Codex 의견 P-03)
  assert.ok(GUARD.hints!.iceTrail && GUARD.hints!.shatter && GUARD.hints!.guarded && GUARD.hints!.zeroDamage);
  assert.ok(BOSS.hints!.needle && BOSS.hints!.pinned && BOSS.hints!.rescue);
});

// ---------- 얼어붙은 박음이 ----------

test('얼음 칸: 박음이가 움직이면 떠난 칸에 얼음 칸이 남고, 첫 얼음 칸에서 안내가 한 번 나온다', () => {
  const s = start(GUARD);
  const from = { col: u(s, 'frozen_doll_b').col, row: u(s, 'frozen_doll_b').row };
  const e = nextRound(s);
  assert.ok(s.ice!.includes(`${from.col},${from.row}`), `떠난 칸 (${from.col},${from.row})이 얼음 칸`);
  assert.equal(e.filter((x) => x.type === 'hint' && x.code === 'iceTrail').length, 1);
  nextRound(s);
  assert.equal((s.hintsShown ?? []).filter((h) => h.code === 'iceTrail').length, 1, '안내는 전투당 한 번');
  assert.deepEqual(toSnapshot(s).ice, s.ice);
});

test('미끄러짐: 얼음 칸에 들어선 아군은 같은 방향으로 한 칸 더(행동력 없음), 그 칸이 막혀 있으면 그 자리', () => {
  const s = start(GUARD);
  const h = mine(s);
  place(s, h.unitId, 2, 6);
  s.ice = ['3,6'];
  const ap = h.ap;
  const e = moveBy(s, h.unitId, 3, 6);
  assert.deepEqual([h.col, h.row], [4, 6], '동쪽으로 한 칸 더');
  assert.equal(types(e).includes('slide'), true);
  assert.equal(h.ap, ap - 1, '미끄러짐은 행동력을 쓰지 않는다');
  // 막힌 경우: 미끄러질 칸에 다른 유닛
  s.ice = ['3,1'];
  place(s, h.unitId, 3, 0);
  place(s, 'frozen_doll_a', 3, 2);
  moveBy(s, h.unitId, 3, 1);
  assert.deepEqual([h.col, h.row], [3, 1], '남쪽 칸이 막혀 그 자리');
});

test('파편: 쓰러진 박음이는 검은 실 파편 2개를 흩뿌리고(승리 아님), 파편을 모두 끊으면 완전히 쓰러진다', () => {
  const s = start(GUARD, [hero(STRONG)]);
  const h = mine(s);
  place(s, 'frozen_doll_b', 4, 6); // 골무막이 곁이 아니다
  place(s, h.unitId, 3, 6);
  const e = attackBy(s, h.unitId, 'frozen_doll_b');
  const sh = e.find((x) => x.type === 'shatter') as Extract<BattleEvent, { type: 'shatter' }>;
  assert.ok(sh, '파편을 흩뿌렸다');
  assert.equal(sh.shardIds.length, 2);
  assert.equal(sh.reviveRound, s.round + 3, '3라운드(Codex 의견 P-03)');
  assert.equal(types(e).includes('hint'), true);
  const snap = toSnapshot(s);
  assert.equal(snap.units.find((x) => x.unitId === 'frozen_doll_b')!.reviving, true);
  for (const id of sh.shardIds) {
    const shard = u(s, id);
    assert.ok(Math.abs(shard.col - 4) + Math.abs(shard.row - 6) === 1, '쓰러진 자리 이웃');
    assert.equal(shard.characterCode, 'ice_shard');
  }
  // 파편 둘을 끊는다
  for (const id of sh.shardIds) {
    const shard = u(s, id);
    const spot = [[shard.col - 1, shard.row], [shard.col + 1, shard.row], [shard.col, shard.row - 1], [shard.col, shard.row + 1]].find(([c, r]) => !s.units.some((x) => !x.stunned && x.col === c && x.row === r) && c >= 0 && r >= 0 && c < 12 && r < 8)!;
    place(s, h.unitId, spot[0], spot[1]);
    h.ap = 3;
    const r = attackBy(s, h.unitId, id);
    if (id === sh.shardIds[1]) assert.equal(types(r).includes('shatter_cleared'), true);
  }
  assert.equal(u(s, 'frozen_doll_b').reviveRound, null, '완전히 쓰러졌다');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'frozen_doll_b')!.reviving, undefined);
});

test('재결합: 3라운드 안에 파편을 다 끊지 않으면 박음이가 HP 절반으로 다시 일어나고, 남은 파편은 사라진다', () => {
  const s = start(GUARD, [hero(STRONG)]);
  const h = mine(s);
  place(s, 'frozen_doll_b', 4, 6);
  place(s, h.unitId, 3, 6);
  const sh = attackBy(s, h.unitId, 'frozen_doll_b').find((x) => x.type === 'shatter') as Extract<BattleEvent, { type: 'shatter' }>;
  place(s, h.unitId, 0, 0); // 멀리 떨어져 기다린다
  const doll = u(s, 'frozen_doll_b');
  let revived: BattleEvent | undefined;
  for (let i = 0; i < 3 && !revived; i++) revived = nextRound(s).find((x) => x.type === 'revive');
  assert.ok(revived, '세 라운드 안에 다시 일어난다');
  assert.equal(s.round, sh.reviveRound);
  assert.deepEqual([doll.stunned, doll.hp], [false, 4], 'HP 8의 절반');
  for (const id of sh.shardIds) assert.equal(u(s, id).fled, true, '남은 파편은 녹아 사라진다');
  assert.notEqual(s.outcome, 'win');
  // 다시 쓰러뜨리면 새 파편이 생기고, 유닛 ID는 앞의 파편과 겹치지 않는다(10-23 E2E에서 찾은 문제)
  place(s, h.unitId, doll.col - 1, doll.row);
  h.ap = 6;
  const again = attackBy(s, h.unitId, 'frozen_doll_b').find((x) => x.type === 'shatter') as Extract<BattleEvent, { type: 'shatter' }>;
  assert.ok(again, '다시 파편을 흩뿌린다');
  const ids = s.units.map((x) => x.unitId);
  assert.equal(new Set(ids).size, ids.length, '유닛 ID 중복 없음');
  assert.equal(again.shardIds.some((id) => sh.shardIds.includes(id)), false);
});

// ---------- 골무막이 ----------

test('골무막이: 실밥이 남아 있으면 골무막이는 피해 0(안내), 곁의 박음이도 피해 0(안내). 등 뒤 실밥을 끊으면 둘 다 피해가 들어간다', () => {
  const s = start(GUARD, [hero(STRONG)]);
  const h = mine(s);
  // 박음이 a(7,2)는 골무막이(8,3)의 대각선 이웃 — 보호받는다
  place(s, h.unitId, 6, 2);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'frozen_doll_a')!.guarded, true);
  const e1 = attackBy(s, h.unitId, 'frozen_doll_a');
  assert.equal((e1.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>).damage, 0);
  assert.equal(e1.some((x) => x.type === 'hint' && x.code === 'guarded'), true);
  // 골무막이 정면(서쪽)
  place(s, h.unitId, 7, 3);
  h.ap = 3;
  const e2 = attackBy(s, h.unitId, 'thimble_guard');
  assert.equal((e2.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>).damage, 0);
  assert.equal(e2.some((x) => x.type === 'hint' && x.code === 'zero_damage'), true, '정면이 막히면 실밥 안내');
  // 등 뒤(동쪽 9,3)의 실밥
  place(s, h.unitId, 10, 3);
  h.ap = 3;
  const e3 = attackBy(s, h.unitId, 'black_stitch');
  assert.equal(types(e3).includes('part_broken'), true);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'frozen_doll_a')!.guarded, false, '실밥을 끊으면 보호가 풀린다');
  place(s, h.unitId, 6, 2);
  h.ap = 3;
  assert.ok((attackBy(s, h.unitId, 'frozen_doll_a').find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>).damage > 0);
});

test('승리: 박음이 둘(파편까지)·골무막이를 모두 쓰러뜨리면 승리 — 파편이 남은 동안은 승리가 아니다', () => {
  const s = start(GUARD, [hero(STRONG)]);
  const h = mine(s);
  place(s, h.unitId, 10, 3);
  attackBy(s, h.unitId, 'black_stitch');
  const cut = (id: string, at: [number, number]) => {
    place(s, h.unitId, at[0], at[1]);
    h.ap = 6;
    return attackBy(s, h.unitId, id);
  };
  cut('thimble_guard', [7, 3]);
  const shardsOf = (id: string) => s.units.filter((x) => x.shardOf === id && !x.stunned);
  for (const doll of ['frozen_doll_a', 'frozen_doll_b']) {
    const d = u(s, doll);
    cut(doll, [d.col - 1, d.row]);
    assert.notEqual(s.outcome, 'win', `${doll}: 파편이 남아 아직 승리가 아니다`);
    for (const sh of shardsOf(doll)) {
      const spot = [[sh.col - 1, sh.row], [sh.col + 1, sh.row], [sh.col, sh.row - 1], [sh.col, sh.row + 1]].find(([c, r]) => !s.units.some((x) => !x.stunned && x.col === c && x.row === r) && c >= 0 && r >= 0 && c < 12 && r < 8)!;
      cut(sh.unitId, spot as [number, number]);
    }
  }
  assert.equal(s.outcome, 'win');
});

// ---------- 서리 미싱 ----------

test('서리 미싱: 공격 대상이 아니고 제자리. 적 차례마다 바늘 칸을 예고하고(남은 밑실 수, 고정되지 않은 아군의 칸), 다음 적 차례에 내려찍는다', () => {
  const s = start(BOSS, [hero({}, 't1'), hero({}, 't2')]);
  const [h1, h2] = [mine(s, 'a', 0), mine(s, 'a', 1)];
  assert.equal(code(() => { place(s, h1.unitId, 9, 3); return attackBy(s, h1.unitId, 'frost_machine'); }), 'INVALID_TARGET');
  place(s, h1.unitId, 2, 2);
  place(s, h2.unitId, 2, 5);
  const e = nextRound(s);
  const t = e.find((x) => x.type === 'needle_telegraph') as Extract<BattleEvent, { type: 'needle_telegraph' }>;
  assert.deepEqual(t.cells.sort(), ['2,2', '2,5'], '밑실 2 = 예고 2칸(Codex 의견 P-04: 첫 예고 2칸)');
  assert.deepEqual(toSnapshot(s).needleMarks!.sort(), ['2,2', '2,5']);
  assert.equal(e.some((x) => x.type === 'hint' && x.code === 'needle'), true);
  assert.deepEqual([u(s, 'frost_machine').col, u(s, 'frost_machine').row], [10, 3], '제자리');
});

test('내려찍기(1인): 예고 칸에 남은 아군 하나만 고정되고 옆에 연결 실이 생긴다 → 다음 아군 차례 전에 가느리가 끊어 준다(행동 소모 없음)', () => {
  const s = start(BOSS, [hero({}, 't1'), hero({}, 't2')]);
  const [h1, h2] = [mine(s, 'a', 0), mine(s, 'a', 1)];
  place(s, h1.unitId, 2, 2);
  place(s, h2.unitId, 2, 5);
  nextRound(s); // 예고
  const e = nextRound(s); // 내려찍기 → 라운드 시작에 가느리 해제
  const strike = e.find((x) => x.type === 'needle_strike') as Extract<BattleEvent, { type: 'needle_strike' }>;
  assert.equal(strike.pinned.length, 1, '연결 실이 남아 있으면 새로 고정하지 않는다 — 한 번에 하나');
  assert.equal(strike.pinned[0], h1.unitId, '슬롯·순서가 앞선 아군');
  const freed = e.find((x) => x.type === 'freed') as Extract<BattleEvent, { type: 'freed' }>;
  assert.deepEqual([freed.unitId, freed.byUnitId], [h1.unitId, 'ganeuri']);
  assert.equal(e.some((x) => x.type === 'hint' && x.code === 'rescue'), true);
  assert.equal(h1.ap, h1.maxAp, '풀린 뒤 아군 차례의 행동력은 그대로 찬다');
  assert.equal(u(s, strike.linkIds[0]).fled, true, '끊긴 연결 실은 숨긴다');
  // 다음 내려찍기에서 같은 아군을 연속으로 고정하지 않는다(그대로 서 있어도)
  const e2 = nextRound(s);
  const strike2 = e2.find((x) => x.type === 'needle_strike') as Extract<BattleEvent, { type: 'needle_strike' }>;
  assert.notEqual(strike2.pinned[0], h1.unitId, '같은 아군 연속 고정 없음');
});

test('내려찍기(2인): 고정된 아군은 행동할 수 없고 시간으로 풀리지 않는다. 동료가 연결 실을 끊으면 풀린다(가느리는 돕지 않는다)', () => {
  const s = start(BOSS, [hero({}, 't1')], ['a', 'b']);
  const ha = mine(s, 'a');
  const hb = mine(s, 'b');
  place(s, ha.unitId, 2, 2);
  place(s, hb.unitId, 5, 6);
  nextRound(s); // 예고(a·b 둘 다 — 밑실 2)
  place(s, hb.unitId, 5, 7); // b는 비켜 선다
  const e = nextRound(s);
  const strike = e.find((x) => x.type === 'needle_strike') as Extract<BattleEvent, { type: 'needle_strike' }>;
  assert.deepEqual(strike.pinned, [ha.unitId]);
  assert.equal(e.some((x) => x.type === 'freed'), false, '2인 전투에서는 가느리가 끊지 않는다');
  assert.equal(ha.ap, 0, '고정된 아군의 행동력은 0');
  nextRound(s);
  assert.equal((ha.statuses ?? []).some((x) => x.kind === 'pinned'), true, '라운드가 지나도 풀리지 않는다');
  const link = u(s, strike.linkIds[0]);
  // b의 차례: 연결 실 옆으로 가서 끊는다
  while (s.turnOrder[s.subturnIndex] !== 'b') applyAction(s, s.turnOrder[s.subturnIndex], { type: 'end' });
  place(s, hb.unitId, link.col, link.row + (link.row < 7 ? 1 : -1));
  hb.ap = 3;
  const cut = attackBy(s, hb.unitId, link.unitId, 'b');
  const freed = cut.find((x) => x.type === 'freed') as Extract<BattleEvent, { type: 'freed' }>;
  assert.deepEqual([freed.unitId, freed.byUnitId], [ha.unitId, hb.unitId]);
  assert.equal((ha.statuses ?? []).some((x) => x.kind === 'pinned'), false);
});

test('밑실 → 윗실: 윗실은 밑실 둘을 끊기 전에는 끊을 수 없고, 밑실을 끊을수록 예고 칸이 줄며(최소 1), 윗실을 끊으면 승리(정지)', () => {
  const s = start(BOSS, [hero(STRONG, 't1'), hero({}, 't2')]);
  const [h1, h2] = [mine(s, 'a', 0), mine(s, 'a', 1)];
  place(s, h2.unitId, 0, 4);
  place(s, h1.unitId, 6, 3);
  assert.equal(code(() => attackBy(s, h1.unitId, 'upper_thread')), 'PART_ORDER');
  place(s, h1.unitId, 6, 1);
  attackBy(s, h1.unitId, 'lower_thread_1');
  const e = nextRound(s);
  assert.equal((e.find((x) => x.type === 'needle_telegraph') as Extract<BattleEvent, { type: 'needle_telegraph' }>).cells.length, 1, '밑실 1 = 예고 1칸');
  place(s, h1.unitId, 6, 6);
  h1.ap = 6;
  attackBy(s, h1.unitId, 'lower_thread_2');
  place(s, h1.unitId, 6, 3);
  const win = attackBy(s, h1.unitId, 'upper_thread');
  assert.equal(types(win).includes('resolved'), true);
  assert.equal(s.outcome, 'win');
  assert.equal(u(s, 'frost_machine').stunned, false, '미싱은 파괴되지 않는다(정지 — 약점 노출 단계)');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'frost_machine')!.phase, 'exposed');
});
