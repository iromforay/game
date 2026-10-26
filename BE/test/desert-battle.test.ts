// 10-26 C5-3: 5장 전투 규칙 — 그을린 박음이(불씨·열기 환영), 물들이(젖은 칸), 재단 실밥이(곧 끊어질 칸·연결 매듭),
// 황금 재단인형(줄 절단·동료 복구·금빛 연결점 재생·누비만 푸는 안쪽 연결). 실제 전투 정의(battles/desert_*.json)로 만든 상태를 엔진에 직접 넣어 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { ENCOUNTER_BY_KEY } from '../src/turby/story/story-data';

const content = new StoryContentService();
const AMBUSH = content.battle('desert_scorched_ambush') as BattleDefinition;
const BOSS = content.battle('desert_boss_golden_doll') as BattleDefinition;
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const hero = (s: Partial<PartyEntry> = {}, id = 't1'): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', attack: 5, defense: 1, actionPower: 3, maxHp: 200, ...s });

function start(def: BattleDefinition, party: PartyEntry[] = [hero()], story: { encounterKey: string; nubiTurbyId?: string } = { encounterKey: def.key }): BattleState {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'desert', spawnIndex: -1, encounterPlayerId: 'a', wild: WILD, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: JSON.parse(JSON.stringify(def)) as BattleDefinition, story });
  submitParty(s, 'a', party);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const mine = (s: BattleState, i = 0) => s.units.filter((x) => x.side === 'party')[i];
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
const attackBy = (s: BattleState, unitId: string, target: string) => applyAction(s, 'a', { type: 'attack', unitId, targetUnitId: target });
function nextRound(s: BattleState): BattleEvent[] {
  const r = s.round;
  return s.phase === 'player_subturn' && s.round === r ? applyAction(s, 'a', { type: 'end' }) : [];
}

// ---------- 정의 ----------

test('정의: 능선 앞 전투·황금 재단인형이 로더·스토리 조우 표에 같은 키로 있고, 승리 사건·목표가 계약대로다', () => {
  assert.deepEqual(ENCOUNTER_BY_KEY.get('desert_scorched_ambush')!.onWinEvents, ['desert_scorched_won']);
  assert.deepEqual(ENCOUNTER_BY_KEY.get('desert_boss_golden_doll')!.onWinEvents, ['desert_boss_defeated']);
  assert.deepEqual(AMBUSH.objectives!.win, [{ kind: 'defeat_units', unitIds: ['scorched_doll_a', 'scorched_doll_b', 'cutting_stitch_a', 'cutting_stitch_b'] }]);
  assert.deepEqual(BOSS.objectives!.win, [{ kind: 'defeat_units', unitIds: ['inner_link'] }], '안쪽 검은 연결을 풀면 풀려 무너진다(파괴 아님)');
  for (const d of [AMBUSH, BOSS]) assert.equal(d.cornerEscape, false);
  assert.ok(AMBUSH.hints!.ember && AMBUSH.hints!.mirage && AMBUSH.hints!.wet && AMBUSH.hints!.cutWarn);
  assert.ok(BOSS.hints!.lineCut && BOSS.hints!.restore && BOSS.hints!.regen && BOSS.hints!.nubiOnly);
  const boss = BOSS.units.find((x) => x.unitId === 'golden_doll')!;
  assert.deepEqual([boss.anchored, boss.targetable, boss.lineCut], [true, false, { length: 3, damage: 3, maxCut: 6 }]);
  assert.deepEqual(BOSS.units.filter((x) => x.regen).map((x) => [x.unitId, x.breakOrder]), [['gold_point_1', 1], ['gold_point_2', 1], ['gold_point_3', 1]]);
  assert.deepEqual(BOSS.units.filter((x) => x.restorer).map((x) => x.name), ['물들이', '오래된 폭신이', '가느리']);
});

// ---------- 능선 앞 ----------

test('불씨: 박음이가 차례를 마칠 때 가장 가까운 아군 칸에 불씨를 두고(칸마다 하나), 2라운드 뒤 그 칸·이웃 칸의 아군만 맞는다', () => {
  const s = start(AMBUSH, [hero(), hero({ name: '보풀이', characterCode: 'bopuli' }, 't2')]);
  const [a, b] = [mine(s, 0), mine(s, 1)];
  const e1 = nextRound(s);
  assert.ok(types(e1).includes('embers'));
  const embers = s.embers!;
  assert.equal(embers.length, new Set(embers.map((x) => x.cell)).size, '같은 칸에 불씨 둘은 없다');
  assert.ok(embers.every((x) => x.explodeRound === 3 && x.damage === 3));
  assert.ok(s.hintsShown!.some((h) => h.code === 'ember'));
  // a는 불씨 칸에 그대로, b는 불씨에서 멀리 비켜 선다
  const target = embers.find((x) => x.cell === `${a.col},${a.row}`) ?? embers[0];
  const [tc, tr] = target.cell.split(',').map(Number);
  a.col = tc;
  a.row = tr;
  b.col = 4;
  b.row = tr <= 3 ? 7 : 0; // 어느 불씨에서도 2칸 이상 떨어진 곳
  const before = [a.hp, b.hp];
  const e3 = nextRound(s); // 2라운드 끝 → 3라운드 시작에 터진다
  assert.equal(s.embers?.some((x) => x.cell === target.cell) ?? false, false, '터진 불씨는 사라진다');
  const burst = e3.filter((x) => x.type === 'ember_burst') as Extract<BattleEvent, { type: 'ember_burst' }>[];
  assert.deepEqual(burst.find((x) => x.cell === target.cell)!.hits.map((x) => [x.unitId, x.damage]), [[a.unitId, 3]]);
  assert.equal(a.hp, before[0] - 3, '불씨 칸의 아군은 3');
  assert.equal(b.hp, before[1], '멀리 비켜 선 아군은 맞지 않는다');
});

test('젖은 칸: 물들이는 열기 환영을 드러낸 박음이 발밑을 아군 차례 전에 적시고, 젖은 칸에서 차례를 시작한 박음이는 불씨를 두지 못한다', () => {
  const s = start(AMBUSH);
  nextRound(s);
  assert.equal(s.wet?.length ?? 0, 0, '환영을 쓴 박음이가 없으면 적시지 않는다(10-26 C5-6 QA-01)');
  // 한 박음이를 쳐서 환영을 드러내게 한 뒤 다음 라운드
  const h = mine(s);
  const wetDoll = u(s, 'scorched_doll_a');
  const dry = u(s, 'scorched_doll_b');
  place(s, wetDoll.unitId, 4, 4);
  h.col = 3;
  h.row = 4;
  h.ap = 3;
  attackBy(s, h.unitId, wetDoll.unitId);
  assert.ok(wetDoll.mirageUsed);
  nextRound(s);
  assert.deepEqual(s.wet!.map((w) => w.cell), [`${wetDoll.col},${wetDoll.row}`], '환영을 쓴 박음이 발밑 한 칸');
  assert.ok(s.hintsShown!.some((x) => x.code === 'wet'));
  // 1라운드 불씨를 지우고 다음 적 차례를 본다: 젖은 박음이는 두지 못하고 마른 박음이만 둔다
  s.embers = [];
  dry.col = 4;
  dry.row = 0; // 젖은 박음이와 다른 줄에서 시작(같은 아군 칸을 노리지 않게 불씨 하나만 본다)
  nextRound(s);
  assert.deepEqual((s.embers ?? []).map((x) => x.by), [dry.unitId], '젖은 칸에서 시작한 박음이는 불씨 없음');
  assert.equal(s.wet!.length, 1, '환영을 아직 쓰지 않은 박음이는 적시지 않는다');
});

test('열기 환영: 마른 박음이를 처음 치면 그 일격을 버티고(HP 1 남김) 한 칸 띄운 자리에 환영이 생기고(한 번만), 환영을 치면 행동만 쓰고 사라진다. 젖은 칸 위면 환영이 없다', () => {
  const s = start(AMBUSH, [hero({ attack: 30, actionPower: 8 })]);
  const h = mine(s);
  place(s, 'scorched_doll_a', 4, 4);
  h.col = 3;
  h.row = 4;
  const e = attackBy(s, h.unitId, 'scorched_doll_a');
  const m = e.find((x) => x.type === 'mirage') as Extract<BattleEvent, { type: 'mirage' }>;
  assert.ok(m, '환영 생김');
  const mirage = u(s, m.mirageId);
  assert.deepEqual([mirage.mirageOf, mirage.hp, mirage.characterCode], ['scorched_doll_a', 1, 'heat_mirage']);
  assert.deepEqual([u(s, 'scorched_doll_a').hp, u(s, 'scorched_doll_a').stunned], [1, false], '누비 혼자 센 일격이어도 첫 일격은 버틴다');
  assert.equal(Math.abs(mirage.col - 4) + Math.abs(mirage.row - 4), 2, '원본과 한 칸 띄운 자리(QA-02)');
  attackBy(s, h.unitId, 'scorched_doll_a');
  assert.equal(s.units.filter((x) => x.mirageOf).length, 1, '두 번째 피격에는 새 환영 없음');
  assert.equal(u(s, 'scorched_doll_a').stunned, true, '두 번째 일격은 흘리지 못한다');
  if (Math.abs(mirage.col - h.col) + Math.abs(mirage.row - h.row) !== 1) {
    mirage.col = h.col;
    mirage.row = h.row - 1;
  }
  attackBy(s, h.unitId, mirage.unitId);
  assert.deepEqual([mirage.stunned, mirage.fled], [true, true], '환영은 사라진다');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === mirage.unitId)!.mirageOf, 'scorched_doll_a');
  // 젖은 칸 위의 박음이
  const w = start(AMBUSH);
  const wh = mine(w);
  place(w, 'scorched_doll_b', 4, 4);
  wh.col = 3;
  wh.row = 4;
  w.wet = [{ cell: '4,4', untilRound: 9 }];
  assert.ok(!types(attackBy(w, wh.unitId, 'scorched_doll_b')).includes('mirage'), '젖은 칸이면 환영 없음');
  // 젖은 박음이는 첫 일격도 흘리지 못한다
  const w2 = start(AMBUSH, [hero({ attack: 30, actionPower: 8 })]);
  const wh2 = mine(w2);
  place(w2, 'scorched_doll_b', 4, 4);
  wh2.col = 3;
  wh2.row = 4;
  w2.wet = [{ cell: '4,4', untilRound: 9 }];
  attackBy(w2, wh2.unitId, 'scorched_doll_b');
  assert.equal(u(w2, 'scorched_doll_b').stunned, true, '젖은 칸이면 한 번에 쓰러진다');
});

test('재단 실밥이: 아군 곁 칸을 예고하고 매듭을 둔다 → 매듭이 남으면 다음 차례에 그 칸이 끊기고(지나갈 수 없음), 매듭을 끊으면 예고가 취소된다. 합계 3칸', () => {
  const s = start(AMBUSH);
  const h = mine(s);
  nextRound(s);
  assert.equal(s.cutWarns!.length, 2, '실밥이 둘이 하나씩');
  const knots = s.cutWarns!.map((w) => u(s, w.knotId));
  assert.ok(knots.every((k) => k.knotOf && k.hp === 1 && Math.abs(k.col - h.col) + Math.abs(k.row - h.row) === 1), '아군 곁의 매듭');
  assert.ok(s.hintsShown!.some((x) => x.code === 'cutWarn'));
  // 하나는 끊어 취소, 하나는 남긴다
  const [save, keep] = s.cutWarns!.map((w) => ({ ...w }));
  attackBy(s, h.unitId, save.knotId);
  assert.ok(!s.cutWarns!.some((w) => w.cell === save.cell), '매듭을 끊으면 예고 취소');
  nextRound(s);
  assert.ok(s.cut!.includes(keep.cell) && s.blocked!.includes(keep.cell), '남긴 매듭의 칸은 끊긴다');
  assert.ok(!s.cut!.includes(save.cell));
  const [kc, kr] = keep.cell.split(',').map(Number);
  h.ap = 3;
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: h.unitId, targetCol: kc, targetRow: kr })), 'TILE_BLOCKED');
  // 합계 상한 3: 끊긴 칸 + 예고 칸이 3을 넘지 않는다
  for (let i = 0; i < 4; i++) nextRound(s);
  assert.ok((s.cutCount ?? 0) + (s.cutWarns?.length ?? 0) <= 3, `끊긴 ${s.cutCount} + 예고 ${s.cutWarns?.length ?? 0}`);
  assert.ok(toSnapshot(s).cut!.length >= 1);
});

test('능선 앞 승리: 박음이 둘·실밥이 둘을 쓰러뜨리면 이긴다(환영·매듭은 승리 조건이 아니다). 쓰러진 실밥이의 예고는 사라진다', () => {
  const s = start(AMBUSH, [hero({ attack: 30, actionPower: 8 })]);
  const h = mine(s);
  nextRound(s);
  const warnsBy = s.cutWarns!.find((w) => w.by === 'cutting_stitch_a')!;
  for (const id of ['cutting_stitch_a', 'cutting_stitch_b', 'scorched_doll_a', 'scorched_doll_b']) {
    const t = u(s, id);
    h.col = t.col - 1 >= 0 && !s.units.some((x) => x !== h && !x.stunned && x.col === t.col - 1 && x.row === t.row) ? t.col - 1 : t.col + 1;
    h.row = t.row;
    h.ap = 8;
    attackBy(s, h.unitId, id);
    if (!u(s, id).stunned) attackBy(s, h.unitId, id); // 마른 박음이는 첫 일격을 버틴다
    if (id === 'cutting_stitch_a') assert.ok(!s.cutWarns!.some((w) => w.knotId === warnsBy.knotId), '쓰러진 실밥이의 예고 취소');
  }
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'win']);
});

// ---------- 황금 재단인형 ----------

test('줄 절단: 가장 가까운 아군 줄 3칸을 예고 → 다음 적 차례에 끊기(서 있던 아군은 피해 3, 그 칸은 남는다) → 동료가 끊긴 칸 하나를 다시 붙잡는다', () => {
  const s = start(BOSS);
  const h = mine(s);
  const row = h.row;
  nextRound(s);
  assert.deepEqual(s.lineWarns, [`0,${row}`, `1,${row}`, `2,${row}`]);
  assert.ok(s.hintsShown!.some((x) => x.code === 'lineCut'));
  const hp = h.hp;
  const e = nextRound(s);
  const cut = e.find((x) => x.type === 'cut') as Extract<BattleEvent, { type: 'cut' }>;
  assert.deepEqual(cut.cells.sort(), [`0,${row}`, `2,${row}`], '아군이 선 칸은 끊기지 않는다');
  assert.deepEqual(cut.hits.map((x) => [x.unitId, x.damage]), [[h.unitId, 3]]);
  assert.equal(h.hp, hp - 3);
  const restored = e.filter((x) => x.type === 'restored') as Extract<BattleEvent, { type: 'restored' }>[];
  assert.equal(restored.length, 1, '동료 한 명이 한 칸');
  assert.ok(['muldeuli', 'old_pokshini', 'ganeuri'].includes(restored[0].byUnitId));
  assert.equal(s.cut!.length, 1);
  assert.ok(!s.blocked!.includes(restored[0].cell));
});

test('줄 절단 예고는 부위 바로 옆 칸을 빼고, 끊긴 칸이 상한(6)이면 피해만 준다', () => {
  const s = start(BOSS);
  const h = mine(s);
  h.col = 5; // gold_point_2(6,3) 바로 옆
  h.row = 3;
  nextRound(s);
  assert.deepEqual(s.lineWarns, ['4,3'], '부위가 선 칸(6,3)·부위 바로 옆 칸(5,3)은 빼고 예고한다');
  const full = start(BOSS);
  full.cut = ['3,0', '4,0', '5,0', '3,7', '4,7', '5,7'];
  full.blocked = [...full.cut];
  full.lineWarns = ['0,5', '2,5'];
  const e = nextRound(full);
  assert.deepEqual((e.find((x) => x.type === 'cut') as Extract<BattleEvent, { type: 'cut' }>).cells, [], '상한이면 끊지 않는다');
});

test('금빛 연결점: 하나를 끊어도 다른 연결점이 남으면 2라운드 뒤 다시 꿰매진다. 셋을 모두 끊으면 그대로 끊긴 채 남고 안쪽 연결이 열린다', () => {
  const s = start(BOSS, [hero({ actionPower: 8 })]);
  const h = mine(s);
  h.col = 6;
  h.row = 2; // gold_point_1(7,2)·gold_point_2(6,3) 옆
  const e = attackBy(s, h.unitId, 'gold_point_1');
  const regen = e.find((x) => x.type === 'regen') as Extract<BattleEvent, { type: 'regen' }>;
  assert.deepEqual([regen.unitId, regen.reviveRound], ['gold_point_1', 3]);
  assert.ok(s.hintsShown!.some((x) => x.code === 'regen'));
  assert.equal(code(() => attackBy(s, h.unitId, 'inner_link')), 'PART_ORDER', '연결점이 남아 있으면 안쪽 연결은 아직');
  nextRound(s);
  nextRound(s); // 3라운드 시작: 다시 꿰매진다
  assert.equal(u(s, 'gold_point_1').stunned, false, '다시 꿰매졌다');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'gold_point_1')!.regen, true);
  // 한 차례에 셋을 모두 끊는다
  for (const [id, col, row] of [['gold_point_1', 6, 2], ['gold_point_2', 5, 3], ['gold_point_3', 6, 4]] as const) {
    h.col = col;
    h.row = row;
    h.ap = 8;
    attackBy(s, h.unitId, id);
  }
  assert.ok(['gold_point_1', 'gold_point_2', 'gold_point_3'].every((id) => u(s, id).stunned && u(s, id).reviveRound == null), '모두 끊긴 채 남는다');
  nextRound(s);
  nextRound(s);
  assert.ok(['gold_point_1', 'gold_point_2', 'gold_point_3'].every((id) => u(s, id).stunned), '다시 꿰매지지 않는다');
});

test('안쪽 검은 연결: 누비가 아닌 유닛은 행동만 쓰고 피해 0(안내), 이야기 누비가 풀면 승리. 스토리 전투는 서버가 넘긴 누비 개체로 판정한다', () => {
  const s = start(BOSS, [hero({ characterCode: 'bopuli', name: '보풀이' }, 't2'), hero()]);
  const [other, nubi] = [mine(s, 0), mine(s, 1)];
  for (const id of ['gold_point_1', 'gold_point_2', 'gold_point_3']) u(s, id).stunned = true;
  other.col = 6;
  other.row = 3;
  nubi.col = 8;
  nubi.row = 3;
  const e = attackBy(s, other.unitId, 'inner_link');
  assert.deepEqual([(e.find((x) => x.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>).damage, u(s, 'inner_link').stunned], [0, false]);
  assert.ok(s.hintsShown!.some((x) => x.code === 'nubiOnly'));
  attackBy(s, nubi.unitId, 'inner_link');
  assert.deepEqual([u(s, 'inner_link').stunned, s.phase, s.outcome], [true, 'resolved', 'win']);
  // 스토리 전투: 캐릭터 코드가 누비여도 이야기 누비 개체가 아니면 풀 수 없다(야생에서 잡은 누비)
  const t = start(BOSS, [hero({}, 'wild-nubi')], { encounterKey: BOSS.key, nubiTurbyId: 'story-nubi' });
  const wild = mine(t);
  for (const id of ['gold_point_1', 'gold_point_2', 'gold_point_3']) u(t, id).stunned = true;
  wild.col = 6;
  wild.row = 3;
  attackBy(t, wild.unitId, 'inner_link');
  assert.equal(u(t, 'inner_link').stunned, false);
  assert.equal(toSnapshot(t).units.find((x) => x.unitId === 'inner_link')!.nubiOnly, true);
});
