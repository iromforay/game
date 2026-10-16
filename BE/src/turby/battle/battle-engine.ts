import { BattleError } from './battle-types';
import type { ActionRequest, BattleDefinition, BattleEvent, BattleObjective, BattleOutcome, BattleRules, BattleSnapshotDto, BattleState, BattleUnit, Participant, PartyEntry, StatusEffectDef, UnitStatsInput } from './battle-types';

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
  definition?: BattleDefinition | null; // M4-A: 있으면 야생 1마리 대신 정의 데이터로 적·NPC·목표·지형을 만든다
  story?: { encounterKey: string } | null; // M4-B: 스토리 전투 표식(포획·야생 보상 없음)
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
    definition: input.definition ?? null,
    story: input.story ?? null,
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

  if (state.definition) {
    addDefinitionUnits(state, state.definition);
  } else {
    pushWildUnit(state, confirmed.length);
  }
  state.pendingParties = {};
  state.round = 1;
  state.phase = 'player_subturn';
  state.subturnIndex = roundStartIndex(state);
  emit(state, ctx, { type: 'started' });
  emit(state, ctx, { type: 'subturn', phase: state.phase, round: state.round, currentPlayerId: currentPlayerId(state) });
  emitThreadHint(state, ctx);
}

// 기존 야생 전투: 야생 1마리(참전 인원별 HP 배율)
function pushWildUnit(state: BattleState, participantCount: number) {
  const mult = state.rules.wildHpMult[Math.min(participantCount, state.rules.wildHpMult.length - 1)] ?? 1;
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
}

// M4-A 정의 전투: 정의 데이터의 적·NPC를 그대로 배치(HP 배율 없음). 기믹 수치는 전부 정의에서 온다.
function addDefinitionUnits(state: BattleState, def: BattleDefinition) {
  for (const d of def.units) {
    state.units.push({
      unitId: d.unitId,
      side: d.side,
      ownerPlayerId: null,
      participantSlot: 0,
      partyOrder: 0,
      turbyId: null,
      characterCode: d.characterCode,
      name: d.name,
      col: d.col,
      row: d.row,
      hp: d.maxHp,
      maxHp: d.maxHp,
      ap: d.actionPower,
      maxAp: d.actionPower,
      attack: d.attack,
      defense: d.defense,
      stunned: false,
      inactive: false,
      statuses: [],
      targetable: d.targetable ?? d.side !== 'neutral',
      threatened: d.threatened ?? false,
      canAct: d.canAct ?? d.side !== 'neutral',
      partOf: d.partOf ?? null,
      breakOrder: d.breakOrder ?? null,
      onHit: d.onHit ?? null,
      exitOnDefeat: d.exitOnDefeat ?? null,
      fled: false,
      protectMode: d.protectMode ?? 'reject',
      ...(d.maxHitPercent !== undefined ? { maxHitPercent: d.maxHitPercent } : {}),
      ...(d.flat ? { flat: true } : {}),
      ...(d.flee ? { flee: { ...d.flee }, reversed: false } : {}),
      ...(d.carrierOf ? { carrierOf: d.carrierOf } : {}),
      ...(d.thread ? { thread: { order: d.thread.order } } : {}),
    });
  }
  state.blocked = (def.blocked ?? []).map((c) => cellKey(c.col, c.row));
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
const enemyUnits = (state: BattleState) => state.units.filter((u) => u.side === 'wild');
const dist = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
const cellKey = (col: number, row: number) => `${col},${row}`;
const isBlockedCell = (state: BattleState, col: number, row: number) => !!state.blocked?.includes(cellKey(col, row));
// 꼭짓점 도착 = 무승부. 정의 전투는 기본으로 끈다(정의에서 켤 수 있음), 야생은 규칙 기본값 true
const cornerEscapeOn = (state: BattleState) => (state.definition ? (state.definition.cornerEscape ?? false) : (state.rules.cornerEscape ?? true));

// 이동 가능 AP: 속박 감소량을 빼되 0 미만으로 내려가지 않는다
function moveAllowance(unit: BattleUnit) {
  const penalty = (unit.statuses ?? []).reduce((sum, s) => sum + (s.kind === 'bind' ? s.movePenalty : 0), 0);
  const base = Math.max(0, unit.ap - penalty);
  // 젖은 속박: 이번 이동의 가능 거리 1칸 감소, 최소 1칸은 보장(AP가 1이면 줄지 않는다)
  return (unit.statuses ?? []).some((s) => s.kind === 'wet_bind') && base >= 1 ? Math.max(1, base - 1) : base;
}

// 이동 비용: 막힌 칸이 없으면 기존 규칙(맨해튼 거리). 있으면 막힌 칸을 피해 가는 최단 경로(유닛은 기존처럼 경로를 막지 않는다).
function pathCost(state: BattleState, from: { col: number; row: number }, to: { col: number; row: number }): number {
  if (!state.blocked || state.blocked.length === 0) return dist(from, to);
  const seen = new Set([cellKey(from.col, from.row)]);
  let frontier = [from];
  for (let steps = 1; frontier.length > 0; steps++) {
    const next: { col: number; row: number }[] = [];
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const col = c.col + dc;
        const row = c.row + dr;
        if (col < 0 || row < 0 || col >= state.rules.gridCols || row >= state.rules.gridRows) continue;
        const k = cellKey(col, row);
        if (seen.has(k) || isBlockedCell(state, col, row)) continue;
        if (col === to.col && row === to.row) return steps;
        seen.add(k);
        next.push({ col, row });
      }
    }
    frontier = next;
  }
  return Infinity;
}

// 부위(partOf)가 하나라도 남아 있으면 중심부는 피해를 받지 않는다
const hasLiveParts = (state: BattleState, core: BattleUnit) => state.units.some((p) => p.partOf === core.unitId && !p.stunned);
const hasParts = (state: BattleState, core: BattleUnit) => state.units.some((p) => p.partOf === core.unitId);

// ---------- 10-16 C3-3: 3장 규칙(모두 전투 정의 데이터가 켠 경우만) ----------
const isConfused = (u: BattleUnit) => (u.statuses ?? []).some((s) => s.kind === 'confused');
// 보스의 기억실: 진짜 실 중 아직 끊지 않은 가장 앞 순서(오래된 폭신이가 가리키는 실). 없으면 null
function nextThread(state: BattleState): BattleUnit | null {
  const live = state.units.filter((u) => u.thread && u.thread.order !== null && !u.stunned && !u.inactive);
  if (live.length === 0) return null;
  return live.reduce((a, b) => (a.thread!.order! <= b.thread!.order! ? a : b));
}
function emitThreadHint(state: BattleState, ctx: Ctx) {
  const text = state.definition?.hints?.threadHint;
  if (text && nextThread(state)) emit(state, ctx, { type: 'hint', code: 'thread_hint', text });
}
const clampTo = (v: number, max: number) => Math.min(Math.max(v, 0), max);

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
  if (col === unit.col && row === unit.row) throw new BattleError('INVALID_TARGET', '같은 칸으로는 이동할 수 없습니다.');
  if (isBlockedCell(state, col, row)) throw new BattleError('TILE_BLOCKED', '지나갈 수 없는 칸입니다.');
  if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
  if (isConfused(unit)) {
    // 혼란: 누른 칸의 반대쪽(내 위치를 기준으로 점대칭, 격자 안으로 맞춤)으로 간다. 갈 수 없으면 행동력 1만 헛돈다(서버가 정한 결정적 규칙)
    const mc = clampTo(2 * unit.col - col, state.rules.gridCols - 1);
    const mr = clampTo(2 * unit.row - row, state.rules.gridRows - 1);
    emit(state, ctx, { type: 'confused_action', unitId: unit.unitId, action: 'move' });
    const mcost = pathCost(state, unit, { col: mc, row: mr });
    const ok = !(mc === unit.col && mr === unit.row) && !isBlockedCell(state, mc, mr) && mcost <= moveAllowance(unit) && !isOccupied(state, mc, mr, unit);
    if (!ok) {
      unit.ap -= 1;
      return;
    }
    moveTo(state, unit, mc, mr, mcost, ctx);
    return;
  }
  const cost = pathCost(state, unit, { col, row });
  if (cost > moveAllowance(unit)) throw new BattleError('OUT_OF_RANGE', '행동력이 모자라 갈 수 없는 칸입니다.');
  if (isOccupied(state, col, row, unit)) throw new BattleError('TILE_OCCUPIED', '이미 다른 유닛이 있는 칸입니다.');
  moveTo(state, unit, col, row, cost, ctx);
}

function moveTo(state: BattleState, unit: BattleUnit, col: number, row: number, cost: number, ctx: Ctx) {
  const fromCol = unit.col;
  const fromRow = unit.row;
  unit.col = col;
  unit.row = row;
  unit.ap -= cost;
  emit(state, ctx, { type: 'move', unitId: unit.unitId, fromCol, fromRow, toCol: col, toRow: row, apLeft: unit.ap });
  // 젖은 속박은 이동 행동 한 번에 소비된다(공격·턴 종료는 막지도 소비하지도 않는다)
  if (unit.statuses?.some((s) => s.kind === 'wet_bind')) {
    unit.statuses = unit.statuses.filter((s) => s.kind !== 'wet_bind');
    emit(state, ctx, { type: 'status', unitId: unit.unitId, statuses: unit.statuses.map((s) => ({ ...s })) });
  }
  if (cornerEscapeOn(state) && atCorner(state, unit)) resolve(state, ctx, 'draw');
}

function atCorner(state: BattleState, unit: BattleUnit) {
  return corners(state.rules).some((c) => c.col === unit.col && c.row === unit.row);
}

function damageOf(state: BattleState, attacker: BattleUnit, defender: BattleUnit) {
  let raw = Math.max(state.rules.minDamage, attacker.attack - Math.floor(defender.defense / state.rules.defenseDivisor));
  if (defender.flat) raw = Math.max(state.rules.minDamage, Math.floor(raw / 2)); // 납작한 박음이: 첫 피격은 절반
  // 10-14 C2-5A: 공격 한 번이 대상 최대 HP의 일정 비율을 넘지 못한다(보스 15% — 연속으로 맞아도 즉시 패배하지 않는다)
  if (attacker.maxHitPercent === undefined) return raw;
  return Math.min(raw, Math.max(1, Math.floor((defender.maxHp * attacker.maxHitPercent) / 100)));
}

function strike(state: BattleState, attacker: BattleUnit, defender: BattleUnit, ctx: Ctx) {
  const damage = damageOf(state, attacker, defender);
  defender.hp = Math.max(0, defender.hp - damage);
  if (defender.hp <= 0) defender.stunned = true;
  emit(state, ctx, { type: 'attack', attackerId: attacker.unitId, targetId: defender.unitId, damage, targetHp: defender.hp, targetStunned: defender.stunned });
  if (defender.flat) {
    defender.flat = false; // 첫 피격: 재봉선이 드러난다(한 번만)
    if (!defender.stunned) emit(state, ctx, { type: 'phase', unitId: defender.unitId, phase: 'exposed' });
  }
  if (defender.stunned && defender.carrierOf) {
    const spool = state.units.find((x) => x.unitId === defender.carrierOf);
    if (spool && isLive(spool) && !spool.reversed) {
      spool.reversed = true;
      emit(state, ctx, { type: 'carrier_cut', unitId: defender.unitId, spoolId: spool.unitId });
    }
  }
  if (defender.stunned) {
    if (defender.exitOnDefeat === 'flee') {
      defender.fled = true; // 연출 표시만 — 승패는 "쓰러짐"으로 이미 판정된다
      emit(state, ctx, { type: 'unit_exit', unitId: defender.unitId, mode: 'flee' });
    }
    if (defender.partOf) {
      const core = state.units.find((x) => x.unitId === defender.partOf);
      const exposed = !!core && !hasLiveParts(state, core);
      emit(state, ctx, { type: 'part_broken', unitId: defender.unitId, coreId: defender.partOf, coreExposed: exposed });
      if (exposed) emit(state, ctx, { type: 'phase', unitId: defender.partOf, phase: 'exposed' }); // 부위는 되살아나지 않으므로 한 번만 발생한다
    }
  } else if (attacker.onHit) {
    applyStatus(state, defender, attacker.onHit, attacker.unitId, ctx);
  }
  evaluateOutcome(state, ctx);
}

function applyStatus(state: BattleState, target: BattleUnit, def: StatusEffectDef, sourceUnitId: string, ctx: Ctx) {
  const list = (target.statuses ??= []);
  const existing = list.find((s) => s.kind === def.kind);
  if (def.kind === 'wet_bind') {
    if (existing) return; // 중첩하지 않고 지속 시간도 갱신하지 않는다
    list.push({ kind: 'wet_bind', turnsLeft: 1, movePenalty: 1, sourceUnitId, appliedRound: state.round });
    emit(state, ctx, { type: 'status', unitId: target.unitId, statuses: list.map((s) => ({ ...s })) });
    return;
  }
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, def.turns);
    existing.movePenalty = Math.max(existing.movePenalty, def.movePenalty);
    existing.appliedRound = state.round;
  } else {
    list.push({ kind: def.kind, turnsLeft: def.turns, movePenalty: def.movePenalty, sourceUnitId, appliedRound: state.round });
  }
  emit(state, ctx, { type: 'status', unitId: target.unitId, statuses: list.map((s) => ({ ...s })) });
}

// 승패: 패배 조건을 먼저 본다. 정의가 없으면 기존 규칙(야생 전원 쓰러짐 = 승리, 아군 전원 기절 = 패배)과 같다.
function objectiveMet(state: BattleState, o: BattleObjective): boolean {
  const down = (id: string) => !!state.units.find((u) => u.unitId === id)?.stunned;
  switch (o.kind) {
    case 'defeat_all':
      return enemyUnits(state).every((u) => u.stunned || u.inactive);
    case 'defeat_units':
      return o.unitIds.every(down);
    case 'protect':
      return o.unitIds.some(down); // 패배 조건으로 쓰일 때: 보호 대상이 하나라도 쓰러지면 참
    case 'party_down':
      return !partyUnits(state).some(isLive);
  }
}

// 기본 조건을 채운 승리·패배 목표 — 판정과 스냅샷(프런트 목표 표시)이 같은 목록을 쓴다
function objectivesOf(state: BattleState): { win: BattleObjective[]; lose: BattleObjective[] } {
  return {
    win: state.definition?.objectives?.win ?? [{ kind: 'defeat_all' }],
    lose: [{ kind: 'party_down' }, ...(state.definition?.objectives?.lose ?? [])],
  };
}

function evaluateOutcome(state: BattleState, ctx: Ctx) {
  if (state.phase === 'resolved') return;
  const { win, lose } = objectivesOf(state);
  if (lose.some((o) => objectiveMet(state, o))) resolve(state, ctx, 'lose');
  else if (win.every((o) => objectiveMet(state, o))) resolve(state, ctx, 'win');
}

function attack(state: BattleState, unit: BattleUnit, targetRaw: unknown, ctx: Ctx) {
  let target = typeof targetRaw === 'string' ? state.units.find((u) => u.unitId === targetRaw) : undefined;
  if (!target || target.side !== 'wild' || !isLive(target) || target.targetable === false) throw new BattleError('INVALID_TARGET', '공격할 수 없는 대상입니다.');
  if (isConfused(unit)) {
    // 혼란: 누른 대상이 사정거리 안이면 행동력을 쓰고, 인접한 다른 적(unitId 순 첫째)을 대신 친다. 없으면 헛손질(피해 0)
    if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
    if (dist(unit, target) !== 1) throw new BattleError('OUT_OF_RANGE', '인접한 대상만 공격할 수 있습니다.');
    const picked = target;
    const alt = state.units.filter((o) => o.side === 'wild' && isLive(o) && o.targetable !== false && o.unitId !== picked.unitId && dist(unit, o) === 1).sort((a, b) => (a.unitId < b.unitId ? -1 : 1))[0];
    emit(state, ctx, { type: 'confused_action', unitId: unit.unitId, action: 'attack' });
    if (!alt) {
      unit.ap -= 1;
      emit(state, ctx, { type: 'attack', attackerId: unit.unitId, targetId: picked.unitId, damage: 0, targetHp: picked.hp, targetStunned: false });
      return;
    }
    target = alt;
  }
  if (target.thread) {
    // 보스의 기억실: 모두 공격할 수 있지만 정해진 순서의 진짜 실만 끊긴다(아니면 행동만 쓰고 혼란)
    if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
    if (dist(unit, target) !== 1) throw new BattleError('OUT_OF_RANGE', '인접한 대상만 공격할 수 있습니다.');
    unit.ap -= 1;
    const next = nextThread(state);
    if (next && next.unitId === target.unitId) {
      strike(state, unit, target, ctx);
      if (state.phase !== 'resolved') emitThreadHint(state, ctx);
    } else {
      emit(state, ctx, { type: 'wrong_thread', unitId: unit.unitId, targetId: target.unitId });
      if (!isConfused(unit)) applyStatus(state, unit, { kind: 'confused', turns: 1, movePenalty: 0 }, target.unitId, ctx);
    }
    return;
  }
  if (target.partOf) {
    const firstOrder = Math.min(...state.units.filter((p) => p.partOf === target.partOf && !p.stunned).map((p) => p.breakOrder ?? 0));
    if ((target.breakOrder ?? 0) !== firstOrder) throw new BattleError('PART_ORDER', '먼저 끊어야 할 부위가 남아 있습니다.');
  }
  const protectedCore = hasLiveParts(state, target);
  if (protectedCore && target.protectMode !== 'zero') throw new BattleError('TARGET_PROTECTED', '바깥 부위가 남아 있어 피해를 줄 수 없습니다.');
  if (unit.ap < 1) throw new BattleError('NO_ACTION_POWER', '행동력이 없습니다.');
  if (dist(unit, target) !== 1) throw new BattleError('OUT_OF_RANGE', '인접한 대상만 공격할 수 있습니다.');
  unit.ap -= 1;
  if (protectedCore) {
    // 결박 상태의 보스: 행동은 쓰지만 피해는 0 — 안내는 전투당 한 번만 낸다
    emit(state, ctx, { type: 'attack', attackerId: unit.unitId, targetId: target.unitId, damage: 0, targetHp: target.hp, targetStunned: false });
    const text = state.definition?.hints?.zeroDamage;
    const shown = (state.hintsShown ??= []);
    if (text && !shown.some((h) => h.code === 'zero_damage')) {
      shown.push({ code: 'zero_damage', text });
      emit(state, ctx, { type: 'hint', code: 'zero_damage', text });
    }
    return;
  }
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
  // 아군 + 적이 노릴 수 있는(threatened) NPC. 공격 불가 NPC(붙잡힌 보풀이 등)는 대상이 아니다
  const alive = state.units.filter((u) => isLive(u) && (u.side === 'party' || (u.side === 'neutral' && u.threatened === true)));
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
  // 야생 전투는 적 1마리. 정의 전투는 행동 가능한(canAct) 적이 배치 순서대로 행동한다
  for (const wild of enemyUnits(state)) {
    if (wild.canAct === false || !isLive(wild)) continue;
    if (!runOneEnemy(state, wild, ctx)) return;
  }
  startNextRound(state, ctx);
}

// 적 한 마리의 행동. 전투가 끝났으면 false
function runOneEnemy(state: BattleState, wild: BattleUnit, ctx: Ctx): boolean {
  wild.ap = wild.maxAp;
  if (wild.flee) {
    runSpool(state, wild, ctx);
    return true;
  }
  while (wild.ap > 0 && !wild.stunned) {
    const target = nearestTarget(state, wild);
    if (!target) return state.phase === 'wild_turn'; // 아군이 없으면 이미 lose/cancelled로 끝났어야 함
    if (dist(wild, target) === 1) {
      wild.ap -= 1;
      strike(state, wild, target, ctx);
      if (state.phase !== 'wild_turn') return false;
      continue;
    }
    // 가장 가까운 아군 쪽으로 1칸(가로 우선). 막혀 있으면 이동 없이 AP만 소모한다(로컬 규칙과 동일)
    const dCol = Math.sign(target.col - wild.col);
    const dRow = Math.sign(target.row - wild.row);
    const nextCol = dCol !== 0 ? wild.col + dCol : wild.col;
    const nextRow = dCol === 0 && dRow !== 0 ? wild.row + dRow : wild.row;
    const blocked = state.units.some((u) => u !== wild && isLive(u) && u.col === nextCol && u.row === nextRow) || isBlockedCell(state, nextCol, nextRow);
    wild.ap -= 1;
    if (!blocked) {
      const fromCol = wild.col;
      const fromRow = wild.row;
      wild.col = nextCol;
      wild.row = nextRow;
      emit(state, ctx, { type: 'move', unitId: wild.unitId, fromCol, fromRow, toCol: nextCol, toRow: nextRow, apLeft: wild.ap });
      if (cornerEscapeOn(state) && atCorner(state, wild)) {
        resolve(state, ctx, 'draw');
        return false;
      }
    }
  }
  return true;
}

// 작은 실패굴이: 공격하지 않는다. 가장 가까운 아군에게서 멀어지는 쪽(운반 실이 끊겼으면 가까워지는 쪽)으로 한 칸씩 굴러간다.
// 후보 칸 순서(동·서·남·북)와 거리 비교만 쓰는 결정적 규칙이다. 더 나은 칸이 없으면(구석) 제자리에서 행동력만 쓴다
function runSpool(state: BattleState, spool: BattleUnit, ctx: Ctx) {
  while (spool.ap > 0 && !spool.stunned) {
    spool.ap -= 1;
    const foes = partyUnits(state).filter(isLive);
    if (foes.length === 0) return;
    const gap = (c: { col: number; row: number }) => Math.min(...foes.map((f) => dist(f, c)));
    const here = gap(spool);
    let best: { col: number; row: number } | null = null;
    let bestGap = here;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const col = spool.col + dc;
      const row = spool.row + dr;
      if (col < 0 || row < 0 || col >= state.rules.gridCols || row >= state.rules.gridRows || isBlockedCell(state, col, row) || isOccupied(state, col, row, spool)) continue;
      const g = gap({ col, row });
      if (spool.reversed ? g < bestGap && g >= 1 : g > bestGap) {
        best = { col, row };
        bestGap = g;
      }
    }
    if (!best) continue;
    const fromCol = spool.col;
    const fromRow = spool.row;
    spool.col = best.col;
    spool.row = best.row;
    emit(state, ctx, { type: 'move', unitId: spool.unitId, fromCol, fromRow, toCol: best.col, toRow: best.row, apLeft: spool.ap });
  }
}

// 작은 실패굴이를 N라운드 안에 잡지 못하면 기억실을 전달해 살아 있는 납작 병사(눌린 박음이) 전원의 공격이 오르고, 실패굴이는 사라진다(도주 연출 — 승패에서는 쓰러진 것으로 센다)
function applyEmpower(state: BattleState, ctx: Ctx) {
  for (const spool of state.units) {
    if (!spool.flee || !isLive(spool) || spool.fled || state.round <= spool.flee.empowerAfterRound) continue;
    const targets = enemyUnits(state).filter((u) => u.flat !== undefined && isLive(u));
    for (const t of targets) t.attack += spool.flee.empowerAttack;
    spool.stunned = true;
    spool.fled = true;
    emit(state, ctx, { type: 'unit_exit', unitId: spool.unitId, mode: 'flee' });
    emit(state, ctx, { type: 'empower', unitId: spool.unitId, targets: targets.map((t) => t.unitId), attack: spool.flee.empowerAttack });
  }
}

function startNextRound(state: BattleState, ctx: Ctx) {
  const endedRound = state.round;
  state.round += 1;
  tickStatuses(state, endedRound, ctx);
  applyEmpower(state, ctx);
  evaluateOutcome(state, ctx);
  if (state.phase === 'resolved') return;
  applyTerrainRules(state, ctx);
  applyCurrent(state, ctx);
  telegraphCurrent(state, ctx);
  for (const u of partyUnits(state)) if (isLive(u)) u.ap = u.maxAp;
  state.phase = 'player_subturn';
  state.subturnIndex = roundStartIndex(state);
  emit(state, ctx, { type: 'subturn', phase: state.phase, round: state.round, currentPlayerId: currentPlayerId(state) });
  emitThreadHint(state, ctx);
}

// 지난 라운드보다 먼저 걸린 상태 이상만 1 줄인다(적 차례에 걸린 속박은 다음 아군 차례에 온전히 적용)
function tickStatuses(state: BattleState, endedRound: number, ctx: Ctx) {
  for (const unit of state.units) {
    if (!unit.statuses || unit.statuses.length === 0) continue;
    let changed = false;
    for (const s of unit.statuses) {
      if (s.kind !== 'wet_bind' && s.appliedRound < endedRound) { // 젖은 속박은 시간으로 풀리지 않는다(다음 이동 한 번에 소비)
        s.turnsLeft -= 1;
        changed = true;
      }
    }
    const kept = unit.statuses.filter((s) => s.turnsLeft > 0);
    if (changed) {
      unit.statuses = kept;
      emit(state, ctx, { type: 'status', unitId: unit.unitId, statuses: kept.map((s) => ({ ...s })) });
    }
  }
}

// 10-14 C2-5A 예고 물살: N라운드 시작마다 다음 라운드의 방향(동·서, 정의의 고정 순서)을 예고하고, 그 라운드 시작에 모든 생존 참전자를 1칸 옮긴다.
// 맵 밖·점유 칸·통행 불가 칸이면 그 유닛은 움직이지 않는다. 피해·AP 감소·턴 박탈 없음(AP 재충전은 이 뒤에 한다)
function applyCurrent(state: BattleState, ctx: Ctx) {
  const t = state.telegraphed;
  if (!t || t.round !== state.round) return;
  state.telegraphed = null;
  const dc = t.direction === 'east' ? 1 : -1;
  const movers = partyUnits(state)
    .filter(isLive)
    .sort((a, b) => a.participantSlot - b.participantSlot || a.partyOrder - b.partyOrder || (a.unitId < b.unitId ? -1 : 1));
  const moved: string[] = [];
  const skipped: string[] = [];
  // 진행 방향 앞쪽 유닛부터 옮겨 같은 줄의 유닛이 서로 막지 않게 한다(결정적 순서)
  movers.sort((a, b) => (dc > 0 ? b.col - a.col : a.col - b.col) || (a.unitId < b.unitId ? -1 : 1));
  for (const u of movers) {
    const col = u.col + dc;
    const blocked = col < 0 || col >= state.rules.gridCols || isBlockedCell(state, col, u.row) || isOccupied(state, col, u.row, u);
    if (blocked) {
      skipped.push(u.unitId);
      continue;
    }
    u.col = col;
    moved.push(u.unitId);
  }
  state.lastCurrent = { round: state.round, direction: t.direction, moved, skipped };
  emit(state, ctx, { type: 'current', direction: t.direction, round: state.round, moved, skipped });
}

function telegraphCurrent(state: BattleState, ctx: Ctx) {
  const c = state.definition?.current;
  if (!c || c.everyRounds < 1 || c.directions.length === 0 || state.round % c.everyRounds !== 0) return;
  const seq = state.currentSeq ?? 0;
  state.currentSeq = seq + 1;
  const direction = c.directions[seq % c.directions.length];
  state.telegraphed = { direction, round: state.round + 1 };
  emit(state, ctx, { type: 'telegraph', direction, round: state.round + 1 });
}

// 라운드 시작 지형 변화(정의 데이터). 유닛이 서 있는 칸은 막지 않는다(갇힘 방지)
function applyTerrainRules(state: BattleState, ctx: Ctx) {
  const rules = state.definition?.terrainRules ?? [];
  if (rules.length === 0) return;
  const blocked = new Set(state.blocked ?? []);
  const before = [...blocked].sort().join('|');
  for (const rule of rules) {
    if (rule.everyRounds < 1 || (state.round - 1) % rule.everyRounds !== 0) continue;
    for (const c of rule.cells) {
      const k = cellKey(c.col, c.row);
      const occupied = state.units.some((u) => isLive(u) && u.col === c.col && u.row === c.row);
      const block = rule.mode === 'block' || (rule.mode === 'toggle' && !blocked.has(k));
      if (block && !occupied) blocked.add(k);
      else if (!block) blocked.delete(k);
    }
  }
  state.blocked = [...blocked];
  if ([...blocked].sort().join('|') !== before) emit(state, ctx, { type: 'terrain', blocked: [...state.blocked] });
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
      ...(state.definition
        ? {
            statuses: (u.statuses ?? []).map((s) => ({ ...s })),
            targetable: u.targetable ?? true,
            invulnerable: hasParts(state, u) ? hasLiveParts(state, u) : undefined,
            partOf: u.partOf ?? null,
            breakOrder: u.breakOrder ?? null,
            fled: u.fled ?? false,
            ...(hasParts(state, u) ? { phase: hasLiveParts(state, u) ? ('bound' as const) : ('exposed' as const), zeroDamage: u.protectMode === 'zero' } : {}),
            ...(u.flat !== undefined ? { flat: u.flat } : {}),
            ...(u.flee ? { reversed: !!u.reversed } : {}),
            ...(u.thread ? { thread: true, hinted: nextThread(state)?.unitId === u.unitId } : {}),
          }
        : {}),
    })),
    ...(state.definition ? { blocked: [...(state.blocked ?? [])], objectives: objectivesOf(state), cornerEscape: cornerEscapeOn(state) } : {}),
    ...(state.story ? { story: { encounterKey: state.story.encounterKey, captureEnabled: false as const, wildRewards: false as const } } : {}),
    ...(state.definition?.zones
      ? { zones: state.definition.zones.map((z) => ({ id: z.id, partId: z.partId, state: state.units.find((u) => u.unitId === z.partId)?.stunned ? ('restored' as const) : ('drained' as const), col: z.col, row: z.row })) }
      : {}),
    ...(state.definition?.current ? { telegraphedCurrent: state.telegraphed ?? null, lastCurrent: state.lastCurrent ?? null } : {}),
    ...(state.hintsShown && state.hintsShown.length > 0 ? { hintsShown: state.hintsShown.map((h) => ({ ...h })) } : {}),
  };
}
