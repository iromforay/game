import type { ServerTurby } from '../api/client';

// 4-B: 서버 전투 계약(docs/save_a_turby_coop_ui_contract.md 10~15절) — 서버가 내려주는 상태를 그대로 담는 타입.
// 클라이언트는 이 상태를 그리고 의도(start/party/action)만 보낸다.
export type BattlePhase = 'inviting' | 'party_select' | 'player_subturn' | 'wild_turn' | 'resolved';
export type BattleOutcome = 'win' | 'lose' | 'draw' | 'cancelled';

export interface BattleUnit {
  unitId: string;
  side: 'party' | 'wild' | 'neutral'; // neutral: 스토리 전투의 보호 대상 NPC 등(공격·조작 불가)
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
  // 아래는 정의(스토리) 전투에서만 온다
  statuses?: StatusEffect[];
  targetable?: boolean;
  invulnerable?: boolean; // 부위가 남아 있는 중심부
  partOf?: string | null; // 이 부위가 속한 중심부 unitId
  breakOrder?: number | null; // 부위 파괴 순서(작은 수부터만 공격 가능)
  fled?: boolean; // 도주 연출로 전장에서 빠짐
  phase?: 'bound' | 'exposed'; // 부위를 가진 중심부(보스)의 서버 판정 상태
  zeroDamage?: boolean; // 결박 중에도 공격은 되지만 피해 0
}

export interface StatusEffect {
  kind: 'bind' | 'wet_bind'; // wet_bind = 젖은 속박(다음 이동 한 번의 이동 거리 1칸 감소, 최소 1칸, 한 번 쓰면 해제)
  turnsLeft: number;
  movePenalty: number;
  sourceUnitId: string | null;
  appliedRound: number;
}

export type BattleObjective = { kind: 'defeat_all' } | { kind: 'defeat_units'; unitIds: string[] } | { kind: 'protect'; unitIds: string[] } | { kind: 'party_down' };

export interface BattleParticipant {
  playerId: string;
  nickname: string;
  slot: number;
  connected: boolean;
  active: boolean;
  partySubmitted: boolean;
  eligibleForReward: boolean;
  invitePending: boolean;
  leftReason: string | null;
}

export interface BattleSnapshot {
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
  serverNow: number;
  outcome: BattleOutcome | null;
  participants: BattleParticipant[];
  units: BattleUnit[];
  // 아래는 정의(스토리) 전투에서만 온다
  blocked?: string[]; // 통행 불가 칸 "col,row"
  objectives?: { win: BattleObjective[]; lose: BattleObjective[] };
  cornerEscape?: boolean;
  story?: { encounterKey: string; captureEnabled: false; wildRewards: false };
  // 보스전(정의가 켠 경우만): 모두 서버가 정한 값 — 화면은 표시만 한다
  zones?: { id: string; partId: string; state: 'drained' | 'restored'; col: number; row: number }[];
  telegraphedCurrent?: { direction: 'east' | 'west'; round: number } | null;
  lastCurrent?: { round: number; direction: 'east' | 'west'; moved: string[]; skipped: string[] } | null;
  hintsShown?: { code: string; text: string }[];
}

export type BattleEvent =
  | { version: number; type: 'started' }
  | { version: number; type: 'move'; unitId: string; fromCol: number; fromRow: number; toCol: number; toRow: number; apLeft: number }
  | { version: number; type: 'attack'; attackerId: string; targetId: string; damage: number; targetHp: number; targetStunned: boolean }
  | { version: number; type: 'subturn'; phase: BattlePhase; round: number; currentPlayerId: string | null }
  | { version: number; type: 'participant_left'; playerId: string; reason: string }
  | { version: number; type: 'participant_status'; playerId: string; connected: boolean }
  | { version: number; type: 'resolved'; outcome: BattleOutcome }
  | { version: number; type: 'status'; unitId: string; statuses: StatusEffect[] }
  | { version: number; type: 'part_broken'; unitId: string; coreId: string; coreExposed: boolean }
  | { version: number; type: 'terrain'; blocked: string[] }
  | { version: number; type: 'unit_exit'; unitId: string; mode: 'flee' }
  | { version: number; type: 'phase'; unitId: string; phase: 'exposed' }
  | { version: number; type: 'hint'; code: string; text: string }
  | { version: number; type: 'telegraph'; direction: 'east' | 'west'; round: number }
  | { version: number; type: 'current'; direction: 'east' | 'west'; round: number; moved: string[]; skipped: string[] };

export interface BattleReward {
  playerId: string;
  rewardStatus: 'granted' | 'none';
  reason: string | null;
  capturedTurbyInstanceId: string | null;
  capturedTurby: ServerTurby | null;
}

export interface BattleEnded {
  outcome: BattleOutcome;
  rewards: BattleReward[];
  settled: boolean;
}

export interface BattleResponse {
  version: number;
  events: BattleEvent[];
  snapshot: BattleSnapshot;
  ended: BattleEnded | null;
}

export type BattleUpdate = BattleResponse & { battleId: string };

export type ActionBody =
  | { type: 'move'; unitId: string; targetCol: number; targetRow: number }
  | { type: 'attack'; unitId: string; targetUnitId: string }
  | { type: 'end' };

export type WildState = 'free' | 'engaged' | 'captured' | 'removed';
// 서버가 내려 주는 야생 마커(10-02 v6 §1): 위치·종류·상태 모두 서버 값. index = 서버 야생 마커 ID
export interface WildInfo {
  index: number;
  characterCode: string;
  x: number;
  y: number;
  state: WildState;
  visible: boolean;
}
export interface BattleInvite {
  battleId: string;
  snapshot: BattleSnapshot;
}
