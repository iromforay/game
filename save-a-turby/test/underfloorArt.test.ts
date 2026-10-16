// 10-16 C3-2: 3장 마루바닥 밑 1차 에셋 연결 — 파일·키·크기·알파·해시(Codex delivery-v1 manifest), 지역 데이터의 표시 계약, 최종 렌더 계획
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planStageRender } from '../src/story/mapRender.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const UG = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/underground.json'), 'utf8')) as {
  greybox: boolean;
  size: { width: number; height: number };
  storyPoints: { id: string; assetKey: string; art: { width: number; height: number; pivot: [number, number] } }[];
  render: { markerMode: string; background: { assetKey: string }; overlays: Record<string, unknown>[] };
  layout: { gates: { id: string; closedAssetKey: string; openAssetKey: string; art: { x: number; y: number; width: number; height: number; pivot: [number, number] }; x: number; y: number; width: number; height: number }[] };
};

// [키, 런타임 경로, 너비, 높이, 알파 있음, SHA-256(Codex delivery-v1 manifest)]
const ASSETS: [string, string, number, number, boolean, string][] = [
  ['underfloor-base', 'world/underfloor/underfloor-base.png', 3200, 2400, false, 'C359D8130E946A35FD20F5283660D0896DF8936477B9D72DD2EDA6D07AA4CBD0'],
  ['elder-pokshini', 'world/underfloor/props/elder-pokshini.png', 512, 512, true, '1A21C28D3443B6ED9E55D8B798ED3DB8A6F2EA7B2C5A34B19A158D709A115F23'],
  ['inspect-glove', 'world/underfloor/props/inspect-glove.png', 512, 512, true, 'B32BCF1AAB1E2842350EA00EA02E29B5902DD744C3691DA8BD2963A625D22C20'],
  ['inspect-blanket', 'world/underfloor/props/inspect-blanket.png', 512, 512, true, 'C960984D1F78270AE05BC7CB833382EF33E9A4E0A5A16CB9EF2AA6658ABFC0A1'],
  ['inspect-doll', 'world/underfloor/props/inspect-doll.png', 512, 512, true, '5E386CFF3EDD8B4359B8F58F6304B14C800CF713E6114B83FB07A5D84020C48D'],
  ['dust-yarn-gate-closed', 'world/underfloor/maze/dust-yarn-gate-closed.png', 1536, 1024, true, '5EB6A766A1111053B406721B7D82623EA6E17D33B43EA8CD9F13892CD62DC56F'],
  ['dust-yarn-gate-open', 'world/underfloor/maze/dust-yarn-gate-open.png', 1536, 1024, true, '5569F6358D78B61A93CE316CE9595ADF9D19991E6EAA8D8A2DD7FB63B0213903'],
  ['memory-trail', 'world/underfloor/overlays/memory-trail.png', 1440, 1360, true, '6F82E492E3189AE0EB48D1F0EFA0CD9C0B2AF95EB87307026342C34605E8E894'],
  ['memory-glove', 'fx/story/memory-glove.png', 768, 768, true, '2A9D5D3C668B90E23BB75EDED48F976CC148F23F7A6923EC428567EDAC5382F6'],
  ['memory-blanket', 'fx/story/memory-blanket.png', 768, 768, true, '59338A0C892BB4868D763A9C8FC3982EFE2679EDA116838685AE4FF2360B9AC5'],
  ['memory-doll', 'fx/story/memory-doll.png', 768, 768, true, '41C912C6198E67243FCE74C363694D5EC945409C24A1E90201F71DB1C4CA5A18'],
];

test('1차 에셋 11종: 파일·키(파일명)·크기·알파 유무·해시가 Codex 전달 manifest와 같고 중복 키가 없다', () => {
  const keys = new Set<string>();
  for (const [key, rel, w, h, alpha, hash] of ASSETS) {
    const file = here(`../src/assets/${rel}`);
    assert.ok(existsSync(file), `${key} 파일`);
    assert.equal(rel.split('/').pop(), `${key}.png`, `${key}: 키 = 파일명`);
    assert.equal(keys.has(key), false, `${key} 중복`);
    keys.add(key);
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    const hasAlpha = bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS'));
    assert.equal(hasAlpha, alpha, `${key} 알파`);
  }
  assert.equal(keys.size, 11);
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  assert.match(reg, /import\.meta\.glob\('\.\/world\/\*\*\/\*\.png'/);
  assert.match(reg, /import\.meta\.glob\('\.\/fx\/\*\*\/\*\.png'/);
});

test('지역 데이터 표시 계약: 배경·지점 그림 크기/피벗·문 두 상태(같은 중심·피벗)·실패 자국 오버레이가 전달 계약 그대로다', () => {
  assert.equal(UG.greybox, false);
  assert.equal(UG.render.markerMode, 'final');
  assert.deepEqual(UG.render.background, { assetKey: 'underfloor-base' });
  const art = (id: string) => UG.storyPoints.find((p) => p.id === id)!;
  const elder = art('underfloor_elder');
  assert.deepEqual([elder.assetKey, elder.art.width, elder.art.height, elder.art.pivot], ['elder-pokshini', 96, 96, [0.5, 0.7]]);
  for (const k of ['glove', 'blanket', 'doll']) {
    const p = art(`underfloor_${k}`);
    assert.deepEqual([p.assetKey, p.art.width, p.art.height, p.art.pivot], [`inspect-${k}`, 104, 104, [0.5, 0.75]]);
  }
  const gate = UG.layout.gates[0];
  assert.deepEqual([gate.closedAssetKey, gate.openAssetKey], ['dust-yarn-gate-closed', 'dust-yarn-gate-open']);
  assert.deepEqual([gate.art.width, gate.art.height, gate.art.pivot], [220, 140, [0.5, 0.85]]);
  assert.equal(gate.art.x, gate.x + gate.width / 2, '문 그림은 충돌 사각형의 가운데');
  const trail = UG.render.overlays.find((o) => o.assetKey === 'memory-trail')!;
  assert.deepEqual([trail.x, trail.y, trail.width, trail.height, trail.pivot, trail.alpha, trail.visibleAfter], [1900, 600, 720, 680, [0, 0], 0.7, 'underfloor_memory_trail_found']);
  assert.ok((trail.x as number) + (trail.width as number) <= UG.size.width && (trail.y as number) + (trail.height as number) <= UG.size.height, '지도 안');
});

test('렌더 계획: 최종 배경(underfloor-base, 3200×2400, 월드 원점), 텍스처가 없으면 임시 배치로 폴백', () => {
  const view = { stageCode: 'underground', greybox: UG.greybox, size: UG.size, objects: [], points: [], gates: [], render: { markerMode: 'final', background: UG.render.background, overlays: [] }, layout: { zones: [], paths: [], blockers: [], gates: [] } } as never;
  const plan = planStageRender(view, (k) => k === 'underfloor-base', { width: 3200, height: 2400 });
  assert.deepEqual(plan.background, { mode: 'final', assetKey: 'underfloor-base', width: 3200, height: 2400 });
  assert.equal(planStageRender(view, () => false, { width: 3200, height: 2400 }).background.mode, 'greybox');
});

test('기억 비침: cameraCue 세 종이 fx 에셋 키와 같고 장면 코드가 알고 있다', () => {
  const dialogue = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/dialogue/ch03.json'), 'utf8')) as { segments: { entries: { cameraCue?: string | null }[] }[] };
  const cues = dialogue.segments.flatMap((s) => s.entries.map((e) => e.cameraCue).filter(Boolean));
  assert.deepEqual(cues, ['memory-glove', 'memory-blanket', 'memory-doll']);
  const scene = readFileSync(here('../src/scenes/OpeningScene.ts'), 'utf8');
  assert.match(scene, /MEMORY_GLIMPSE_KEYS = \['memory-glove', 'memory-blanket', 'memory-doll'\]/);
});
