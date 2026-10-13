// M4-A 전투 엔진 확장 테스트(테스트 우선 작성) — 기믹은 전투 정의 데이터로만 받는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, BattleUnitDefinition, PartyEntry } from '../src/turby/battle/battle-types';

const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const hero = (s: Partial<PartyEntry> = {}): PartyEntry => ({ turbyId: 't1', characterCode: 'nubi', name: '누비', attack: 20, defense: 4, actionPower: 4, maxHp: 40, ...s });
const enemy = (s: Partial<BattleUnitDefinition> & Pick<BattleUnitDefinition, 'unitId'>): BattleUnitDefinition => ({ side: 'wild', characterCode: 'stitchling', name: '실밥이', col: 10, row: 1, attack: 6, defense: 2, actionPower: 1, maxHp: 10, ...s });

// 1인 파티(누비 1마리 = p1-0, 시작 칸 (1,4))로 정의 전투를 시작한다
function start(def: BattleDefinition, party: PartyEntry[] = [hero()]): BattleState {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'forest', spawnIndex: 0, encounterPlayerId: 'a', wild: WILD, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: def });
  submitParty(s, 'a', party);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const act = (s: BattleState, req: Parameters<typeof applyAction>[2]) => applyAction(s, 'a', req);
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}
const types = (evts: BattleEvent[]) => evts.map((e) => e.type);

test('정의 전투: 야생 1마리 대신 정의의 적·NPC가 배치되고 꼭짓점 도주가 꺼진다', () => {
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1' }), enemy({ unitId: 'npc', side: 'neutral', targetable: false, canAct: false })], cornerEscape: false });
  assert.deepEqual(s.units.map((x) => x.unitId), ['p1-0', 'e1', 'npc']);
  assert.equal(s.units.some((x) => x.unitId === 'wild'), false);
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 0, targetRow: 7 }); // (1,4)→(0,7) 거리 4, 꼭짓점
  assert.equal(s.phase === 'resolved', false, '스토리 전투는 꼭짓점 도착이 무승부가 아니다');
});

test('상태 이상: 속박은 이동력을 줄이고 지속 턴이 지나면 풀린다(적 공격으로 걸림)', () => {
  const bind = { kind: 'bind' as const, turns: 2, movePenalty: 2 };
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1', col: 2, row: 4, onHit: bind, attack: 1 })] });
  const evts = act(s, { type: 'end' }); // 적 차례: 인접한 누비를 공격하며 속박
  assert.ok(types(evts).includes('status'));
  assert.deepEqual(u(s, 'p1-0').statuses?.map((x) => [x.kind, x.turnsLeft]), [['bind', 2]]);
  // 이번 라운드(AP 4): 이동은 4-2=2칸까지만
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 7 })), 'OUT_OF_RANGE', '3칸은 속박으로 불가');
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 6 }); // 2칸
  act(s, { type: 'end' }); // 적 차례(떨어져 있어 다가오기만) → 다음 라운드: 1턴 남음
  assert.equal(u(s, 'p1-0').statuses?.[0]?.turnsLeft, 1);
  act(s, { type: 'end' }); // 다음 라운드 시작 → 해제
  assert.deepEqual(u(s, 'p1-0').statuses ?? [], [], '지속 턴이 끝나면 복구');
});

test('상태 이상: 이동력 감소가 0 미만으로 내려가지 않고, 공격은 막지 않는다', () => {
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1', col: 2, row: 4, maxHp: 100, attack: 1, onHit: { kind: 'bind', turns: 3, movePenalty: 99 } })] });
  act(s, { type: 'end' });
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 5 })), 'OUT_OF_RANGE', '이동 가능 0');
  const before = u(s, 'e1').hp;
  act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'e1' });
  assert.ok(u(s, 'e1').hp < before, '속박 중에도 인접 공격 가능');
});

test('공격 불가 NPC: 아군 공격 대상에서 제외되고, 적 AI도 노리지 않는다', () => {
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1', col: 4, row: 4, actionPower: 3 }), enemy({ unitId: 'bopuli', side: 'neutral', characterCode: 'bopuli', name: '보풀이', col: 2, row: 4, targetable: false, canAct: false })] });
  assert.equal(code(() => act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'bopuli' })), 'INVALID_TARGET');
  act(s, { type: 'end' });
  assert.equal(u(s, 'bopuli').hp, u(s, 'bopuli').maxHp, '적 AI가 공격하지 않음');
  assert.equal(s.phase, 'player_subturn', 'NPC는 차례가 없다');
});

test('보호 대상 NPC가 쓰러지면 전투 목표 실패(패배)', () => {
  const s = start({
    key: 'k',
    units: [enemy({ unitId: 'e1', col: 9, row: 1, attack: 50 }), enemy({ unitId: 'guest', side: 'neutral', col: 9, row: 2, maxHp: 5, targetable: false, threatened: true, canAct: false })],
    objectives: { lose: [{ kind: 'protect', unitIds: ['guest'] }] },
  });
  act(s, { type: 'end' }); // 적은 가장 가까운 대상(보호 NPC)을 공격
  assert.equal(u(s, 'guest').stunned, true);
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'lose']);
});

test('부위 파괴 순서: 외부 부위가 남아 있으면 중심부 피해 무효, 순서대로 부순 뒤 중심부 파괴로 승리', () => {
  const core = enemy({ unitId: 'core', characterCode: 'giant_knot', name: '거대 실밥 매듭', col: 2, row: 4, maxHp: 30, canAct: false });
  const partA = enemy({ unitId: 'strand_a', col: 1, row: 3, maxHp: 5, partOf: 'core', breakOrder: 1, canAct: false });
  const partB = enemy({ unitId: 'strand_b', col: 1, row: 5, maxHp: 5, partOf: 'core', breakOrder: 2, canAct: false });
  const s = start({ key: 'k', units: [core, partA, partB], objectives: { win: [{ kind: 'defeat_units', unitIds: ['core'] }] } }, [hero({ actionPower: 9, attack: 20 })]);

  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'core')?.invulnerable, true);
  assert.equal(code(() => act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'core' })), 'TARGET_PROTECTED', '중심부 피해 무효');
  assert.equal(u(s, 'core').hp, 30);
  assert.equal(code(() => act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'strand_b' })), 'PART_ORDER', '순서가 아닌 부위');

  const e1 = act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'strand_a' });
  assert.ok(e1.some((e) => e.type === 'part_broken' && !e.coreExposed));
  const e2 = act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'strand_b' });
  assert.ok(e2.some((e) => e.type === 'part_broken' && e.coreExposed), '모든 부위 파괴 → 중심부 노출');
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'core')?.invulnerable, false);

  act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'core' });
  assert.equal(u(s, 'core').hp, 30 - (20 - 1), '노출 후 피해 가능');
  act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'core' });
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'win']);
});

test('지형: 통행 불가 칸으로는 이동할 수 없고, 막힌 칸을 돌아가는 경로 비용으로 판정한다', () => {
  // (2,4)가 막혀 있으면 (1,4)→(3,4)는 맨해튼 2가 아니라 우회 4
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1', col: 10, row: 0 })], blocked: [{ col: 2, row: 4 }] }, [hero({ actionPower: 3 })]);
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 2, targetRow: 4 })), 'TILE_BLOCKED');
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 3, targetRow: 4 })), 'OUT_OF_RANGE', '우회 경로 4 > AP 3');
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 5 });
  assert.equal(u(s, 'p1-0').ap, 2);
});

test('지형: 라운드 시작마다 규칙대로 막히고, 바뀐 지형으로 경로 판정이 갱신된다', () => {
  const s = start({ key: 'k', units: [enemy({ unitId: 'e1', col: 10, row: 0, canAct: false })], terrainRules: [{ everyRounds: 1, cells: [{ col: 2, row: 4 }], mode: 'toggle' }] }, [hero({ actionPower: 3 })]);
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 3, targetRow: 4 })), 'NO_ERROR', '1라운드: 열려 있어 2칸');
  const evts = act(s, { type: 'end' }); // 2라운드 시작 → (2,4) 막힘
  assert.ok(evts.some((e) => e.type === 'terrain' && e.blocked.includes('2,4')));
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 4 })), 'OUT_OF_RANGE', '(3,4)→(1,4): (2,4)가 막혀 우회 4 > AP 3');
  assert.equal(u(s, 'p1-0').col, 3, '막혀서 이동하지 못함');
});

test('도주 연출 유닛은 적 전멸 판정을 막지 않고 승패에도 영향 없음', () => {
  const s = start({ key: 'k', units: [enemy({ unitId: 'runner', col: 2, row: 4, exitOnDefeat: 'flee', canAct: false }), enemy({ unitId: 'e2', col: 1, row: 3, canAct: false })] }, [hero({ actionPower: 9 })]);
  const e1 = act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'runner' });
  assert.ok(e1.some((e) => e.type === 'unit_exit'));
  assert.equal(u(s, 'runner').fled, true);
  assert.equal(s.phase, 'player_subturn', '아직 e2가 남음');
  act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'e2' });
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'win'], '도주한 유닛도 쓰러진 것으로 셈');
});

test('정의 없는 기존 야생 전투: 새 필드 없이 기존 결과와 같다', () => {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'forest', spawnIndex: 0, encounterPlayerId: 'a', wild: { code: 'bopuli', name: '보풀이', stats: { attack: 8, defense: 6, actionPower: 7, maxHp: 28 } }, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }] });
  submitParty(s, 'a', [hero({ attack: 50, defense: 8, actionPower: 6, maxHp: 30 })]);
  const snap = toSnapshot(s);
  assert.deepEqual(snap.units.map((x) => x.unitId), ['p1-0', 'wild']);
  assert.equal(snap.blocked, undefined);
  assert.equal(snap.units[1].invulnerable, undefined);
  // 꼭짓점 도착은 여전히 무승부
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 0, targetRow: 7 });
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'draw']);
});

// ---------- 10-13 C2-3: 젖은 속박(wet_bind) ----------

const WET = { kind: 'wet_bind' as const, turns: 1, movePenalty: 1 };
const wetEnemy = (s: Partial<BattleUnitDefinition> = {}) => enemy({ unitId: 'e1', characterCode: 'wet_stitchling', name: '젖은 실밥이', col: 2, row: 4, attack: 1, maxHp: 100, onHit: WET, ...s });

test('젖은 속박: 적의 지정 공격이 적중하면 대상에게 1회 걸리고, 다음 이동 한 번의 가능 거리만 1칸 줄고 즉시 해제된다', () => {
  const s = start({ key: 'k', units: [wetEnemy()] }, [hero({ actionPower: 4 })]);
  const evts = act(s, { type: 'end' }); // 적 차례: 인접한 누비를 공격
  assert.ok(types(evts).includes('status'));
  assert.deepEqual(u(s, 'p1-0').statuses?.map((x) => x.kind), ['wet_bind']);
  // AP 4 → 이동 가능 3칸. 4칸은 불가, 3칸은 가능하고 이동하면 해제
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 0, targetRow: 7 })), 'OUT_OF_RANGE', '(1,4)→(0,7)=4칸 > 3');
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 7 }); // 3칸
  assert.deepEqual(u(s, 'p1-0').statuses ?? [], [], '이동 한 번에 해제');
  assert.equal(u(s, 'p1-0').ap, 1);
});

test('젖은 속박: 최소 1칸 보장(AP 1이면 줄지 않음), 공격·턴 종료는 막지도 소비하지도 않으며, 중첩·지속 갱신이 없다', () => {
  const s = start({ key: 'k', units: [wetEnemy({ maxHp: 500 })] }, [hero({ actionPower: 1 })]);
  act(s, { type: 'end' }); // 적이 공격 → wet_bind (적 AP 1)
  assert.deepEqual(u(s, 'p1-0').statuses?.map((x) => x.kind), ['wet_bind']);
  // 공격은 막지 않고 속박을 소비하지 않는다
  act(s, { type: 'attack', unitId: 'p1-0', targetUnitId: 'e1' });
  assert.equal(u(s, 'p1-0').statuses?.length, 1, '공격은 소비하지 않는다');
  // 라운드가 지나도(시간으로) 풀리지 않고, 적이 또 맞혀도 중첩·갱신 없음
  act(s, { type: 'end' });
  act(s, { type: 'end' });
  const w = u(s, 'p1-0').statuses!;
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'wet_bind');
  // AP 1: 이동 가능 거리 1칸(0칸이 되지 않는다)
  assert.equal(u(s, 'p1-0').ap, 1);
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 5 });
  assert.deepEqual(u(s, 'p1-0').statuses ?? [], []);
});

test('젖은 속박과 기존 bind는 별개이며 함께 걸릴 수 있다(bind는 지속 턴, wet_bind는 이동 1회)', () => {
  const s = start({ key: 'k', units: [wetEnemy({ onHit: WET }), enemy({ unitId: 'e2', col: 1, row: 5, attack: 1, maxHp: 100, onHit: { kind: 'bind', turns: 2, movePenalty: 1 } })] }, [hero({ actionPower: 5 })]);
  act(s, { type: 'end' });
  const kinds = u(s, 'p1-0').statuses!.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['bind', 'wet_bind']);
  // AP 5 → bind -1 = 4, wet_bind -1 = 3칸
  assert.equal(code(() => act(s, { type: 'move', unitId: 'p1-0', targetCol: 0, targetRow: 7 })), 'OUT_OF_RANGE', '4칸 불가');
  act(s, { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 7 });
  assert.deepEqual(u(s, 'p1-0').statuses!.map((x) => x.kind), ['bind'], 'wet_bind만 해제');
});
