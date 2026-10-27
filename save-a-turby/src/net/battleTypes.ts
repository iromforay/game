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
  // 10-16 C3-3(3장)
  flat?: boolean; // 눌린 박음이: 납작(첫 피격 전). false면 재봉선이 드러난 상태
  reversed?: boolean; // 작은 실패굴이: 운반 실이 끊겨 아군 쪽으로 굴러온다
  thread?: boolean; // 보스의 기억실(진짜·가짜는 알리지 않는다)
  hinted?: boolean; // 오래된 폭신이가 지금 가리키는 다음 기억실
  // 10-23 C4-3(4장): 서버 스냅샷 값 그대로 표시만 한다
  shardOf?: string; // 검은 실 파편(흩뿌린 박음이)
  reviving?: boolean; // 쓰러졌지만 파편이 남아 다시 일어날 수 있는 박음이
  reviveRound?: number;
  guardedBy?: string;
  guarded?: boolean; // 지금 골무막이 보호(피해 0)
  linkFor?: string; // 연결 실(묶인 아군)
  // 10-26 C5-3(5장)
  mirageOf?: string; // 열기 환영(만든 박음이)
  knotOf?: string; // 연결 매듭(지키는 예고 칸)
  regen?: boolean; // 금빛 연결점(끊겨도 다시 꿰매질 수 있는 부위 — reviving이면 다시 꿰매지는 중)
  nubiOnly?: boolean; // 이야기 누비만 풀 수 있는 안쪽 연결
  storyNubi?: boolean; // 이야기 누비
  // 10-26 F-3a 종장
  restores?: boolean; // 유물 매듭(누르면 길이 이어진다 — 정해진 순서)
  phantom?: boolean; // 누비 환영(치면 가위가 곁 칸을 끊는다)
  releases?: string; // 검정실(끊으면 묶인 환영이 사라진다)
}

export interface StatusEffect {
  kind: 'bind' | 'wet_bind' | 'confused' | 'pinned'; // pinned(10-23 C4-3) = 바닥에 고정(연결 실을 끊으면 풀림) // confused = 혼란(이동·공격 대상이 서버가 정한 다른 칸·대상으로 바뀐다). wet_bind = 젖은 속박(다음 이동 한 번의 이동 거리 1칸 감소, 최소 1칸, 한 번 쓰면 해제)
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
  ice?: string[]; // 10-23 C4-3: 얼음 칸 "col,row"
  needleMarks?: string[]; // 10-23 C4-3: 다음 적 차례에 바늘이 내려올 칸
  // 10-26 C5-3
  embers?: { cell: string; explodeRound: number }[]; // 불씨 칸(터질 라운드)
  wet?: string[]; // 물들이가 적신 칸
  cutWarns?: string[]; // 곧 끊어질 칸(실밥이 예고·재단인형 줄 예고)
  cut?: string[]; // 끊긴 칸(blocked에도 있다)
  stage?: { index: number; total: number; id: string; label: string }; // 10-26 F-3a: 단계 전투
  sealed?: string[]; // 유물 매듭으로 봉합된 칸
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
  | { version: number; type: 'current'; direction: 'east' | 'west'; round: number; moved: string[]; skipped: string[] }
  | { version: number; type: 'wrong_thread'; unitId: string; targetId: string }
  | { version: number; type: 'confused_action'; unitId: string; action: 'move' | 'attack' }
  | { version: number; type: 'carrier_cut'; unitId: string; spoolId: string }
  | { version: number; type: 'empower'; unitId: string; targets: string[]; attack: number }
  // 10-23 C4-3
  | { version: number; type: 'ice'; cells: string[] }
  | { version: number; type: 'slide'; unitId: string; fromCol: number; fromRow: number; toCol: number; toRow: number }
  | { version: number; type: 'shatter'; unitId: string; shardIds: string[]; reviveRound: number }
  | { version: number; type: 'shatter_cleared'; unitId: string }
  | { version: number; type: 'revive'; unitId: string; hp: number }
  | { version: number; type: 'needle_telegraph'; cells: string[] }
  | { version: number; type: 'needle_strike'; cells: string[]; pinned: string[]; linkIds: string[] }
  | { version: number; type: 'freed'; unitId: string; linkId: string; byUnitId: string | null }
  // 10-26 C5-3
  | { version: number; type: 'embers'; cells: string[] }
  | { version: number; type: 'ember_burst'; cell: string; hits: { unitId: string; damage: number; hp: number; stunned: boolean }[] }
  | { version: number; type: 'wet'; cells: string[] }
  | { version: number; type: 'mirage'; unitId: string; mirageId: string }
  | { version: number; type: 'cut_warn'; cells: string[] }
  | { version: number; type: 'cut'; cells: string[]; hits: { unitId: string; damage: number; hp: number; stunned: boolean }[] }
  | { version: number; type: 'restored'; cell: string; byUnitId: string }
  | { version: number; type: 'regen'; unitId: string; reviveRound: number }
  | { version: number; type: 'stage'; index: number; total: number; id: string; label: string; hint: string | null }
  | { version: number; type: 'phantom_hit'; unitId: string; phantomId: string; cell: string | null };

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
