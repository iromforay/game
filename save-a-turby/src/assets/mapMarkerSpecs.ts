// 지도(미니맵·전체 지도·범례)의 정식 UI 기호 정의 — 순수 데이터(Phaser 없음)라 단위 시험에서 키·크기·종류를 확인한다.
// 이 기호들은 색뿐 아니라 실루엣으로 종류를 구분하고 작은 지도에서 선명해야 하므로 코드로 생성하는 정식 UI다(월드의 임시 placeholder와 다르다).
// 같은 키의 실제 PNG가 이미 로드돼 있으면 PNG를 쓰고 이 도형은 만들지 않는다(ensureMapMarkerTextures).
import type { MarkerType } from '../ui/screenStates';

export type MarkerShape = 'arrow' | 'house' | 'stall' | 'door' | 'lock' | 'ring' | 'diamond' | 'triangle' | 'star';

export interface MapMarkerSpec {
  key: string;
  width: number;
  height: number;
  shape: MarkerShape;
  role: string;
}

export const MAP_MARKER_SPECS: readonly MapMarkerSpec[] = [
  { key: 'marker-player', width: 40, height: 40, shape: 'arrow', role: '내 위치 — 화살표' },
  { key: 'marker-home', width: 40, height: 40, shape: 'house', role: '내 집' },
  { key: 'marker-market', width: 40, height: 40, shape: 'stall', role: '장터' },
  { key: 'marker-exit', width: 40, height: 40, shape: 'door', role: '야생 출구' },
  { key: 'marker-locked', width: 40, height: 40, shape: 'lock', role: '잠금' },
  { key: 'marker-story', width: 40, height: 40, shape: 'ring', role: '이야기 지점 — 겹동그라미' },
  { key: 'marker-dust', width: 40, height: 40, shape: 'diamond', role: '빛나는 실가루 — 마름모' },
  { key: 'marker-wild', width: 40, height: 40, shape: 'triangle', role: '야생 터비 ▲' },
  { key: 'marker-current', width: 48, height: 48, shape: 'star', role: '목적지 — 별(현재 목표)' },
] as const;

export const MAP_MARKER_KEYS: readonly string[] = MAP_MARKER_SPECS.map((s) => s.key);

// 범례 종류(MarkerType) → 텍스처 키. 목적지(target)는 별(marker-current)을 쓴다
export function markerTextureKey(type: MarkerType): string {
  return type === 'target' ? 'marker-current' : `marker-${type}`;
}
