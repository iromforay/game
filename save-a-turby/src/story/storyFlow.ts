// 1장 실제 흐름 연결(M4-C) — 화면과 분리된 순수 판정(test/storyFlow.test.ts).
// 무엇을 재생할지는 서버가 정한다(map:enter / 트리거 응답의 play). 여기서는 그 결과를 화면 흐름으로 옮기는 규칙만 둔다.
import type { DialogueFile, StoryBattleResult } from './dialogueRunner';

export interface StoryPlay {
  segmentId: string;
  endAfter: string;
}

export interface StoryDelivery {
  triggerId: string;
  itemCode: string;
  have: number;
  need: number;
}

// 대화 파일 코드: 구간 ID 앞부분(ch01.first_path → ch01)
export const chapterOfSegment = (segmentId: string) => segmentId.split('.')[0];

// 새로고침으로 스토리 전투 화면부터 복원했을 때: 그 전투가 들어 있는 구간과 전투 항목(여기부터 대화를 이어 간다)
export function battleEntryOf(file: DialogueFile, encounterKey: string): { segmentId: string; dialogueId: string } | null {
  for (const seg of file.segments) {
    const e = seg.entries.find((x) => x.kind === 'storyBattle' && x.encounterKey === encounterKey);
    if (e) return { segmentId: seg.segmentId, dialogueId: e.dialogueId };
  }
  return null;
}

// 스토리 전투 → 대화 복귀 결과. 이겼을 때만 다음 항목, 그 밖(패배·무승부·취소·나가기)은 재도전
export function battleResultOf(outcome: string | null | undefined): StoryBattleResult {
  return outcome === 'win' ? 'won' : 'lost';
}

// 서버 오류 코드 → 대화 진행기 결과. 이미 이긴 전투는 다시 싸우지 않고 넘어간다. 나머지는 통신·상태 오류(재시도)
export function battleStartErrorResult(code: string | undefined): StoryBattleResult | null {
  return code === 'STORY_ENCOUNTER_DONE' ? 'already_won' : null;
}

// 실가루 목표·부족 수량 문구(수량은 서버 인벤토리 기준). 아이템 이름은 정본 표기 그대로
export const DELIVERY_ITEM_NAME: Record<string, string> = { glowing_yarn_dust: '빛나는 실가루' };

export function deliveryGoalText(d: StoryDelivery): string {
  return `${DELIVERY_ITEM_NAME[d.itemCode] ?? d.itemCode} 모으기 ${Math.min(d.have, d.need)}/${d.need}`;
}

export function shortageText(s: { itemCode: string; have: number; need: number }): string {
  return `${DELIVERY_ITEM_NAME[s.itemCode] ?? s.itemCode}이(가) ${s.need - s.have}개 더 필요해요 (${s.have}/${s.need})`;
}

// 지역 → 장 대화 파일(story_chapter 순서와 같다: 1장 숲 … 5장 사막)
const STAGE_CHAPTER: Record<string, string> = { forest: 'ch01', lake: 'ch02', underground: 'ch03', ice: 'ch04', desert: 'ch05' };
export const chapterOfStage = (stageCode: string) => STAGE_CHAPTER[stageCode] ?? 'ch01';
