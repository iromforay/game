// 기획안(docs/Steal a Kirby.md) 3.2 확정 패턴: kirbies.json엔 imageKey(짧은 키)만 두고,
// 실제 파일 경로는 이 레지스트리에서만 관리한다(save-a-turby의 CHARACTER_IMAGES와 동일 목적).
// Vite의 import.meta.glob으로 폴더 전체를 한 번에 정적 임포트 — 캐릭터가 늘어나도 이 파일을 손댈 필요 없음.

function buildMap(globResult: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(globResult)) {
    const key = path.split('/').pop()!.replace(/\.png$/, '');
    map[key] = url;
  }
  return map;
}

const KIRBY_128 = buildMap(import.meta.glob('./kirby/128/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>);
const KIRBY_256 = buildMap(import.meta.glob('./kirby/256/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>);
const KIRBY_512 = buildMap(import.meta.glob('./kirby/512/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>);

export type KirbyImageSize = 128 | 256 | 512;

export function getKirbyImageUrl(imageKey: string, size: KirbyImageSize = 128): string | undefined {
  const map = size === 128 ? KIRBY_128 : size === 256 ? KIRBY_256 : KIRBY_512;
  return map[imageKey];
}

export function allKirbyImageKeys(size: KirbyImageSize = 128): string[] {
  const map = size === 128 ? KIRBY_128 : size === 256 ? KIRBY_256 : KIRBY_512;
  return Object.keys(map);
}

// UI/아바타/무기 등 개수가 적고 고정된 에셋은 그냥 named export로 직접 참조
import playerUrl from './avatar/player.png';
import coinUrl from './ui/coin.png';
import joystickUrl from './ui/joystick.png';
import radarUrl from './ui/radar.png';
import hitCounterUrl from './ui/hit-counter.png';
import batUrl from './weapons/bat.png';
import maceUrl from './weapons/mace.png';
import rayGunUrl from './weapons/ray-gun.png';

export const PLAYER_AVATAR_URL = playerUrl;
export const UI_COIN_URL = coinUrl;
export const UI_JOYSTICK_URL = joystickUrl;
export const UI_RADAR_URL = radarUrl;
export const UI_HIT_COUNTER_URL = hitCounterUrl;
export const WEAPON_BAT_URL = batUrl;
export const WEAPON_MACE_URL = maceUrl;
export const WEAPON_RAY_GUN_URL = rayGunUrl;
