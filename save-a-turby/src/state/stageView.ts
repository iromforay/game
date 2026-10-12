// M2: 지역 선택·맵 목적지·마을 안내가 쓰는 지역 상태 — 판정은 서버(GET /player/me/story의 stages)만 한다.
// 서버 응답을 받지 못했으면 어떤 지역도 열린 것으로 추측하지 않는다(숲 포함 전부 잠김 + 다시 시도 안내).
// import.meta·DOM 비의존 순수 모듈(test/stageView.test.ts).

export type StageState = 'cleared' | 'current' | 'open' | 'locked';

export interface ServerStageStatus {
  stageCode: string;
  order: number;
  title: string;
  state: StageState;
  canEnter: boolean;
  canProgress: boolean;
  lockedReason: 'OPENING_REQUIRED' | 'STAGE_LOCKED' | 'PREVIOUS_CHAPTER' | null; // OPENING_REQUIRED: 오프닝 완료 전(v15)
  hint: string | null;
  legacyTargetCode: string | null; // 구 판정(롤백 상태)일 때만 — 포획하면 다음 지역이 열리는 대표 터비
}

export type StageLoad = { status: 'ready'; stages: ServerStageStatus[] } | { status: 'error' };

export interface StageCardView {
  stageCode: string;
  order: number;
  title: string;
  state: StageState;
  enterable: boolean;
  lockedReason: ServerStageStatus['lockedReason'];
  hint: string | null;
  legacyTargetCode: string | null;
}

export const STAGE_LOAD_ERROR_HINT = '지역 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

export function toCards(load: StageLoad, chapters: { order: number; stageCode: string; titleKo: string }[]): StageCardView[] {
  if (load.status !== 'ready') {
    return [...chapters]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ stageCode: c.stageCode, order: c.order, title: c.titleKo, state: 'locked' as const, enterable: false, lockedReason: null, hint: STAGE_LOAD_ERROR_HINT, legacyTargetCode: null }));
  }
  return [...load.stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ stageCode: s.stageCode, order: s.order, title: s.title, state: s.state, enterable: s.canEnter, lockedReason: s.lockedReason, hint: s.hint, legacyTargetCode: s.legacyTargetCode }));
}

export function currentCard(cards: StageCardView[]): StageCardView | null {
  return cards.find((c) => c.state === 'current') ?? null;
}
