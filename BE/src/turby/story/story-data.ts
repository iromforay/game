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
  ev({ id: 'forest_first_path_started', chapter: 1, allowedAt: ['OPENING_COMPLETE'], requires: ['story_nubi_granted'], evidence: { kind: 'region', stageCode: 'forest', regionId: 'forest_first_path_start' }, to: 'CH01_STARTED' }),
  ev({ id: 'forest_stitchling_battle_won', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['forest_bopul_rescued'] }),
  ev({ id: 'forest_bopul_rescued', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' } }),
  ev({ id: 'forest_dansuring_clue_learned', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_bopul_rescued'], evidence: { kind: 'none' }, to: 'CH01_BOPUL_RESCUED' }),
  ev({
    id: 'forest_compass_granted',
    chapter: 1,
    allowedAt: ['CH01_BOPUL_RESCUED'],
    requires: ['forest_dansuring_clue_learned'],
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'npc_bopuli' },
    requireObjective: { key: 'forest_glowing_dust', count: 10 },
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
