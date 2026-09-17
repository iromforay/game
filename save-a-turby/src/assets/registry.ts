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
import villageHomeUrl from './village/home.png';
import villageMarketUrl from './village/market.png';

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

// 4.1: 마을 건물(타일이 아닌 실제 건물 형태) — VillageScene이 이 키로 이미지 로드
export const VILLAGE_BUILDING_IMAGES: Record<string, string> = {
  home: villageHomeUrl,
  market: villageMarketUrl,
};
