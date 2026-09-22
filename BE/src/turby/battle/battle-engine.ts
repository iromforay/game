import { BattleError } from './battle-types';
import type { ActionRequest, BattleEvent, BattleOutcome, BattleRules, BattleSnapshotDto, BattleState, BattleUnit, Participant, PartyEntry, UnitStatsInput } from './battle-types';

// 4-B: 서버 권위 전투 엔진(순수 모듈). 규칙은 기존 1인 로컬 전투(BattleScene)를 그대로 옮긴 것이다:
// 이동=목표 칸까지 맨해튼 거리만큼 AP, 공격=인접 1칸 AP 1, 피해=max(최소피해, 공격-floor(방어/나눗수)), 꼭짓점 도착=즉시 무승부.
// 수치(격자·피해 공식·배치)는 전부 state.rules(game_setting)에서 온다. 함수는 state를 직접 바꾸고 발생한 이벤트를 돌려준다.

type Ctx = BattleEvent[];

function emit(state: BattleState, ctx: Ctx, evt: DistributiveOmit<BattleEvent, 'version'>) {
  ctx.push({ ...evt, version: ++state.version } as BattleEvent);
}
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

// ---------- 생성 ----------

export interface CreateBattleInput {
  battleId: string;
  roomCode: string;
  stageCode: string;
  spawnIndex: number;
  wild: { code: string; name: string; stats: UnitStatsInput };
  rules: BattleRules;
  encounterPlayerId: string;
  participants: { playerId: string; nickname: string; slot: number; connected: boolean; invited?: boolean }[]; // invited=초대받은 사람(응답 전까지 pending)
}

export function createBattle(input: CreateBattleInput): BattleState {
  const participants: Participant[] = [...input.participants]
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({ playerId: p.playerId, nickname: p.nickname, slot: p.slot, connected: p.connected, active: true, partySubmitted: false, eligibleForReward: true, invitePending: !!p.invited, leftReason: null }));
  return {
    battleId: input.battleId,
    roomCode: input.roomCode,
    stageCode: input.stageCode,
    spawnIndex: input.spawnIndex,
    wildCharacterCode: input.wild.code,
    encounterPlayerId: input.encounterPlayerId,
    wildName: input.wild.name,
    wildBase: input.wild.stats,
    rules: input.rules,
    phase: participants.some((p) => p.invitePending) ? 'inviting' : 'party_select', // 초대할 사람이 없으면(혼자) 바로 파티 선택
    version: 0,
    round: 0,
    participants,
    turnOrder: [],
    subturnIndex: 0,
    units: [],
    outcome: null,
    expiresAt: null,
    pendingParties: {},
  };
}

// 3.3/협동 스펙: 전체 아군 5마리 이하 — 참전자 1인당 상한 = floor(전체 상한 ÷ 참전 인원)
export function partyLimit(state: BattleState): number {
  const n = Math.max(1, state.participants.filter((p) => p.active).length);
  return Math.max(1, Math.floor(state.rules.maxAlliedUnits / n));
}

// ---------- 초대(4-C) ----------

function deactivate(state: BattleState, ctx: Ctx, p: Participant, reason: string) {
  p.active = false;
  p.invitePending = false;
  p.eligibleForReward = false;
  p.leftReason = reason;
  emit(state, ctx, { type: 'participant_left', playerId: p.playerId, reason });
}

// 초대 단계 → 파티 선택 단계: 응답할 사람이 남아 있지 않을 때 넘어간다(전원 이탈이면 취소)
function advanceSetup(state: BattleState, ctx: Ctx) {
  if (state.phase === 'inviting') {
    if (!state.participants.some((p) => p.active)) {
      resolve(state, ctx, 'cancelled');
      return;
    }
    if (state.participants.some((p) => p.active && p.invitePending)) return;
    state.phase = 'party_select';
    emit(state, ctx, { type: 'subturn', phase: 'party_select', round: 0, currentPlayerId: null });
  } else if (state.phase === 'party_select') {
    startIfReady(state, ctx);
  }
}

export function respondInvite(state: BattleState, playerId: string, join: unknown): BattleEvent[] {
  if (state.phase === 'resolved') throw new BattleError('BATTLE_RESOLVED', '이미 끝난 전투입니다.');
  const p = state.participants.find((x) => x.playerId === playerId);
  if (!p) throw new BattleError('NOT_PARTICIPANT', '이 전투에 초대되지 않았습니다.');
  if (!p.invitePending) throw new BattleError(p.leftReason === 'invite_timeout' ? 'INVITE_EXPIRED' : 'ALREADY_RESPONDED', p.leftReason === 'invite_timeout' ? '초대 시간이 지났습니다.' : '이미 응답했습니다.');
  if (typeof join !== 'boolean') throw new BattleError('INVALID_PAYLOAD', '응답 값이 올바르지 않습니다.');
  const ctx: Ctx = [];
  p.invitePending = false;
  if (!join) deactivate(state, ctx, p, 'declined');
  advanceSetup(state, ctx);
  return ctx;
}

// 초대 대기 시간 초과: 응답 없는 사람은 불참으로 본다
export function closeInvites(state: BattleState): BattleEvent[] {
  const ctx: Ctx = [];
  if (state.phase !== 'inviting') return ctx;
  for (const p of state.participants) if (p.active && p.invitePending) deactivate(state, ctx, p, 'invite_timeout');
  advanceSetup(state, ctx);
  return ctx;
}

// ---------- 파티 제출·시작 ----------

export function submitParty(state: BattleState, playerId: string, party: PartyEntry[]): BattleEvent[] {
  const ctx: Ctx = [];
  if (state.phase !== 'party_select') throw new BattleError(state.phase === 'resolved' ? 'BATTLE_RESOLVED' : 'INVALID_PHASE', '지금은 파티를 고를 수 없습니다.');
  const p = requireActiveParticipant(state, playerId);
  if (p.partySubmitted) throw new BattleError('ALREADY_RESPONDED', '이미 파티를 확정했습니다.');
  if (party.length < 1 || party.length > partyLimit(state)) throw new BattleError('PARTY_LIMIT', `파티는 1~${partyLimit(state)}마리여야 합니다.`);

  p.partySubmitted = true;
  state.pendingParties[playerId] = party;
  startIfReady(state, ctx);
  return ctx;
}

function startIfReady(state: BattleState, ctx: Ctx) {
  if (state.phase !== 'party_select') return;
  const active = state.participants.filter((p) => p.active);
  if (active.length === 0) {
    resolve(state, ctx, 'cancelled');
    return;
  }
  if (active.every((p) => p.partySubmitted)) startBattle(state, ctx);
}

// 파티 선택 시간 초과: 미제출 참가자는 참전 취소(보상 자격 없음)하고 남은 사람들로 시작한다
export function closePartySelect(state: BattleState): BattleEvent[] {
  const ctx: Ctx = [];
  if (state.phase !== 'party_select') return ctx;
  for (const p of state.participants) {
    if (p.active && !p.partySubmitted) {
      p.active = false;
      p.eligibleForReward = false;
      p.leftReason = 'party_timeout';
      emit(state, ctx, { type: 'participant_left', playerId: p.playerId, reason: 'party_timeout' });
    }
  }
  startIfReady(state, ctx);
  return ctx;
}

function rowsForCount(rows: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.min(rows - 1, Math.round((i + 0.5) * (rows / n))));
}

function startBattle(state: BattleState, ctx: Ctx) {
  const confirmed = state.participants.filter((p) => p.active && p.partySubmitted);
  state.turnOrder = confirmed.map((p) => p.playerId);

  const entries: { slot: number; order: number; playerId: string; entry: PartyEntry }[] = [];
  for (const p of confirmed) state.pendingParties[p.playerId].forEach((entry, order) => entries.push({ slot: p.slot, order, playerId: p.playerId, entry }));
  const rows = rowsForCount(state.rules.gridRows, entries.length);
  state.units = entries.map(({ slot, order, playerId, entry }, i) => ({
    unitId: `p${slot}-${order}`,
    side: 'party' as const,
    ownerPlayerId: playerId,
    participantSlot: slot,
    partyOrder: order,
    turbyId: entry.turbyId,
    characterCode: entry.characterCode,
    name: entry.name,
    col: state.rules.partyStartCol,
    row: rows[i],
    hp: entry.maxHp,
    maxHp: entry.maxHp,
    ap: entry.actionPower,
    maxAp: entry.actionPower,
    attack: entry.attack,
    defense: entry.defense,
    stunned: false,
    inactive: false,
  }));

  const mult = state.rules.wildHpMult[Math.min(confirmed.length, state.rules.wildHpMult.length - 1)] ?? 1;
  const base = state.wildBase;
  const hp = Math.max(1, Math.round(base.maxHp * mult));
  state.units.push({
    unitId: 'wild',
    side: 'wild',
    ownerPlayerId: null,
    participantSlot: 0,
    partyOrder: 0,
    turbyId: null,
    characterCode: state.wildCharacterCode,
    name: state.wildName,
    col: state.rules.wildStartCol,
    row: state.rules.wildStartRow,
    hp,
    maxHp: hp,
    ap: base.actionPower,
    maxAp: base.actionPower,
    attack: base.attack,
    defense: base.defense,
    stunned: false,
    inactive: false,
  });
  state.pendingParties = {};
  state.round = 1;
  state.phase = 'player_subturn';
  state.subturnIndex = roundStartIndex(state);
  emit(state, ctx, { type: 'started' });
  emit(state, ctx, { type: 'subturn', phase: state.phase, round: state.round, currentPlayerId: currentPlayerId(state) });
}

// ---------- 조회 ----------

export function currentPlayerId(state: BattleState): string | null {
  return state.phase === 'player_subturn' ? (state.turnOrder[state.subturnIndex] ?? null) : null;
}

function requireActiveParticipant(state: BattleState, playerId: string): Participant {
  const p = state.participants.find((x) => x.playerId === playerId);
  if (!p || !p.active) throw new BattleError('NOT_PARTICIPANT', '이 전투의 참전자가 아닙니다.');
  return p;
}

const isLive = (u: BattleUnit) => !u.stunned && !u.inactive;
const partyUnits = (state: BattleState) => state.units.filter((u) => u.side === 'party');
const wildUnit = (state: BattleState) => state.units.find((u) => u.side === 'wild')!;
const dist = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

function corners(rules: BattleRules) {
  const c = rules.gridCols - 1;
  const r = rules.gridRows - 1;
  return [
    { col: 0, row: 0 },
    { col: c, row: 0 },
    { col: 0, row: r },
    { col: c, row: r },
  ];
}

function isOccupied(state: BattleState, col: number, row: number, except: BattleUnit) {
  return state.units.some((u) => u !== except && isLive(u) && u.col === col && u.row === row);
}

// 서브턴을 받을 수 있는 참전자: 유효(active)하고 연결 중(away가 아님)이며 움직일 수 있는 유닛이 있는 사람.
// 모두 조건에 맞지 않으면(전원 away 등) 멈춰서 복귀를 기다린다 — 무한 라운드 방지.
function subturnAvailable(state: BattleState, playerId: string) {
  const p = state.participants.find((x) => x.playerId === playerId);
  return !!p && p.active && p.connected && partyUnits(state).some((u) => u.ownerPlayerId === playerId && isLive(u));
}

function firstAvailableSubturn(state: BattleState, from: number): number {
  for (let i = from; i < state.turnOrder.length; i++) if (subturnAvailable(state, state.turnOrder[i])) return i;
  return state.turnOrder.length; // 남은 서브턴 없음
}

// 라운드 시작 위치. 받을 수 있는 참전자가 아무도 없으면(전원 away) 첫 참전자에서 멈춰 복귀를 기다린다.
function roundStartIndex(state: BattleState): number {
  const i = firstAvailableSubturn(state, 0);
  return i < state.turnOrder.length ? i : 0;
}

// ---------- 행동 ----------

export function applyAction(state: BattleState, playerId: string, req: ActionRequest): BattleEvent[] {
  if (state.phase === 'resolved') throw new BattleError('BATTLE_RESOLVED', '이미 끝난 전투입니다.');
  requireActiveParticipant(state, playerId);
  if (state.phase !== 'player_subturn' || currentPlayerId(state) !== playerId) throw new BattleError('NOT_YOUR_SUBTURN', '지금은 내 차례가 아닙니다.');

  if (req?.type !== 'end' && req?.type !== 'move' && req?.type !== 'attack') throw new BattleError('INVALID_PAYLOAD', '알 수 없는 행동입니다.');
  const ctx: Ctx = [];
  if (req.type === 'end') {
    for (const u of partyUnits(state)) if (u.ownerPlayerId === playerId) u.ap = 0;
    endSubturn(state, ctx);
    return ctx;
  }

  const unit = ownUnit(state, playerId, req.unitId);
  if (req.type === 'move') move(state, unit, req.targetCol, req.targetRow, ctx);
  else if (req.type === 'attack') attack(state, unit, req.targetUnitId, ctx);
  else throw new BattleError('INVALID_PAYLOAD', '알 수 없는 행동입니다.');

  // 자기 모든 활성 유닛의 AP가 0이면 즉시 다음 서브턴
  if (state.phase === 'player_subturn' && !partyUnits(state).some((u) => u.ownerPlayerId === playerId && isLive(u) && u.ap > 0)) endSubturn(state, ctx);
  return ctx;
}

function ownUnit(state: BattleState, playerId: string, unitId: unknown): BattleUnit {
  const unit = typeof unitId === 'string' ? state.units.find((u) => u.unitId === unitId) : undefined;
  if (!unit || unit.side !== 'party') throw new BattleError('INVALID_UNIT', '존재하지 않는 유닛입니다.');
  if (unit.ownerPlayerId !== playerId) throw new BattleError('UNIT_NOT_OWNED', '내 유닛이 아닙니다.');
  if (!isLive(unit)) throw new BattleError('UNIT_STUNNED', '기절했거나 이탈한 유닛입니다.');
  return unit;
}

function move(state: BattleState, unit: BattleUnit, colRaw: unknown, rowRaw: unknown, ctx: Ctx) {
  if (!Number.isInteger(colRaw) || !Number.isInteger(rowRaw)) throw new BattleError('INVALID_TARGET', '목표 칸이 올바르지 않습니다.');
  const col = colRaw as number;
  const row = rowRaw as number;
  if (col < 0 || row < 0 || col >= state.rules.gridCols || row >= state.rules.gridRows) throw new BattleError('INVALID_TARGET', '격자 밖입니다.');
  const cost = dist(unit, { col, row });
  if (cost === 0) throw new BattleError('INVALID_TARGET', '같은 칸으로는 이동할 수 없습니다.');
  if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
  if (cost > unit.ap) throw new BattleError('OUT_OF_RANGE', '행동력이 모자라 갈 수 없는 칸입니다.');
  if (isOccupied(state, col, row, unit)) throw new BattleError('TILE_OCCUPIED', '이미 다른 유닛이 있는 칸입니다.');

  const fromCol = unit.col;
  const fromRow = unit.row;
  unit.col = col;
  unit.row = row;
  unit.ap -= cost;
  emit(state, ctx, { type: 'move', unitId: unit.unitId, fromCol, fromRow, toCol: col, toRow: row, apLeft: unit.ap });
  if (atCorner(state, unit)) resolve(state, ctx, 'draw');
}

function atCorner(state: BattleState, unit: BattleUnit) {
  return corners(state.rules).some((c) => c.col === unit.col && c.row === unit.row);
}

function damageOf(state: BattleState, attacker: BattleUnit, defender: BattleUnit) {
  return Math.max(state.rules.minDamage, attacker.attack - Math.floor(defender.defense / state.rules.defenseDivisor));
}

function strike(state: BattleState, attacker: BattleUnit, defender: BattleUnit, ctx: Ctx) {
  const damage = damageOf(state, attacker, defender);
  defender.hp = Math.max(0, defender.hp - damage);
  if (defender.hp <= 0) defender.stunned = true;
  emit(state, ctx, { type: 'attack', attackerId: attacker.unitId, targetId: defender.unitId, damage, targetHp: defender.hp, targetStunned: defender.stunned });
  if (defender.stunned) {
    if (defender.side === 'wild') resolve(state, ctx, 'win');
    else if (!partyUnits(state).some(isLive)) resolve(state, ctx, 'lose');
  }
}

function attack(state: BattleState, unit: BattleUnit, targetRaw: unknown, ctx: Ctx) {
  const target = typeof targetRaw === 'string' ? state.units.find((u) => u.unitId === targetRaw) : undefined;
  if (!target || target.side !== 'wild' || !isLive(target)) throw new BattleError('INVALID_TARGET', '공격할 수 없는 대상입니다.');
  if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
  if (dist(unit, target) !== 1) throw new BattleError('OUT_OF_RANGE', '인접한 대상만 공격할 수 있습니다.');
  unit.ap -= 1;
  strike(state, unit, target, ctx);
}

// ---------- 서브턴·야생 차례 ----------

function endSubturn(state: BattleState, ctx: Ctx) {
  if (state.phase !== 'player_subturn') return;
  const next = firstAvailableSubturn(state, state.subturnIndex + 1);
  if (next < state.turnOrder.length) {
    state.subturnIndex = next;
    emit(state, ctx, { type: 'subturn', phase: 'player_subturn', round: state.round, currentPlayerId: currentPlayerId(state) });
    return;
  }
  runWildTurn(state, ctx);
}

function nearestTarget(state: BattleState, wild: BattleUnit): BattleUnit | null {
  const alive = partyUnits(state).filter(isLive);
  if (alive.length === 0) return null;
  // 가장 가까운 유닛, 동률이면 participantSlot → partyOrder → unitId 순
  return alive.reduce((best, u) => {
    const d = dist(u, wild);
    const bd = dist(best, wild);
    if (d !== bd) return d < bd ? u : best;
    if (u.participantSlot !== best.participantSlot) return u.participantSlot < best.participantSlot ? u : best;
    if (u.partyOrder !== best.partyOrder) return u.partyOrder < best.partyOrder ? u : best;
    return u.unitId < best.unitId ? u : best;
  });
}

function runWildTurn(state: BattleState, ctx: Ctx) {
  state.phase = 'wild_turn';
  emit(state, ctx, { type: 'subturn', phase: 'wild_turn', round: state.round, currentPlayerId: null });
  const wild = wildUnit(state);
  wild.ap = wild.maxAp;

  while (wild.ap > 0 && !wild.stunned) {
    const target = nearestTarget(state, wild);
    if (!target) return; // 아군이 없으면 이미 lose/cancelled로 끝났어야 함
    if (dist(wild, target) === 1) {
      wild.ap -= 1;
      strike(state, wild, target, ctx);
      if (state.phase !== 'wild_turn') return;
      continue;
    }
    // 가장 가까운 아군 쪽으로 1칸(가로 우선). 막혀 있으면 이동 없이 AP만 소모한다(로컬 규칙과 동일)
    const dCol = Math.sign(target.col - wild.col);
    const dRow = Math.sign(target.row - wild.row);
    const nextCol = dCol !== 0 ? wild.col + dCol : wild.col;
    const nextRow = dCol === 0 && dRow !== 0 ? wild.row + dRow : wild.row;
    const blocked = partyUnits(state).some((u) => isLive(u) && u.col === nextCol && u.row === nextRow);
    wild.ap -= 1;
    if (!blocked) {
      const fromCol = wild.col;
      const fromRow = wild.row;
      wild.col = nextCol;
      wild.row = nextRow;
      emit(state, ctx, { type: 'move', unitId: wild.unitId, fromCol, fromRow, toCol: nextCol, toRow: nextRow, apLeft: wild.ap });
      if (atCorner(state, wild)) {
        resolve(state, ctx, 'draw');
        return;
      }
    }
  }
  startNextRound(state, ctx);
}

function startNextRound(state: BattleState, ctx: Ctx) {
  state.round += 1;
  for (const u of partyUnits(state)) if (isLive(u)) u.ap = u.maxAp;
  state.phase = 'player_subturn';
  state.subturnIndex = roundStartIndex(state);
  emit(state, ctx, { type: 'subturn', phase: state.phase, round: state.round, currentPlayerId: currentPlayerId(state) });
}

// ---------- 종료·이탈 ----------

function resolve(state: BattleState, ctx: Ctx, outcome: BattleOutcome) {
  if (state.phase === 'resolved') return;
  state.phase = 'resolved';
  state.outcome = outcome;
  state.expiresAt = null;
  emit(state, ctx, { type: 'resolved', outcome });
}

// 서브턴 30초 시간 초과: 남은 AP를 버리고 다음으로 넘긴다(end 요청과 같은 결과)
export function expireSubturn(state: BattleState): BattleEvent[] {
  const ctx: Ctx = [];
  const playerId = currentPlayerId(state);
  if (state.phase !== 'player_subturn' || !playerId) return ctx;
  for (const u of partyUnits(state)) if (u.ownerPlayerId === playerId) u.ap = 0;
  endSubturn(state, ctx);
  return ctx;
}

// 일시 연결 끊김/복귀 — 유닛은 전장에 남는다. 현재 서브턴 주인이 끊기면 다른 참전자가 있을 때 즉시 자동 종료한다.
export function setConnected(state: BattleState, playerId: string, connected: boolean): BattleEvent[] {
  const ctx: Ctx = [];
  const p = state.participants.find((x) => x.playerId === playerId);
  if (!p || p.connected === connected) return ctx;
  p.connected = connected;
  emit(state, ctx, { type: 'participant_status', playerId, connected }); // 다른 참전자 화면의 away 표시용
  if (!connected && state.phase === 'player_subturn' && currentPlayerId(state) === playerId && state.turnOrder.some((id) => id !== playerId && subturnAvailable(state, id))) {
    for (const u of partyUnits(state)) if (u.ownerPlayerId === playerId) u.ap = 0;
    endSubturn(state, ctx);
  }
  return ctx;
}

// 명시 퇴장·재접속 유예 만료: 보상 자격을 잃고 유닛이 전장에서 제거된다. 남은 참전자가 없으면 전투 취소.
export function removeParticipant(state: BattleState, playerId: string, reason: string): BattleEvent[] {
  const ctx: Ctx = [];
  const p = state.participants.find((x) => x.playerId === playerId);
  if (!p || !p.active || state.phase === 'resolved') return ctx;
  p.active = false;
  p.eligibleForReward = false;
  p.leftReason = reason;
  for (const u of partyUnits(state)) if (u.ownerPlayerId === playerId) u.inactive = true;
  emit(state, ctx, { type: 'participant_left', playerId, reason });

  if (state.phase === 'inviting' || state.phase === 'party_select') {
    p.invitePending = false;
    advanceSetup(state, ctx);
    return ctx;
  }
  if (!state.participants.some((x) => x.active)) {
    resolve(state, ctx, 'cancelled');
    return ctx;
  }
  if (!partyUnits(state).some(isLive)) {
    resolve(state, ctx, 'cancelled');
    return ctx;
  }
  if (state.phase === 'player_subturn' && state.turnOrder[state.subturnIndex] === playerId) endSubturn(state, ctx);
  return ctx;
}

// ---------- 스냅샷 ----------

export function toSnapshot(state: BattleState): BattleSnapshotDto {
  return {
    battleId: state.battleId,
    version: state.version,
    phase: state.phase,
    round: state.round,
    stageCode: state.stageCode,
    spawnIndex: state.spawnIndex,
    wildCharacterCode: state.wildCharacterCode,
    wildName: state.wildName,
    encounterPlayerId: state.encounterPlayerId,
    grid: { cols: state.rules.gridCols, rows: state.rules.gridRows },
    partyLimit: partyLimit(state),
    currentPlayerId: currentPlayerId(state),
    expiresAt: state.expiresAt,
    serverNow: Date.now(),
    outcome: state.outcome,
    participants: state.participants.map((p) => ({ playerId: p.playerId, nickname: p.nickname, slot: p.slot, connected: p.connected, active: p.active, partySubmitted: p.partySubmitted, eligibleForReward: p.eligibleForReward, invitePending: p.invitePending, leftReason: p.leftReason })),
    units: state.units.map((u) => ({
      unitId: u.unitId,
      side: u.side,
      ownerPlayerId: u.ownerPlayerId,
      participantSlot: u.participantSlot,
      characterCode: u.characterCode,
      name: u.name,
      col: u.col,
      row: u.row,
      hp: u.hp,
      maxHp: u.maxHp,
      ap: u.ap,
      maxAp: u.maxAp,
      stunned: u.stunned,
      inactive: u.inactive,
    })),
  };
}
