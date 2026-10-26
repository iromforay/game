// 10-26 C5-5: 5장 1차(C5-2, 배경 보정 B-01~03 포함)·2차(C5-4) 에셋 연결 — 파일·키(파일명)·크기·알파·해시(Codex manifest, codex/turby-ch5-assets f00f97c),
// 지도·전투·연출 연결. 받아들이기 점검 보정(R-01 잘린 틈 가로 띠 4종, R-02 바닥 칸 4종 85~95%, R-03 표적 2종) 반영.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// [키, 런타임 경로, 너비, 높이, 투명, SHA-256]
const ASSETS: [string, string, number, number, boolean, string][] = [
  ['desert-base', 'world/desert', 3200, 2400, false, 'C3168A491729C306F02F9FC32FE1A206E35BA4AF6C833B96807352D2C47BD553'],
  ['ridge-gap-closed', 'world/desert', 768, 384, true, '6F88B63A4C93BBA41B4C071C3182E019A0FB5C41745B4B5B47444B47A4F0E6A7'],
  ['ridge-gap-pad', 'world/desert', 768, 384, true, 'E72166157837794F219717E28BA0B578F24C205C71672D1085A6911667C42386'],
  ['ridge-gap-scent', 'world/desert', 768, 384, true, '30FBBF14389DD68AFDB06790CA24B1F4D5D9CE6A6671DFC8B467C49178635054'],
  ['ridge-gap-thread', 'world/desert', 768, 384, true, '84BA9D5B4A11D656478D0FBD0437083751AEC2399051E5D58DC6DE36AEE3E441'],
  ['mirage-path', 'world/desert', 800, 240, true, '1257BAA824A66F53DFE26C11A2C5D14BE0001E9D2ACF53267A85AD25FCFC0C1E'],
  ['cut-face', 'world/desert', 512, 512, true, '3137574E551E677F0ABD903357BDB6612DCA7E18B4D4953B2A96C3912CE25D21'],
  ['chapter05-dialogue-bg', 'world/desert', 1280, 720, false, 'BEA83DDA1F8CE3BCC996F2CDE5834036F5FB1BB8AB0B5BF111AC3A98F94C6FA3'],
  ['boss-floor-cut', 'world/desert', 960, 240, true, '342876CCF02C3E0E853738887A65E9E571C6AE15DC941A4E8DB44A351832B3B2'],
  ['scorched-mark', 'world/desert', 512, 512, true, '045412F3B6C31FB59714FBB0AB708187A0E1E4AA78477ECCECB18BACA27C6386'],
  ['golden-doll-mark', 'world/desert', 512, 512, true, '20D4806152A50AF442BAF06A3FA2834010987BB9142E6C93E6A03ED9A114CB75'],
  ['heat-haze', 'fx/story', 1280, 720, true, '1D0F8E39B7B0E12656F6F9FF8D73ECFD73C2829EBB9CA803C63DB484DAE3EFC1'],
  ['scissors-glimpse', 'fx/story', 1280, 720, true, '6C00FFE635B6038D206AAF9710DCCE1266D4835AEE391A11AE6BE1DB0C60FD58'],
  ['scissors-reveal', 'fx/story', 1280, 720, true, '2E08F1FFCBEE1EC59F1F7D9D7098B335241FCBB61E6BA8DC6669DA2CB060EE40'],
  ['five-relics', 'fx/story', 768, 768, true, '352D78FBFDBB9C2AB3481ADF0445ACEAE0D1AA4EBE3492B34B7537634F76FE56'],
  ['scorched-sewn-doll-idle', 'sprites/enemies', 640, 160, true, 'CB1C602D2380BBF57010EA8BB4096834C3F860912DA09AA5CEAB91E24187D292'],
  ['heat-mirage', 'sprites/enemies', 160, 160, true, 'C1EFFFD3416E53F0B902AE9D7F6CDA2B9BF1DBACA09EB1E8845D5001C15DB5E4'],
  ['cutting-stitch-idle', 'sprites/enemies', 640, 160, true, '98E7420C03875BF33EE94D1E817C18AB7E68E3B368965AF0CDFA31755EE3C599'],
  ['cut-knot', 'sprites/enemies', 128, 128, true, 'C8BEAAE0CA4E621FC8129D28AEB022B1180D39AF2EF36150E627B64F3B1F3DB8'],
  ['ember-cell', 'sprites/enemies', 160, 160, true, 'DC785296BA9346EA9F119FC1FACB4EE0977FF6939D41F94C789E46C00712E8CE'],
  ['wet-cell', 'sprites/enemies', 160, 160, true, '49D948D0CD8794AF4748436F1BCAE0718D7207580E09E976CE8D72176EB956B1'],
  ['cut-warn', 'sprites/enemies', 160, 160, true, '84EA7ECBC119751F50A4E88A86FACEC9A530F97798CB45065849AF91C45766AC'],
  ['cut-cell', 'sprites/enemies', 160, 160, true, 'B90F491240AD45FF969A35817909EF4237FEBC7FB58AEE19140AD3B2CC579B18'],
  ['golden-doll-idle', 'sprites/bosses', 1024, 256, true, '19E38B391CCF0EF5DA01CADA5F441708CFA35D2689E56CDDE5A0D31A66CEDF8A'],
  ['golden-doll-unraveled', 'sprites/bosses', 1024, 256, true, '358E13FBF72F7A99FB92EB7EA058A4FD7F119FEBDF5E3A5F0A3081015B73C057'],
  ['gold-point', 'sprites/enemies', 128, 128, true, '94C340A4A7E2E52E1E938517A09534630F9AE32292ED3FF6C4BE257FC066910C'],
  ['inner-link', 'sprites/enemies', 128, 128, true, 'D48E306F6376070B1F299B40EAC5196C778E7CB9611D40AA35F16DA80C537ACB'],
  ['golden-finish-thread', 'items/relics', 160, 160, true, '4F3017523F5813176E7AE4C5927BA2D13EE979D26C1B803CFCCE0362CFAC5547'],
];

test('5장 에셋 28종: 파일·키(파일명)·크기·투명·해시가 Codex manifest와 같다', () => {
  for (const [key, dir, w, h, alpha, hash] of ASSETS) {
    const file = here(`../src/assets/${dir}/${key}.png`);
    assert.ok(existsSync(file), `${key} 파일`);
    const bytes = readFileSync(file);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    assert.equal(bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS')), alpha, `${key} 투명`);
  }
  assert.equal(new Set(ASSETS.map((a) => a[0])).size, 28);
});

test('연결: 지도 배경·표식·오버레이·아지랑이, 전투 시트 규격(프레임 × 4 = 폭), 연출 키가 지역 데이터·대화·화면과 맞는다', () => {
  const D = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/desert.json'), 'utf8')) as {
    greybox: boolean;
    storyPoints: { id: string; assetKey: string }[];
    render: { background: { assetKey: string }; overlays: { assetKey: string }[] };
    layout: { gates: { id: string; closedAssetKey: string; openAssetKey: string }[] };
  };
  assert.deepEqual([D.greybox, D.render.background.assetKey], [false, 'desert-base']);
  const keys = new Set(ASSETS.map((a) => a[0]));
  for (const id of ['desert_scorched', 'desert_cut_face', 'desert_boss_entrance']) assert.ok(keys.has(D.storyPoints.find((p) => p.id === id)!.assetKey), `${id} 표식`);
  assert.ok(D.render.overlays.some((o) => o.assetKey === 'boss-floor-cut'));
  for (const g of D.layout.gates) for (const k of [g.closedAssetKey, g.openAssetKey]) assert.ok(keys.has(k), `${g.id} 그림 ${k}`);
  const map = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  assert.match(map, /'mirage-path'/);
  assert.match(map, /heat \? 'heat-haze' : 'voice-frost'/);
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  for (const [key, , w, h] of ASSETS.filter((a) => /-idle$|-unraveled$/.test(a[0]))) {
    const m = reg.match(new RegExp(`'${key}': \\{ size: (\\d+), frames: (\\d+)`))!;
    assert.deepEqual([Number(m[1]) * Number(m[2]), Number(m[1])], [w, h], `${key} 시트 규격`);
  }
  const ch05 = readFileSync(here('../../BE/story-data/save-a-turby/dialogue/ch05.json'), 'utf8');
  for (const cue of ['scissors-glimpse', 'scissors-reveal', 'five-relics']) assert.ok(ch05.includes(`"cameraCue": "${cue}"`) && keys.has(cue), `${cue} 연출`);
});
