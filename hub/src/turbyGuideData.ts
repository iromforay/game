import { ACCOUNT_SERVER_URL } from './account/accountClient';

// 터비 구하기 게임이 같은 출처(origin)의 localStorage에 저장하는 기기 식별자(save-a-turby/src/state/player.ts)
const TURBY_DEVICE_KEY = 'turby_player_id';

export interface TurbyStats {
  attack: number;
  defense: number;
  actionPower: number;
  maxHp: number;
}

export interface OwnedTurbyEntry {
  no: number;
  owned: true;
  imageKey: string;
  code: string;
  name: string;
  grade: { id: number; name: string };
  description: string | null;
  stats: TurbyStats;
  count: number;
  firstAcquiredAt: string | null;
}

export interface UnknownTurbyEntry {
  no: number;
  owned: false;
  imageKey: string;
}

export type TurbyEntry = OwnedTurbyEntry | UnknownTurbyEntry;

export interface TurbyCollection {
  playerFound: boolean;
  total: number;
  ownedCount: number;
  entries: TurbyEntry[];
}

// 게임과 같은 원본 그림을 쓴다. 게임 쪽 그림이 바뀌면 도감도 따라 바뀐다.
const images = import.meta.glob<string>('../../save-a-turby/src/assets/turby/*.png', { eager: true, import: 'default' });
const imageByKey = new Map(Object.entries(images).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.png'.length), url]));

export function turbyImage(imageKey: string) {
  return imageByKey.get(imageKey);
}

// 등급 칩 색 — 게임 아트 방향(저채도 크림·라벤더·세이지·물빛)에 맞춘 허브 표시용 값
const GRADE_COLORS: Record<number, string> = {
  1: '#c9bca8',
  2: '#e2d3b3',
  3: '#a8cfdc',
  4: '#c9b0dc',
  5: '#e6c878',
  6: '#afd8c8',
  7: 'linear-gradient(90deg, #f4b3c2, #f3d894, #afd8c8, #a8cfdc, #c9b0dc)',
};

export function gradeColor(gradeId: number) {
  return GRADE_COLORS[gradeId] ?? '#d8d0e6';
}

function readDeviceUuid() {
  try {
    return localStorage.getItem(TURBY_DEVICE_KEY);
  } catch {
    return null;
  }
}

export async function fetchTurbyCollection(): Promise<TurbyCollection> {
  const res = await fetch(`${ACCOUNT_SERVER_URL}/collection/turby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceUuid: readDeviceUuid() }),
  });
  if (!res.ok) throw new Error(`collection failed: ${res.status}`);
  return res.json();
}
