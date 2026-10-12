import storyData from '../data/story.json';
import charactersData from '../data/characters.json';
import backgroundsData from '../data/backgrounds.json';
import { fetchStory } from '../api/client';
import { currentCard, toCards, type StageCardView, type StageLoad, type StageState } from '../state/stageView';

// 장 목록의 정적 표시 데이터(제목·지역 이미지·대표 터비 그림). 장 개방 판정에는 쓰지 않는다 —
// M2부터 개방·진행 상태는 서버(GET /player/me/story의 stages)만 판정한다(story.stageAccessV2로 신·구 전환).
export interface StoryChapter {
  order: number;
  stageCode: string;
  clearCharacterCode: string; // 표시용(카드의 대표 터비 그림). 판정에 쓰지 않는다
  titleKo: string;
}

export type ChapterState = StageState;

export interface ChapterStatus {
  chapter: StoryChapter;
  state: ChapterState;
  enterable: boolean;
  lockedReason: StageCardView['lockedReason']; // OPENING_REQUIRED면 오프닝 완료 전(v15)
  stageName: string;
  clearCharacterName: string;
  unlockHint: string | null;
  legacyTargetCode: string | null; // 구 판정(롤백)일 때만 채워짐 — 맵 목적지·"직접 포획하면 장 완료" 표시용
}

export function getStoryChapters(): StoryChapter[] {
  return (storyData as StoryChapter[]).slice().sort((a, b) => a.order - b.order);
}

const characterName = (code: string) => (charactersData as { code: string; name: string }[]).find((c) => c.code === code)?.name ?? code;
const stageName = (code: string) => (backgroundsData as { code: string; name: string }[]).find((b) => b.code === code)?.name ?? code;

export async function loadStageLoad(): Promise<StageLoad> {
  try {
    const story = await fetchStory();
    return { status: 'ready', stages: story.stages };
  } catch (err) {
    console.warn('[story] 지역 상태를 불러오지 못했습니다:', err);
    return { status: 'error' };
  }
}

// 서버 상태 + 정적 표시 데이터. 서버 응답이 없으면 전부 잠김(추측으로 열지 않음).
export async function loadChapterStatuses(): Promise<{ ok: boolean; statuses: ChapterStatus[] }> {
  const load = await loadStageLoad();
  const chapters = getStoryChapters();
  const statuses = toCards(load, chapters).map((card: StageCardView) => {
    const chapter = chapters.find((c) => c.stageCode === card.stageCode) ?? { order: card.order, stageCode: card.stageCode, clearCharacterCode: '', titleKo: card.title };
    return {
      chapter: { ...chapter, titleKo: card.title },
      state: card.state,
      enterable: card.enterable,
      lockedReason: card.lockedReason,
      stageName: stageName(card.stageCode),
      clearCharacterName: characterName(chapter.clearCharacterCode),
      unlockHint: card.hint,
      legacyTargetCode: card.legacyTargetCode,
    };
  });
  return { ok: load.status === 'ready', statuses };
}

export function getCurrentChapter(statuses: ChapterStatus[]): ChapterStatus | null {
  return statuses.find((s) => s.state === 'current') ?? null;
}

export { currentCard };
