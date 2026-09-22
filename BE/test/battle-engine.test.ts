import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, closeInvites, closePartySelect, createBattle, currentPlayerId, expireSubturn, partyLimit, removeParticipant, respondInvite, setConnected, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';

const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'bopuli', name: '보풀이', stats: { attack: 8, defense: 6, actionPower: 7, maxHp: 28 } };
const entry = (id: string, s: Partial<PartyEntry> = {}): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', attack: 50, defense: 8, actionPower: 6, maxHp: 30, ...s });

function make(players: string[], wild = WILD, rules = RULES, invited = false): BattleState {
  return createBattle({ battleId: 'b1', roomCode: 'ROOM1', stageCode: 'forest', spawnIndex: 0, encounterPlayerId: players[0], wild, rules, participants: players.map((p, i) => ({ playerId: p, nickname: p, slot: i + 1, connected: true, invited: invited && i > 0 })) });
}
function start(players: string[], parties: PartyEntry[][], wild = WILD, rules = RULES) {
  const s = make(players, wild, rules);
  players.forEach((p, i) => submitParty(s, p, parties[i]));
  return s;
}
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

test('1인 시작: 기존 로컬과 같은 배치(4행 정중앙)와 야생 위치, 야생 HP 배율 1.0', () => {
  const s = start(['a'], [[entry('t1')]]);
  assert.equal(s.phase, 'player_subturn');
  assert.deepEqual([unit(s, 'p1-0').col, unit(s, 'p1-0').row], [1, 4]);
  assert.deepEqual([unit(s, 'wild').col, unit(s, 'wild').row], [10, 4]);
  assert.equal(unit(s, 'wild').maxHp, 28);
  assert.equal(currentPlayerId(s), 'a');
  assert.equal(s.round, 1);
});

test('파티 제출 검증: 상한·중복 제출', () => {
  const s = make(['a']);
  assert.equal(partyLimit(s), 5);
  assert.equal(code(() => submitParty(s, 'a', [])), 'PARTY_LIMIT');
  assert.equal(code(() => submitParty(s, 'a', Array.from({ length: 6 }, (_, i) => entry(`t${i}`)))), 'PARTY_LIMIT');
  assert.equal(code(() => submitParty(s, 'zz', [entry('t1')])), 'NOT_PARTICIPANT');
  submitParty(s, 'a', [entry('t1')]);
  assert.equal(code(() => submitParty(s, 'a', [entry('t1')])), 'INVALID_PHASE');
});

test('5마리 파티는 8행에 균등 분산 배치', () => {
  const s = start(['a'], [Array.from({ length: 5 }, (_, i) => entry(`t${i}`))]);
  assert.deepEqual(
    s.units.filter((u) => u.side === 'party').map((u) => u.row),
    [1, 2, 4, 6, 7],
  );
});

test('이동: 맨해튼 거리만큼 AP, 범위·점유·경계 검증', () => {
  const s = start(['a'], [[entry('t1', { actionPower: 4 })]]);
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 4 })), 'INVALID_TARGET'); // 제자리
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 1.5, targetRow: 4 })), 'INVALID_TARGET');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 12, targetRow: 4 })), 'INVALID_TARGET');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 8, targetRow: 4 })), 'OUT_OF_RANGE');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'nope', targetCol: 2, targetRow: 4 })), 'INVALID_UNIT');
  const ev = applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 3, targetRow: 5 });
  assert.equal(ev[0].type, 'move');
  assert.equal(unit(s, 'p1-0').ap, 1); // 거리 3
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 5, targetRow: 5 })), 'OUT_OF_RANGE');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'wild', targetCol: 5, targetRow: 5 })), 'INVALID_UNIT');
});

test('점유 칸 이동 거부(야생·아군), 기절 유닛 칸은 점유하지 않음', () => {
  const s = start(['a'], [[entry('t1', { actionPower: 20 }), entry('t2', { actionPower: 20 })]]);
  const a = unit(s, 'p1-0');
  const b = unit(s, 'p1-1');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: b.col, targetRow: b.row })), 'TILE_OCCUPIED');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 10, targetRow: 4 })), 'TILE_OCCUPIED');
  b.stunned = true;
  applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: b.col, targetRow: b.row });
  assert.equal(a.col, b.col);
});

test('공격: 인접만 가능, 피해=max(1, 공격-floor(방어/2)), 야생 기절 → 승리 후 행동 거부', () => {
  const s = start(['a'], [[entry('t1', { attack: 10, actionPower: 20 })]], { ...WILD, stats: { attack: 8, defense: 6, actionPower: 7, maxHp: 14 } });
  assert.equal(code(() => applyAction(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'wild' })), 'OUT_OF_RANGE');
  applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 9, targetRow: 4 }); // 거리 8
  assert.equal(code(() => applyAction(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'p1-0' })), 'INVALID_TARGET');
  let ev = applyAction(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'wild' });
  assert.deepEqual([(ev[0] as { damage: number }).damage, unit(s, 'wild').hp], [7, 7]); // 10 - floor(6/2)
  ev = applyAction(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'wild' });
  assert.equal(s.phase, 'resolved');
  assert.equal(s.outcome, 'win');
  assert.equal(ev[ev.length - 1].type, 'resolved');
  assert.equal(code(() => applyAction(s, 'a', { type: 'end' })), 'BATTLE_RESOLVED');
});

test('최소 피해 1 보장', () => {
  const s = start(['a'], [[entry('t1', { attack: 1, actionPower: 20 })]], { ...WILD, stats: { attack: 8, defense: 100, actionPower: 7, maxHp: 28 } });
  applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 9, targetRow: 4 });
  const ev = applyAction(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'wild' });
  assert.equal((ev[0] as { damage: number }).damage, 1);
});

test('AP 전소 시 자동으로 야생 차례 → 새 라운드에 AP 회복', () => {
  const s = start(['a'], [[entry('t1', { actionPower: 2 })]]);
  const ev = applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 3, targetRow: 4 }); // AP 0
  const phases = ev.filter((e) => e.type === 'subturn').map((e) => (e as { phase: string }).phase);
  assert.deepEqual(phases, ['wild_turn', 'player_subturn']);
  assert.equal(s.round, 2);
  assert.equal(unit(s, 'p1-0').ap, 2);
  assert.equal(currentPlayerId(s), 'a');
  // 야생은 AP 7만큼 아군 쪽(가로 우선)으로 접근: 10 → 3+1 인접까지 6칸 이동 후 공격 1회
  assert.equal(unit(s, 'wild').col, 4);
  assert.equal(unit(s, 'p1-0').hp, 30 - Math.max(1, 8 - Math.floor(8 / 2)));
});

test('end 요청은 남은 AP를 모두 버리고 차례를 넘긴다', () => {
  const s = start(['a'], [[entry('t1')]]);
  applyAction(s, 'a', { type: 'end' });
  assert.equal(s.round, 2);
  assert.equal(unit(s, 'p1-0').ap, 6);
});

test('아군 전원 기절 → 패배', () => {
  const s = start(['a'], [[entry('t1', { maxHp: 1, defense: 0, actionPower: 1 })]], { ...WILD, stats: { attack: 30, defense: 6, actionPower: 20, maxHp: 28 } });
  applyAction(s, 'a', { type: 'end' });
  assert.equal(s.outcome, 'lose');
  assert.equal(unit(s, 'p1-0').stunned, true);
});

test('꼭짓점 도착 → 즉시 무승부(아군 이동)', () => {
  const s = start(['a'], [[entry('t1', { actionPower: 20 })]]);
  applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 1, targetRow: 7 });
  applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 0, targetRow: 7 });
  assert.equal(s.outcome, 'draw');
});

test('꼭짓점 도착 → 즉시 무승부(야생 이동)', () => {
  const s = start(['a'], [[entry('t1', { actionPower: 1 })]]);
  const wild = unit(s, 'wild');
  wild.col = 10;
  wild.row = 0;
  unit(s, 'p1-0').col = 11;
  unit(s, 'p1-0').row = 1;
  // 야생(10,0) → 아군(11,1): 가로 우선이라 (11,0)=꼭짓점에 도착
  applyAction(s, 'a', { type: 'end' });
  assert.equal(s.outcome, 'draw');
});

test('야생 AI 동률 목표: participantSlot → partyOrder → unitId 순', () => {
  const s = start(['a', 'b'], [[entry('t1', { actionPower: 1 }), entry('t2', { actionPower: 1 })], [entry('t3', { actionPower: 1 })]]);
  const wild = unit(s, 'wild');
  wild.col = 6;
  wild.row = 4;
  const p10 = unit(s, 'p1-0');
  const p11 = unit(s, 'p1-1');
  const p20 = unit(s, 'p2-0');
  p10.col = 5; p10.row = 4; // 거리 1
  p11.col = 7; p11.row = 4; // 거리 1
  p20.col = 6; p20.row = 5; // 거리 1
  p11.stunned = false;
  applyAction(s, 'a', { type: 'end' });
  applyAction(s, 'b', { type: 'end' });
  // 슬롯 1의 첫 유닛(p1-0)이 먼저 맞는다
  assert.ok(p10.hp < p10.maxHp);
});

test('다인: 서브턴 순서·타인 행동 거부·야생 HP 배율', () => {
  const s = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  assert.equal(unit(s, 'wild').maxHp, 42); // 28 × 1.5
  assert.equal(currentPlayerId(s), 'a');
  assert.equal(code(() => applyAction(s, 'b', { type: 'end' })), 'NOT_YOUR_SUBTURN');
  assert.equal(code(() => applyAction(s, 'a', { type: 'move', unitId: 'p2-0', targetCol: 2, targetRow: 4 })), 'UNIT_NOT_OWNED');
  applyAction(s, 'a', { type: 'end' });
  assert.equal(currentPlayerId(s), 'b');
  assert.equal(s.round, 1);
  applyAction(s, 'b', { type: 'end' });
  assert.equal(currentPlayerId(s), 'a');
  assert.equal(s.round, 2);
});

test('다인 파티 상한: 2인 각 2마리, 5인 각 1마리', () => {
  assert.equal(partyLimit(make(['a', 'b'])), 2);
  assert.equal(partyLimit(make(['a', 'b', 'c', 'd', 'e'])), 1);
});

test('일시 이탈(away): 현재 서브턴이면 자동 종료, 이후 서브턴 건너뜀, 유닛은 전장에 남음', () => {
  const s = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  setConnected(s, 'a', false);
  assert.equal(currentPlayerId(s), 'b');
  assert.equal(unit(s, 'p1-0').inactive, false);
  applyAction(s, 'b', { type: 'end' });
  assert.equal(s.round, 2);
  assert.equal(currentPlayerId(s), 'b'); // a는 건너뜀
  setConnected(s, 'a', true);
  applyAction(s, 'b', { type: 'end' });
  assert.equal(currentPlayerId(s), 'a');
  assert.equal(s.participants[0].eligibleForReward, true);
});

test('전원 away면 멈춰서 기다린다(무한 라운드 없음)', () => {
  const s = start(['a'], [[entry('t1')]]);
  setConnected(s, 'a', false);
  const round = s.round;
  assert.equal(s.round, round);
  assert.equal(s.phase, 'player_subturn');
  setConnected(s, 'a', true);
  applyAction(s, 'a', { type: 'end' });
  assert.equal(s.round, round + 1);
});

test('명시 퇴장: 보상 자격 제거·유닛 제거·서브턴 넘김, 마지막 참전자면 전투 취소', () => {
  const s = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  const ev = removeParticipant(s, 'a', 'left');
  assert.equal(ev[0].type, 'participant_left');
  assert.equal(s.participants[0].eligibleForReward, false);
  assert.equal(unit(s, 'p1-0').inactive, true);
  assert.equal(currentPlayerId(s), 'b');
  assert.equal(code(() => applyAction(s, 'a', { type: 'end' })), 'NOT_PARTICIPANT');
  removeParticipant(s, 'b', 'timeout');
  assert.equal(s.outcome, 'cancelled');
});

test('파티 선택 중 퇴장/시간 초과: 남은 제출자로 시작, 전원 이탈이면 취소', () => {
  const s = make(['a', 'b']);
  submitParty(s, 'a', [entry('t1')]);
  closePartySelect(s);
  assert.equal(s.phase, 'player_subturn');
  assert.deepEqual(s.turnOrder, ['a']);
  assert.equal(s.participants[1].eligibleForReward, false);
  assert.equal(unit(s, 'wild').maxHp, 28); // 확정 참전자 1명 기준 배율

  const t = make(['a']);
  removeParticipant(t, 'a', 'left');
  assert.equal(t.outcome, 'cancelled');
});

test('버전은 이벤트마다 1씩 증가하고 스냅샷이 같은 버전을 가진다', () => {
  const s = start(['a'], [[entry('t1')]]);
  const before = s.version;
  const ev = applyAction(s, 'a', { type: 'move', unitId: 'p1-0', targetCol: 2, targetRow: 4 });
  assert.deepEqual(ev.map((e) => e.version), Array.from({ length: ev.length }, (_, i) => before + i + 1));
  assert.equal(toSnapshot(s).version, s.version);
});

// ---------- 4-C: 초대·서브턴 시간 초과 ----------

test('초대: 응답이 모두 모이면 파티 선택으로, 불참자는 자격 없이 빠짐', () => {
  const s = make(['a', 'b', 'c'], WILD, RULES, true);
  assert.equal(s.phase, 'inviting');
  assert.equal(s.participants[1].invitePending, true);
  assert.equal(s.participants[0].invitePending, false); // 조우자는 자동 참전
  assert.equal(code(() => submitParty(s, 'a', [entry('t1')])), 'INVALID_PHASE');
  respondInvite(s, 'b', true);
  assert.equal(s.phase, 'inviting'); // c가 아직
  const ev = respondInvite(s, 'c', false);
  assert.equal(ev[0].type, 'participant_left');
  assert.equal(s.phase, 'party_select');
  assert.equal(s.participants[2].active, false);
  assert.equal(s.participants[2].eligibleForReward, false);
  assert.equal(s.participants[2].leftReason, 'declined');
  assert.equal(partyLimit(s), 2); // 참전자 2명 → 각 2마리
  submitParty(s, 'b', [entry('t2')]);
  assert.equal(s.phase, 'party_select');
  submitParty(s, 'a', [entry('t1')]);
  assert.equal(s.phase, 'player_subturn');
  assert.deepEqual(s.turnOrder, ['a', 'b']);
  assert.equal(unit(s, 'wild').maxHp, 42);
});

test('초대 응답 검증: 중복·비참가자·형식 오류', () => {
  const s = make(['a', 'b'], WILD, RULES, true);
  assert.equal(code(() => respondInvite(s, 'zz', true)), 'NOT_PARTICIPANT');
  assert.equal(code(() => respondInvite(s, 'a', true)), 'ALREADY_RESPONDED'); // 조우자는 응답 대상이 아님
  assert.equal(code(() => respondInvite(s, 'b', 'yes')), 'INVALID_PAYLOAD');
  assert.equal(s.participants[1].invitePending, true); // 잘못된 요청은 상태를 바꾸지 않는다
  respondInvite(s, 'b', true);
  assert.equal(code(() => respondInvite(s, 'b', true)), 'ALREADY_RESPONDED');
});

test('초대 시간 초과: 미응답은 불참, 늦은 응답은 INVITE_EXPIRED', () => {
  const s = make(['a', 'b', 'c'], WILD, RULES, true);
  respondInvite(s, 'b', true);
  closeInvites(s);
  assert.equal(s.phase, 'party_select');
  assert.equal(s.participants[2].leftReason, 'invite_timeout');
  assert.equal(code(() => respondInvite(s, 'c', true)), 'INVITE_EXPIRED');
  assert.deepEqual(closeInvites(s), []); // 이미 지난 단계에서는 아무 일도 없다
});

test('초대를 모두 거절하면 혼자 전투(파티 상한 5), 조우자도 나가면 취소', () => {
  const s = make(['a', 'b'], WILD, RULES, true);
  respondInvite(s, 'b', false);
  assert.equal(s.phase, 'party_select');
  assert.equal(partyLimit(s), 5);
  const t = make(['a', 'b'], WILD, RULES, true);
  removeParticipant(t, 'a', 'left');
  assert.equal(t.phase, 'inviting'); // b가 아직 응답 전
  respondInvite(t, 'b', false);
  assert.equal(t.outcome, 'cancelled');
});

test('서브턴 시간 초과는 end와 같은 결과', () => {
  const a = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  const b = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  expireSubturn(a);
  applyAction(b, 'a', { type: 'end' });
  assert.deepEqual(toSnapshot(a).units, toSnapshot(b).units);
  assert.equal(currentPlayerId(a), 'b');
  assert.deepEqual(expireSubturn(make(['a'])), []); // 진행 중이 아니면 무시
});

test('다인: 서브턴 시간 초과가 이어지면 야생 차례를 거쳐 새 라운드', () => {
  const s = start(['a', 'b'], [[entry('t1')], [entry('t2')]]);
  expireSubturn(s);
  const ev = expireSubturn(s);
  assert.ok(ev.some((e) => e.type === 'subturn' && (e as { phase: string }).phase === 'wild_turn'));
  assert.equal(s.round, 2);
  assert.equal(currentPlayerId(s), 'a');
});

// ---------- 기존 로컬 전투 규칙(BattleScene)과의 동등성 ----------
// 로컬 구현의 규칙을 그대로 옮긴 기준 구현(UI 선택 상태 제외)과 무작위 행동열을 돌려 매 행동 후 상태가 같은지 비교한다.

interface RefUnit { id: string; side: 'party' | 'wild'; col: number; row: number; hp: number; maxHp: number; ap: number; maxAp: number; attack: number; defense: number; stunned: boolean }

class RefBattle {
  units: RefUnit[];
  outcome: string | null = null;
  round = 1;
  constructor(party: RefUnit[], wild: RefUnit) {
    this.units = [...party, wild];
  }
  get party() { return this.units.filter((u) => u.side === 'party'); }
  get wild() { return this.units.find((u) => u.side === 'wild')!; }
  private occupied(col: number, row: number, except: RefUnit) {
    if (this.wild !== except && this.wild.col === col && this.wild.row === row && !this.wild.stunned) return true;
    return this.party.some((u) => u !== except && !u.stunned && u.col === col && u.row === row);
  }
  private corner(u: RefUnit) { return [0, 11].includes(u.col) && [0, 7].includes(u.row); }
  private dmg(a: RefUnit, d: RefUnit) { return Math.max(1, a.attack - Math.floor(d.defense / 2)); }
  private hit(a: RefUnit, d: RefUnit) {
    d.hp = Math.max(0, d.hp - this.dmg(a, d));
    if (d.hp <= 0) {
      d.stunned = true;
      if (d.side === 'wild') this.outcome = 'win';
      else if (this.party.every((u) => u.stunned)) this.outcome = 'lose';
    }
  }
  move(id: string, col: number, row: number) {
    const u = this.units.find((x) => x.id === id)!;
    const cost = Math.abs(col - u.col) + Math.abs(row - u.row);
    if (u.stunned || cost === 0 || cost > u.ap || this.occupied(col, row, u)) return false;
    u.col = col; u.row = row; u.ap -= cost;
    if (this.corner(u)) { this.outcome = 'draw'; return true; }
    this.after();
    return true;
  }
  attack(id: string) {
    const u = this.units.find((x) => x.id === id)!;
    const w = this.wild;
    if (u.stunned || u.ap < 1 || w.stunned || Math.abs(u.col - w.col) + Math.abs(u.row - w.row) !== 1) return false;
    u.ap -= 1;
    this.hit(u, w);
    if (!this.outcome) this.after();
    return true;
  }
  end() { this.wildTurn(); }
  private after() {
    if (this.outcome) return;
    if (!this.party.some((u) => !u.stunned && u.ap > 0)) this.wildTurn();
  }
  private wildTurn() {
    const w = this.wild;
    w.ap = w.maxAp;
    while (w.ap > 0 && !w.stunned) {
      const alive = this.party.filter((u) => !u.stunned);
      if (alive.length === 0) return;
      const t = alive.reduce((c, u) => (Math.abs(u.col - w.col) + Math.abs(u.row - w.row) < Math.abs(c.col - w.col) + Math.abs(c.row - w.row) ? u : c));
      if (Math.abs(t.col - w.col) + Math.abs(t.row - w.row) === 1) {
        w.ap -= 1;
        this.hit(w, t);
        if (this.outcome) return;
        continue;
      }
      const dCol = Math.sign(t.col - w.col);
      const dRow = Math.sign(t.row - w.row);
      const nc = dCol !== 0 ? w.col + dCol : w.col;
      const nr = dCol === 0 && dRow !== 0 ? w.row + dRow : w.row;
      const blocked = this.party.some((u) => !u.stunned && u.col === nc && u.row === nr);
      w.ap -= 1;
      if (!blocked) {
        w.col = nc; w.row = nr;
        if (this.corner(w)) { this.outcome = 'draw'; return; }
      }
    }
    this.round += 1;
    for (const u of this.party) if (!u.stunned) u.ap = u.maxAp;
  }
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('동등성: 1인 전투가 기존 로컬 규칙과 300개 무작위 시나리오에서 매 행동 같은 상태', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = lcg(seed);
    const n = 1 + Math.floor(rnd() * 5);
    const party: PartyEntry[] = Array.from({ length: n }, (_, i) => entry(`t${i}`, { attack: 5 + Math.floor(rnd() * 20), defense: Math.floor(rnd() * 12), actionPower: 2 + Math.floor(rnd() * 6), maxHp: 8 + Math.floor(rnd() * 30) }));
    const wildStats = { attack: 4 + Math.floor(rnd() * 16), defense: Math.floor(rnd() * 12), actionPower: 3 + Math.floor(rnd() * 6), maxHp: 15 + Math.floor(rnd() * 40) };
    const s = start(['a'], [party], { code: 'w', name: 'w', stats: wildStats });

    const rows = Array.from({ length: n }, (_, i) => Math.min(7, Math.round((i + 0.5) * (8 / n))));
    const ref = new RefBattle(
      party.map((p, i) => ({ id: `p1-${i}`, side: 'party', col: 1, row: rows[i], hp: p.maxHp, maxHp: p.maxHp, ap: p.actionPower, maxAp: p.actionPower, attack: p.attack, defense: p.defense, stunned: false })),
      { id: 'wild', side: 'wild', col: 10, row: 4, hp: wildStats.maxHp, maxHp: wildStats.maxHp, ap: wildStats.actionPower, maxAp: wildStats.actionPower, attack: wildStats.attack, defense: wildStats.defense, stunned: false },
    );

    for (let step = 0; step < 400 && !ref.outcome; step++) {
      assert.equal(s.outcome, null, `seed ${seed} step ${step}: 서버가 먼저 종료`);
      const live = ref.party.filter((u) => !u.stunned);
      const u = live[Math.floor(rnd() * live.length)];
      const pick = rnd();
      let refOk = false;
      let srvCode = 'NO_ERROR';
      const w = ref.wild;
      const adjacent = Math.abs(u.col - w.col) + Math.abs(u.row - w.row) === 1;
      if (pick < 0.05) {
        ref.end();
        refOk = true;
        applyAction(s, 'a', { type: 'end' });
      } else if (adjacent && pick < 0.6) {
        refOk = ref.attack(u.id);
        srvCode = code(() => applyAction(s, 'a', { type: 'attack', unitId: u.id, targetUnitId: 'wild' }));
      } else {
        // 목표: 야생 쪽으로 편향된 무작위 칸(범위·점유 위반 포함) — 양쪽이 같은 판정을 내려야 한다
        const bias = rnd() < 0.6;
        const tc = bias ? Math.max(0, Math.min(11, u.col + Math.sign(w.col - u.col) * (1 + Math.floor(rnd() * 3)))) : Math.floor(rnd() * 12);
        const tr = bias ? Math.max(0, Math.min(7, u.row + Math.sign(w.row - u.row) * Math.floor(rnd() * 2))) : Math.floor(rnd() * 8);
        refOk = ref.move(u.id, tc, tr);
        srvCode = code(() => applyAction(s, 'a', { type: 'move', unitId: u.id, targetCol: tc, targetRow: tr }));
      }
      assert.equal(srvCode === 'NO_ERROR', refOk, `seed ${seed} step ${step}: 합법 판정 불일치(${srvCode})`);
      for (const ru of ref.units) {
        const su = unit(s, ru.id);
        assert.deepEqual([su.col, su.row, su.hp, su.stunned, su.stunned ? 0 : su.ap], [ru.col, ru.row, ru.hp, ru.stunned, ru.stunned ? 0 : ru.ap], `seed ${seed} step ${step} ${ru.id}`); // 기절 유닛의 AP는 규칙과 무관
      }
      assert.equal(s.outcome, ref.outcome, `seed ${seed} step ${step}: 결과`);
      assert.equal(s.round, ref.round, `seed ${seed} step ${step}: 라운드`);
    }
  }
});
