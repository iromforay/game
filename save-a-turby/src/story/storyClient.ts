// 오프닝 씬이 쓰는 서버 계약. 실제 게임은 api/client의 /player/me/* 를, 개발용 미리보기(dev/)는 메모리 가짜를 넣는다.
import type { DialogueFile } from './dialogueRunner';

export interface OpeningStoryState {
  checkpoint: string;
  needsName: boolean;
  playerName: string;
  resume: { segmentId: string | null };
  // 서버가 판정한 오프닝 필수/선택(Codex v13). 클라이언트는 신규/기존을 추측하지 않는다
  openingRequired: boolean;
  openingAvailable: boolean;
  openingStarted: boolean;
}

export interface StoryClient {
  fetchState(): Promise<OpeningStoryState>;
  fetchDialogue(chapterCode: string): Promise<DialogueFile>;
  completeEvent(eventId: string): Promise<OpeningStoryState>;
  saveName(name: string): Promise<OpeningStoryState>; // 거절 시 { code, message, reason }을 가진 오류 throw
}

// 첫 화면 분기: 서버가 필수라고 할 때만 오프닝으로 보낸다(기존 계정은 마을)
export function bootRoute(state: OpeningStoryState): 'opening' | 'village' {
  return state.openingRequired ? 'opening' : 'village';
}

// v15(사용자 확정): 오프닝 완료 전에는 마을 밖 이동·사냥 불가. 서버 지역 상태의 잠금 사유로 판단한다(로컬 추측 없음)
export const OPENING_REQUIRED_MESSAGE = '먼저 누비와 이야기를 마쳐 주세요.';

export function openingLocked(stages: { lockedReason: string | null }[]): boolean {
  return stages.some((s) => s.lockedReason === 'OPENING_REQUIRED');
}
