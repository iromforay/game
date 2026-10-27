// 10-26 F-2·F-4: 종장 1·2차 에셋 연결 — 파일·키(파일명)·크기·알파·해시(Codex manifest, codex/turby-final-assets 9e64b65), 지도·대화 배경·연출 키가 지역 데이터·대화와 맞는다.
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
  // F-4 2차(최종 전투, codex/turby-final-assets 61fd1f2)
  ['scissors-open-idle', 'sprites/bosses', 1024, 256, true, 'FADA36B604EC892D693CB401D72586E0209131415B88F8DE2F7BB256F50FE0A3'],
  ['scissors-bound', 'sprites/bosses', 1024, 256, true, 'E7D2EBD31565480E3CAD0524E00F9B6BBAB02B58FA68E7C6C90E63EF8F784A49'],
  ['scissors-blade', 'sprites/enemies', 128, 128, true, '4C808BAE475FAEAB8FC16CD3481021625E58888E9C5187173DA3EA226C0DFD26'],
  ['five-memory-knot', 'sprites/enemies', 128, 128, true, 'C031BF7F81445C394B45CB18A372FC6E1F56AEA8CFB5491FA2F795D78B1BFC77'],
  ['relic-knot-first', 'sprites/enemies', 128, 128, true, 'F9F7247A56206C577CE46F35DA6BF90648E2F40CB8E9BC5D65490D38319A82C8'],
  ['relic-knot-dye', 'sprites/enemies', 128, 128, true, 'DA72FCBA9C40C101F941DA6F9E1090A45F2B6B75CD382D5FF36E2F00B09AA778'],
  ['relic-knot-cotton', 'sprites/enemies', 128, 128, true, 'D3380FA174445A06AEA1402071EEC8DDF77ABD6AAF34F423E898FD7CE5AF35C9'],
  ['relic-knot-frost', 'sprites/enemies', 128, 128, true, '68F00D91302B15161638D8CEB327F237627A6E20E5C5DC0CFF407F9D1F95951C'],
  ['relic-knot-gold', 'sprites/enemies', 128, 128, true, '7B9FF934C51E6048D75156A26CE0E6239AD948E53EA2A5607EE6F0CC9BA1BC6A'],
  ['nubi-phantom-name', 'sprites/enemies', 160, 160, true, '3E7315EE0DC457E59278B4A85C66A1DF76A6D3645295BC3811B55F1D03416F2B'],
  ['nubi-phantom-memory', 'sprites/enemies', 160, 160, true, '8A413AC13F9D373B35B7D8B55F6637804C1AA552430445602A62A71D59404B46'],
  ['nubi-phantom-fade', 'sprites/enemies', 160, 160, true, '6A64F1825BCDED7E02420D3142F6130893A8958049B40084B561D24FF4855AFD'],
  ['nubi-phantom-silence', 'sprites/enemies', 160, 160, true, 'FE2FD92AC4BF79CA1757585553C486C9DA731D37CD6D51BFB5E732BF8D92B9D5'],
  ['black-thread', 'sprites/enemies', 128, 128, true, 'D3D3C08A780EB114B70E43B3F2AB7292D5AC665483BC4182FC34482F5712EA7D'],
  ['scissors-final-reveal', 'fx/story', 1280, 720, true, '55E0C1D030BD2A9BDA8BFEC4423DB0E0827B399462BB551B88AEF6B7E5C0817D'],
  ['five-knot-bind', 'fx/story', 768, 768, true, '4B70C77EBABD8DC96D025756062765FFFADC8BB8D5292CF3577B9A3FD9FEB364'],
  ['core-joined', 'world/home-core', 1280, 480, true, '0C8F95BF0FECADD60548863AFB961B9366BD0F0A53BB0F816EEE71C30C2E59A2'],
  // F-3b 3차(엔딩, codex/turby-final-assets 950e3c2)
  ['five-unravel', 'fx/story', 768, 768, true, 'FC04AC27E16B8A657ED7585D4D8194DB73D5CE46FEC310EDC57114722CD22800'],
  ['thread-path', 'fx/story', 1280, 720, true, '8FA72E3214EF0994B8B539BA1B719C355175274AD23EF8D44D5F7EFFE2EFB743'],
  ['real-world-bg', 'world/home-core', 1280, 720, false, '64EA93A60200D08B4831F30763672C677444607CFFC4C4F38C8E33924588DD00'],
  ['real-yarn-knot', 'fx/story', 768, 768, true, '9C9AC6662B89D2FF8ABD9780FC79580BBE2A5591C5E6678EBBA6B0456CA246EF'],
  ['mother-hand', 'fx/story', 768, 768, true, 'E5D4141086381B01E180959EDD81CA4384E193A0A5325609D4CB9920F80ACC60'],
  ['title-card-bg', 'world/home-core', 1280, 720, false, '3C4E0D107932B552084EC59B1FED8169BAD6D60B1ECD84AD0A6C940AD616B184'],
];

test('종장 에셋 29종(1차 6 + 2차 17 + 3차 6): 파일·키(파일명)·크기·투명·해시가 Codex manifest와 같다', () => {
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
  assert.deepEqual([gap.assetKey, gap.x, gap.y, gap.width, gap.height], ['core-gap', 1280, 980, 640, 240], '640×240, 왼쪽 위 (1280, 980) — F-6 QA-F03: 결속 지점 바로 위로 내림');
  const joined = D.render.overlays.find((o) => o.id === 'overlay_core_joined')!;
  assert.deepEqual([joined.assetKey, joined.x, joined.y, joined.width, joined.height], ['core-joined', 1280, 980, 640, 240], '승리 뒤 같은 자리');
  const battle = readFileSync(here('../src/scenes/BattleScene.ts'), 'utf8');
  assert.match(battle, /scissors: \{ idle: 'scissors-open-idle', exposed: 'scissors-bound'/);
  for (const k of ['relic-knot-first', 'nubi-phantom-name', 'black-thread', 'scissors-blade', 'five-memory-knot']) assert.ok(battle.includes(`key: '${k}'`), `${k} 표적 그림`);
  const opening = readFileSync(here('../src/scenes/OpeningScene.ts'), 'utf8');
  assert.match(opening, /home_core: \{ key: 'final-dialogue-bg', alpha: 0\.8 \}/);
  const final = readFileSync(here('../../BE/story-data/save-a-turby/dialogue/final.json'), 'utf8');
  for (const cue of ['five-bind', 'origin-fall']) assert.ok(final.includes(`"cameraCue": "${cue}"`) && opening.includes(`'${cue}'`), `${cue} 연출`);
  // 정체 공개 뒤에만 보이는 그림(origin-fall)은 결속 구간 안에만 있다
  const bind = (JSON.parse(final) as { segments: { segmentId: string; entries: { cameraCue?: string | null }[] }[] }).segments.find((s) => s.segmentId === 'final.bind')!;
  assert.ok(bind.entries.some((e) => e.cameraCue === 'origin-fall'));
});
