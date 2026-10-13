// 스토리 판정 순수 함수 — DB·소켓·시간을 모른다. StoryService가 트랜잭션 안에서 읽은 값을 넣어 호출한다.
import {
  CHECKPOINTS,
  CHAPTER_CODES,
  DEFAULT_NICKNAME,
  LEGACY_ACCESS_PREFIX,
  STAGE_UNLOCK_EVENTS,
  type Checkpoint,
  type ChapterCode,
  type StoryEventDef,
  type StoryObjectiveDef,
} from './story-data';

export interface StorySnapshot {
  checkpoint: Checkpoint;
  events: ReadonlySet<string>;
  objectives: ReadonlyMap<string, ReadonlySet<string>>;
  growthStage: number;
}

export function isCheckpoint(value: string): value is Checkpoint {
  return (CHECKPOINTS as readonly string[]).includes(value);
}

export function checkpointIndex(cp: Checkpoint): number {
  return CHECKPOINTS.indexOf(cp);
}

// DB 값이 목록에 없으면(수동 수정 등) 가장 앞 상태로 취급해 진행을 막는다
export function toCheckpoint(value: string): Checkpoint {
  return isCheckpoint(value) ? value : 'OPENING_NOT_STARTED';
}

export function chapterOf(cp: Checkpoint): number {
  if (cp.startsWith('OPENING_')) return 0;
  return Number(cp.slice(2, 4));
}

export function chapterCodeOf(cp: Checkpoint): ChapterCode {
  const n = chapterOf(cp);
  // 장 완료 체크포인트는 다음 장의 입구에 서 있는 상태다
  const current = cp.endsWith('_COMPLETE') && n < CHAPTER_CODES.length - 1 ? n + 1 : n;
  return CHAPTER_CODES[current];
}

// N장 이야기를 진행할 수 있는가(지역 입장과 별개 — 개발 계획 4절)
export function canProgressChapter(chapter: number, cp: Checkpoint): boolean {
  if (chapter <= 0) return true;
  if (chapter === 1) return checkpointIndex(cp) >= checkpointIndex('OPENING_COMPLETE');
  const prevComplete = `CH0${chapter - 1}_COMPLETE`;
  return isCheckpoint(prevComplete) && checkpointIndex(cp) >= checkpointIndex(prevComplete);
}

// 지역 입장: 숲은 항상, 그 외는 스토리 개방 이벤트 또는 M2 백필 입장 권한
export function canEnterStage(stageCode: string, events: ReadonlySet<string>): boolean {
  if (stageCode === 'forest') return true;
  const unlock = STAGE_UNLOCK_EVENTS[stageCode];
  if (!unlock) return false;
  return events.has(unlock) || events.has(`${LEGACY_ACCESS_PREFIX}${stageCode}`);
}

export type RuleFailure = { code: 'STORY_EVENT_NOT_ALLOWED' | 'STORY_PREREQUISITE_MISSING' | 'CHAPTER_LOCKED'; detail: string };

// 이벤트 허용 여부(증거·아이템 보유는 서비스가 별도 확인). null이면 허용.
export function checkEvent(def: StoryEventDef, snap: StorySnapshot): RuleFailure | null {
  if (!canProgressChapter(def.chapter, snap.checkpoint)) return { code: 'CHAPTER_LOCKED', detail: `chapter ${def.chapter} is locked at ${snap.checkpoint}` };
  if (!def.allowedAt.includes(snap.checkpoint)) return { code: 'STORY_EVENT_NOT_ALLOWED', detail: `${def.id} is not allowed at ${snap.checkpoint}` };
  const missing = def.requires.filter((r) => !snap.events.has(r));
  if (missing.length > 0) return { code: 'STORY_PREREQUISITE_MISSING', detail: `missing events: ${missing.join(', ')}` };
  if (def.requireObjective) {
    const got = snap.objectives.get(def.requireObjective.key)?.size ?? 0;
    if (got < def.requireObjective.count) return { code: 'STORY_PREREQUISITE_MISSING', detail: `${def.requireObjective.key} ${got}/${def.requireObjective.count}` };
  }
  if (def.requireGrowth !== undefined && snap.growthStage < def.requireGrowth) return { code: 'STORY_PREREQUISITE_MISSING', detail: `growth ${snap.growthStage} < ${def.requireGrowth}` };
  return null;
}

export function checkObjective(def: StoryObjectiveDef, snap: StorySnapshot): RuleFailure | null {
  if (!canProgressChapter(def.chapter, snap.checkpoint)) return { code: 'CHAPTER_LOCKED', detail: `chapter ${def.chapter} is locked` };
  if (!def.activeAt.includes(snap.checkpoint) || def.requires.some((r) => !snap.events.has(r))) {
    return { code: 'STORY_EVENT_NOT_ALLOWED', detail: `${def.key} is not active at ${snap.checkpoint}` };
  }
  return null;
}

// 체크포인트는 앞으로만 간다
export function nextCheckpoint(current: Checkpoint, to: Checkpoint | undefined): Checkpoint | null {
  if (!to) return null;
  return checkpointIndex(to) > checkpointIndex(current) ? to : null;
}

// 재접속 시 클라이언트가 다시 보여 줄 곳(story_checkpoint_spec.md 14절). 대화 구간 ID는 대화 JSON의 segmentId와 같다.
export function resumeOf(snap: StorySnapshot): { segmentId: string | null; tutorial: 'relic_equip' | null } {
  const has = (e: string) => snap.events.has(e);
  const tutorial = has('forest_first_knot_awakened') && !has('forest_first_knot_equipped') ? ('relic_equip' as const) : null;
  const seg = (() => {
    switch (snap.checkpoint) {
      case 'OPENING_NOT_STARTED':
        return 'opening.fall';
      case 'OPENING_FALL_COMPLETE':
        return 'opening.meeting';
      case 'OPENING_NAME_SAVED':
        return 'opening.promise';
      case 'CH01_STARTED':
        return has('forest_bopul_rescued') ? 'ch01.bopul_clue' : 'ch01.first_path';
      case 'CH01_COMPASS_ACQUIRED':
        return has('forest_giant_knot_defeated') && !has('forest_first_knot_awakened') ? 'ch01.first_knot_awaken' : null;
      case 'CH01_FIRST_KNOT_EQUIPPED':
        return has('forest_dansuring_found') ? 'ch01.primordial_knot' : null;
      case 'CH01_COMPLETE':
        return 'ch02.lake_entry'; // 호수에 들어서면(지역 진입 트리거) 물빛 입구 도입을 본다. 마을·숲에서는 자동으로 뜨지 않는다(resume은 오프닝 화면만 쓴다)
      default:
        return null; // 자유 탐험(트리거까지 이동)
    }
  })();
  return { segmentId: seg, tutorial };
}

// ---- 플레이어 이름(Codex D5) ----
// 앞뒤 공백 제거 후 1~10자. 한글 음절·영문·숫자와 단어 사이 공백 하나만 허용. 연속 공백·특수문자·금칙어·기본값 거부.
const NAME_PATTERN = /^[가-힣A-Za-z0-9]+( [가-힣A-Za-z0-9]+)*$/;

export function validatePlayerName(raw: unknown, bannedWords: readonly string[]): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_string' };
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > 10) return { ok: false, reason: 'length' };
  if (!NAME_PATTERN.test(name)) return { ok: false, reason: 'characters' };
  if (name === DEFAULT_NICKNAME) return { ok: false, reason: 'default_name' };
  const compact = name.replace(/ /g, '').toLowerCase();
  if (bannedWords.some((w) => w && compact.includes(w.replace(/ /g, '').toLowerCase()))) return { ok: false, reason: 'banned_word' };
  return { ok: true, name };
}

// ---- 가방 칸(인벤토리 명세 3절) ----
export function slotsOf(quantity: number, maxStack: number): number {
  if (quantity <= 0) return 0;
  return Math.ceil(quantity / Math.max(1, maxStack));
}

// 가방에 더 넣을 수 있는 수량. 기존 칸의 남은 자리 + 빈 칸 수 × 최대 중첩
export function bagRoomFor(currentQuantity: number, maxStack: number, usedSlots: number, capacity: number): number {
  const stack = Math.max(1, maxStack);
  const freeSlots = Math.max(0, capacity - usedSlots);
  const partial = currentQuantity > 0 ? slotsOf(currentQuantity, stack) * stack - currentQuantity : 0;
  return partial + freeSlots * stack;
}

// ---- 오프닝 필수(v15 사용자 확정) ----
// 신규·기존 계정 모두 OPENING_COMPLETE 전에는 오프닝 필수이며 마을 밖·사냥이 막힌다(v13의 기존 계정 선택 진입은 폐기).
// origin은 출신 기록용으로만 남긴다. 오프닝을 마치면 필수도 진입점도 아니다(재시청은 별도 계약 — 현재 없음).
export type ProgressOrigin = 'new' | 'legacy_backfill';

export function openingFlags(_origin: ProgressOrigin, checkpoint: Checkpoint): { openingRequired: boolean; openingAvailable: boolean; openingStarted: boolean } {
  const done = checkpointIndex(checkpoint) >= checkpointIndex('OPENING_COMPLETE');
  const started = checkpoint !== 'OPENING_NOT_STARTED';
  return done ? { openingRequired: false, openingAvailable: false, openingStarted: true } : { openingRequired: true, openingAvailable: true, openingStarted: started };
}

// 진행 행이 없을 때의 서버 판정(백필에서 빠진 계정 대비): 새 BE는 스타터를 주지 않으므로,
// 행이 없는데 터비를 한 마리라도 가졌으면 구 BE 시절에 만든 기존 계정이다. 클라이언트 값은 쓰지 않는다.
export function originWithoutRow(ownedTurbyCount: number): ProgressOrigin {
  return ownedTurbyCount > 0 ? 'legacy_backfill' : 'new';
}
