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
  // 종장(집의 중심, 장 코드 final, 10-26 F-1). 정본 저장점 이름 그대로(docs/scene/종장.md)
  'CHFINAL_STARTED',
  'CHFINAL_IDENTITY_REVEALED',
  'CHFINAL_SCISSORS_DEFEATED',
  'CHFINAL_COST_ACCEPTED',
  'ENDING_COMPLETE',
] as const;

export type Checkpoint = (typeof CHECKPOINTS)[number];

export const DEFAULT_NICKNAME = '터비 탐험가';
export const STORY_NUBI_CHARACTER = 'nubi';

// 장 번호(0 = 오프닝)별 코드. 대화 파일 이름과 GET /player/me/story의 chapterCode에 쓴다.
export const CHAPTER_CODES = ['opening', 'ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'final'] as const; // 6 = 종장
export const FINAL_CHAPTER = 6;
export type ChapterCode = (typeof CHAPTER_CODES)[number];

// 정본 이벤트 ID ↔ DB stage_code(C4: 내부 코드는 underground/ice 유지)
export const STAGE_UNLOCK_EVENTS: Record<string, string> = {
  lake: 'lake_unlocked',
  underground: 'underfloor_unlocked',
  ice: 'fridge_unlocked',
  desert: 'desert_unlocked',
  home_core: 'final_unlocked', // 10-26 F-1: 종장 집의 중심(5장 금빛 마감실 장착 때 기록)
};
export const STAGE_CHAPTER: Record<string, number> = { forest: 1, lake: 2, underground: 3, ice: 4, desert: 5, home_core: 6 };
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
  requireGrowthEq?: number; // 성장 단계가 정확히 이 값이어야 한다(C2-6 장착 — 2 초과·재증가 방지)
  requireEquipped?: string[]; // 이야기 누비에 이미 장착돼 있어야 하는 슬롯(예: story_1)
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
  // 10-14 C2-5B: 물먹은 박음이 승리 정산(서버 전용 — 전투 확정만 기록). 한 트랜잭션: 보스 격퇴 + 염색실 지급 사건 + 물빛 염색실 1개(확률 아님) + CH02_BOSS_DEFEATED.
  //   장착·성장 단계·색 회복·CH02_COMPLETE·3장 개방은 C2-6. 유물은 한 번만 지급된다(grantItem의 relic 1회 규칙)
  ev({ id: 'lake_boss_defeated', chapter: 2, allowedAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['lake_dye_thread_granted'], grant: [{ itemCode: 'water_dye_yarn', quantity: 1 }], to: 'CH02_BOSS_DEFEATED' }),
  ev({ id: 'lake_dye_thread_granted', chapter: 2, allowedAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // 승리 장면(ch02.boss_victory)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 체크포인트·아이템·성장은 바꾸지 않는다. C2-6 장착 지점의 선행 조건
  // 10-14 C2-6: 인벤토리 "누비에게 장착"(POST /player/me/story/relics/water_dye_yarn/equip)만 기록. 한 트랜잭션: story_2 장착 + 성장 1→2 + 이 사건 + underfloor_unlocked + CH02_COMPLETE.
  //   water_dye_yarn 보유 레코드는 삭제하지 않는다. 선행: 승리 장면 완료·첫 매듭(story_1) 장착·성장 정확히 1
  ev({
    id: 'lake_dye_thread_equipped',
    chapter: 2,
    allowedAt: ['CH02_BOSS_DEFEATED'],
    requires: ['lake_boss_defeated', 'lake_dye_thread_granted', 'lake_boss_aftermath_seen'],
    serverOnly: true,
    evidence: { kind: 'none' },
    requireGrowthEq: 1,
    requireEquipped: ['story_1'],
    equipRelic: { itemCode: 'water_dye_yarn', slotKey: 'story_2', growthStage: 2 },
    alsoComplete: ['underfloor_unlocked'],
    to: 'CH02_COMPLETE',
  }),
  ev({ id: 'underfloor_unlocked', chapter: 2, allowedAt: ['CH02_BOSS_DEFEATED'], requires: ['lake_boss_aftermath_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // '돌아온 색' 장면(ch02.chapter_complete)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 체크포인트·보상·성장은 다시 바꾸지 않는다
  ev({ id: 'lake_chapter_complete_seen', chapter: 2, allowedAt: ['CH02_COMPLETE'], requires: ['lake_dye_thread_equipped', 'underfloor_unlocked'], evidence: { kind: 'none' } }),
  ev({ id: 'lake_boss_aftermath_seen', chapter: 2, allowedAt: ['CH02_BOSS_DEFEATED'], requires: ['lake_boss_defeated', 'lake_dye_thread_granted'], evidence: { kind: 'none' } }),
  // ---- 3장 마루바닥 밑(C3-1) ----
  // 낯익은 어둠: 지역에 들어서면 도입 대화를 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 3장 개방(underfloor_unlocked)은 2장 장착 때 이미 기록됐다
  ev({ id: 'underfloor_entry_seen', chapter: 3, allowedAt: ['CH02_COMPLETE'], requires: ['underfloor_unlocked'], evidence: { kind: 'stage', stageCode: 'underground' }, to: 'CH03_STARTED' }),
  // 오래된 폭신이: 지점에서 정본 장면을 끝까지 본 뒤 클라이언트가 완료를 요청한다(completesWith)
  ev({ id: 'underfloor_elder_met', chapter: 3, allowedAt: ['CH03_STARTED'], requires: ['underfloor_entry_seen'], evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_elder' }, to: 'CH03_ELDER_MET' }),
  // 사라진 기억실: 물건 더미 3곳(순서 없음). 지점에 닿으면 서버가 한 번 기록한다(서버 전용, 좌표 증거). 체크포인트는 바꾸지 않는다
  ev({ id: 'underfloor_glove_inspected', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_elder_met'], serverOnly: true, evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_glove' } }),
  ev({ id: 'underfloor_blanket_inspected', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_elder_met'], serverOnly: true, evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_blanket' } }),
  ev({ id: 'underfloor_doll_inspected', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_elder_met'], serverOnly: true, evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_doll' } }),
  // 3곳을 모두 살펴보면 집계 사건이 함께 기록된다(EVENT_AGGREGATES). 매복 지점(기계음 장면)의 선행 조건
  ev({ id: 'underfloor_items_inspected', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected'], serverOnly: true, evidence: { kind: 'none' } }),
  // 매복 전투(C3-3) 승리 정산: 박음이 처치 + 기억실 방향 복구(실패 자국 길 개방 = 먼지 실타래 문 열림) + CH03_MEMORY_TRAIL_FOUND를 한 트랜잭션으로 기록한다.
  //   C3-1에서는 사건 자리만 둔다(전투 정의는 C3-3). 서버 전용 — 클라이언트가 직접 요청할 수 없다
  ev({ id: 'underfloor_ambush_won', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_items_inspected'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['underfloor_memory_trail_found'], to: 'CH03_MEMORY_TRAIL_FOUND' }),
  ev({ id: 'underfloor_memory_trail_found', chapter: 3, allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_items_inspected'], serverOnly: true, evidence: { kind: 'none' } }),
  // 내 것이 아닌 기억: 실패 자국 끝 지점에서 정본 장면을 끝까지 본 뒤 클라이언트가 완료를 요청한다(completesWith)
  ev({ id: 'underfloor_memory_fragment_seen', chapter: 3, allowedAt: ['CH03_MEMORY_TRAIL_FOUND'], requires: ['underfloor_memory_trail_found'], evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_fragment' }, to: 'CH03_MEMORY_FRAGMENT_SEEN' }),
  // 10-16 C3-3: 기억 실패굴이 승리 정산(서버 전용 — 전투 확정만 기록). 한 트랜잭션: 보스 격퇴 + 솜심 지급 사건 + 오래된 솜심 1개(확률 아님) + CH03_BOSS_DEFEATED.
  //   장착·성장·장 완료·4장 개방은 아래 장착 사건. 유물은 한 번만 지급된다(grantItem의 relic 1회 규칙)
  ev({ id: 'underfloor_boss_defeated', chapter: 3, allowedAt: ['CH03_MEMORY_FRAGMENT_SEEN'], requires: ['underfloor_memory_fragment_seen'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['underfloor_cotton_core_granted'], grant: [{ itemCode: 'old_cotton_core', quantity: 1 }], to: 'CH03_BOSS_DEFEATED' }),
  ev({ id: 'underfloor_cotton_core_granted', chapter: 3, allowedAt: ['CH03_MEMORY_FRAGMENT_SEEN'], requires: ['underfloor_memory_fragment_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // 승리 장면(ch03.boss_victory)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 체크포인트·아이템·성장은 바꾸지 않는다. 장착의 선행 조건
  ev({ id: 'underfloor_boss_aftermath_seen', chapter: 3, allowedAt: ['CH03_BOSS_DEFEATED'], requires: ['underfloor_boss_defeated', 'underfloor_cotton_core_granted'], evidence: { kind: 'none' } }),
  // 인벤토리 "누비에게 장착"(POST /player/me/story/relics/old_cotton_core/equip)만 기록. 한 트랜잭션: story_3 장착 + 성장 2→3 + 이 사건 + fridge_unlocked + CH03_COMPLETE.
  //   old_cotton_core 보유 레코드는 삭제하지 않는다. 선행: 승리 장면 완료·story_1·story_2 장착·성장 정확히 2
  ev({
    id: 'underfloor_cotton_core_equipped',
    chapter: 3,
    allowedAt: ['CH03_BOSS_DEFEATED'],
    requires: ['underfloor_boss_defeated', 'underfloor_cotton_core_granted', 'underfloor_boss_aftermath_seen'],
    serverOnly: true,
    evidence: { kind: 'none' },
    requireGrowthEq: 2,
    requireEquipped: ['story_1', 'story_2'],
    equipRelic: { itemCode: 'old_cotton_core', slotKey: 'story_3', growthStage: 3 },
    alsoComplete: ['fridge_unlocked'],
    to: 'CH03_COMPLETE',
  }),
  ev({ id: 'fridge_unlocked', chapter: 3, allowedAt: ['CH03_BOSS_DEFEATED'], requires: ['underfloor_boss_aftermath_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // '돌아온 중심' 장면(ch03.chapter_complete)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(대화 구간 completesWith). 체크포인트·보상·성장은 다시 바꾸지 않는다
  ev({ id: 'underfloor_chapter_complete_seen', chapter: 3, allowedAt: ['CH03_COMPLETE'], requires: ['underfloor_cotton_core_equipped', 'fridge_unlocked'], evidence: { kind: 'none' } }),
  // ---- 4장 냉장고 속(C4-1) ----
  // 소리 없는 냉기: 지역에 들어서면 도입(누비만 듣는 첫 목소리)을 끝까지 본 뒤 클라이언트가 완료를 요청한다. 4장 개방(fridge_unlocked)은 3장 장착 때 이미 기록됐다
  ev({ id: 'fridge_entry_seen', chapter: 4, allowedAt: ['CH03_COMPLETE'], requires: ['fridge_unlocked'], evidence: { kind: 'stage', stageCode: 'ice' }, to: 'CH04_STARTED' }),
  // 얼음에 박힌 가느리: 통로 끝 지점에서 장면을 끝까지 보면(연결 실을 끊음) 기록
  ev({ id: 'fridge_ganeuri_freed', chapter: 4, allowedAt: ['CH04_STARTED'], requires: ['fridge_entry_seen'], evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_ganeuri' }, to: 'CH04_GANEURI_RESCUED' }),
  // 저장고 앞 전투(C4-3에서 전투 연결) 승리 정산: 저장고 문만 연다. 체크포인트는 바꾸지 않는다(10-23 Codex 의견 P-01 — 도안 벽을 본 시점이 저장고 완료). 서버 전용
  ev({ id: 'fridge_frozen_guard_won', chapter: 4, allowedAt: ['CH04_GANEURI_RESCUED'], requires: ['fridge_ganeuri_freed'], serverOnly: true, evidence: { kind: 'none' } }),
  // 완성된 도안 벽과 두 번째 목소리를 끝까지 보면 저장고 완료
  ev({ id: 'fridge_storage_seen', chapter: 4, allowedAt: ['CH04_GANEURI_RESCUED'], requires: ['fridge_frozen_guard_won'], evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_storage_wall' }, to: 'CH04_STORAGE_CLEARED' }),
  // 누비의 고백(저장고 중심 앞)
  ev({ id: 'fridge_confession_seen', chapter: 4, allowedAt: ['CH04_STORAGE_CLEARED'], requires: ['fridge_storage_seen'], evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_confession' }, to: 'CH04_CONFESSION_SEEN' }),
  // 10-23 C4-3: 서리 미싱 승리 정산(서버 전용 — 전투 확정만 기록). 한 트랜잭션: 보스 정지 + 극세사 지급 사건 + 얼음 극세사 1개(확률 아님) + CH04_BOSS_DEFEATED.
  //   보스는 파괴하지 않는다(정지). 장착·성장·장 완료·5장 개방은 아래 장착 사건. 유물은 한 번만 지급된다(grantItem의 relic 1회 규칙)
  ev({ id: 'fridge_boss_defeated', chapter: 4, allowedAt: ['CH04_CONFESSION_SEEN'], requires: ['fridge_confession_seen'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['fridge_microfiber_granted'], grant: [{ itemCode: 'ice_microfiber', quantity: 1 }], to: 'CH04_BOSS_DEFEATED' }),
  ev({ id: 'fridge_microfiber_granted', chapter: 4, allowedAt: ['CH04_CONFESSION_SEEN'], requires: ['fridge_confession_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // 승리 장면(ch04.boss_victory)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(completesWith). 체크포인트·아이템·성장은 바꾸지 않는다. 장착의 선행 조건
  ev({ id: 'fridge_boss_aftermath_seen', chapter: 4, allowedAt: ['CH04_BOSS_DEFEATED'], requires: ['fridge_boss_defeated', 'fridge_microfiber_granted'], evidence: { kind: 'none' } }),
  // 인벤토리 "누비에게 장착"(POST /player/me/story/relics/ice_microfiber/equip)만 기록. 한 트랜잭션: story_4 장착 + 성장 3→4 + 이 사건 + desert_unlocked + CH04_COMPLETE.
  //   ice_microfiber 보유 레코드는 삭제하지 않는다. 선행: 승리 장면 완료·story_1~3 장착·성장 정확히 3
  ev({
    id: 'fridge_microfiber_equipped',
    chapter: 4,
    allowedAt: ['CH04_BOSS_DEFEATED'],
    requires: ['fridge_boss_defeated', 'fridge_microfiber_granted', 'fridge_boss_aftermath_seen'],
    serverOnly: true,
    evidence: { kind: 'none' },
    requireGrowthEq: 3,
    requireEquipped: ['story_1', 'story_2', 'story_3'],
    equipRelic: { itemCode: 'ice_microfiber', slotKey: 'story_4', growthStage: 4 },
    alsoComplete: ['desert_unlocked'],
    to: 'CH04_COMPLETE',
  }),
  ev({ id: 'desert_unlocked', chapter: 4, allowedAt: ['CH04_BOSS_DEFEATED'], requires: ['fridge_boss_aftermath_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // '이어진 감각' 장면(ch04.chapter_complete)을 끝까지 본 뒤 클라이언트가 완료를 요청한다. 체크포인트·보상·성장은 다시 바꾸지 않는다
  ev({ id: 'fridge_chapter_complete_seen', chapter: 4, allowedAt: ['CH04_COMPLETE'], requires: ['fridge_microfiber_equipped', 'desert_unlocked'], evidence: { kind: 'none' } }),

  // ---- 5장 보일러 옆 사막(C5-1) ----
  // 뜨거운 침묵: 사막에 들어서면 도입(동료 셋 합류)을 끝까지 본 뒤 클라이언트가 완료를 요청한다. 5장 개방(desert_unlocked)은 4장 장착 때 이미 기록됐다
  ev({ id: 'desert_entry_seen', chapter: 5, allowedAt: ['CH04_COMPLETE'], requires: ['desert_unlocked'], evidence: { kind: 'stage', stageCode: 'desert' }, to: 'CH05_STARTED' }),
  // 말하지 못한 결론: 단서 길 지점에서 장면을 끝까지 보면 기록(정본 CH05_CLUES_JOINED — 단서를 거의 완성했지만 정체를 말하지 않은 장면)
  ev({ id: 'desert_clues_seen', chapter: 5, allowedAt: ['CH05_STARTED'], requires: ['desert_entry_seen'], evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_clues' }, to: 'CH05_CLUES_JOINED' }),
  // 능선 앞 전투(C5-3에서 전투 연결) 승리 정산: 능선 첫 틈 앞 물들이 지점만 연다. 체크포인트는 바꾸지 않는다(4장 P-01 방식). 서버 전용
  ev({ id: 'desert_scorched_won', chapter: 5, allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_clues_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // 뜨거운 모래 능선: 동료 셋이 차례로 틈을 잇는다(각 틈 앞 지점에서 장면을 끝까지 보면 그 틈이 열린다). 체크포인트 유지
  ev({ id: 'desert_ridge_pad', chapter: 5, allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_scorched_won'], evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_pad' } }),
  ev({ id: 'desert_ridge_scent', chapter: 5, allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_pad'], evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_scent' } }),
  ev({ id: 'desert_ridge_thread', chapter: 5, allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_scent'], evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_thread' } }),
  // 능선 끝 절단면: 장면(두 긴 날은 플레이어에게만)을 끝까지 보면 능선 통과
  ev({ id: 'desert_ridge_crossed', chapter: 5, allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_thread'], evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_cut_face' }, to: 'CH05_RIDGE_CROSSED' }),
  // 10-26 C5-3: 황금 재단인형 승리 정산(서버 전용 — 전투 확정만 기록). 한 트랜잭션: 마감실 지급 사건 + 금빛 마감실 1개(확률 아님) + CH05_BOSS_DEFEATED.
  //   재단인형은 파괴하지 않는다(천 조각으로 풀림). 장착·성장·장 완료·종장 개방은 아래 장착 사건. 유물은 한 번만 지급된다(grantItem의 relic 1회 규칙)
  ev({ id: 'desert_boss_defeated', chapter: 5, allowedAt: ['CH05_RIDGE_CROSSED'], requires: ['desert_ridge_crossed'], serverOnly: true, evidence: { kind: 'none' }, alsoComplete: ['desert_finish_thread_granted'], grant: [{ itemCode: 'golden_finish_thread', quantity: 1 }], to: 'CH05_BOSS_DEFEATED' }),
  ev({ id: 'desert_finish_thread_granted', chapter: 5, allowedAt: ['CH05_RIDGE_CROSSED'], requires: ['desert_ridge_crossed'], serverOnly: true, evidence: { kind: 'none' } }),
  // 승리 장면(ch05.boss_victory)을 끝까지 본 뒤 클라이언트가 완료를 요청한다(completesWith). 체크포인트·아이템·성장은 바꾸지 않는다
  ev({ id: 'desert_boss_aftermath_seen', chapter: 5, allowedAt: ['CH05_BOSS_DEFEATED'], requires: ['desert_boss_defeated', 'desert_finish_thread_granted'], evidence: { kind: 'none' } }),
  // 가위(정본: 금빛 마감실을 장착하려는 순간) — 승리 장면에 이어지는 장면을 끝까지 보면 CH05_SCISSORS_REVEALED. 장착의 선행 조건
  ev({ id: 'desert_scissors_seen', chapter: 5, allowedAt: ['CH05_BOSS_DEFEATED'], requires: ['desert_boss_aftermath_seen'], evidence: { kind: 'none' }, to: 'CH05_SCISSORS_REVEALED' }),
  // 인벤토리 "누비에게 장착"(POST /player/me/story/relics/golden_finish_thread/equip)만 기록. 한 트랜잭션: story_5 장착 + 성장 4→5 + 이 사건 + final_unlocked + CH05_COMPLETE.
  //   golden_finish_thread 보유 레코드는 삭제하지 않는다. 선행: 가위 장면 완료·story_1~4 장착·성장 정확히 4
  ev({
    id: 'desert_finish_thread_equipped',
    chapter: 5,
    allowedAt: ['CH05_SCISSORS_REVEALED'],
    requires: ['desert_boss_defeated', 'desert_finish_thread_granted', 'desert_boss_aftermath_seen', 'desert_scissors_seen'],
    serverOnly: true,
    evidence: { kind: 'none' },
    requireGrowthEq: 4,
    requireEquipped: ['story_1', 'story_2', 'story_3', 'story_4'],
    equipRelic: { itemCode: 'golden_finish_thread', slotKey: 'story_5', growthStage: 5 },
    alsoComplete: ['final_unlocked'],
    to: 'CH05_COMPLETE',
  }),
  // 종장(집의 중심, home_core) 개방 기록
  ev({ id: 'final_unlocked', chapter: 5, allowedAt: ['CH05_SCISSORS_REVEALED'], requires: ['desert_scissors_seen'], serverOnly: true, evidence: { kind: 'none' } }),
  // '마지막 마감' 장면(ch05.chapter_complete)을 끝까지 본 뒤 클라이언트가 완료를 요청한다. 체크포인트·보상·성장은 다시 바꾸지 않는다
  ev({ id: 'desert_chapter_complete_seen', chapter: 5, allowedAt: ['CH05_COMPLETE'], requires: ['desert_finish_thread_equipped', 'final_unlocked'], evidence: { kind: 'none' } }),

  // ---- 종장 집의 중심(F-1) ----
  // 집의 중심: 금빛 길 끝의 입구 지점에서 도착 장면(동료 합류)을 끝까지 보면 CHFINAL_STARTED. 5장 '마지막 마감' 장면을 본 뒤에만
  ev({ id: 'final_entry_seen', chapter: 6, allowedAt: ['CH05_COMPLETE'], requires: ['final_unlocked', 'desert_chapter_complete_seen'], evidence: { kind: 'point', stageCode: 'home_core', pointId: 'final_arrival' }, to: 'CHFINAL_STARTED' }),
  // 다섯 기억의 결속: 중앙의 빈자리에서 정체 공개 장면을 끝까지 보면 CHFINAL_IDENTITY_REVEALED(정본 — 이후 재접속은 가위 등장 직전부터)
  ev({ id: 'final_identity_revealed', chapter: 6, allowedAt: ['CHFINAL_STARTED'], requires: ['final_entry_seen'], evidence: { kind: 'point', stageCode: 'home_core', pointId: 'final_core' }, to: 'CHFINAL_IDENTITY_REVEALED' }),
];

// 부분 사건이 모두 기록되면 같은 트랜잭션에서 함께 기록하는 집계 사건(C2-3). 이미 기록돼 있으면 다시 만들지 않는다
export const EVENT_AGGREGATES: { id: string; parts: string[] }[] = [
  { id: 'lake_trapped_turbies_rescued', parts: ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued'] },
  { id: 'underfloor_items_inspected', parts: ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected'] },
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
  // 7) 염색 샘 보스 입장(C2-5A) — 위기 장면 뒤에만 보인다. 대화 구간의 storyBattle이 서버 스토리 전투를 연다(지점 반경 증거).
  //    C2-5B: 승리하면 서버가 lake_boss_defeated를 정산하고, 같은 재생 범위가 정본 승리 장면(ch02.boss_victory)으로 이어진다. 정산 뒤에는 입장 지점이 닫힌다
  { id: 'lake_boss_entrance', stageCode: 'lake', evidence: { kind: 'point', stageCode: 'lake', pointId: 'lake_boss_entrance' }, activeAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], unless: ['lake_boss_defeated'], encounterKey: 'lake_boss_sewn_doll', repeatable: true, play: { segmentId: 'ch02.boss_intro', endAfter: 'ch02.boss_victory' } },
  // ---- 3장 마루바닥 밑(C3-1) ----
  // 1) 마루 틈새 입구 — 지역에 들어서면 서버가 실행. 도입(낯익은 어둠)을 끝까지 본 뒤 클라이언트가 underfloor_entry_seen을 요청한다(대화 구간 completesWith)
  { id: 'underfloor_entry', stageCode: 'underground', evidence: { kind: 'stage', stageCode: 'underground' }, auto: true, repeatable: true, play: 'resume' },
  // 2) 오래된 폭신이 — 장면을 끝까지 보면 underfloor_elder_met + CH03_ELDER_MET(대화 구간 completesWith). 중간에 끊기면 같은 지점에서 처음부터
  { id: 'underfloor_elder', stageCode: 'underground', evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_elder' }, activeAt: ['CH03_STARTED'], requires: ['underfloor_entry_seen'], unless: ['underfloor_elder_met'], repeatable: true, play: { segmentId: 'ch03.elder', endAfter: 'ch03.elder' } },
  // 3) 물건 더미 조사 3곳(순서 없음) — 닿으면 서버가 조사를 한 번 기록하고 짧은 기억 비침을 재생한다
  ...(['glove', 'blanket', 'doll'] as const).map((k): StoryTriggerDef => ({
    id: `underfloor_${k}`,
    stageCode: 'underground',
    evidence: { kind: 'point', stageCode: 'underground', pointId: `underfloor_${k}` },
    event: `underfloor_${k}_inspected`,
    repeatable: false,
    play: { segmentId: `ch03.memory_${k}`, endAfter: `ch03.memory_${k}` },
  })),
  // 4) 기계음과 눌린 박음이 매복 — 세 곳을 모두 살펴본 뒤 열린다. C3-1은 지점과 기계음 장면까지, 전투(storyBattle)와 승리 정산은 C3-3
  { id: 'underfloor_ambush', stageCode: 'underground', evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_ambush' }, activeAt: ['CH03_ELDER_MET'], requires: ['underfloor_items_inspected'], unless: ['underfloor_memory_trail_found'], repeatable: true, encounterKey: 'underfloor_ambush', play: { segmentId: 'ch03.machine_sound', endAfter: 'ch03.machine_sound' } },
  // 5) 실패 자국 끝의 기억 조각 — 먼지 실타래 문이 열린 뒤에만 닿는다. 장면을 끝까지 보면 underfloor_memory_fragment_seen + CH03_MEMORY_FRAGMENT_SEEN(completesWith)
  { id: 'underfloor_fragment', stageCode: 'underground', evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_fragment' }, activeAt: ['CH03_MEMORY_TRAIL_FOUND'], requires: ['underfloor_memory_trail_found'], unless: ['underfloor_memory_fragment_seen'], repeatable: true, play: { segmentId: 'ch03.fragment', endAfter: 'ch03.fragment' } },
  // 6) 기억 실패굴이(C3-3) — 기억 조각 장면을 본 뒤에만 보인다. 대화 구간의 storyBattle이 서버 스토리 전투를 연다(지점 반경 증거).
  //    승리하면 서버가 underfloor_boss_defeated를 정산하고, 같은 재생 범위가 정본 승리 장면(ch03.boss_victory)으로 이어진다. 정산 뒤에는 입장 지점이 닫힌다
  { id: 'underfloor_boss_entrance', stageCode: 'underground', evidence: { kind: 'point', stageCode: 'underground', pointId: 'underfloor_boss_entrance' }, activeAt: ['CH03_MEMORY_FRAGMENT_SEEN'], requires: ['underfloor_memory_fragment_seen'], unless: ['underfloor_boss_defeated'], encounterKey: 'underfloor_boss_memory_spool', repeatable: true, play: { segmentId: 'ch03.boss_intro', endAfter: 'ch03.boss_victory' } },
  // ---- 4장 냉장고 속(C4-1) ----
  // 1) 성에 낀 입구 — 지역에 들어서면 서버가 실행. 도입(소리 없는 냉기)을 끝까지 본 뒤 fridge_entry_seen(completesWith)
  { id: 'fridge_entry', stageCode: 'ice', evidence: { kind: 'stage', stageCode: 'ice' }, auto: true, repeatable: true, play: 'resume' },
  // 2) 통로 끝의 가느리 — 장면을 끝까지 보면 fridge_ganeuri_freed + CH04_GANEURI_RESCUED. 중간에 끊기면 같은 지점에서 처음부터
  { id: 'fridge_ganeuri', stageCode: 'ice', evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_ganeuri' }, activeAt: ['CH04_STARTED'], requires: ['fridge_entry_seen'], unless: ['fridge_ganeuri_freed'], repeatable: true, play: { segmentId: 'ch04.ganeuri', endAfter: 'ch04.ganeuri' } },
  // 3) 저장고 앞 길목 — 바늘 통로 너머. 지문 뒤 전투(storyBattle). 승리하면 서버가 fridge_frozen_guard_won(저장고 문 열림, 체크포인트 유지)을 기록한다
  { id: 'fridge_guard', stageCode: 'ice', evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_guard' }, activeAt: ['CH04_GANEURI_RESCUED'], requires: ['fridge_ganeuri_freed'], unless: ['fridge_frozen_guard_won'], encounterKey: 'fridge_frozen_guard', repeatable: true, play: { segmentId: 'ch04.guard', endAfter: 'ch04.guard' } },
  // 4) 완성된 도안 벽 — 저장고 문이 열린 뒤. 끝까지 보면 fridge_storage_seen + CH04_STORAGE_CLEARED
  { id: 'fridge_storage_wall', stageCode: 'ice', evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_storage_wall' }, activeAt: ['CH04_GANEURI_RESCUED'], requires: ['fridge_frozen_guard_won'], unless: ['fridge_storage_seen'], repeatable: true, play: { segmentId: 'ch04.storage', endAfter: 'ch04.storage' } },
  // 5) 저장고 중심 앞 얼음 틈 — 누비의 고백. 끝까지 보면 fridge_confession_seen + CH04_CONFESSION_SEEN
  { id: 'fridge_confession', stageCode: 'ice', evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_confession' }, activeAt: ['CH04_STORAGE_CLEARED'], requires: ['fridge_storage_seen'], unless: ['fridge_confession_seen'], repeatable: true, play: { segmentId: 'ch04.confession', endAfter: 'ch04.confession' } },
  // 6) 저장고 중심 입구(10-23 C4-3) — 고백 뒤에만. 도입 → 서리 미싱 전투 → (이기면) 승리 장면이 한 재생 범위로 이어진다. 정산 뒤에는 닫힌다
  { id: 'fridge_boss_entrance', stageCode: 'ice', evidence: { kind: 'point', stageCode: 'ice', pointId: 'fridge_boss_entrance' }, activeAt: ['CH04_CONFESSION_SEEN'], requires: ['fridge_confession_seen'], unless: ['fridge_boss_defeated'], encounterKey: 'fridge_boss_frost_machine', repeatable: true, play: { segmentId: 'ch04.boss_intro', endAfter: 'ch04.boss_victory' } },
  // ---- 5장 보일러 옆 사막(C5-1) ----
  // 1) 사막 초입 — 지역에 들어서면 서버가 실행. 도입(뜨거운 침묵)을 끝까지 본 뒤 desert_entry_seen(completesWith)
  { id: 'desert_entry', stageCode: 'desert', evidence: { kind: 'stage', stageCode: 'desert' }, auto: true, repeatable: true, play: 'resume' },
  // 2) 단서 길 — 끝까지 보면 desert_clues_seen + CH05_CLUES_JOINED
  { id: 'desert_clues', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_clues' }, activeAt: ['CH05_STARTED'], requires: ['desert_entry_seen'], unless: ['desert_clues_seen'], repeatable: true, play: { segmentId: 'ch05.clues', endAfter: 'ch05.clues' } },
  // 3~5) 능선의 세 틈 앞 동료 — 차례로 하나씩. 끝까지 보면 그 틈이 열린다(체크포인트 유지)
  { id: 'desert_ridge_pad', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_pad' }, activeAt: ['CH05_CLUES_JOINED'], requires: ['desert_scorched_won'], unless: ['desert_ridge_pad'], repeatable: true, play: { segmentId: 'ch05.ridge_pad', endAfter: 'ch05.ridge_pad' } },
  { id: 'desert_ridge_scent', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_scent' }, activeAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_pad'], unless: ['desert_ridge_scent'], repeatable: true, play: { segmentId: 'ch05.ridge_scent', endAfter: 'ch05.ridge_scent' } },
  { id: 'desert_ridge_thread', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_ridge_thread' }, activeAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_scent'], unless: ['desert_ridge_thread'], repeatable: true, play: { segmentId: 'ch05.ridge_thread', endAfter: 'ch05.ridge_thread' } },
  // 2-1) 능선 앞 — 단서 길 뒤. 지문 뒤 전투(storyBattle). 승리하면 서버가 desert_scorched_won(물들이 지점 열림, 체크포인트 유지)을 기록한다(C5-3)
  { id: 'desert_scorched', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_scorched' }, activeAt: ['CH05_CLUES_JOINED'], requires: ['desert_clues_seen'], unless: ['desert_scorched_won'], encounterKey: 'desert_scorched_ambush', repeatable: true, play: { segmentId: 'ch05.scorched', endAfter: 'ch05.scorched' } },
  // 6) 능선 끝 절단면 — 끝까지 보면 desert_ridge_crossed + CH05_RIDGE_CROSSED
  { id: 'desert_cut_face', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_cut_face' }, activeAt: ['CH05_CLUES_JOINED'], requires: ['desert_ridge_thread'], unless: ['desert_ridge_crossed'], repeatable: true, play: { segmentId: 'ch05.cut_face', endAfter: 'ch05.cut_face' } },
  // 7) 금빛 마감실이 잠든 자리 — 보스 도입 → 전투 → (이기면 이어서) 승리 장면 → 가위(C5-3)
  { id: 'desert_boss_entrance', stageCode: 'desert', evidence: { kind: 'point', stageCode: 'desert', pointId: 'desert_boss_entrance' }, activeAt: ['CH05_RIDGE_CROSSED'], requires: ['desert_ridge_crossed'], unless: ['desert_boss_defeated'], encounterKey: 'desert_boss_golden_doll', repeatable: true, play: { segmentId: 'ch05.boss_intro', endAfter: 'ch05.scissors' } },
  // ---- 종장 집의 중심(F-1) ----
  // 1) 금빛 길 끝 — 도착 장면(동료 합류). 끝까지 보면 final_entry_seen + CHFINAL_STARTED. 중간에 끊기면 같은 지점에서 처음부터
  { id: 'final_arrival', stageCode: 'home_core', evidence: { kind: 'point', stageCode: 'home_core', pointId: 'final_arrival' }, activeAt: ['CH05_COMPLETE'], requires: ['final_unlocked', 'desert_chapter_complete_seen'], unless: ['final_entry_seen'], repeatable: true, play: { segmentId: 'final.arrival', endAfter: 'final.arrival' } },
  // 2) 중앙의 빈자리 — 다섯 기억의 결속·정체 공개. 끝까지 보면 final_identity_revealed + CHFINAL_IDENTITY_REVEALED
  { id: 'final_core', stageCode: 'home_core', evidence: { kind: 'point', stageCode: 'home_core', pointId: 'final_core' }, activeAt: ['CHFINAL_STARTED'], requires: ['final_entry_seen'], unless: ['final_identity_revealed'], repeatable: true, play: { segmentId: 'final.bind', endAfter: 'final.bind' } },
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
  'ch02.chapter_complete': 'ch02.chapter_complete',
  'ch03.chapter_complete': 'ch03.chapter_complete',
  'ch04.chapter_complete': 'ch04.chapter_complete',
  'ch05.boss_victory': 'ch05.scissors', // 10-26 C5-3: 승리 장면에 가위 장면이 이어진다(정본 — 장착하려는 순간)
  'ch05.chapter_complete': 'ch05.chapter_complete',
};

// 숲 입구 복귀 범위: 잘린 실을 살펴보기 전까지는 첫 길의 걷는 장면(001~004)만 다시 보여 준다. 그 뒤는 지점이 이어 간다
export const FIRST_PATH_INTRO: StoryPlayRange = { segmentId: FIRST_PATH, endAfter: FIRST_PATH, untilEntry: `${FIRST_PATH}.004` };

// 이벤트를 새로 기록했을 때 이어서 재생할 구간(유물 장착 → 장착 장면)
export const SEGMENT_AFTER_EVENT: Record<string, string> = {
  forest_first_knot_equipped: 'ch01.first_knot_equipped',
  lake_dye_thread_equipped: 'ch02.chapter_complete', // 장착이 처음 기록되면 '돌아온 색' 장면을 이어 재생
  underfloor_cotton_core_equipped: 'ch03.chapter_complete', // 장착이 처음 기록되면 '돌아온 중심' 장면을 이어 재생
  fridge_microfiber_equipped: 'ch04.chapter_complete', // 10-23 C4-3: 장착이 처음 기록되면 '이어진 감각' 장면을 이어 재생
  desert_finish_thread_equipped: 'ch05.chapter_complete', // 10-26 C5-3: 장착이 처음 기록되면 '마지막 마감' 장면을 이어 재생
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
  // 10-14 C2-5B: 물먹은 박음이. 승리하면 lake_boss_defeated(염색실 지급 사건·물빛 염색실 1개·CH02_BOSS_DEFEATED)를 서버가 한 트랜잭션으로 정산한다.
  //   정산 뒤에는 STORY_ENCOUNTER_DONE이라 다시 싸울 수 없다(체크포인트도 허용 범위를 벗어난다)
  { key: 'lake_boss_sewn_doll', chapter: 2, stageCode: 'lake', allowedAt: ['CH02_NUBI_CRISIS_SEEN'], requires: ['lake_nubi_crisis_seen'], onWinEvents: ['lake_boss_defeated'] },
  // 10-16 C3-3: 눌린 박음이 매복. 승리하면 매복 승리(실패 자국 길 개방 + CH03_MEMORY_TRAIL_FOUND)를 서버가 기록한다
  { key: 'underfloor_ambush', chapter: 3, stageCode: 'underground', allowedAt: ['CH03_ELDER_MET'], requires: ['underfloor_items_inspected'], onWinEvents: ['underfloor_ambush_won'] },
  // 10-16 C3-3: 기억 실패굴이. 승리하면 underfloor_boss_defeated(솜심 지급 사건·오래된 솜심 1개·CH03_BOSS_DEFEATED)를 서버가 한 트랜잭션으로 정산한다
  { key: 'underfloor_boss_memory_spool', chapter: 3, stageCode: 'underground', allowedAt: ['CH03_MEMORY_FRAGMENT_SEEN'], requires: ['underfloor_memory_fragment_seen'], onWinEvents: ['underfloor_boss_defeated'] },
  // 10-23 C4-3: 저장고 앞 길목. 승리하면 저장고 문만 열린다(체크포인트 유지 — Codex 의견 P-01)
  { key: 'fridge_frozen_guard', chapter: 4, stageCode: 'ice', allowedAt: ['CH04_GANEURI_RESCUED'], requires: ['fridge_ganeuri_freed'], onWinEvents: ['fridge_frozen_guard_won'] },
  // 10-23 C4-3: 서리 미싱. 승리하면 fridge_boss_defeated(극세사 지급 사건·얼음 극세사 1개·CH04_BOSS_DEFEATED)를 서버가 한 트랜잭션으로 정산한다
  { key: 'fridge_boss_frost_machine', chapter: 4, stageCode: 'ice', allowedAt: ['CH04_CONFESSION_SEEN'], requires: ['fridge_confession_seen'], onWinEvents: ['fridge_boss_defeated'] },
  // 10-26 C5-3: 능선 앞. 승리하면 물들이 지점만 열린다(체크포인트 유지 — 4장 P-01 방식)
  { key: 'desert_scorched_ambush', chapter: 5, stageCode: 'desert', allowedAt: ['CH05_CLUES_JOINED'], requires: ['desert_clues_seen'], onWinEvents: ['desert_scorched_won'] },
  // 10-26 C5-3: 황금 재단인형. 승리하면 desert_boss_defeated(마감실 지급 사건·금빛 마감실 1개·CH05_BOSS_DEFEATED)를 서버가 한 트랜잭션으로 정산한다
  { key: 'desert_boss_golden_doll', chapter: 5, stageCode: 'desert', allowedAt: ['CH05_RIDGE_CROSSED'], requires: ['desert_ridge_crossed'], onWinEvents: ['desert_boss_defeated'] },
  { key: 'forest_giant_knot', chapter: 1, stageCode: 'forest', allowedAt: ['CH01_COMPASS_ACQUIRED'], requires: ['forest_compass_granted', 'forest_hidden_path_opened'], onWinEvents: ['forest_giant_knot_defeated'] },
];

export const ENCOUNTER_BY_KEY = new Map(STORY_ENCOUNTERS.map((e) => [e.key, e]));
