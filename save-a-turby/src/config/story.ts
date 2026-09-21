import storyData from '../data/story.json';
import charactersData from '../data/characters.json';
import backgroundsData from '../data/backgrounds.json';
import type { OwnedTurby } from '../state/inventory';

export interface StoryChapter {
  order: number;
  stageCode: string;
  clearCharacterCode: string; // 이 맵에서 직접 포획하면 장이 완료되고 다음 장이 열림
  titleKo: string;
}

export type ChapterState = 'cleared' | 'current' | 'locked';

export interface ChapterStatus {
  chapter: StoryChapter;
  state: ChapterState;
  stageName: string;
  clearCharacterName: string;
  unlockHint: string | null; // 잠겨 있을 때 이유(직접 포획해야 하는 이전 장의 대표 터비)
}

// 3.1.1 JSON 분리 정책 — 지금은 로컬 JSON, 나중에 DB로 옮기면 이 함수 하나만 fetch로 바꾸면 됨.
export async function getStoryChapters(): Promise<StoryChapter[]> {
  return (storyData as StoryChapter[]).slice().sort((a, b) => a.order - b.order);
}

const characterName = (code: string) => (charactersData as { code: string; name: string }[]).find((c) => c.code === code)?.name ?? code;
const stageName = (code: string) => (backgroundsData as { code: string; name: string }[]).find((b) => b.code === code)?.name ?? code;

// docs/Turby_story.md 3.2: 스타터·구매로 가진 같은 캐릭터는 인정하지 않고, 직접 포획(acquired_via='wild_capture')한 개체만 장 완료로 본다.
export function isChapterCleared(chapter: StoryChapter, owned: OwnedTurby[]) {
  return owned.some((t) => t.characterCode === chapter.clearCharacterCode && t.acquiredVia === 'wild_capture');
}

export function getChapterStatuses(chapters: StoryChapter[], owned: OwnedTurby[]): ChapterStatus[] {
  let previousCleared = true;
  let currentAssigned = false;
  return chapters.map((chapter, i) => {
    const cleared = isChapterCleared(chapter, owned);
    const unlocked = previousCleared;
    let state: ChapterState = 'locked';
    if (cleared) state = 'cleared';
    else if (unlocked && !currentAssigned) {
      state = 'current';
      currentAssigned = true;
    }
    const prev = chapters[i - 1];
    const status: ChapterStatus = {
      chapter,
      state,
      stageName: stageName(chapter.stageCode),
      clearCharacterName: characterName(chapter.clearCharacterCode),
      unlockHint: unlocked || !prev ? null : `${prev.titleKo}의 대표 터비 '${characterName(prev.clearCharacterCode)}'를 직접 포획하면 열립니다`,
    };
    previousCleared = cleared;
    return status;
  });
}

export function isStageUnlocked(statuses: ChapterStatus[], stageCode: string) {
  const s = statuses.find((x) => x.chapter.stageCode === stageCode);
  return !!s && s.state !== 'locked';
}

export function getCurrentChapter(statuses: ChapterStatus[]) {
  return statuses.find((s) => s.state === 'current') ?? null;
}
