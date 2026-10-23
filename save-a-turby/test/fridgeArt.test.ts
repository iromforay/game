// 10-23 C4-3: 4장 냉장고 속 1차 에셋(C4-2) 연결 — 파일·키(파일명)·크기·알파·해시(Codex delivery-v1 manifest), 지역 데이터 표시 계약, 장 전용 대화 배경
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// [키, 런타임 경로, 너비, 높이, 알파 있음, SHA-256(Codex delivery-v1 manifest — 대화 배경은 delivery-v1-fix, 도안 벽은 delivery-v3 교체본)]
const ASSETS: [string, string, number, number, boolean, string][] = [
  ['fridge-base', 'world/fridge/fridge-base.png', 3200, 2400, false, '097B0BCD85B0A184208F29F8E9CAB3A084CB584352B74729E3E899E2F9B3C07D'],
  ['ganeuri-pinned', 'world/fridge/ganeuri-pinned.png', 512, 512, true, 'B42170A7581411C1D4E8E0B9DBC0CC3241C9611EEAC0BD62751D314D4D290077'],
  ['ganeuri-freed', 'world/fridge/ganeuri-freed.png', 512, 512, true, '1DEAA9FFAD47AF94E6F83938E5ECA4852F557EF7B9EBCA234654255EE393A7F4'],
  ['storage-door-closed', 'world/fridge/storage-door-closed.png', 1536, 1024, true, '7E8BFD225316FA258ECE582BC4BE45B27F26851ADBF829E2B18EFE58DB05AE4F'],
  ['storage-door-open', 'world/fridge/storage-door-open.png', 1536, 1024, true, 'B33D5B3A4FAC7F42C3430606BD60ABAB568540899BA039D67B75680EC147EB31'],
  ['frost-crack-light', 'world/fridge/frost-crack-light.png', 512, 512, true, '8679106F5A1EEBA4FC8541E7DC8BE5916273822BA59A0796D9778AE01C938624'],
  ['storage-pattern-wall', 'world/fridge/storage-pattern-wall.png', 1200, 440, true, 'D3270B5EDC2BABD9A91B56A3E2730FCD55F4B051B3F26D0CF32A6B3C4665FCD2'],
  ['needle-warn', 'world/fridge/needle-warn.png', 384, 640, true, 'E616B75AB73EB27E01086E0CBD6E6A9EA07F4C421157C5ED2AAB786FE01E0DC9'],
  ['needle-strike', 'world/fridge/needle-strike.png', 384, 640, true, '41793A466F557665713D34C49BD9BF34B7B22F0B1868CE38B3475AB7BA79AB32'],
  ['voice-frost', 'fx/story/voice-frost.png', 1280, 720, true, 'B8275F5BE7D8EB8542FCD10E7C076C6F4D2563B217BBD2A9DD156613EFF3DFED'],
  ['storage-pattern', 'fx/story/storage-pattern.png', 768, 768, true, '778122C0A7A93FF56021ECC39AF9AD5151B3869D0BFF39EB06A13513ED6A996C'],
  ['chapter04-dialogue-bg', 'world/fridge/chapter04-dialogue-bg.png', 1280, 720, false, 'D9C840C5855543FC81FA973CAA449CAAEF520FFACE1178AB02D47B43EE667483'],
];

test('1차 에셋 12종: 파일·키(파일명)·크기·알파 유무·해시가 Codex 전달 manifest와 같고 중복 키가 없다', () => {
  const keys = new Set<string>();
  for (const [key, rel, w, h, alpha, hash] of ASSETS) {
    const file = here(`../src/assets/${rel}`);
    assert.ok(existsSync(file), `${key} 파일`);
    assert.equal(rel.split('/').pop(), `${key}.png`, `${key}: 키 = 파일명`);
    assert.equal(keys.has(key), false, `${key} 중복`);
    keys.add(key);
    const bytes = readFileSync(file);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    assert.equal(bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS')), alpha, `${key} 알파`);
  }
  assert.equal(keys.size, 12);
});

test('지역 데이터 표시 계약: 최종 배경, 가느리 124·고백 빛 120(외곽광), 저장고 문 두 상태(열림은 좌우 반쪽 0.8배), 도안 벽·풀려난 가느리 오버레이가 지도 안에 있다', () => {
  const ICE = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/ice.json'), 'utf8')) as {
    greybox: boolean;
    size: { width: number; height: number };
    storyPoints: { id: string; assetKey: string; art?: { width: number; height: number; pivot: [number, number]; glow?: boolean } }[];
    render: { markerMode: string; background: { assetKey: string }; overlays: { id: string; assetKey: string; x: number; y: number; width: number; height: number; forPoints?: string[]; visibleAfter?: string; hiddenAfter?: string }[] };
    layout: { gates: { closedAssetKey: string; openAssetKey: string; art: { width: number; height: number }; openPieces: { width: number; height: number; frame: number[] }[] }[] };
  };
  assert.deepEqual([ICE.greybox, ICE.render.markerMode, ICE.render.background.assetKey], [false, 'final', 'fridge-base']);
  const art = (id: string) => ICE.storyPoints.find((p) => p.id === id)!;
  assert.deepEqual([art('fridge_ganeuri').assetKey, art('fridge_ganeuri').art!.width, art('fridge_ganeuri').art!.glow], ['ganeuri-pinned', 124, undefined], 'C4-6 QA-11: 외곽광은 실 땀 층에만');
  assert.deepEqual([art('fridge_confession').assetKey, art('fridge_confession').art!.width, art('fridge_confession').art!.glow], ['frost-crack-light', 120, true]);
  const g = ICE.layout.gates[0];
  assert.deepEqual([g.closedAssetKey, g.openAssetKey, g.art.width, g.art.height], ['storage-door-closed', 'storage-door-open', 220, 140]);
  assert.deepEqual(g.openPieces.map((p) => [p.width, p.height, p.frame]), [[88, 112, [0, 0, 768, 1024]], [88, 112, [768, 0, 768, 1024]]]);
  const wall = ICE.render.overlays.find((o) => o.assetKey === 'storage-pattern-wall')! as typeof ICE.render.overlays[number] & { alpha?: number };
  assert.deepEqual([wall.x, wall.y, wall.width, wall.height, wall.alpha, wall.forPoints], [2250, 220, 600, 220, 0.88, ['fridge_storage_wall']], 'C4-6 QA-05·10');
  const guide = ICE.render.overlays.find((o) => o.assetKey === 'ganeuri-freed')!;
  assert.deepEqual([guide.visibleAfter, guide.hiddenAfter], ['fridge_ganeuri_freed', 'fridge_frozen_guard_won']);
  for (const o of ICE.render.overlays) assert.ok(o.x + o.width <= ICE.size.width && o.y + o.height <= ICE.size.height, `${o.id} 지도 안`);
});

test('연출 연결: 4장 대화 구간은 장 전용 배경, 목소리 서리·도안 클로즈업은 대화 연출 키, 바늘 칸은 그림 키로 그린다', () => {
  const opening = readFileSync(here('../src/scenes/OpeningScene.ts'), 'utf8');
  assert.match(opening, /fridge: \{ key: 'chapter04-dialogue-bg', alpha: 0\.8 \}/);
  assert.match(opening, /'storage-pattern'/);
  assert.match(opening, /const VOICE_CUE = 'voice-frost';/);
  assert.match(readFileSync(here('../src/scenes/StoryDialogueScene.ts'), 'utf8'), /ch04: 'fridge'/);
  const map = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  assert.match(map, /make\('needle-warn'/);
  assert.match(map, /make\('needle-strike'/);
});
