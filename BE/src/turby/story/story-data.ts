// 스토리 서버 전이표 — docs/dev/save-a-turby/m0/m0_design.md 3절, docs/implementation/story/story_checkpoint_spec.md.
// 클라이언트는 이벤트 "완료 요청"만 보낸다. 도착 체크포인트·영구 효과·멱등 키는 전부 이 표가 정한다.
// 2~5장은 M7에서 같은 형식으로 추가한다(체크포인트 순서만 먼저 둔다).

export const CHECKPOINTS = [
  'OPENING_NOT_STARTED',
  'OPENING_FALL_COMPLETE',
  'OPENING_NAME_SAVED',
  'OPENING_COMPLETE',
  'CH01_STARTED',
  'CH01_BOPUL_RESCUED',
  'CH01_COMPASS_ACQUIRED',
  'CH01_FIRST_KNOT_EQUIPPED',
  'CH01_COMPLETE',
  'CH02_STARTED',
  'CH02_SETTLEMENT_MET',
  'CH02_MAZE_CLEARED',
  'CH02_NUBI_CRISIS_SEEN',
  'CH02_BOSS_DEFEATED',
  'CH02_COMPLETE',
  'CH03_STARTED',
  'CH03_ELDER_MET',
  'CH03_MEMORY_TRAIL_FOUND',
  'CH03_MEMORY_FRAGMENT_SEEN',
  'CH03_BOSS_DEFEATED',
  'CH03_COMPLETE',
  'CH04_STARTED',
  'CH04_GANEURI_RESCUED',
  'CH04_STORAGE_CLEARED',
  'CH04_CONFESSION_SEEN',
  'CH04_BOSS_DEFEATED',
  'CH04_COMPLETE',
  'CH05_STARTED',
  'CH05_CLUES_JOINED',
  'CH05_RIDGE_CROSSED',
  'CH05_BOSS_DEFEATED',
  'CH05_SCISSORS_REVEALED',
  'CH05_COMPLETE',
] as const;

export type Checkpoint = (typeof CHECKPOINTS)[number];

export const DEFAULT_NICKNAME = '터비 탐험가';
export const STORY_NUBI_CHARACTER = 'nubi';

// 장 번호(0 = 오프닝)별 코드. 대화 파일 이름과 GET /player/me/story의 chapterCode에 쓴다.
export const CHAPTER_CODES = ['opening', 'ch01', 'ch02', 'ch03', 'ch04', 'ch05'] as const;
export type ChapterCode = (typeof CHAPTER_CODES)[number];

// 정본 이벤트 ID ↔ DB stage_code(C4: 내부 코드는 underground/ice 유지)
export const STAGE_UNLOCK_EVENTS: Record<string, string> = {
  lake: 'lake_unlocked',
  underground: 'underfloor_unlocked',
  ice: 'fridge_unlocked',
  desert: 'desert_unlocked',
};
export const STAGE_CHAPTER: Record<string, number> = { forest: 1, lake: 2, underground: 3, ice: 4, desert: 5 };
export const LEGACY_ACCESS_PREFIX = 'legacy_access_';

export type ItemGrant = { itemCode: string; quantity: number };

export type Evidence =
  | { kind: 'none' }
  | { kind: 'region'; stageCode: string; regionId: string } // 서버가 아는 플레이어 좌표가 구역 안
  | { kind: 'point'; stageCode: string; pointId: string } // 서버가 아는 플레이어 좌표가 지점 반경 안
  | { kind: 'stage'; stageCode: string } // 임시(Codex v2 §1.1): 좌표 확정 전 — 그 지역 탐험 세션(맵 입장) 안에 있음. 지도 개편 후 region/point로 교체
  | { kind: 'name' }; // 이름 API로 저장했거나, 기존 계정이 이미 기본값이 아닌 닉네임을 가짐

export interface StoryEventDef {
  id: string;
  chapter: number; // canProgressChapter 검사 대상(0 = 오프닝)
  allowedAt: Checkpoint[]; // 허용 시작 체크포인트
  requires: string[]; // 선행 완료 이벤트
  serverOnly?: boolean; // 전투 확정 등 서버 코드만 기록. REST 요청 거부
  evidence: Evidence;
  requireObjective?: { key: string; count: number };
  consume?: ItemGrant[];
  grant?: ItemGrant[];
  markUsed?: string[]; // mission 아이템 사용 완료 표시
  grantStoryNubi?: boolean;
  equipRelic?: { itemCode: string; slotKey: string; growthStage: number };
  requireGrowth?: number;
  alsoComplete?: string[]; // 같은 트랜잭션에서 함께 기록할 이벤트(예: 장 완료 + 다음 지역 개방)
  to?: Checkpoint; // 도착 체크포인트(현재보다 앞설 때만 갱신)
}

export interface StoryObjectiveDef {
  key: string;
  chapter: number;
  activeAt: Checkpoint[];
  requires: string[];
  stageCode: string;
  objectIds: string[];
  grantPerObject?: ItemGrant;
}

const ev = (def: StoryEventDef) => def;

export const STORY_EVENTS: StoryEventDef[] = [
  // ---- 오프닝 ----
  ev({ id: 'opening_fall_completed', chapter: 0, allowedAt: ['OPENING_NOT_STARTED'], requires: [], evidence: { kind: 'none' }, to: 'OPENING_FALL_COMPLETE' }),
  ev({ id: 'opening_name_saved', chapter: 0, allowedAt: ['OPENING_FALL_COMPLETE'], requires: [], evidence: { kind: 'name' }, to: 'OPENING_NAME_SAVED' }),
  ev({ id: 'story_nubi_granted', chapter: 0, allowedAt: ['OPENING_NAME_SAVED'], requires: ['opening_name_saved'], evidence: { kind: 'none' }, grantStoryNubi: true, to: 'OPENING_COMPLETE' }),

  // ---- 1장 소파 속 먼지숲 ----
  // 숲 첫 정상 진입 트리거(forest_entry)만 기록한다(서버 전용 — 클라이언트가 장 시작을 직접 요청할 수 없음)
  ev({ id: 'forest_first_path_started', chapter: 1, allowedAt: ['OPENING_COMPLETE'], requires: ['story_nubi_granted'], serverOnly: true, evidence: { kind: 'stage', stageCode: 'forest' }, to: 'CH01_STARTED' }),
  ev({ id: 'forest_stitchling_battle_won', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['forest_bopul_rescued'] }),
  ev({ id: 'forest_bopul_rescued', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' } }),
  ev({ id: 'forest_dansuring_clue_learned', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_bopul_rescued'], evidence: { kind: 'none' }, to: 'CH01_BOPUL_RESCUED' }),
  ev({
    id: 'forest_compass_granted',
    chapter: 1,
    allowedAt: ['CH01_BOPUL_RESCUED'],
    requires: ['forest_dansuring_clue_learned'],
    // 보풀이 전달 트리거(npc_bopuli)만 기록한다(서버 전용). 조건은 서버 인벤토리 실가루 수량(Codex v2 §2.3) — 소비·지급·체크포인트가 한 트랜잭션
    serverOnly: true,
    evidence: { kind: 'stage', stageCode: 'forest' },
    consume: [{ itemCode: 'glowing_yarn_dust', quantity: 10 }],
    grant: [{ itemCode: 'yarn_tremor_compass', quantity: 1 }],
    to: 'CH01_COMPASS_ACQUIRED',
  }),
  ev({ id: 'forest_giant_knot_defeated', chapter: 1, allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted'], serverOnly: true, evidence: { kind: 'none' }, markUsed: ['yarn_tremor_compass'] }),
  ev({ id: 'forest_first_knot_awakened', chapter: 1, allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_giant_knot_defeated'], evidence: { kind: 'none' }, grant: [{ itemCode: 'first_knot', quantity: 1 }] }),
  ev({
    id: 'forest_first_knot_equipped',
    chapter: 1,
    allowedAt: ['CH01_COMPASS_ACQUIRED'],
    requires: ['forest_first_knot_awakened'],
    evidence: { kind: 'none' },
    equipRelic: { itemCode: 'first_knot', slotKey: 'story_1', growthStage: 1 }, // Codex D2: 성장 단계는 장착 트랜잭션에서만 올린다
    to: 'CH01_FIRST_KNOT_EQUIPPED',
  }),
  ev({ id: 'forest_dansuring_found', chapter: 1, allowedAt: ['CH01_FIRST_KNOT_EQUIPPED'], requires: ['forest_first_knot_equipped'], evidence: { kind: 'point', stageCode: 'forest', pointId: 'dansuring' } }),
  ev({
    id: 'forest_primordial_knot_seen',
    chapter: 1,
    allowedAt: ['CH01_FIRST_KNOT_EQUIPPED'],
    requires: ['forest_dansuring_found'],
    evidence: { kind: 'none' },
    requireGrowth: 1, // 장 완료는 성장 단계를 확인만 한다
    alsoComplete: ['lake_unlocked'],
    to: 'CH01_COMPLETE',
  }),
  ev({ id: 'lake_unlocked', chapter: 1, allowedAt: ['CH01_FIRST_KNOT_EQUIPPED'], requires: ['forest_dansuring_found'], serverOnly: true, evidence: { kind: 'none' } }),
];

export const STORY_OBJECTIVES: StoryObjectiveDef[] = [
  {
    key: 'forest_glowing_dust',
    chapter: 1,
    activeAt: ['CH01_BOPUL_RESCUED'],
    requires: ['forest_dansuring_clue_learned'],
    stageCode: 'forest',
    objectIds: Array.from({ length: 10 }, (_, i) => `dust_${String(i + 1).padStart(2, '0')}`),
    grantPerObject: { itemCode: 'glowing_yarn_dust', quantity: 1 },
  },
];

export const EVENT_BY_ID = new Map(STORY_EVENTS.map((e) => [e.id, e]));
export const OBJECTIVE_BY_KEY = new Map(STORY_OBJECTIVES.map((o) => [o.key, o]));

// 인벤토리의 "누비에게 장착" 버튼이 호출할 이벤트(유물 전용 장착 API를 따로 두지 않는다)
export const RELIC_EQUIP_EVENT = new Map(STORY_EVENTS.filter((e) => e.equipRelic).map((e) => [e.equipRelic!.itemCode, e.id]));

// 이야기 탭(가방 40칸에 포함하지 않음)
export const STORY_CATEGORIES = new Set(['mission', 'relic', 'memento']);
export const STORY_SLOT_PREFIX = 'story_';

// ---- 스토리 트리거(M4-C) ----
// 트리거 판정(어디서·언제)과 대화 실행을 분리한다: 서버가 트리거를 판정해 이벤트를 기록하고 재생할 구간을 알려 준다.
// 클라이언트는 서버가 알려 준 구간만 재생한다(임의 구간 ID로 진행을 건너뛸 수 없음 — 진행은 이벤트 규칙으로만 바뀐다).
// 좌표가 필요한 트리거(point)는 지역 스토리 데이터가 없으면 서버가 거부하므로 일반 플레이에서 거짓 진행되지 않는다.
export interface StoryTriggerDef {
  id: string;
  stageCode: string;
  evidence: Evidence;
  event?: string; // 트리거가 서버 경로로 기록하는 이벤트
  optionalEvent?: boolean; // 이벤트를 기록할 수 없는 시점이어도 거부하지 않고 재생 구간만 판단(지역 진입)
  need?: ItemGrant; // 이벤트 전에 확인할 보유 수량(부족하면 기록하지 않고 부족 수량을 돌려줌)
  activeAt?: Checkpoint[]; // 이벤트 없는 트리거의 허용 체크포인트
  unless?: string[]; // 이미 완료됐으면 트리거가 열리지 않는 이벤트
  play: 'resume' | string; // resume = 현재 진행의 복귀 구간(이 지역 장의 구간만), 그 밖에는 새로 기록했을 때만 재생할 구간
}

export const STORY_TRIGGERS: StoryTriggerDef[] = [
  { id: 'forest_entry', stageCode: 'forest', evidence: { kind: 'stage', stageCode: 'forest' }, event: 'forest_first_path_started', optionalEvent: true, play: 'resume' },
  { id: 'npc_bopuli', stageCode: 'forest', evidence: { kind: 'stage', stageCode: 'forest' }, event: 'forest_compass_granted', need: { itemCode: 'glowing_yarn_dust', quantity: 10 }, play: 'ch01.compass_craft' },
  { id: 'forest_hidden_path', stageCode: 'forest', evidence: { kind: 'point', stageCode: 'forest', pointId: 'hidden_path' }, activeAt: ['CH01_COMPASS_ACQUIRED'], unless: ['forest_giant_knot_defeated'], play: 'ch01.hidden_path' },
  { id: 'forest_dansuring', stageCode: 'forest', evidence: { kind: 'point', stageCode: 'forest', pointId: 'dansuring' }, event: 'forest_dansuring_found', play: 'ch01.primordial_knot' },
];
export const TRIGGER_BY_ID = new Map(STORY_TRIGGERS.map((t) => [t.id, t]));

// 한 번에 이어서 재생하는 구간의 끝. 그다음 구간은 별도 트리거(보풀이 전달·지도 지점·유물 장착)가 있어야 열린다
export const SEGMENT_CHAIN_END: Record<string, string> = {
  'ch01.first_path': 'ch01.bopul_clue',
  'ch01.bopul_clue': 'ch01.bopul_clue',
  'ch01.compass_craft': 'ch01.compass_craft',
  'ch01.hidden_path': 'ch01.first_knot_awaken',
  'ch01.first_knot_awaken': 'ch01.first_knot_awaken',
  'ch01.first_knot_equipped': 'ch01.first_knot_equipped',
  'ch01.primordial_knot': 'ch01.primordial_knot',
};

// 이벤트를 새로 기록했을 때 이어서 재생할 구간(유물 장착 → 장착 장면)
export const SEGMENT_AFTER_EVENT: Record<string, string> = {
  forest_first_knot_equipped: 'ch01.first_knot_equipped',
};

// ---- 스토리 전투 조우(M4-B) ----
// 탐험 세션 안에서 battle:story:start { encounterKey }로 시작한다. 승리 이벤트는 서버 전투 확정만 기록한다(REST 불가).
// 전투 정의(적·NPC·기믹·수치)는 BE/story-data/save-a-turby/battles/<key>.json — 현재 값은 기능 검증용 임시값.
export interface StoryEncounterDef {
  key: string;
  chapter: number;
  stageCode: string;
  allowedAt: Checkpoint[];
  requires: string[];
  onWinEvents: string[]; // 이미 완료됐으면 다시 시작할 수 없다(STORY_ENCOUNTER_DONE)
}

export const STORY_ENCOUNTERS: StoryEncounterDef[] = [
  { key: 'forest_stitchling_ambush', chapter: 1, stageCode: 'forest', allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], onWinEvents: ['forest_stitchling_battle_won'] },
  { key: 'forest_giant_knot', chapter: 1, stageCode: 'forest', allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted'], onWinEvents: ['forest_giant_knot_defeated'] },
];

export const ENCOUNTER_BY_KEY = new Map(STORY_ENCOUNTERS.map((e) => [e.key, e]));
