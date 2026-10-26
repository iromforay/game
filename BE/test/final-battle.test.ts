// 10-26 F-3a: 종장 가위 최종 전투 — 한 전투 안의 3단계(잘린 길·잘린 기억·다섯 기억의 매듭). 실제 전투 정의(battles/final_boss_scissors.json)로 만든 상태를 엔진에 직접 넣어 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { ENCOUNTER_BY_KEY } from '../src/turby/story/story-data';

const content = new StoryContentService();
const FINAL = content.battle('final_boss_scissors') as BattleDefinition;
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const hero = (s: Partial<PartyEntry> = {}, id = 't1'): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', attack: 30, defense: 6, actionPower: 4, maxHp: 200, ...s });
const KNOTS = ['relic_knot_1', 'relic_knot_2', 'relic_knot_3', 'relic_knot_4', 'relic_knot_5'];
const THREADS = ['black_thread_name', 'black_thread_memory', 'black_thread_fade', 'black_thread_silence'];

function start(party: PartyEntry[] = [hero()]): BattleState {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'home_core', spawnIndex: -1, encounterPlayerId: 'a', wild: WILD, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: JSON.parse(JSON.stringify(FINAL)) as BattleDefinition, story: { encounterKey: FINAL.key } });
  submitParty(s, 'a', party);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const mine = (s: BattleState, i = 0) => s.units.filter((x) => x.side === 'party')[i];
const types = (e: BattleEvent[]) => e.map((x) => x.type);
const key = (c: number, r: number) => `${c},${r}`;
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}
// 대상 곁의 빈 칸으로 아군을 옮기고 행동력을 채운 뒤 공격한다(경로·차례는 다른 시험이 본다)
function hit(s: BattleState, unitId: string, target: string): BattleEvent[] {
  const h = u(s, unitId);
  const t = u(s, target);
  const taken = new Set(s.units.filter((x) => !x.stunned && !x.inactive && x !== h).map((x) => key(x.col, x.row)));
  const blocked = new Set(s.blocked ?? []);
  const at = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [t.col + dc, t.row + dr]).find(([c, r]) => c >= 0 && r >= 0 && c < 12 && r < 8 && !taken.has(key(c, r)) && !blocked.has(key(c, r)))!;
  [h.col, h.row] = at;
  h.ap = h.maxAp;
  return applyAction(s, 'a', { type: 'attack', unitId, targetUnitId: target });
}
const toStage = (s: BattleState, n: number) => {
  if (n >= 1) for (const k of KNOTS) hit(s, mine(s).unitId, k);
  if (n >= 2) for (const t of THREADS) hit(s, mine(s).unitId, t);
};

test('정의: 3단계(잘린 길·잘린 기억·다섯 기억의 매듭)·목표·조우 표·가위 줄 절단이 계약대로다', () => {
  assert.deepEqual(ENCOUNTER_BY_KEY.get('final_boss_scissors'), { key: 'final_boss_scissors', chapter: 6, stageCode: 'home_core', allowedAt: ['CHFINAL_IDENTITY_REVEALED'], requires: ['final_identity_revealed'], onWinEvents: ['final_boss_defeated'] });
  assert.deepEqual(FINAL.stages!.map((x) => [x.id, x.label, x.objectives.win]), [
    ['cut_path', '1단계 — 잘린 길', [{ kind: 'defeat_units', unitIds: KNOTS }]],
    ['cut_memory', '2단계 — 잘린 기억', [{ kind: 'defeat_units', unitIds: THREADS }]],
    ['five_knot', '3단계 — 다섯 기억의 매듭', [{ kind: 'defeat_units', unitIds: ['five_knot'] }]],
  ]);
  assert.deepEqual(FINAL.stages![0].units.map((x) => [x.name, x.thread!.order]), [['첫 매듭', 1], ['물빛 염색실', 2], ['오래된 솜심', 3], ['얼음 극세사', 4], ['금빛 마감실', 5]], '정본 순서');
  const scissors = FINAL.units.find((x) => x.unitId === 'scissors')!;
  assert.deepEqual([scissors.anchored, scissors.targetable, scissors.lineCut], [true, false, { length: 3, damage: 3, maxCut: 8 }]);
  assert.deepEqual(FINAL.units.filter((x) => x.restorer).map((x) => x.name), ['물들이', '오래된 폭신이', '가느리', '보풀이']);
  assert.equal(FINAL.cornerEscape, false);
});

test('1단계 잘린 길: 벽 네 줄이 다섯 구역으로 나누고, 유물 매듭을 순서대로 끊을 때마다 다음 벽의 한 칸이 이어져 봉합된다(순서가 아니면 효과 없음)', () => {
  const s = start();
  const h = mine(s);
  assert.deepEqual(toSnapshot(s).stage, { index: 0, total: 3, id: 'cut_path', label: '1단계 — 잘린 길' });
  for (const col of [2, 4, 6, 8]) for (let row = 0; row < 8; row++) assert.ok(s.blocked!.includes(key(col, row)), `벽 ${col},${row}`);
  assert.deepEqual(toSnapshot(s).units.filter((x) => x.hinted).map((x) => x.unitId), ['relic_knot_1'], '첫 매듭이 다음 매듭');
  // 순서가 아닌 매듭: 행동만 쓰고 혼란, 길은 그대로
  const wrong = hit(s, h.unitId, 'relic_knot_2');
  assert.ok(types(wrong).includes('wrong_thread'));
  assert.ok(s.blocked!.includes(key(4, 6)));
  h.statuses = [];
  const e = hit(s, h.unitId, 'relic_knot_1');
  assert.ok(e.some((x) => x.type === 'restored' && x.cell === key(2, 1)), '첫 벽에 길이 이어진다');
  assert.deepEqual([s.blocked!.includes(key(2, 1)), s.sealed], [false, [key(2, 1)]]);
  assert.equal(u(s, 'relic_knot_1').fled, true, '끊은 매듭은 화면에서 걷힌다');
  for (const k of KNOTS.slice(1, 4)) hit(s, h.unitId, k);
  assert.deepEqual(s.sealed, [key(2, 1), key(4, 6), key(6, 1), key(8, 6)]);
  assert.equal(s.stageIndex, 0, '다섯째 전에는 단계가 그대로');
  const last = hit(s, h.unitId, 'relic_knot_5');
  const st = last.find((x) => x.type === 'stage') as Extract<BattleEvent, { type: 'stage' }>;
  assert.deepEqual([st.index, st.total, st.id, s.phase], [1, 3, 'cut_memory', 'player_subturn'], '마지막 매듭 → 2단계(승리 아님)');
});

test('가위 줄 절단: 봉합된 칸은 예고·절단하지 않는다', () => {
  const s = start();
  const h = mine(s);
  hit(s, h.unitId, 'relic_knot_1');
  [h.col, h.row] = [2, 1]; // 봉합된 길 위
  u(s, 'relic_knot_2').col = 3; // (매듭이 줄 위에 오지 않게 둔다)
  applyAction(s, 'a', { type: 'end' });
  assert.ok(!(s.lineWarns ?? []).includes(key(2, 1)) && !(s.cut ?? []).includes(key(2, 1)));
});

test('2단계 잘린 기억: 벽이 걷히고 누비 환영 넷·검정실 넷. 환영을 치면 피해 0·가위가 곁 칸을 끊고, 이어진 검정실을 끊으면 그 환영이 사라진다', () => {
  const s = start();
  const h = mine(s);
  toStage(s, 1);
  for (const col of [2, 4, 6, 8]) assert.ok(!s.blocked!.filter((k) => !(s.cut ?? []).includes(k)).includes(key(col, 3)), `벽 ${col}열 걷힘`);
  assert.ok(KNOTS.every((k) => u(s, k).fled), '1단계 유닛은 걷힌다');
  const phantoms = s.units.filter((x) => x.phantom);
  assert.deepEqual(phantoms.map((x) => x.name), ['이름을 잊은 누비', '흔들리는 누비', '사라질까 두려운 누비', '말을 피하는 누비']);
  const e = hit(s, h.unitId, 'phantom_name');
  const ph = e.find((x) => x.type === 'phantom_hit') as Extract<BattleEvent, { type: 'phantom_hit' }>;
  assert.ok(ph && ph.cell && s.cut!.includes(ph.cell), '환영을 치면 가위가 곁 칸을 끊는다');
  assert.ok(e.some((x) => x.type === 'attack' && x.targetId === 'phantom_name' && x.damage === 0));
  assert.equal(u(s, 'phantom_name').stunned, false, '환영은 쳐도 사라지지 않는다');
  assert.ok(s.hintsShown!.some((x) => x.code === 'phantom'));
  const cut = hit(s, h.unitId, 'black_thread_name');
  assert.ok(cut.some((x) => x.type === 'unit_exit' && x.unitId === 'phantom_name'));
  assert.equal(u(s, 'phantom_name').fled, true);
  for (const t of THREADS.slice(1)) hit(s, h.unitId, t);
  assert.equal(s.stageIndex, 2);
  assert.ok(phantoms.every((x) => x.fled), '검정실을 다 끊으면 환영도 다 걷힌다');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'scissors')!.phase, 'bound', '3단계: 가위가 두 날로 버틴다');
});

test('3단계 다섯 기억의 매듭: 두 날 전에는 순서 거부, 다른 터비는 피해 0, 이야기 누비가 묶으면 승리(가위는 묶여 풀림 — 파괴 아님)', () => {
  const s = start([hero(), hero({ characterCode: 'bopuli', name: '보풀이' }, 't2')]);
  const [nubi, other] = [mine(s, 0), mine(s, 1)];
  toStage(s, 2);
  assert.equal(code(() => hit(s, nubi.unitId, 'five_knot')), 'PART_ORDER');
  hit(s, other.unitId, 'blade_upper');
  hit(s, other.unitId, 'blade_lower');
  const zero = hit(s, other.unitId, 'five_knot');
  assert.ok(zero.some((x) => x.type === 'attack' && x.damage === 0));
  assert.equal(s.phase, 'player_subturn');
  const win = hit(s, nubi.unitId, 'five_knot');
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'win']);
  assert.ok(win.some((x) => x.type === 'phase' && x.unitId === 'scissors' && x.phase === 'exposed'));
  assert.equal(u(s, 'scissors').stunned, false, '가위는 쓰러뜨리지 않는다');
});

test('단계 전환: 앞 단계에서 끊긴 칸에 다음 단계 유닛이 놓이면 그 칸이 다시 열린다', () => {
  const s = start();
  toStage(s, 1);
  s.cut = [...(s.cut ?? []), '7,2'];
  s.blocked = [...(s.blocked ?? []), '7,2'];
  for (const t of THREADS) hit(s, mine(s).unitId, t);
  assert.equal(s.stageIndex, 2);
  assert.ok(!s.blocked!.includes('7,2') && !(s.cut ?? []).includes('7,2'), '윗날 자리는 열린다');
});
