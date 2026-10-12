// 10-12 v1 §2: 배치 사전 검수 도구(scripts/layout-qa.mjs) — 좌표 계산·규칙·결정성·CLI 종료 코드
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 순수 JS 모듈(타입 선언 없음)
import { area, evaluate, intersectArea, normalizePath, offscreenOf, pngSize, rectGap, toViewport, worldRect, worldViewOf } from '../scripts/layout-qa.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/layout-qa.mjs', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../layout-qa/specs/forest-hidden-path.json', import.meta.url));

function pngHeader(w: number, h: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const baseSpec = (): any => ({
  name: 't', world: { width: 3200, height: 2400 }, logical: { width: 1280, height: 720 }, camera: { center: { x: 1000, y: 1000 } },
  viewports: [{ id: 'a', width: 1280, height: 720 }, { id: 'b', width: 640, height: 360 }],
  targets: [], hud: [], rules: {},
});

test('좌표 계산: pivot 반영 → 논리 화면(카메라 worldView) → 실제 viewport 배율', () => {
  const spec = baseSpec();
  const view = worldViewOf(spec);
  assert.deepEqual([view.x, view.y], [360, 640], '카메라 중심 − 논리 화면/2');
  const rc = worldRect({ x: 1000, y: 1000, width: 100, height: 60, pivot: [0.5, 0.9] });
  assert.deepEqual(rc, { l: 950, t: 946, r: 1050, b: 1006 });
  const a = toViewport(rc, view, spec, spec.viewports[0]);
  const b = toViewport(rc, view, spec, spec.viewports[1]);
  assert.deepEqual([a.l, a.t, a.r, a.b], [590, 306, 690, 366]);
  assert.deepEqual([b.l, b.t, b.r, b.b], [295, 153, 345, 183], '640×360은 절반 배율');
});

test('카메라는 월드 경계 안으로 고정되고, worldView 직접 지정도 받는다', () => {
  const s = baseSpec();
  s.camera = { center: { x: 10, y: 10 } };
  assert.deepEqual([worldViewOf(s).x, worldViewOf(s).y], [0, 0]);
  s.camera = { center: { x: 3190, y: 2390 } };
  assert.deepEqual([worldViewOf(s).x, worldViewOf(s).y], [1920, 1680]);
  s.camera = { worldView: { x: 500, y: 600 } };
  assert.deepEqual([worldViewOf(s).x, worldViewOf(s).y], [500, 600]);
});

test('화면 밖 구분: 전부 안 none / 일부 밖 partial / 전부 밖 full, 교차·간격 면적', () => {
  const vp = { width: 1280, height: 720 };
  assert.equal(offscreenOf({ l: 10, t: 10, r: 50, b: 50 }, vp), 'none');
  assert.equal(offscreenOf({ l: 1250, t: 10, r: 1300, b: 50 }, vp), 'partial');
  assert.equal(offscreenOf({ l: 1300, t: 10, r: 1400, b: 50 }, vp), 'full');
  assert.equal(intersectArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 5, t: 5, r: 20, b: 20 }), 25);
  assert.equal(area({ l: 0, t: 0, r: 10, b: 5 }), 50);
  assert.equal(rectGap({ l: 0, t: 0, r: 10, b: 10 }, { l: 0, t: 30, r: 10, b: 40 }), 20);
  assert.equal(rectGap({ l: 0, t: 0, r: 10, b: 10 }, { l: 5, t: 5, r: 20, b: 20 }), 0);
  assert.equal(rectGap({ l: 0, t: 0, r: 10, b: 10 }, { l: 13, t: 14, r: 20, b: 20 }), 5);
});

test('규칙: 교차·HUD 교차·최소 간격·허용 범위·깊이·원본 비율 — 통과와 실패가 규칙별로 기록된다', () => {
  const s = baseSpec();
  s.targets = [
    { id: 'a', image: 'a.png', x: 1000, y: 1000, width: 200, height: 100, depth: -10, range: { x: [990, 1010], width: [150, 160] } },
    { id: 'b', image: 'b.png', x: 1100, y: 1000, width: 100, height: 100, depth: -20 },
  ];
  s.hud = [{ id: 'h', rect: { x: 600, y: 300, width: 100, height: 100 } }];
  s.rules = { mustNotOverlap: [['a', 'b']], hudAvoid: [{ targets: ['a'], hud: 'all' }], minGap: [{ a: 'a', b: 'h', min: 1 }], depthOrder: [['a', 'b']] };
  const img = (p: string) => pngHeader(p.endsWith('a.png') ? 200 : 100, 100);
  const res = evaluate(s, '/x', img, () => true);
  const by = (type: string, vp: string) => res.rules.filter((r: any) => r.type === type && r.viewport === vp);
  assert.equal(by('mustNotOverlap', 'a')[0].pass, false, '겹침');
  assert.equal(by('hudAvoid', 'a')[0].pass, false, 'a 화면 (640,310)~(840,390)가 HUD (600,300)~(700,400)와 겹침');
  assert.equal(by('minGap', 'a')[0].pass, false);
  assert.equal(by('depthOrder', 'all')[0].pass, false, 'a(-10) > b(-20)');
  assert.deepEqual(by('range', 'all').map((r: any) => r.pass), [true, false], 'x 통과·width(200) 실패');
  assert.deepEqual(by('aspect', 'all').map((r: any) => r.pass), [true, true]);
  s.targets[0].height = 150;
  const res2 = evaluate(s, '/x', img, () => true);
  assert.equal(res2.rules.find((r: any) => r.type === 'aspect' && r.id === 'a').pass, false, '원본 비율과 달라짐');
});

test('화면 밖 대상은 교차 없음의 근거로 쓰지 않는다(완전히 밖이면 실패)', () => {
  const s = baseSpec();
  s.targets = [{ id: 'far', x: 3000, y: 2300, width: 50, height: 50 }, { id: 'near', x: 1000, y: 1000, width: 20, height: 20 }];
  s.hud = [{ id: 'h', rect: { x: 0, y: 0, width: 50, height: 50 } }];
  s.rules = { mustNotOverlap: [['far', 'near']], hudAvoid: [{ targets: ['far'], hud: 'all' }], onscreen: ['far', 'near'] };
  const res = evaluate(s, '/x', undefined, () => true);
  const far = res.viewports[0].targets.find((t: any) => t.id === 'far');
  assert.equal(far.offscreen, 'full');
  for (const r of res.rules.filter((x: any) => x.viewport === 'a')) {
    if (r.type === 'onscreen' && r.id === 'near') assert.equal(r.pass, true);
    else assert.equal(r.pass, false, `${r.type} ${r.id}`);
  }
});

test('Windows·POSIX 경로 구분자 모두 처리', () => {
  assert.equal(normalizePath('..\\src\\assets\\a.png'), '../src/assets/a.png');
  assert.equal(normalizePath('../src/assets/a.png'), '../src/assets/a.png');
  assert.deepEqual(pngSize(pngHeader(12, 34)), { width: 12, height: 34 });
});

test('CLI: 예시 spec(숲 잠금 입구 v6)은 전부 통과하고 종료 코드 0, 같은 입력이면 출력 바이트가 같다', () => {
  const out = mkdtempSync(join(tmpdir(), 'lqa-'));
  const r1 = spawnSync(process.execPath, [SCRIPT, EXAMPLE, '--out', out], { encoding: 'utf8' });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /규칙 28개 · 통과 28 · 실패 0/);
  assert.deepEqual(readdirSync(out).sort(), ['1280x720.qa.svg', '1280x720.svg', '640x360.qa.svg', '640x360.svg', 'qa.json']);
  const first = Object.fromEntries(readdirSync(out).map((f) => [f, readFileSync(join(out, f))]));
  const r2 = spawnSync(process.execPath, [SCRIPT, EXAMPLE, '--out', out], { encoding: 'utf8' });
  assert.equal(r2.status, 0);
  for (const f of Object.keys(first)) assert.ok(first[f].equals(readFileSync(join(out, f))), `${f} 바이트 동일`);
  const qa = JSON.parse(first['qa.json'].toString('utf8'));
  assert.equal(qa.summary.fail, 0);
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(qa)), false, '생성 시각이 들어 있지 않다');
  assert.match(first['640x360.svg'].toString('utf8'), /<image href="[^"]*forest-base\.png"/);
  assert.match(first['640x360.qa.svg'].toString('utf8'), /stroke="#43a047"/, '정상은 초록');
});

test('CLI: 규칙 실패는 빨간 경계로 표시하고 종료 코드 1, spec 오류는 종료 코드 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lqa-fail-'));
  const spec = baseSpec();
  spec.targets = [{ id: 'a', x: 1000, y: 1000, width: 100, height: 100 }, { id: 'b', x: 1010, y: 1000, width: 100, height: 100 }];
  spec.rules = { mustNotOverlap: [['a', 'b']] };
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec));
  const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'spec.json'), '--out', join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /mustNotOverlap a×b/);
  assert.match(readFileSync(join(dir, 'out', 'a.qa.svg'), 'utf8'), /stroke="#e53935"/, '실패는 빨강');
  mkdirSync(join(dir, 'bad'));
  writeFileSync(join(dir, 'bad', 'spec.json'), '{"name":"x"}');
  const bad = spawnSync(process.execPath, [SCRIPT, join(dir, 'bad', 'spec.json')], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
