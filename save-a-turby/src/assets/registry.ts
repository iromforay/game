import childUrl from './avatar/child.png';
import nubiUrl from './turby/nubi.png';
import bopuliUrl from './turby/bopuli.png';
import muldeuliUrl from './turby/muldeuli.png';
import pokshiniUrl from './turby/pokshini.png';
import geumbitiUrl from './turby/geumbiti.png';
import ganeuriUrl from './turby/ganeuri.png';
import mujigaeUrl from './turby/mujigae.png';
import forestTileUrl from './backgrounds/forest-tile.png';
import homeTileUrl from './backgrounds/home-tile.png';
import villageTileUrl from './backgrounds/village-tile.png';
import lakeTileUrl from './backgrounds/lake-tile.png';
import undergroundTileUrl from './backgrounds/underground-tile.png';
import iceTileUrl from './backgrounds/ice-tile.png';
import desertTileUrl from './backgrounds/desert-tile.png';

// 3.1.1: 이미지 리소스는 원화 완성 전까지 여기서만 교체하면 되도록 키로 분리해둠.
// characters.json/backgrounds.json의 imageKey와 대응 — 7종 캐릭터 전부 원화 반영 완료(2026-09-17).
export const CHARACTER_IMAGES: Record<string, string> = {
  nubi: nubiUrl,
  bopuli: bopuliUrl,
  muldeuli: muldeuliUrl,
  pokshini: pokshiniUrl,
  geumbiti: geumbitiUrl,
  ganeuri: ganeuriUrl,
  mujigae: mujigaeUrl,
};

export const BACKGROUND_TILES: Record<string, string> = {
  forest: forestTileUrl,
  home: homeTileUrl,
  village: villageTileUrl,
  lake: lakeTileUrl,
  underground: undergroundTileUrl,
  ice: iceTileUrl,
  desert: desertTileUrl,
};

export const AVATAR_IMAGE = childUrl;

// docs/save_a_turby_asset.md §3 구조(world/·sprites/·ui/)의 파일을 파일명(확장자 제외)을 키로 자동 등록.
// 에셋이 폴더에 들어오는 즉시 코드 수정 없이 로드되고, 없으면 씬이 임시 도형으로 대체한다.
function buildKeyMap(globResult: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, url] of Object.entries(globResult)) {
    map[path.split('/').pop()!.replace(/\.png$/, '')] = url;
  }
  return map;
}

export const WORLD_IMAGES: Record<string, string> = {
  ...buildKeyMap(import.meta.glob('./world/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...buildKeyMap(import.meta.glob('./sprites/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...buildKeyMap(import.meta.glob('./ui/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  // 아이템 그림(예: items/story/glowing-yarn-dust.png → glowing-yarn-dust). 지도의 수집 오브젝트가 쓴다
  ...buildKeyMap(import.meta.glob('./items/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
};

// 초상화(docs/asset/integration_contract.md 2절): portraits/{인물}/{표정}.png → portrait-{인물}-{표정}.
// 폴더마다 neutral.png가 반복되므로 파일명만이 아니라 경로로 키를 만든다. 아직 없는 초상화는 대사 재생기가 기존 캐릭터 그림으로 대체한다.
export const PORTRAIT_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('./portraits/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>).map(([path, url]) => {
    const [, who, file] = path.match(/portraits\/([^/]+)\/([^/]+)\.png$/) ?? [];
    return [`portrait-${who}-${file}`, url];
  }),
);

// 스프라이트시트(96x96 프레임) 키 — 나머지는 일반 이미지로 로드
export const SPRITESHEET_KEYS = ['child-walk', 'child-idle', 'villager-a-walk', 'villager-b-walk', 'merchant-idle', 'nubi-field'];

