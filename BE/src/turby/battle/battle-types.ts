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
  // 10-14 C2-5A(보스): 부위가 남은 중심부를 공격했을 때 — 'zero'면 행동은 소모되지만 피해 0 + 안내 1회(기본은 거부 TARGET_PROTECTED)
  protectMode?: 'reject' | 'zero';
  maxHitPercent?: number; // 이 유닛의 공격 한 번이 대상 최대 HP의 몇 %를 넘지 못하는가
  // 10-16 C3-3(3장): 모두 전투 정의 데이터가 소유한다. 없으면 기존 전투와 같다
  flat?: boolean; // 눌린 박음이: 첫 피격 전에는 납작해 피해가 절반(최소 최소피해). 맞으면 재봉선이 드러나 한 번만 해제된다
  flee?: SpoolFleeDef | null; // 작은 실패굴이: 공격하지 않고 아군에게서 달아난다. N라운드 안에 못 잡으면 박음이를 강화하고 사라진다
  reversed?: boolean; // 작은 실패굴이: 운반 실이 끊겨 방향이 뒤집힌 상태(아군 쪽으로 굴러온다)
  carrierOf?: string | null; // 운반 실: 이 실이 끊기면 해당 작은 실패굴이의 방향이 뒤집힌다
  thread?: { order: number | null } | null; // 보스의 기억실. order = 정해진 끊기 순서(1부터), null = 가짜 실
  anchored?: boolean; // 제자리 적(10-16 C3-6): 이동하지 않고 인접한 아군만 공격한다(기억실에 묶인 기억 실패굴이)
}

// 10-16 C3-3: 작은 실패굴이 규칙
export interface SpoolFleeDef {
  empowerAfterRound: number; // 이 라운드를 넘기면(라운드 시작 때) 강화 후 사라진다
  empowerAttack: number; // 살아 있는 납작 병사(flat 정의 유닛) 전원의 공격 증가량
}

// 지속 턴 상태 이상(M4-A). bind = 지속 턴 동안 이동력 감소. wet_bind(10-13 C2-3 젖은 속박) = 다음 이동 행동 한 번의 이동 가능 거리만 1칸 줄고(최소 1칸) 즉시 해제 —
// 중첩·지속 시간 갱신 없음. 수치는 전투 정의 데이터에서 온다(wet_bind는 turns·movePenalty를 쓰지 않는다)
export type StatusKind = 'bind' | 'wet_bind' | 'confused'; // confused(10-16 C3-3 혼란): 걸린 유닛의 이동·공격 대상이 서버가 정한 다른 칸·대상으로 바뀐다
export interface StatusEffectDef {
  kind: StatusKind;
  turns: number; // 걸린 뒤 라운드가 몇 번 시작될 때까지 유지
  movePenalty: number; // 이동에 쓸 수 있는 AP 감소량(0 미만으로 내려가지 않음)
}

export interface StatusEffect {
  kind: StatusKind;
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
  protectMode?: 'reject' | 'zero';
  maxHitPercent?: number;
  flat?: boolean;
  anchored?: boolean;
  flee?: SpoolFleeDef;
  carrierOf?: string;
  thread?: { order: number | null };
}

// 10-14 C2-5A: 보스전 전용 규칙(모두 전투 정의 데이터가 소유한다 — 전투 밖 C2-2 물살과 상태를 공유하지 않는다)
export interface BattleZoneDef {
  id: string;
  partId: string; // 이 부위가 끊어지면 구역이 drained → restored
  col: number; // 격자 가장자리 기준 중심(칸 단위 실수)
  row: number;
}
export interface BattleCurrentDef {
  everyRounds: number; // N라운드 시작마다 다음 라운드의 방향을 예고한다
  directions: ('east' | 'west')[]; // 고정 순서(난수 아님), 예고할 때마다 다음 값
}
export interface BattleHintDef {
  zeroDamage?: string; // 보호된 중심부를 처음 공격했을 때 한 번 보여 줄 안내
  threadHint?: string; // 10-16 C3-3: 매 라운드 시작에 알리는 "다음 기억실" 안내(표시 대상은 스냅샷 hinted)
}

export interface BattleDefinition {
  key: string;
  units: BattleUnitDefinition[];
  objectives?: { win?: BattleObjective[]; lose?: BattleObjective[] };
  blocked?: { col: number; row: number }[]; // 시작 시 통행 불가 칸
  terrainRules?: TerrainRule[];
  cornerEscape?: boolean;
  zones?: BattleZoneDef[];
  current?: BattleCurrentDef;
  hints?: BattleHintDef;
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
  // 10-14 C2-5A
  currentSeq?: number; // 지금까지 예고한 횟수(방향 순서의 위치)
  telegraphed?: { direction: 'east' | 'west'; round: number } | null; // round = 이 물살이 적용될 라운드
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
  | { version: number; type: 'phase'; unitId: string; phase: 'exposed' } // 보스: 모든 부위가 끊겨 약점이 드러났다(한 번만)
  | { version: number; type: 'hint'; code: string; text: string }
  | { version: number; type: 'telegraph'; direction: 'east' | 'west'; round: number }
  | { version: number; type: 'current'; direction: 'east' | 'west'; round: number; moved: string[]; skipped: string[] }
  // 10-16 C3-3
  | { version: number; type: 'wrong_thread'; unitId: string; targetId: string } // 정해진 순서가 아닌 기억실(또는 가짜 실)을 끊으려 했다 — 행동은 쓰지만 진행 없음, 공격한 유닛이 혼란
  | { version: number; type: 'confused_action'; unitId: string; action: 'move' | 'attack' } // 혼란 때문에 목표가 바뀌었거나 행동이 헛돌았다
  | { version: number; type: 'carrier_cut'; unitId: string; spoolId: string } // 운반 실이 끊겨 작은 실패굴이의 방향이 뒤집혔다
  | { version: number; type: 'empower'; unitId: string; targets: string[]; attack: number }; // 작은 실패굴이가 기억실을 전달해 박음이를 강화하고 사라졌다

export type ActionRequest =
  | { type: 'move'; unitId: unknown; targetCol: unknown; targetRow: unknown }
  | { type: 'attack'; unitId: unknown; targetUnitId: unknown }
  | { type: 'end' };

export class BattleError extends Error {
  readonly code: string;
  readonly snapshot: BattleSnapshotDto | null;
  reason: string | null = null; // 내부 사유(가로막힘 등) — 좌표 같은 정보는 담지 않는다
  battleId: string | null = null; // UNACKNOWLEDGED_BATTLE_RESULT일 때 복원할 전투(결과 화면으로 가는 길) — 그 플레이어 자신의 전투 ID뿐

  constructor(code: string, message: string, snapshot: BattleSnapshotDto | null = null) {
    super(message);
    this.code = code;
    this.snapshot = snapshot;
  }

  forBattle(battleId: string): this {
    this.battleId = battleId;
    return this;
  }

  because(reason: string): this {
    this.reason = reason;
    return this;
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
  phase?: 'bound' | 'exposed'; // 부위를 가진 중심부(보스)만
  zeroDamage?: boolean; // 보호 중에도 공격은 되지만 피해 0(안내 표시)
  flat?: boolean; // 눌린 박음이: 납작(첫 피격 전)
  reversed?: boolean; // 작은 실패굴이: 운반 실이 끊김
  thread?: boolean; // 보스의 기억실(진짜·가짜 구분은 알리지 않는다)
  hinted?: boolean; // 오래된 폭신이가 지금 가리키는 "다음 기억실"
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
  // 10-14 C2-5A 보스전(정의가 켠 경우만): 색 구역 상태, 예고된 물살과 마지막 적용 결과, 이미 보여 준 안내
  zones?: { id: string; partId: string; state: 'drained' | 'restored'; col: number; row: number }[];
  telegraphedCurrent?: { direction: 'east' | 'west'; round: number } | null;
  lastCurrent?: { round: number; direction: 'east' | 'west'; moved: string[]; skipped: string[] } | null;
  hintsShown?: { code: string; text: string }[];
}
