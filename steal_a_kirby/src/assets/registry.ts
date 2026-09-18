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

// 2026-09-18 — docs/Steal a Kirby_image_generation_plan.md 1단계(정적 월드) 대비 준비.
// `lobby/`, `base/` 폴더는 아직 안 생겼지만 import.meta.glob은 매치가 없어도 에러 없이 빈 객체를
// 반환하므로 미리 걸어둠 — 코덱스가 파일을 그 경로에 넣기만 하면 씬 코드 수정 없이 자동으로 잡힘.
// 키는 "폴더/파일명"(확장자 제외) 형태, 예: "background/lobby-ground", "buildings/base-house-red".
function buildNestedMap(globResult: Record<string, string>, rootPrefix: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(globResult)) {
    const key = path.replace(rootPrefix, '').replace(/\.png$/, '');
    map[key] = url;
  }
  return map;
}

const STAGE1_LOBBY = buildNestedMap(
  import.meta.glob('./lobby/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  './lobby/',
);
const STAGE1_BASE = buildNestedMap(
  import.meta.glob('./base/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  './base/',
);

/** 1단계 로비 에셋 조회 — 파일이 아직 없으면 undefined(호출부에서 폴백 처리) */
export function getLobbyAssetUrl(key: string): string | undefined {
  return STAGE1_LOBBY[key];
}

/** 1단계 기지 에셋 조회 — 파일이 아직 없으면 undefined(호출부에서 폴백 처리) */
export function getBaseAssetUrl(key: string): string | undefined {
  return STAGE1_BASE[key];
}

// 2단계(캐릭터·오브젝트, DELIVERED 2026-09-18) — characters/ 폴더도 동일 패턴으로 준비.
// base/slots, base/structures/base-exit-glow, lobby/buildings/base-door-glow는 이미 위 glob이 커버함.
const STAGE2_CHARACTERS = buildNestedMap(
  import.meta.glob('./characters/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  './characters/',
);

/** 2단계 캐릭터 에셋 조회 — 예: getCharacterAssetUrl('player/player-walk-down') */
export function getCharacterAssetUrl(key: string): string | undefined {
  return STAGE2_CHARACTERS[key];
}

// 3단계(HUD·모바일 컨트롤, DELIVERED 2026-09-18) — hud/minimap/controls 폴더, 기존 ui/coin.png 등
// 구형 개별 named export와는 별개(둘 다 당분간 공존, 코덱스 QA 이후 구형은 정리 예정).
const STAGE3_UI = buildNestedMap(
  import.meta.glob('./ui/{hud,minimap,controls}/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  './ui/',
);

/** 3단계 UI 에셋 조회 — 예: getUiAssetUrl('hud/coin-panel'), getUiAssetUrl('controls/joystick-base') */
export function getUiAssetUrl(key: string): string | undefined {
  return STAGE3_UI[key];
}
