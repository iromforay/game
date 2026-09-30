// 4-B: 서버 권위 전투 상태(docs/save_a_turby_coop_ui_contract.md 10~15절). 엔진은 이 타입만 다루는 순수 모듈이고
// DB·소켓·시간은 BattleService가 맡는다.
export type BattlePhase = 'inviting' | 'party_select' | 'player_subturn' | 'wild_turn' | 'resolved';
export type BattleOutcome = 'win' | 'lose' | 'draw' | 'cancelled';
export type UnitSide = 'party' | 'wild' | 'neutral'; // neutral: 전투 정의의 NPC(붙잡힌 보풀이·보호 대상 등)

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
  cornerEscape?: boolean; // 꼭짓점 도착 = 무승부(도주). 기본 true(야생). 스토리 전투 정의는 false
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
  // ---- M4-A 확장(모두 선택. 없으면 기존 야생 전투와 같다) ----
  statuses?: StatusEffect[];
  targetable?: boolean; // false면 아군이 공격할 수 없다(기본 true)
  threatened?: boolean; // neutral 유닛을 적 AI가 노릴 수 있는가(기본 false)
  canAct?: boolean; // false면 차례가 없다(neutral NPC 기본 false)
  partOf?: string | null; // 부위가 속한 중심부 unitId
  breakOrder?: number | null; // 부위 파괴 순서(작은 수부터만 공격 가능)
  onHit?: StatusEffectDef | null; // 이 적이 공격해 맞히면 대상에게 거는 상태 이상
  exitOnDefeat?: 'flee' | null; // 쓰러지면 "도주" 연출 표시(승패·보상 판정과 무관)
  fled?: boolean; // 연출 표시 상태
}

// 지속 턴 상태 이상(M4-A). 현재 종류는 속박(이동력 감소)뿐 — 수치는 전투 정의 데이터에서 온다
export interface StatusEffectDef {
  kind: 'bind';
  turns: number; // 걸린 뒤 라운드가 몇 번 시작될 때까지 유지
  movePenalty: number; // 이동에 쓸 수 있는 AP 감소량(0 미만으로 내려가지 않음)
}

export interface StatusEffect {
  kind: 'bind';
  turnsLeft: number;
  movePenalty: number;
  sourceUnitId: string | null;
  appliedRound: number; // 걸린 라운드(그 라운드가 끝날 때는 줄이지 않는다)
}

export type BattleObjective =
  | { kind: 'defeat_all' } // 적(wild) 전원 쓰러뜨림 — 기본 승리 조건
  | { kind: 'defeat_units'; unitIds: string[] } // 특정 유닛 파괴(부위 중심부 등)
  | { kind: 'protect'; unitIds: string[] } // 이 유닛이 쓰러지면 패배
  | { kind: 'party_down' }; // 아군 전원 기절 — 기본 패배 조건

export interface TerrainRule {
  everyRounds: number; // N라운드마다(라운드 시작 시점)
  cells: { col: number; row: number }[];
  mode: 'block' | 'open' | 'toggle';
}

// 전투 정의 데이터(M4-A): 적·NPC 배치, 기믹 수치, 목표, 지형. 코드에 분기로 넣지 않는다.
export interface BattleUnitDefinition extends UnitStatsInput {
  unitId: string;
  side: 'wild' | 'neutral';
  characterCode: string;
  name: string;
  col: number;
  row: number;
  targetable?: boolean;
  threatened?: boolean;
  canAct?: boolean;
  partOf?: string | null;
  breakOrder?: number | null;
  onHit?: StatusEffectDef | null;
  exitOnDefeat?: 'flee' | null;
}

export interface BattleDefinition {
  key: string;
  units: BattleUnitDefinition[];
  objectives?: { win?: BattleObjective[]; lose?: BattleObjective[] };
  blocked?: { col: number; row: number }[]; // 시작 시 통행 불가 칸
  terrainRules?: TerrainRule[];
  cornerEscape?: boolean;
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
  definition?: BattleDefinition | null; // 있으면 야생 1마리 대신 정의 데이터로 적·NPC·목표·지형을 만든다
  blocked?: string[]; // 현재 통행 불가 칸 "col,row"
  story?: { encounterKey: string } | null; // 스토리 전투 표식
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
  | { version: number; type: 'unit_exit'; unitId: string; mode: 'flee' };

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
  statuses?: StatusEffect[];
  targetable?: boolean;
  invulnerable?: boolean;
  partOf?: string | null;
  breakOrder?: number | null;
  fled?: boolean;
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
  blocked?: string[];
  objectives?: { win: BattleObjective[]; lose: BattleObjective[] }; // 정의 전투만: 기본값을 채운 목표(프런트 표시용)
  cornerEscape?: boolean; // 정의 전투만: 꼭짓점 퇴각(무승부) 사용 여부 — 프런트가 퇴각존을 그릴지 정한다
  story?: { encounterKey: string; captureEnabled: false; wildRewards: false }; // 스토리 전투 표식 — 포획·일반 야생 보상 없음
}
