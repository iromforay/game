// 4-B: 서버 권위 전투 상태(docs/save_a_turby_coop_ui_contract.md 10~15절). 엔진은 이 타입만 다루는 순수 모듈이고
// DB·소켓·시간은 BattleService가 맡는다.
export type BattlePhase = 'inviting' | 'party_select' | 'player_subturn' | 'wild_turn' | 'resolved';
export type BattleOutcome = 'win' | 'lose' | 'draw' | 'cancelled';
export type UnitSide = 'party' | 'wild';

export interface BattleRules {
  gridCols: number;
  gridRows: number;
  maxAlliedUnits: number;
  partyStartCol: number;
  wildStartCol: number;
  wildStartRow: number;
  minDamage: number;
  defenseDivisor: number;
  wildHpMult: number[]; // 인덱스 = 참전 인원(1~5), 0번은 사용하지 않음
}

export interface UnitStatsInput {
  attack: number;
  defense: number;
  actionPower: number;
  maxHp: number;
}

export interface BattleUnit {
  unitId: string;
  attack: number;
  defense: number;
  side: UnitSide;
  ownerPlayerId: string | null;
  participantSlot: number; // 야생은 0
  partyOrder: number;
  turbyId: string | null;
  characterCode: string;
  name: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  stunned: boolean;
  inactive: boolean; // 참가자가 퇴장·유예 만료로 빠져 전장에서 제거됨
}

export interface Participant {
  playerId: string;
  nickname: string;
  slot: number; // 입장 순서로 고정 1~5
  connected: boolean;
  active: boolean; // false = 명시 퇴장/유예 만료
  partySubmitted: boolean;
  eligibleForReward: boolean;
  invitePending: boolean; // 초대를 받았고 아직 응답하지 않음(조우자는 자동 참전이라 항상 false)
  leftReason: string | null; // 명시 퇴장('left')·유예 만료('timeout')·파티 선택 시간 초과('party_timeout')
}

export interface PartyEntry extends UnitStatsInput {
  turbyId: string;
  characterCode: string;
  name: string;
}

export interface BattleState {
  battleId: string;
  roomCode: string;
  stageCode: string;
  spawnIndex: number;
  wildCharacterCode: string;
  encounterPlayerId: string;
  wildName: string;
  wildBase: UnitStatsInput;
  rules: BattleRules;
  phase: BattlePhase;
  version: number;
  round: number;
  participants: Participant[]; // 슬롯 순서
  turnOrder: string[]; // 확정 참전자 playerId (슬롯 순서)
  subturnIndex: number;
  units: BattleUnit[];
  outcome: BattleOutcome | null;
  expiresAt: number | null;
  pendingParties: Record<string, PartyEntry[]>; // 파티 선택 중 제출된 목록(playerId → 파티). 전투 시작 후 비운다
}

export type BattleEvent =
  | { version: number; type: 'started' }
  | { version: number; type: 'move'; unitId: string; fromCol: number; fromRow: number; toCol: number; toRow: number; apLeft: number }
  | { version: number; type: 'attack'; attackerId: string; targetId: string; damage: number; targetHp: number; targetStunned: boolean }
  | { version: number; type: 'subturn'; phase: BattlePhase; round: number; currentPlayerId: string | null }
  | { version: number; type: 'participant_left'; playerId: string; reason: string }
  | { version: number; type: 'participant_status'; playerId: string; connected: boolean }
  | { version: number; type: 'resolved'; outcome: BattleOutcome };

export type ActionRequest =
  | { type: 'move'; unitId: unknown; targetCol: unknown; targetRow: unknown }
  | { type: 'attack'; unitId: unknown; targetUnitId: unknown }
  | { type: 'end' };

export class BattleError extends Error {
  readonly code: string;
  readonly snapshot: BattleSnapshotDto | null;

  constructor(code: string, message: string, snapshot: BattleSnapshotDto | null = null) {
    super(message);
    this.code = code;
    this.snapshot = snapshot;
  }
}

export interface BattleUnitDto {
  unitId: string;
  side: UnitSide;
  ownerPlayerId: string | null;
  participantSlot: number;
  characterCode: string;
  name: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  stunned: boolean;
  inactive: boolean;
}

export interface BattleSnapshotDto {
  battleId: string;
  version: number;
  phase: BattlePhase;
  round: number;
  stageCode: string;
  spawnIndex: number;
  wildCharacterCode: string;
  wildName: string;
  encounterPlayerId: string;
  grid: { cols: number; rows: number };
  partyLimit: number;
  currentPlayerId: string | null;
  expiresAt: number | null;
  serverNow: number; // 응답을 만든 서버 시각(ms) — 클라이언트가 시계 오차를 보정해 카운트다운을 표시하는 데만 쓴다(만료 판정은 서버)
  outcome: BattleOutcome | null;
  participants: { playerId: string; nickname: string; slot: number; connected: boolean; active: boolean; partySubmitted: boolean; eligibleForReward: boolean; invitePending: boolean; leftReason: string | null }[];
  units: BattleUnitDto[];
}
