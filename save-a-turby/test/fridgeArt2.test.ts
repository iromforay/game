// 10-23 C4-5: 4장 2차 에셋(C4-4)·검수 보정(delivery-v3) 연결 — 파일·키(파일명)·크기·알파·해시(Codex manifest, codex/turby-ch4-assets 5b90b56), 시트 프레임 계약, 전투·지도 연결
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// [키, 런타임 경로, 너비, 높이, SHA-256] — 모두 투명 PNG
const ASSETS: [string, string, number, number, string][] = [
  ['frozen-sewn-doll-idle', 'sprites/enemies', 640, 160, '4567FE27D1CA9AF7F71E9A4D0FB2EDEA45BB8A61D59DF4AF8EC0DC1EEB70FD32'],
  ['ice-shard', 'sprites/enemies', 128, 128, 'FD063E5086BDB6102C4C67A1B712E2D8DC7F403C9797DBF2F97508CA5B0AF09B'],
  ['thimble-guard-idle', 'sprites/enemies', 640, 160, '6CA46792A02C04A091BF9222FD9A6EBEB4072AB6FB10F7E17401310605AB2C9D'],
  ['thimble-guard-exposed', 'sprites/enemies', 640, 160, '2CC3453051B7B4AC6B7B59AC608FC83F4F3D7A967753198B780998B09579BE54'],
  ['black-stitch', 'sprites/enemies', 128, 128, '0555E0C052A630B8BA4930CE14B5E25235BDA9B7F102497A0C3A3D5AF15CABC4'],
  ['ice-cell', 'sprites/enemies', 160, 160, '11BF341988E2D8BD75B98021944519A2C30F7BE96A9B57BF58DAD795AC3B58FF'],
  ['frost-machine-idle', 'sprites/bosses', 1024, 256, '79D1D203A1F8BED6E012CE383A477BEE37987774740A6676912495FB83768637'],
  ['frost-machine-stopped', 'sprites/bosses', 1024, 256, '6FF26963BB72FFA51CC0FAD2475C3B67C03361B83B1878FC8147EA8CE13F3D7C'],
  ['lower-thread', 'sprites/enemies', 128, 128, 'B99356EC2A333DCDB8962CA61A7578E5A2E711B20F1FB6666ADBE6EDC3DD33D4'],
  ['upper-thread', 'sprites/enemies', 128, 128, '42CEF9B9EC768743C1522DA29E4E3CE00310ABE27612D21E58DBB32CB343EC9D'],
  ['battle-needle-mark', 'sprites/enemies', 160, 160, '06EE047FB3EB0D8370E49F1A4056B5CDC1F92B94FE4C9E3731ACF040155CAB20'],
  ['link-thread', 'sprites/enemies', 128, 128, '6A79938A075FBF685526D8CA5DBA4B840463FE569201B787B67403AF28E91A4C'],
  ['pinned-stitch', 'sprites/enemies', 160, 160, '2850336069539E9CA2D8436585CE0283C5D9BE64E7FDE705DBA3110E123F8D22'],
  ['ice-microfiber', 'items/relics', 160, 160, 'B386D489466D5E5B371379314D12BF64083D63EBB16D6F00E419B76767FCB696'],
  ['frozen-guard-mark', 'world/fridge', 512, 512, '65EEA8DACB3CED9FDD2F0B4723A55878AAEF16000581FFB976CE5BAC26F944E7'],
  ['frost-machine-mark', 'world/fridge', 512, 512, 'CE811F3B64EED70869A66D4C9354866CD2591065147ECF2870A49586FFEF6A81'],
  ['frost-machine-scar', 'fx/story', 768, 768, '0A1943F6D668ACD7F6259E719ADFAE6B38A7F6B3862642713A9E575668AD95F8'],
  ['sense-restore', 'fx/story', 768, 768, '790921593E39EBAE6855EC19B037452D391BDCD8B1CDB1466D73230CBD14D88F'],
  ['warm-gold', 'fx/story', 768, 768, '4FFC6FC4495AC4292819D1C600A6716B0EC22F11A46CC241B2B5A573C804B219'],
  ['ganeuri-pinned-stitches', 'world/fridge', 512, 512, '68B751B41790530A3F64F101EEA6FB290A05F199D2B90439CCEECBF906F2116B'],
];

test('2차 에셋 19종 + 실 땀 층: 파일·키(파일명)·크기·투명·해시가 Codex manifest와 같다', () => {
  for (const [key, dir, w, h, hash] of ASSETS) {
    const file = here(`../src/assets/${dir}/${key}.png`);
    assert.ok(existsSync(file), `${key} 파일`);
    const bytes = readFileSync(file);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    assert.ok(bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS')), `${key} 투명`);
  }
  assert.equal(new Set(ASSETS.map((a) => a[0])).size, 20);
});

test('시트 계약: 등록 프레임 × 4 = 시트 폭, 두 상태 시트는 같은 규격, 전투 정의 캐릭터 → 시트·표적 그림', () => {
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  const frame = (key: string) => {
    const m = reg.match(new RegExp(`'${key}': \\{ size: (\\d+), frames: (\\d+), fps: (\\d+) \\}`));
    assert.ok(m, `${key} 시트 등록`);
    return { size: Number(m![1]), frames: Number(m![2]) };
  };
  for (const [key, , w, h] of ASSETS.filter((a) => /-idle$|-exposed$|-stopped$/.test(a[0]))) {
    const f = frame(key);
    assert.deepEqual([f.size * f.frames, f.size], [w, h], `${key} 규격`);
  }
  assert.deepEqual(frame('thimble-guard-idle'), frame('thimble-guard-exposed'));
  assert.deepEqual(frame('frost-machine-idle'), frame('frost-machine-stopped'));
  for (const [code, key] of [['frozen_sewn_doll', 'frozen-sewn-doll-idle'], ['thimble_guard', 'thimble-guard-idle'], ['frost_machine', 'frost-machine-idle']]) assert.match(reg, new RegExp(`${code}: '${key}'`));
  const scene = readFileSync(here('../src/scenes/BattleScene.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(scene, /frost_machine: \{ idle: 'frost-machine-idle', exposed: 'frost-machine-stopped', labelBelow: \d+ \}/);
  assert.match(scene, /thimble_guard: \{ bound: 'thimble-guard-idle', exposed: 'thimble-guard-exposed' \}/);
  for (const [code, key] of [['ice_shard', 'ice-shard'], ['black_stitch', 'black-stitch'], ['lower_thread', 'lower-thread'], ['upper_thread', 'upper-thread'], ['link_thread', 'link-thread']]) assert.match(scene, new RegExp(`${code}: \\{ key: '${key}'`));
  assert.match(scene, /const ICE_KEY = 'ice-cell';\nconst NEEDLE_MARK_KEY = 'battle-needle-mark';\nconst PINNED_KEY = 'pinned-stitch';/);
});

test('지도 연결: 길목·서리 미싱 입구 표식, 외곽광은 박힌 가느리의 실 땀 층에만(몸 전체 아님)', () => {
  const ICE = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/ice.json'), 'utf8')) as {
    storyPoints: { id: string; assetKey: string; art?: { width: number; glow?: boolean } }[];
    render: { overlays: { id: string; assetKey: string; x: number; y: number; width: number; height: number; glow?: boolean; hiddenAfter?: string }[] };
  };
  const pt = (id: string) => ICE.storyPoints.find((p) => p.id === id)!;
  assert.deepEqual([pt('fridge_guard').assetKey, pt('fridge_boss_entrance').assetKey], ['frozen-guard-mark', 'frost-machine-mark']);
  assert.equal(pt('fridge_ganeuri').art!.glow, undefined, '몸 전체 외곽광 없음');
  const st = ICE.render.overlays.find((o) => o.assetKey === 'ganeuri-pinned-stitches')!;
  assert.deepEqual([st.x, st.y, st.width, st.height, st.glow, st.hiddenAfter], [1680, 1600, 124, 124, true, 'fridge_ganeuri_freed']);
});
