// 10-26 F-2: 종장 1차 에셋 연결 — 파일·키(파일명)·크기·알파·해시(Codex manifest, codex/turby-final-assets 9e64b65), 지도·대화 배경·연출 키가 지역 데이터·대화와 맞는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// [키, 런타임 경로, 너비, 높이, 투명, SHA-256]
const ASSETS: [string, string, number, number, boolean, string][] = [
  ['home-core-base', 'world/home-core', 3200, 2400, false, 'BA01174323766770468F40AF0F0E44CAEBF327C47E6F41986231D2119A934820'],
  ['core-gap', 'world/home-core', 1280, 480, true, 'D82EA86E319DF9B6AC3E743848E3380EA4E8C2DE8A20724029BEA998DF937DE9'],
  ['final-dialogue-bg', 'world/home-core', 1280, 720, false, '001638C012E2F68D7B9A7E2C42C9006D189C84AD17A81EA82DEF2513270E9164'],
  ['nubi-origin', 'sprites/story', 512, 512, true, 'E7C8254D0BDF5A06BF6FD0102669294061201C45797DC573834A042D1681CAF3'],
  ['five-bind', 'fx/story', 768, 768, true, '06D601B2B0FB18F4C41B419E26B2302DEBA21D800849D320FE09CEB4779EFDD1'],
  ['origin-fall', 'fx/story', 768, 768, true, '87562A2CBEAAA3962528FF684204900F7B6569D7F7293EFD3092F15CD27D51D2'],
];

test('종장 1차 에셋 6종: 파일·키(파일명)·크기·투명·해시가 Codex manifest와 같다', () => {
  for (const [key, dir, w, h, alpha, hash] of ASSETS) {
    const file = here(`../src/assets/${dir}/${key}.png`);
    assert.ok(existsSync(file), `${key} 파일`);
    const bytes = readFileSync(file);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    assert.equal(bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS')), alpha, `${key} 투명`);
  }
});

test('연결: 지도 배경·검은 틈 오버레이·대화 배경·결속/그날의 기억 연출 키가 지역 데이터·화면·대화와 맞는다', () => {
  const D = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/home_core.json'), 'utf8')) as {
    greybox: boolean;
    render: { background: { assetKey: string }; overlays: { id: string; assetKey: string; x: number; y: number; width: number; height: number }[] };
  };
  assert.deepEqual([D.greybox, D.render.background.assetKey], [false, 'home-core-base']);
  const gap = D.render.overlays.find((o) => o.id === 'overlay_core_gap')!;
  assert.deepEqual([gap.assetKey, gap.x, gap.y, gap.width, gap.height], ['core-gap', 1280, 890, 640, 240], '지시서 계약: 640×240, 왼쪽 위 (1280, 890)');
  const opening = readFileSync(here('../src/scenes/OpeningScene.ts'), 'utf8');
  assert.match(opening, /home_core: \{ key: 'final-dialogue-bg', alpha: 0\.8 \}/);
  const final = readFileSync(here('../../BE/story-data/save-a-turby/dialogue/final.json'), 'utf8');
  for (const cue of ['five-bind', 'origin-fall']) assert.ok(final.includes(`"cameraCue": "${cue}"`) && opening.includes(`'${cue}'`), `${cue} 연출`);
  // 정체 공개 뒤에만 보이는 그림(origin-fall)은 결속 구간 안에만 있다
  const bind = (JSON.parse(final) as { segments: { segmentId: string; entries: { cameraCue?: string | null }[] }[] }).segments.find((s) => s.segmentId === 'final.bind')!;
  assert.ok(bind.entries.some((e) => e.cameraCue === 'origin-fall'));
});
