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
  // 이야기 연출 오버레이(예: fx/story/nubi-color-drain.png → nubi-color-drain)
  ...buildKeyMap(import.meta.glob('./fx/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
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

// 10-13 C2-3: 프레임 크기가 96이 아닌 시트(호수 일반 적). 가로 4프레임 idle. fps는 권장 재생 속도(젖은 실밥이 5~7, 젖은 박음이 4~6)
export const SPRITESHEET_FRAMES: Record<string, { size: number; frames: number; fps: number }> = {
  'wet-stitchling-idle': { size: 128, frames: 4, fps: 6 },
  'wet-sewn-doll-idle': { size: 160, frames: 4, fps: 5 },
  'waterlogged-sewn-doll-idle': { size: 256, frames: 4, fps: 4 }, // 10-14 C2-5A 보스(결박)
  'waterlogged-sewn-doll-exposed': { size: 256, frames: 4, fps: 4 }, // 보스(약점 노출) — 같은 프레임 인덱스·표시 중심으로 교체
  'nubi-color-drain': { size: 192, frames: 6, fps: 9 }, // 10-13 C2-4 누비 색 빠짐 오버레이(1회 재생, 8~10fps)
  'nubi-color-restore': { size: 192, frames: 6, fps: 9 }, // 10-14 C2-6 색 회복 오버레이(1→6 순서 1회 재생 — 시트가 이미 회복 방향이다. drain을 역재생하지 않는다)
  // 10-16 3장 2차 전투 에셋(Codex delivery-v2). 상태가 둘인 시트는 같은 프레임 인덱스·표시 중심으로 교체한다
  'pressed-sewn-doll-idle': { size: 160, frames: 4, fps: 5 }, // 눌린 박음이(납작)
  'pressed-sewn-doll-exposed': { size: 160, frames: 4, fps: 5 }, // 눌린 박음이(재봉선 노출)
  'small-spool-idle': { size: 128, frames: 4, fps: 6 }, // 작은 실패굴이
  'memory-spool-idle': { size: 256, frames: 4, fps: 4 }, // 기억 실패굴이(결박)
  'memory-spool-exposed': { size: 256, frames: 4, fps: 4 }, // 기억 실패굴이(약점 노출)
  'memory-thread': { size: 128, frames: 5, fps: 0 }, // 기억실 5가닥 — 재생하지 않고 프레임 = 가닥 번호(1 분홍·2 청록·3 금색·4 보라·5 산호)
  // 10-23 C4-3 4장 2차 에셋(C4-4 지시서 규격 — 파일이 오면 그대로 재생)
  'frozen-sewn-doll-idle': { size: 160, frames: 4, fps: 5 }, // 얼어붙은 박음이
  'thimble-guard-idle': { size: 160, frames: 4, fps: 5 }, // 골무막이(골무를 쓴 상태)
  'thimble-guard-exposed': { size: 160, frames: 4, fps: 5 }, // 골무막이(벗겨진 상태)
  'frost-machine-idle': { size: 256, frames: 4, fps: 4 }, // 서리 미싱(작동)
  'frost-machine-stopped': { size: 256, frames: 4, fps: 4 }, // 서리 미싱(정지)
  // 10-26 C5-3 5장 2차 에셋(C5-4 지시서 규격 — 파일이 오면 그대로 재생)
  'scorched-sewn-doll-idle': { size: 160, frames: 4, fps: 5 }, // 그을린 박음이
  'cutting-stitch-idle': { size: 160, frames: 4, fps: 6 }, // 재단 실밥이
  'golden-doll-idle': { size: 256, frames: 4, fps: 4 }, // 황금 재단인형(작동)
  'golden-doll-unraveled': { size: 256, frames: 4, fps: 4 }, // 황금 재단인형(풀려 무너짐)
};

// 전투 정의의 characterCode → 전투·지도에서 쓰는 적 시트 키(없으면 기존 터비 그림/임시 도형)
export const ENEMY_SHEET_OF: Record<string, string> = {
  wet_stitchling: 'wet-stitchling-idle',
  wet_sewn_doll: 'wet-sewn-doll-idle',
  waterlogged_sewn_doll: 'waterlogged-sewn-doll-idle',
  pressed_sewn_doll: 'pressed-sewn-doll-idle',
  small_spool: 'small-spool-idle',
  memory_spool: 'memory-spool-idle',
  // 10-23 C4-3 4장(2차 에셋 C4-4 — 파일이 오기 전에는 임시 도형)
  frozen_sewn_doll: 'frozen-sewn-doll-idle',
  thimble_guard: 'thimble-guard-idle',
  frost_machine: 'frost-machine-idle',
  // 10-26 C5-3 5장(2차 에셋 C5-4 — 파일이 오기 전에는 임시 도형)
  scorched_sewn_doll: 'scorched-sewn-doll-idle',
  cutting_stitch: 'cutting-stitch-idle',
  golden_doll: 'golden-doll-idle',
};

