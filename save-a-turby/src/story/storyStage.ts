// 지역 스토리 화면(10-02 v3) — 서버가 내려 준 "지금 이 플레이어에게 보이는 것"을 화면 판정으로 옮기는 순수 함수(test/storyStage.test.ts).
// 좌표·문구·에셋 키는 전부 서버의 지역 데이터에서 온다(회색상자 좌표를 최종 지도로 바꿔도 이 파일은 그대로다).
// 수집·지점 발동의 허용 여부는 서버가 판정한다. 여기서는 "무엇을 누를 수 있게 보여 줄지"만 정한다.

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
}
export interface StageView {
  stageCode: string;
  greybox: boolean;
  size: { width: number; height: number } | null;
  objects: StageObject[];
  points: StagePointView[];
  gates: (StageRect & { open: boolean })[];
  layout: { zones: StageRect[]; paths: number[][][]; blockers: StageRect[] } | null;
  objectives: { key: string; collected: number; required: number; active: boolean }[];
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

// 지나갈 수 없는 사각형: 막힌 곳 + 닫힌 문
export function solidRects(view: StageView | null): StageRect[] {
  if (!view?.layout) return [];
  return [...view.layout.blockers, ...view.gates.filter((g) => !g.open)];
}

// 아바타 중심(x, y)이 반지름 half인 몸으로 막힌 곳에 닿는가
export function blockedAt(solids: StageRect[], x: number, y: number, half: number): boolean {
  return solids.some((r) => x + half > r.x && x - half < r.x + r.width && y + half > r.y && y - half < r.y + r.height);
}

// 한 걸음: 가로·세로를 따로 시험해 벽을 따라 미끄러진다
export function stepWithSolids(solids: StageRect[], from: { x: number; y: number }, to: { x: number; y: number }, half: number): { x: number; y: number } {
  const x = blockedAt(solids, to.x, from.y, half) ? from.x : to.x;
  const y = blockedAt(solids, x, to.y, half) ? from.y : to.y;
  return { x, y };
}

// 수집 뒤 알림 문구(수량은 서버 응답 기준)
export function collectedText(label: string, collected: number, required: number): string {
  return `${label} ${Math.min(collected, required)}/${required}`;
}
