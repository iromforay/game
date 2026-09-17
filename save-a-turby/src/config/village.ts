import villageData from '../data/village.json';

export interface VillageBuilding {
  id: string;
  type: 'home' | 'market' | 'exit';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // "#rrggbb"
}

export interface VillageLayout {
  width: number;
  height: number;
  buildings: VillageBuilding[];
  avatarStart: { x: number; y: number };
}

// 3.1.1 JSON 분리 정책 — 지금은 로컬 JSON에서 읽지만, 나중에 DB로 옮기면 이 함수 하나만
// fetch(`${API}/village`) 같은 비동기 호출로 바꾸면 됨(호출부는 이미 await 가능하게 async로 선언해둠).
export async function getVillageLayout(): Promise<VillageLayout> {
  return villageData as VillageLayout;
}
