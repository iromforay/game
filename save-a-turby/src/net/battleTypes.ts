import type { ServerTurby } from '../api/client';

// 4-B: 서버 전투 계약(docs/save_a_turby_coop_ui_contract.md 10~15절) — 서버가 내려주는 상태를 그대로 담는 타입.
// 클라이언트는 이 상태를 그리고 의도(start/party/action)만 보낸다.
export type BattlePhase = 'inviting' | 'party_select' | 'player_subturn' | 'wild_turn' | 'resolved';
export type BattleOutcome = 'win' | 'lose' | 'draw' | 'cancelled';

export interface BattleUnit {
  unitId: string;
  side: 'party' | 'wild';
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
}

export type BattleEvent =
  | { version: number; type: 'started' }
  | { version: number; type: 'move'; unitId: string; fromCol: number; fromRow: number; toCol: number; toRow: number; apLeft: number }
  | { version: number; type: 'attack'; attackerId: string; targetId: string; damage: number; targetHp: number; targetStunned: boolean }
  | { version: number; type: 'subturn'; phase: BattlePhase; round: number; currentPlayerId: string | null }
  | { version: number; type: 'participant_left'; playerId: string; reason: string }
  | { version: number; type: 'participant_status'; playerId: string; connected: boolean }
  | { version: number; type: 'resolved'; outcome: BattleOutcome };

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
export interface WildInfo {
  index: number;
  state: WildState;
}
export interface BattleInvite {
  battleId: string;
  snapshot: BattleSnapshot;
}
