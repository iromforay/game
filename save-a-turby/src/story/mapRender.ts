// 탐험 맵의 렌더링 계획(10-06 v2) — 서버가 내려 준 지역 화면(StageView)과 "그 텍스처가 로드돼 있는가"만으로 무엇을 어떻게 그릴지 정하는 순수 함수(test/mapRender.test.ts).
// 최종 숲은 `대형 비반복 배경 1장 + 진행 상태별 투명 오버레이 + 코드 충돌 영역`이다. 작은 타일을 반복하는 tileSprite는 최종 분기에서 쓰지 않는다.
// 에셋이 아직 없으면(미납품·로드 실패) 회색상자와 임시 도형이 그대로 남아 대상이 보이지 않게 되는 일이 없다.
import type { StageObject, StagePointView, StageView } from './storyStage';

// 그리는 순서(깊이): 대형 배경 → 진행 상태별 바닥 오버레이 → 이야기 지점·수집 오브젝트·문 → 야생 터비·플레이어·동료 → 전경·HUD.
// 회색상자(임시 배경)는 대형 배경 자리를 쓰고, 야생·플레이어·동료는 기본 깊이(0), HUD는 2000 이상이다.
export const MAP_DEPTH = {
  background: -30, // 최종 대형 배경
  greybox: -20, // 임시 회색상자 지형(배경 자리) — 글자는 +1
  overlay: -15, // 진행 상태별 바닥 오버레이(숨은 길 등)
  story: -5, // 이야기 지점·수집 오브젝트·문
  actors: 0, // 야생 터비·플레이어·동료
  hud: 2000,
} as const;

export type BackgroundPlan =
  | { mode: 'final'; assetKey: string; width: number; height: number; locked?: boolean } // 대형 배경 한 장을 지도 크기로 맞춘다
  | { mode: 'greybox' } // 임시 회색상자(최종 배경이 없거나 아직 회색상자 단계)
  | { mode: 'tile' }; // 지역 배치가 없는 다른 지역의 기존 반복 배경(최종 숲 분기에서는 쓰지 않는다)

export interface OverlayPlan {
  id: string;
  assetKey: string;
  x: number; // 피벗이 놓이는 월드 좌표
  y: number;
  width: number;
  height: number;
  pivot: [number, number];
  depth: number;
  forPoints: string[];
  rotation: number; // 도(°)
  alpha: number;
}
export interface GatePlan {
  id: string;
  open: boolean;
  art: { assetKey: string; x: number; y: number; width: number; height: number; pivot: [number, number] } | null; // 이 상태의 그림(없으면 null). 닫힘·열림이 같은 캔버스·피벗이라 전환 때 위치가 튀지 않는다
  placeholder: boolean; // 그림이 없어 임시 도형(닫힌 문 사각형)을 쓴다 — 닫힌 문만. 열린 문은 아무것도 그리지 않는다
}
export interface ActorPlan {
  id: string;
  assetKey: string | null; // 이 키의 텍스처가 있으면 그 그림, 없으면 null(임시 도형)
  art: { width: number; height: number; pivot: [number, number] } | null; // 서버가 정한 표시 크기(없으면 원본 크기)
  marker: boolean; // 임시 표식(고리·동심원·라벨)을 그린다 — 'final' 모드에서 그림(또는 대신하는 월드 그림)이 있으면 false
}

export interface StageRenderPlan {
  markerMode: 'fallback' | 'final';
  background: BackgroundPlan;
  overlays: OverlayPlan[];
  gates: GatePlan[];
  objects: ActorPlan[];
  points: ActorPlan[];
  bounds: { x: number; y: number; width: number; height: number }; // 카메라 경계 = 지도 크기
}

export type HasTexture = (assetKey: string) => boolean;

export function planStageRender(view: StageView | null, has: HasTexture, fallbackSize: { width: number; height: number }): StageRenderPlan {
  const size = view?.size ?? fallbackSize;
  const bounds = { x: 0, y: 0, width: size.width, height: size.height };
  // 잠금 배경(10-08 v2): 잠금 키·해제 이벤트가 모두 있고 아직 해제 전이며 잠금 이미지가 로드돼 있을 때만. 아니면 기존 배경(로드 실패도 폴백)
  const r = view?.render;
  const lockedKey = r?.backgroundLocked && r.unlockedBy && !r.backgroundUnlocked && has(r.backgroundLocked) ? r.backgroundLocked : null;
  const bgKey = lockedKey ?? view?.render?.background?.assetKey ?? null;
  // 최종 배경: 회색상자 단계가 끝났고(greybox:false) 대형 배경 텍스처가 실제로 있을 때만. 키만 있고 텍스처가 없으면 임시 배치가 유지된다
  let background: BackgroundPlan;
  if (view && !view.greybox && bgKey && has(bgKey)) background = { mode: 'final', assetKey: bgKey, width: size.width, height: size.height, ...(lockedKey ? { locked: true } : {}) };
  else if (view?.layout) background = { mode: 'greybox' };
  else background = { mode: 'tile' };

  // 월드 그림(길 오버레이·NPC·보스 표식 등): 텍스처가 있는 것만. 층이 story면 이야기 대상 위(고리·마름모 위), 같은 층에서는 데이터 순서대로 위로 쌓인다
  const overlays: OverlayPlan[] = (view?.render?.overlays ?? [])
    .filter((o) => has(o.assetKey))
    .map((o, i) => ({ id: o.id, assetKey: o.assetKey, x: o.x, y: o.y, width: o.width, height: o.height, pivot: o.pivot ?? [0.5, 0.5], depth: (o.layer ?? 'overlay') === 'story' ? MAP_DEPTH.story + 1 + i * 0.01 : MAP_DEPTH.overlay, forPoints: o.forPoints ?? [], rotation: o.rotation ?? 0, alpha: o.alpha ?? 1 }));

  const gates: GatePlan[] = (view?.gates ?? []).map((g) => {
    const key = g.open ? g.openAssetKey : g.closedAssetKey;
    const art = key && g.art && has(key) ? { assetKey: key, ...g.art, pivot: g.art.pivot ?? ([0.5, 0.5] as [number, number]) } : null;
    return { id: g.id, open: g.open, art, placeholder: !g.open && !art };
  });

  // 임시 표식 모드: fallback(기본) = 항상 유지 / final = 그림이 있는 대상의 임시 표식을 없앤다(Codex가 최종 에셋 연결 완료를 확인한 뒤 데이터에서 바꾼다)
  const markerMode = view?.render?.markerMode ?? 'fallback';
  const covered = new Set(overlays.flatMap((o) => o.forPoints));
  const actor = (o: StageObject | StagePointView): ActorPlan => {
    const art = has(o.assetKey) ? o.assetKey : null;
    const pa = 'art' in o ? o.art : undefined;
    return { id: o.id, assetKey: art, art: pa ? { width: pa.width, height: pa.height, pivot: pa.pivot ?? [0.5, 0.7] } : null, marker: !(markerMode === 'final' && (art || covered.has(o.id))) };
  };
  return { markerMode, background, overlays, gates, objects: (view?.objects ?? []).map(actor), points: (view?.points ?? []).map(actor), bounds };
}
