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
  // 10-02 v3 §4: 숲 안의 이야기 지점 완료 기록(체크포인트는 바꾸지 않는다). 지점 트리거만 기록한다(서버 전용, 좌표 증거)
  ev({ id: 'forest_cut_thread_inspected', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_cut_thread' } }),
  ev({ id: 'forest_stitchling_battle_won', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['forest_bopul_rescued'] }),
  ev({ id: 'forest_bopul_rescued', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started'], serverOnly: true, evidence: { kind: 'none' } }),
  ev({ id: 'forest_dansuring_clue_learned', chapter: 1, allowedAt: ['CH01_STARTED'], requires: ['forest_bopul_rescued'], evidence: { kind: 'none' }, to: 'CH01_BOPUL_RESCUED' }),
  ev({
    id: 'forest_compass_granted',
    chapter: 1,
    allowedAt: ['CH01_BOPUL_RESCUED'],
    requires: ['forest_dansuring_clue_learned'],
    // 보풀이 전달 지점(forest_bopuli_return)만 기록한다(서버 전용). 조건은 서버 인벤토리 실가루 수량(Codex v2 §2.3) — 소비·지급·체크포인트가 한 트랜잭션
    serverOnly: true,
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_bopuli_return' },
    consume: [{ itemCode: 'glowing_yarn_dust', quantity: 10 }],
    grant: [{ itemCode: 'yarn_tremor_compass', quantity: 1 }],
    to: 'CH01_COMPASS_ACQUIRED',
  }),
  ev({ id: 'forest_hidden_path_opened', chapter: 1, allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted'], serverOnly: true, evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_hidden_path' } }),
  ev({ id: 'forest_giant_knot_defeated', chapter: 1, allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted'], serverOnly: true, evidence: { kind: 'none' }, markUsed: ['yarn_tremor_compass'] }),
  ev({ id: 'forest_first_knot_awakened', chapter: 1, allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_giant_knot_defeated'], evidence: { kind: 'none' }, grant: [{ itemCode: 'first_knot', quantity: 1 }] }),
  ev({
    id: 'forest_first_knot_equipped',
    chapter: 1,
    allowedAt: ['CH01_COMPASS_ACQUIRED'],
    requires: ['forest_first_knot_awakened'],
    // 인벤토리 "누비에게 장착"(POST /player/me/story/relics/:itemCode/equip)만 기록 — 이벤트 ID·터비를 클라이언트가 고르지 않는다(v3 §3)
    serverOnly: true,
    evidence: { kind: 'none' },
    equipRelic: { itemCode: 'first_knot', slotKey: 'story_1', growthStage: 1 }, // Codex D2: 성장 단계는 장착 트랜잭션에서만 올린다
    to: 'CH01_FIRST_KNOT_EQUIPPED',
  }),
  ev({ id: 'forest_dansuring_found', chapter: 1, allowedAt: ['CH01_FIRST_KNOT_EQUIPPED'], requires: ['forest_first_knot_equipped'], serverOnly: true, evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_dansuring' } }),
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

  // ---- 2장 어항 속 호수(C2-1: 입구·정착지·물결북) ----
  // 물빛 입구 도입 대화를 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간의 completesWith). 호수 탐험 세션 안에서만 허용 — 1장을 마치지 않았으면 CHAPTER_LOCKED
  ev({ id: 'lake_entry_seen', chapter: 2, allowedAt: ['CH01_COMPLETE'], requires: ['lake_unlocked'], evidence: { kind: 'stage', stageCode: 'lake' }, to: 'CH02_STARTED' }),
  // 정착지의 물들이·물결북 지점에 닿았을 때 서버가 기록한다(서버 전용, 좌표 증거). 체크포인트는 물결북 반응에서 CH02_SETTLEMENT_MET
  ev({ id: 'lake_mulduri_met', chapter: 2, allowedAt: ['CH02_STARTED'], requires: ['lake_entry_seen'], serverOnly: true, evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_mulduri' } }),
  ev({ id: 'lake_wave_drum_awakened', chapter: 2, allowedAt: ['CH02_STARTED'], requires: ['lake_mulduri_met'], serverOnly: true, evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_wave_drum' }, to: 'CH02_SETTLEMENT_MET' }),
  // 10-13 C2-3: 붙잡힌 물들이 구조. 지점마다 서버 스토리 전투(lake_guard_*)를 이기면 서버가 한 번 기록한다(서버 전용 — 전투 시작 때 반경 증거를 이미 확인했다).
  // 개별 구조는 아이템·통화·성장을 주지 않고 체크포인트도 바꾸지 않는다. 덫 제거와 구조는 같은 기록이다
  ev({ id: 'lake_trapped_mulduri_a_rescued', chapter: 2, allowedAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_wave_drum_awakened'], serverOnly: true, evidence: { kind: 'none' } }),
  ev({ id: 'lake_trapped_mulduri_b_rescued', chapter: 2, allowedAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_wave_drum_awakened'], serverOnly: true, evidence: { kind: 'none' } }),
  ev({ id: 'lake_trapped_mulduri_c_rescued', chapter: 2, allowedAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_wave_drum_awakened'], serverOnly: true, evidence: { kind: 'none' } }),
  // 세 개별 구조가 모두 기록되면 같은 트랜잭션에서 서버가 한 번 기록하는 집계 사건(EVENT_AGGREGATES). 직접 요청 불가
  ev({ id: 'lake_trapped_turbies_rescued', chapter: 2, allowedAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued'], serverOnly: true, evidence: { kind: 'none' } }),
  // 안전 물길 개방: 세 구조 뒤 안전 물길 지점(lake_safe_route)에서 '물풀 미로' 정본 장면을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith).
  // 서버는 집계 사건과 지점 반경 증거를 요구하고, 이 사건과 CH02_MAZE_CLEARED 이동을 한 트랜잭션으로 기록한다. 내부 안전 물길 문(gate_lake_safe_route)의 openEvent
  ev({ id: 'lake_safe_route_opened', chapter: 2, allowedAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_trapped_turbies_rescued'], evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_safe_route' }, to: 'CH02_MAZE_CLEARED' }),
  // 10-13 C2-4: 안전 물길 너머 위기 지점에서 '잊어버린 이름' 장면을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 사건과 CH02_NUBI_CRISIS_SEEN을 한 트랜잭션으로 기록.
  //   서버는 CH02_MAZE_CLEARED·lake_safe_route_opened와 지점 반경 증거를 요구한다. 위기는 실패가 아니다 — 아이템·통화·성장·능력치 변화 없음
  ev({ id: 'lake_nubi_crisis_seen', chapter: 2, allowedAt: ['CH02_MAZE_CLEARED'], requires: ['lake_safe_route_opened'], evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_nubi_crisis' }, to: 'CH02_NUBI_CRISIS_SEEN' }),
];

// 부분 사건이 모두 기록되면 같은 트랜잭션에서 함께 기록하는 집계 사건(C2-3). 이미 기록돼 있으면 다시 만들지 않는다
export const EVENT_AGGREGATES: { id: string; parts: string[] }[] = [
  { id: 'lake_trapped_turbies_rescued', parts: ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued'] },
];

export const STORY_OBJECTIVES: StoryObjectiveDef[] = [
  {
    key: 'forest_glowing_dust',
    chapter: 1,
    activeAt: ['CH01_BOPUL_RESCUED'],
    requires: ['forest_dansuring_clue_learned'],
    stageCode: 'forest',
    // 10-02 v3 §3.1: 좌표와 분리된 고정 ID(forest_dust_01~10). 좌표·에셋 키는 story-data/stages/forest.json
    objectIds: Array.from({ length: 10 }, (_, i) => `forest_dust_${String(i + 1).padStart(2, '0')}`),
    grantPerObject: { itemCode: 'glowing_yarn_dust', quantity: 1 },
  },
];

export const EVENT_BY_ID = new Map(STORY_EVENTS.map((e) => [e.id, e]));
export const OBJECTIVE_BY_KEY = new Map(STORY_OBJECTIVES.map((o) => [o.key, o]));

// 인벤토리의 "누비에게 장착"이 서버에서 실행할 이벤트(유물 코드 → 이벤트). 대상은 언제나 이야기 누비
export const RELIC_EQUIP_EVENT = new Map(STORY_EVENTS.filter((e) => e.equipRelic).map((e) => [e.equipRelic!.itemCode, e.id]));

// 이야기 탭(가방 40칸에 포함하지 않음)
export const STORY_CATEGORIES = new Set(['mission', 'relic', 'memento']);
export const STORY_SLOT_PREFIX = 'story_';

// ---- 스토리 트리거(M4-C) = 숲 안의 이야기 지점(10-02 v3 §4) ----
// 트리거 판정(어디서·언제)과 대화 실행을 분리한다: 서버가 지점을 판정해 이벤트를 기록하고 재생할 범위를 알려 준다.
// 클라이언트는 서버가 알려 준 범위만 재생한다(임의 구간 ID로 진행을 건너뛸 수 없음 — 진행은 이벤트 규칙으로만 바뀐다).
// 좌표는 여기 두지 않는다: 지점 ID로 story-data/stages/<stage>.json의 points를 찾는다(회색상자 좌표는 그 파일만 바꾸면 된다).
// 한 숲 안의 논리 지점이지 별도 맵이 아니다.

// 재생 범위: segmentId의 fromEntry(없으면 처음)부터, endAfter 구간의 untilEntry(없으면 끝)까지
export interface StoryPlayRange {
  segmentId: string;
  endAfter?: string;
  fromEntry?: string;
  untilEntry?: string;
}

export interface StoryTriggerDef {
  id: string; // 고정 지점 ID
  stageCode: string;
  evidence: Evidence; // 발동에 필요한 위치(좌표는 지역 데이터)
  auto?: boolean; // 지역 진입 때 서버가 실행(지도에 지점으로 표시하지 않음)
  event?: string; // 발동 때 서버 경로로 기록하는 완료 이벤트(일회성)
  optionalEvent?: boolean; // 이벤트를 기록할 수 없는 시점이어도 거부하지 않고 재생 범위만 판단(지역 진입)
  need?: ItemGrant; // 이벤트 전에 확인할 보유 수량(부족하면 기록하지 않고 부족 수량을 돌려줌)
  activeAt?: Checkpoint[]; // 이벤트 없는 지점의 활성화 체크포인트
  requires?: string[]; // 이벤트 없는 지점의 선행 이벤트
  unless?: string[]; // 이 이벤트가 모두 끝났으면 지점이 닫힌다(완료 — 다시 발동하지 않음)
  encounterKey?: string; // 이 지점이 여는 스토리 전투(대화 범위 안의 storyBattle 항목과 같은 키)
  repeatable: boolean; // 완료 전까지 다시 발동할 수 있는가(전투 재도전·끊긴 대화 이어 보기)
  // resume = 현재 진행의 복귀 범위(이 지역 장의 구간만). 그 밖에는 발동했을 때 재생할 범위
  play: 'resume' | StoryPlayRange | ((events: ReadonlySet<string>) => StoryPlayRange);
}

const FIRST_PATH = 'ch01.first_path';
const HIDDEN_PATH = 'ch01.hidden_path';

export const STORY_TRIGGERS: StoryTriggerDef[] = [
  // 1) 숲 입구와 첫 길 — 숲에 들어서면 서버가 실행
  { id: 'forest_entry', stageCode: 'forest', evidence: { kind: 'stage', stageCode: 'forest' }, auto: true, event: 'forest_first_path_started', optionalEvent: true, repeatable: true, play: 'resume' },
  // 2) 잘린 실오라기 조사
  {
    id: 'forest_cut_thread',
    stageCode: 'forest',
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_cut_thread' },
    event: 'forest_cut_thread_inspected',
    repeatable: false,
    play: { segmentId: FIRST_PATH, fromEntry: `${FIRST_PATH}.005`, endAfter: FIRST_PATH, untilEntry: `${FIRST_PATH}.009` },
  },
  // 3)~4) 실밥이 매복·보풀이 구조·단서 확인 — 전투에서 지거나 대화가 끊기면 같은 지점에서 다시 이어 간다
  {
    id: 'forest_bopuli_ambush',
    stageCode: 'forest',
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_bopuli_ambush' },
    activeAt: ['CH01_STARTED'],
    requires: ['forest_cut_thread_inspected'],
    unless: ['forest_dansuring_clue_learned'],
    encounterKey: 'forest_stitchling_ambush',
    repeatable: true,
    play: (events) => (events.has('forest_bopul_rescued') ? { segmentId: 'ch01.bopul_clue' } : { segmentId: FIRST_PATH, fromEntry: `${FIRST_PATH}.010`, endAfter: 'ch01.bopul_clue' }),
  },
  // 5)~6) 실가루 10개를 보풀이에게 전달 → 나침판 제작
  { id: 'forest_bopuli_return', stageCode: 'forest', evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_bopuli_return' }, event: 'forest_compass_granted', need: { itemCode: 'glowing_yarn_dust', quantity: 10 }, repeatable: false, play: { segmentId: 'ch01.compass_craft' } },
  // 7) 나침판이 가리키는 숨은 길 — 길이 열린다(전투는 다음 지점)
  {
    id: 'forest_hidden_path',
    stageCode: 'forest',
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_hidden_path' },
    event: 'forest_hidden_path_opened',
    repeatable: false,
    play: { segmentId: HIDDEN_PATH, endAfter: HIDDEN_PATH, untilEntry: `${HIDDEN_PATH}.002` },
  },
  // 8) 거대 매듭 전투
  {
    id: 'forest_giant_knot',
    stageCode: 'forest',
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_giant_knot' },
    activeAt: ['CH01_COMPASS_ACQUIRED'],
    requires: ['forest_hidden_path_opened'],
    unless: ['forest_giant_knot_defeated'],
    encounterKey: 'forest_giant_knot',
    repeatable: true,
    play: { segmentId: HIDDEN_PATH, fromEntry: `${HIDDEN_PATH}.003`, endAfter: 'ch01.first_knot_awaken' },
  },
  // 9) 첫 매듭 각성 — 전투는 이겼지만 각성 장면을 끝내지 못했을 때 이어 보는 지점
  {
    id: 'forest_first_knot_awaken',
    stageCode: 'forest',
    evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_first_knot_awaken' },
    activeAt: ['CH01_COMPASS_ACQUIRED'],
    requires: ['forest_giant_knot_defeated'],
    unless: ['forest_first_knot_awakened'],
    repeatable: true,
    play: { segmentId: 'ch01.first_knot_awaken' },
  },
  // 10) 단수링 지점과 1장 마무리 — 발견 기록은 한 번, 장면이 끊겼으면 장 완료 전까지 같은 지점에서 이어 볼 수 있다
  { id: 'forest_dansuring', stageCode: 'forest', evidence: { kind: 'point', stageCode: 'forest', pointId: 'forest_dansuring' }, event: 'forest_dansuring_found', unless: ['forest_primordial_knot_seen'], repeatable: true, play: { segmentId: 'ch01.primordial_knot' } },
  // ---- 2장 호수(C2-1) ----
  // 1) 호수 입구 — 지역에 들어서면 서버가 실행. 이벤트(lake_entry_seen)는 도입 대화를 끝까지 본 뒤 클라이언트가 완료 요청하므로 여기서는 기록하지 않는다.
  //    1장을 마친 계정이 도입을 보기 전이면 resume = 물빛 입구 구간, 그 밖(이미 봄·1장 미완료 백필 계정)은 재생 없음
  { id: 'lake_entry', stageCode: 'lake', evidence: { kind: 'stage', stageCode: 'lake' }, auto: true, repeatable: true, play: 'resume' },
  // 2) 정착지의 물들이 — 닿으면 만남을 기록하고 정착지 대화(물결북 앞까지)를 재생. 물결북 반응 전까지는 끊긴 대화를 이어 볼 수 있다
  {
    id: 'lake_mulduri',
    stageCode: 'lake',
    evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_mulduri' },
    event: 'lake_mulduri_met',
    unless: ['lake_wave_drum_awakened'],
    repeatable: true,
    play: { segmentId: 'ch02.settlement', endAfter: 'ch02.settlement', untilEntry: 'ch02.settlement.008' },
  },
  // 3) 물결북 — 누비가 다가가면 반응한다. 반응을 확인하면 CH02_SETTLEMENT_MET
  { id: 'lake_wave_drum', stageCode: 'lake', evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_wave_drum' }, event: 'lake_wave_drum_awakened', repeatable: false, play: { segmentId: 'ch02.settlement', fromEntry: 'ch02.settlement.009', endAfter: 'ch02.settlement' } },
  // 4) 물풀 미로의 붙잡힌 물들이(C2-3) — 지점에 닿아 누르면 수호 젖은 실밥이 전투가 열린다(대화 구간 안의 storyBattle). 이기면 구조 사건 기록·덫 제거.
  //    지고 나가면 같은 지점에서 다시 도전한다. 구조한 지점은 닫힌다(재생성 없음)
  ...(['a', 'b', 'c'] as const).map((k): StoryTriggerDef => ({
    id: `lake_rescue_${k}`,
    stageCode: 'lake',
    evidence: { kind: 'point', stageCode: 'lake', pointId: `lake_rescue_${k}` },
    activeAt: ['CH02_SETTLEMENT_MET'],
    requires: ['lake_wave_drum_awakened'],
    unless: [`lake_trapped_mulduri_${k}_rescued`],
    encounterKey: `lake_guard_${k}`,
    repeatable: true,
    play: { segmentId: `ch02.rescue_${k}`, endAfter: `ch02.rescue_${k}` },
  })),
  // 5) 안전 물길 지점 — 세 구조가 끝나야 열린다. 정본 '물풀 미로' 장면을 끝까지 보면 lake_safe_route_opened + CH02_MAZE_CLEARED(대화 구간 completesWith)
  { id: 'lake_safe_route', stageCode: 'lake', evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_safe_route' }, activeAt: ['CH02_SETTLEMENT_MET'], requires: ['lake_trapped_turbies_rescued'], unless: ['lake_safe_route_opened'], repeatable: true, play: { segmentId: 'ch02.maze', endAfter: 'ch02.maze' } },
  // 6) 누비 이름 망각 위기(C2-4) — 안전 물길 너머. 장면을 끝까지 보면 lake_nubi_crisis_seen + CH02_NUBI_CRISIS_SEEN(대화 구간 completesWith). 중간에 끊기면 같은 지점에서 처음부터
  { id: 'lake_nubi_crisis', stageCode: 'lake', evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_nubi_crisis' }, activeAt: ['CH02_MAZE_CLEARED'], requires: ['lake_safe_route_opened'], unless: ['lake_nubi_crisis_seen'], repeatable: true, play: { segmentId: 'ch02.nubi_crisis', endAfter: 'ch02.nubi_crisis' } },
  // 7) 염색 샘 보스 입장(C2-5A) — 위기 장면 뒤에만 보인다. 대화 구간의 storyBattle이 서버 스토리 전투를 연다(지점 반경 증거). 완료 사건 없음(개발 격리)
  { id: 'lake_boss_entrance', stageCode: 'lake', evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_boss_entrance' }, activeAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], encounterKey: 'lake_boss_sewn_doll', repeatable: true, play: { segmentId: 'ch02.boss_intro', endAfter: 'ch02.boss_intro' } },
];
export const TRIGGER_BY_ID = new Map(STORY_TRIGGERS.map((t) => [t.id, t]));

// 한 번에 이어서 재생하는 구간의 끝. 그다음 구간은 별도 지점(보풀이 전달·지도 지점·유물 장착)이 있어야 열린다
export const SEGMENT_CHAIN_END: Record<string, string> = {
  'ch01.first_path': 'ch01.bopul_clue',
  'ch01.bopul_clue': 'ch01.bopul_clue',
  'ch01.compass_craft': 'ch01.compass_craft',
  'ch01.hidden_path': 'ch01.first_knot_awaken',
  'ch01.first_knot_awaken': 'ch01.first_knot_awaken',
  'ch01.first_knot_equipped': 'ch01.first_knot_equipped',
  'ch01.primordial_knot': 'ch01.primordial_knot',
};

// 숲 입구 복귀 범위: 잘린 실을 살펴보기 전까지는 첫 길의 걷는 장면(001~004)만 다시 보여 준다. 그 뒤는 지점이 이어 간다
export const FIRST_PATH_INTRO: StoryPlayRange = { segmentId: FIRST_PATH, endAfter: FIRST_PATH, untilEntry: `${FIRST_PATH}.004` };

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
  { key: 'forest_stitchling_ambush', chapter: 1, stageCode: 'forest', allowedAt: ['CH01_STARTED'], requires: ['forest_first_path_started', 'forest_cut_thread_inspected'], onWinEvents: ['forest_stitchling_battle_won'] },
  // 2장 물풀 미로(C2-3): 구조 지점마다 젖은 실밥이 수호 전투. 승리하면 그 지점의 구조 사건만 기록한다(다른 지점의 승리는 증거가 아니다)
  ...(['a', 'b', 'c'] as const).map((k) => ({ key: `lake_guard_${k}`, chapter: 2, stageCode: 'lake', allowedAt: ['CH02_SETTLEMENT_MET'] as Checkpoint[], requires: ['lake_wave_drum_awakened'], onWinEvents: [`lake_trapped_mulduri_${k}_rescued`] })),
  // 10-14 C2-5A: 물먹은 박음이 보스 전투 본체. 영구 사건·체크포인트를 바꾸지 않는다(onWinEvents 없음 — C2-5B에서 승리 정산을 연결). 이겨도 다시 입장해 싸울 수 있다
  { key: 'lake_boss_sewn_doll', chapter: 2, stageCode: 'lake', allowedAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], onWinEvents: [] },
  { key: 'forest_giant_knot', chapter: 1, stageCode: 'forest', allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted', 'forest_hidden_path_opened'], onWinEvents: ['forest_giant_knot_defeated'] },
];

export const ENCOUNTER_BY_KEY = new Map(STORY_ENCOUNTERS.map((e) => [e.key, e]));
