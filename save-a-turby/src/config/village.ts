import villageData from '../data/village.json';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VillageCollider {
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export interface VillageObject {
  id: string;
  key: string;
  x: number; // 발밑 기준점(월드 좌표) — 깊이(100+y)와 충돌 기준
  y: number;
  scale?: number;
  origin: [number, number];
  shadow?: { w: number; h: number; alpha?: number };
  colliders?: VillageCollider[];
}

export interface VillageInteraction {
  id: string;
  type: 'home' | 'market' | 'exit';
  name: string;
  prompt: string;
  hint: string;
  zone: Rect;
}

export interface VillageLayout {
  width: number;
  height: number;
  avatarStart: { x: number; y: number };
  walkBounds: Rect;
  defaultDestinationId: string;
  blockers: Rect[]; // 지면 그림에 구워진 돌담·큰 돌덩이처럼 이미지가 아닌 정적 충돌 영역
  objects: VillageObject[];
  interactions: VillageInteraction[];
}

// 광장(분수)을 허브로 각 상호작용 존을 잇는 돌길 — 임시 길 텍스처와 지도 UI가 같은 모양을 공유
export function getVillagePaths(layout: VillageLayout) {
  const plaza = layout.objects.find((o) => o.id === 'fountain');
  const hub = { x: plaza?.x ?? layout.width / 2, y: (plaza?.y ?? layout.height / 2) + 70 };
  const lines = layout.interactions.map((it) => {
    const z = { x: it.zone.x + it.zone.w / 2, y: it.zone.y + it.zone.h / 2 };
    return [z, { x: z.x, y: hub.y }, hub];
  });
  return { hub, lines, plaza: { x: hub.x, y: hub.y - 40, w: 300, h: 150 } };
}

// 3.1.1 JSON 분리 정책 — 지금은 로컬 JSON에서 읽지만, 나중에 DB로 옮기면 이 함수 하나만
// fetch(`${API}/village`) 같은 비동기 호출로 바꾸면 됨(호출부는 이미 await 가능하게 async로 선언해둠).
export async function getVillageLayout(): Promise<VillageLayout> {
  return villageData as VillageLayout;
}
