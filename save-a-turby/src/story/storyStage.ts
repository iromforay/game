// 지역 스토리 화면(10-02 v3) — 서버가 내려 준 "지금 이 플레이어에게 보이는 것"을 화면 판정으로 옮기는 순수 함수(test/storyStage.test.ts).
// 좌표·문구·에셋 키는 전부 서버의 지역 데이터에서 온다(회색상자 좌표를 최종 지도로 바꿔도 이 파일은 그대로다).
// 수집·지점 발동의 허용 여부는 서버가 판정한다. 여기서는 "무엇을 누를 수 있게 보여 줄지"만 정한다.
import { bodyBlocked, CLIENT_BODY_HALF, solidsOfView } from 'turby-stage-geometry';

export { CLIENT_BODY_HALF, SERVER_BODY_HALF, stepWithSolids } from 'turby-stage-geometry';

export interface StageRect {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface StageObject {
  id: string;
  objectiveKey: string;
  x: number;
  y: number;
  radius: number;
  assetKey: string;
  label: string;
  prompt: string;
  state: 'locked' | 'available';
}
export interface StagePointView {
  id: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  assetKey: string;
  label: string;
  prompt: string;
  art?: { width: number; height: number; pivot?: [number, number] }; // 그림 표시 크기·피벗(서버 데이터가 단일 출처). 없으면 원본 크기
}
export interface StageView {
  stageCode: string;
  greybox: boolean;
  size: { width: number; height: number } | null;
  objects: StageObject[];
  points: StagePointView[];
  gates: (StageRect & { open: boolean; closedAssetKey?: string | null; openAssetKey?: string | null; art?: { x: number; y: number; width: number; height: number; pivot?: [number, number] } | null })[];
  render?: { markerMode?: 'fallback' | 'final'; background: { assetKey: string } | null; backgroundLocked?: string; unlockedBy?: string; backgroundUnlocked?: boolean; overlays: { id: string; assetKey: string; x: number; y: number; width: number; height: number; pivot?: [number, number]; layer?: 'overlay' | 'story'; forPoints?: string[]; rotation?: number; alpha?: number }[] }; // 구버전 서버 응답에는 없다
  // water·anchors: 얕은/깊은 물과 마른 발판(표시 전용 — 판정은 서버. 회색상자 지도에서 물 구역을 구분해 그린다)
  layout: { zones: StageRect[]; paths: number[][][]; blockers: StageRect[]; water?: { id: string; kind: 'shallow' | 'deep'; x: number; y: number; width: number; height: number }[]; anchors?: { id: string; x: number; y: number; radius: number }[]; currents?: { id: string; x: number; y: number; width: number; height: number; dx: number; dy: number }[]; traps?: { id: string; x: number; y: number; radius: number }[] } | null;
  objectives: { key: string; collected: number; required: number; active: boolean }[];
  goal?: { id: string; text: string } | null; // 이야기 목표 문구(서버가 진행에 맞춰 정한다 — 수집 목표가 없을 때 상단 목표 패널에 표시)
}

export type Interactable = { type: 'object'; target: StageObject } | { type: 'point'; target: StagePointView };

// 지금 서 있는 자리에서 누를 수 있는 대상 하나: 반경 안에서 가장 가까운 것. 같은 거리면 이야기 지점이 먼저(이야기 진행 우선)
export function nearestInteractable(view: StageView | null, x: number, y: number): Interactable | null {
  if (!view) return null;
  let best: { d: number; it: Interactable } | null = null;
  const consider = (it: Interactable) => {
    const d = Math.hypot(it.target.x - x, it.target.y - y);
    if (d > it.target.radius) return;
    if (!best || d < best.d) best = { d, it };
  };
  view.points.forEach((p) => consider({ type: 'point', target: p }));
  view.objects.forEach((o) => consider({ type: 'object', target: o }));
  return (best as { d: number; it: Interactable } | null)?.it ?? null;
}

// 안내 버튼 문구. 잠긴 오브젝트는 눌러도 서버가 거절하므로 잠김을 드러낸다
export const LOCKED_OBJECT_PROMPT = '아직 모을 수 없어요';
export function promptText(it: Interactable): string {
  return it.type === 'object' && it.target.state === 'locked' ? LOCKED_OBJECT_PROMPT : it.target.prompt;
}

// ----- 막힌 곳(예측 충돌) — 규칙은 서버와 같은 공용 패키지(shared/turby-stage-geometry)에서 온다 -----
// 경계 포함 여부, 몸 반지름, 문 개방 해석이 서버와 한 정의를 쓴다. 여기서는 화면 데이터에 맞춰 부르기만 한다.

// 지나갈 수 없는 사각형: 막힌 곳 + 닫힌 문(문의 open은 서버가 정해 내려 준 값)
export function solidRects(view: StageView | null): StageRect[] {
  if (!view?.layout) return [];
  return solidsOfView(view.layout.blockers, view.gates);
}

// 아바타 중심(x, y)이 반지름 half인 몸으로 막힌 곳에 닿는가
export function blockedAt(solids: StageRect[], x: number, y: number, half: number = CLIENT_BODY_HALF): boolean {
  return bodyBlocked(solids, { x, y }, half);
}

// 수집 뒤 알림 문구(수량은 서버 응답 기준)
export function collectedText(label: string, collected: number, required: number): string {
  return `${label} ${Math.min(collected, required)}/${required}`;
}
