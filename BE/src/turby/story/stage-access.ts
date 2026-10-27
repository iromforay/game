// M2 지역 개방 판정 — 순수 함수. 서버 StageAccessService가 DB 값을 넣어 호출한다.
// v2(story.stageAccessV2=true): 스토리 개방 이벤트 또는 백필 입장 권한(legacy_access_<stage>)
// 구 판정(false, 롤백용): 대표 터비 직접 포획 기록 — 서버 입장 검사는 "이전 장 대표 포획"만, 화면 표시는 연속 개방(기존 FE 규칙)
import { STAGE_CHAPTER } from './story-data';
import { canEnterStage, canProgressChapter, chapterCompleteCheckpoint, checkpointIndex, isCheckpoint } from './story-rules';
import type { Checkpoint } from './story-data';

export interface ChapterRow {
  order: number;
  stageCode: string;
  title: string;
}

export type StageState = 'cleared' | 'current' | 'open' | 'locked';

export interface StageStatusDto {
  stageCode: string;
  order: number;
  title: string;
  state: StageState;
  canEnter: boolean;
  canProgress: boolean;
  lockedReason: 'OPENING_REQUIRED' | 'STAGE_LOCKED' | 'PREVIOUS_CHAPTER' | null;
  hint: string | null;
  legacyTargetCode: string | null; // 구 판정일 때만: 이 지역에서 포획하면 다음 지역이 열리는 대표 터비(맵 목적지 표시용)
}

// v15(사용자 확정): 오프닝 완료 전에는 신규·기존 계정 모두 마을 밖(숲 포함 모든 야생 지역)에 들어갈 수 없다.
// 신·구 판정(story.stageAccessV2)과 관계없이 가장 먼저 적용하며, 구 판정 롤백 경로도 이 조건을 우회하지 않는다.
export const OPENING_REQUIRED_HINT = '먼저 누비와 이야기를 마쳐 주세요.';

export function openingDone(checkpoint: Checkpoint): boolean {
  return checkpointIndex(checkpoint) >= checkpointIndex('OPENING_COMPLETE');
}

export function gateByOpening(statuses: StageStatusDto[], checkpoint: Checkpoint): StageStatusDto[] {
  if (openingDone(checkpoint)) return statuses;
  return statuses.map((s) => ({ ...s, state: 'locked' as const, canEnter: false, lockedReason: 'OPENING_REQUIRED' as const, hint: OPENING_REQUIRED_HINT, legacyTargetCode: null }));
}

// 구 FE 규칙: 1장부터 연속으로 대표 터비를 직접 포획한 만큼 열린다(중간이 빠지면 뒤는 잠김)
export function legacyReachedOrder(chapters: ChapterRow[], clearCodeByOrder: Map<number, string>, captured: ReadonlySet<string>): number {
  let reached = 1;
  for (const ch of [...chapters].sort((a, b) => a.order - b.order)) {
    if (ch.order !== reached) break;
    const code = clearCodeByOrder.get(ch.order);
    if (code && captured.has(code) && reached < chapters.length) reached += 1;
    else break;
  }
  return reached;
}

// 구 서버 입장 검사(rooms.service.ts::requireUnlocked 그대로): 1장은 항상, N장은 N-1장 대표를 직접 포획했으면
export function legacyServerCanEnter(order: number, clearCodeByOrder: Map<number, string>, captured: ReadonlySet<string>): boolean {
  if (order <= 1) return true;
  const prev = clearCodeByOrder.get(order - 1);
  return prev === undefined || captured.has(prev);
}

export function chapterCompleted(order: number, checkpoint: Checkpoint): boolean {
  const done = chapterCompleteCheckpoint(order);
  return isCheckpoint(done) && checkpointIndex(checkpoint) >= checkpointIndex(done);
}

// "현재" 장: 들어갈 수 있고(v2는 이야기 진행도 가능해야 함) 아직 끝나지 않은 첫 장. 나머지 입장 가능한 장은 open.
function assignStates(rows: Omit<StageStatusDto, 'state'>[], cleared: (s: Omit<StageStatusDto, 'state'>) => boolean, currentNeedsProgress: boolean): StageStatusDto[] {
  let currentAssigned = false;
  return rows.map((r) => {
    let state: StageState = 'locked';
    if (cleared(r)) state = 'cleared';
    else if (r.canEnter && (r.canProgress || !currentNeedsProgress) && !currentAssigned) {
      state = 'current';
      currentAssigned = true;
    } else if (r.canEnter) state = 'open';
    return { ...r, state };
  });
}

export function v2Statuses(chapters: ChapterRow[], events: ReadonlySet<string>, checkpoint: Checkpoint): StageStatusDto[] {
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const rows = sorted.map((ch) => {
    const canEnter = canEnterStage(ch.stageCode, events);
    const canProgress = canProgressChapter(STAGE_CHAPTER[ch.stageCode] ?? ch.order, checkpoint);
    const prevTitle = sorted.find((p) => p.order === ch.order - 1)?.title;
    return {
      stageCode: ch.stageCode,
      order: ch.order,
      title: ch.title,
      canEnter,
      canProgress,
      lockedReason: !canEnter ? ('STAGE_LOCKED' as const) : !canProgress ? ('PREVIOUS_CHAPTER' as const) : null,
      hint: !canEnter
        ? `${prevTitle ?? '이전 장'}의 이야기를 마치면 열립니다`
        : !canProgress
          ? '이전 장 이야기를 마치면 이 지역의 이야기가 시작됩니다'
          : null,
      legacyTargetCode: null,
    };
  });
  return assignStates(rows, (r) => chapterCompleted(r.order, checkpoint), true);
}

export function legacyStatuses(
  chapters: ChapterRow[],
  clearCodeByOrder: Map<number, string>,
  nameByCode: Map<string, string>,
  captured: ReadonlySet<string>,
  checkpoint: Checkpoint,
): StageStatusDto[] {
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const reached = legacyReachedOrder(sorted, clearCodeByOrder, captured);
  const rows = sorted.map((ch) => {
    const canEnter = ch.order <= reached;
    const prev = sorted.find((p) => p.order === ch.order - 1);
    const prevCode = prev ? clearCodeByOrder.get(prev.order) : undefined;
    return {
      stageCode: ch.stageCode,
      order: ch.order,
      title: ch.title,
      canEnter,
      canProgress: canProgressChapter(STAGE_CHAPTER[ch.stageCode] ?? ch.order, checkpoint),
      lockedReason: canEnter ? null : ('STAGE_LOCKED' as const),
      hint: canEnter || !prev ? null : `${prev.title}의 대표 터비 '${nameByCode.get(prevCode ?? '') ?? prevCode}'를 직접 포획하면 열립니다`,
      legacyTargetCode: clearCodeByOrder.get(ch.order) ?? null,
    };
  });
  // 구 규칙의 "완료"는 그 장의 대표 터비를 직접 포획한 것. 이야기 진행은 구 규칙에서도 따로 판정한다.
  return assignStates(rows, (r) => r.canEnter && captured.has(clearCodeByOrder.get(r.order) ?? ''), false);
}
