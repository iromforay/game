// 10-06 v7 §1: 숲 에셋 자동 검수기 — 임시 폴더의 PNG fixture로 성공·실패 조건을 검증한다(실제 에셋 파일을 요구하지 않고, 제품 에셋 폴더에는 아무것도 쓰지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { crc32, deflateSync } from 'node:zlib';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 순수 JS 모듈(타입 선언 없음)
import { decodePng, DEFAULT_FOREST_JSON, FOREST_ASSETS, formatReport, verifyForestAssets } from '../scripts/forest-assets.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/verify-forest-assets.mjs', import.meta.url));
type Px = [number, number, number, number];

// ---------- 작은 PNG 인코더(시험용) ----------
function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
// rgba: 4채널 8비트 / rgb: 3채널(알파 없음) / palette: 팔레트 + tRNS(투명 색 0번)
function png(width: number, height: number, opts: { mode?: 'rgba' | 'rgb' | 'palette'; fill?: Px; edits?: [number, number, Px][] } = {}) {
  const mode = opts.mode ?? 'rgba';
  const fill = opts.fill ?? [90, 140, 80, 255];
  const channels = mode === 'rgba' ? 4 : mode === 'rgb' ? 3 : 1;
  const rowBytes = width * channels;
  const pixels = Buffer.alloc(height * rowBytes);
  if (mode === 'palette') pixels.fill(fill[3] === 0 ? 0 : 1);
  else for (let i = 0; i < pixels.length; i += channels) for (let c = 0; c < channels; c++) pixels[i + c] = fill[c];
  for (const [x, y, v] of opts.edits ?? []) {
    const at = y * rowBytes + x * channels;
    if (mode === 'palette') pixels[at] = v[3] === 0 ? 0 : 1;
    else for (let c = 0; c < channels; c++) pixels[at + c] = v[c];
  }
  const raw = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes); // 필터 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = mode === 'rgba' ? 6 : mode === 'rgb' ? 2 : 3;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (mode === 'palette') {
    parts.push(chunk('PLTE', Buffer.from([0, 0, 0, 200, 100, 50])), chunk('tRNS', Buffer.from([0])));
  }
  parts.push(chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const TMP: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'forest-assets-'));
  TMP.push(dir);
  return dir;
}
process.on('exit', () => TMP.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Spec = { path: string; width: number; height: number; kind: 'opaque' | 'alpha' };
// 실제 규격 그대로 12개를 만든다. over로 파일 하나를 다른 PNG로 바꾸거나(문자열 경로 → Buffer) 빼 둘 수 있다
function build(dir: string, over: Record<string, Buffer | null> = {}) {
  for (const s of FOREST_ASSETS as Spec[]) {
    const file = join(dir, s.path);
    mkdirSync(dirname(file), { recursive: true });
    if (s.path in over) {
      if (over[s.path]) writeFileSync(file, over[s.path]!);
      continue;
    }
    writeFileSync(file, s.kind === 'opaque' ? png(s.width, s.height) : png(s.width, s.height, { fill: [0, 0, 0, 0], edits: [[Math.floor(s.width / 2), Math.floor(s.height / 2), [255, 220, 120, 255]]] }));
  }
}
const run = (dir: string, extra: string[] = []) => spawnSync(process.execPath, [SCRIPT, '--assets', dir, ...extra], { encoding: 'utf8' });
const snapshot = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${join(e.parentPath, e.name)}:${statSync(join(e.parentPath, e.name)).size}:${statSync(join(e.parentPath, e.name)).mtimeMs}`).sort();
const fail = (dir: string, over: Record<string, Buffer | null>) => {
  build(dir, over);
  return verifyForestAssets({ assetsDir: dir });
};
const lines = (r: { checks: { ok: boolean; file: string; check: string; expected?: string; actual?: string }[] }) => r.checks.filter((c) => !c.ok).map((c) => `${c.file}|${c.check}|${c.expected}|${c.actual}`);

test('모두 규격대로면 통과: 종료 코드 0, 12개 파일의 크기와 검수 결과 요약, 아무것도 쓰지 않는다(읽기 전용)', () => {
  const dir = workspace();
  build(dir);
  const before = snapshot(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /숲 에셋 12개 검수 통과/);
  for (const s of FOREST_ASSETS as Spec[]) assert.ok(r.stdout.includes(`${s.path} — ${s.width}×${s.height}`), `${s.path} 요약`);
  assert.deepEqual(snapshot(dir), before, '파일을 만들거나 바꾸지 않았다');
  assert.equal(readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.png')).length, 12);
});

test('에셋이 없으면 실패(정상): 종료 코드 1, 파일명·기대값·실제값을 함께 출력한다', () => {
  const dir = workspace();
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /숲 에셋 검수 실패/);
  assert.match(r.stderr, /world\/forest\/forest-base\.png — 파일 존재: 기대 있음, 실제 없음/);
  assert.match(r.stderr, /items\/story\/glowing-yarn-dust\.png — 파일 존재: 기대 있음, 실제 없음/);
  assert.equal(r.stdout, '');
});

test('PNG가 아니거나 크기가 다르면 파일명·기대값·실제값을 알려 준다', () => {
  const dir = workspace();
  const r = fail(dir, {
    'items/story/glowing-yarn-dust.png': png(100, 96, { fill: [0, 0, 0, 0] }),
    'world/forest/dust-wind-closed.png': Buffer.from('not a png at all'),
    'world/forest/props/cut-yarn-strand.png': png(768, 300, { fill: [0, 0, 0, 0] }),
  });
  const f = lines(r);
  assert.ok(f.includes('items/story/glowing-yarn-dust.png|가로×세로|96×96|100×96'));
  assert.ok(f.includes('world/forest/props/cut-yarn-strand.png|가로×세로|768×320|768×300'));
  assert.ok(f.some((x) => x.startsWith('world/forest/dust-wind-closed.png|PNG 서명·헤더|올바른 PNG|PNG 서명이 아니다')));
  assert.equal(r.ok, false);
  const cli = run(dir);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /items\/story\/glowing-yarn-dust\.png — 가로×세로: 기대 96×96, 실제 100×96/);
});

test('투명 PNG: 알파 채널이 없거나 모서리가 불투명하면 실패, 팔레트+tRNS 투명도는 알파로 인정한다', () => {
  const dir = workspace();
  const r = fail(dir, {
    'world/forest/hidden-path-reveal.png': png(960, 560, { mode: 'rgb' }), // 알파 채널 없음
    'world/forest/root-gate-closed.png': png(480, 520, { fill: [0, 0, 0, 0], edits: [[0, 519, [10, 10, 10, 255]]] }), // 왼쪽 아래 모서리 불투명
    'world/forest/root-gate-open.png': png(480, 520, { mode: 'palette', fill: [0, 0, 0, 0] }), // tRNS 알파 — 통과해야 한다
  });
  const f = lines(r);
  assert.ok(f.some((x) => x.startsWith('world/forest/hidden-path-reveal.png|알파 채널|있음|없음')));
  assert.ok(f.some((x) => x.startsWith('world/forest/root-gate-closed.png|네 모서리 투명|네 모서리 알파 8 이하(육안으로 투명)|(0,519)α=255')));
  assert.ok(!f.some((x) => x.startsWith('world/forest/root-gate-open.png')), '팔레트 tRNS는 알파로 인정');
  assert.equal(decodePng(png(4, 4, { mode: 'palette', fill: [0, 0, 0, 0] })).hasAlpha, true);
  assert.equal(decodePng(png(4, 4, { mode: 'rgb' })).hasAlpha, false);
});

test('forest-base: 가장자리·주요 이동 영역의 완전 투명 픽셀과 반투명을 잡아낸다', () => {
  const dir = workspace();
  // 가장자리(오른쪽 위 모서리) + 시작 지점(길 위)에 구멍, 그리고 이동 영역 밖에는 반투명 한 점
  const spawn = JSON.parse(readFileSync(DEFAULT_FOREST_JSON, 'utf8')).spawnPoint as { x: number; y: number };
  const r = fail(dir, { 'world/forest/forest-base.png': png(3200, 2400, { edits: [[3199, 0, [0, 0, 0, 0]], [spawn.x, spawn.y, [0, 0, 0, 0]], [20, 20, [90, 140, 80, 128]]] }) });
  const f = lines(r);
  assert.ok(f.some((x) => x.startsWith('world/forest/forest-base.png|가장자리 완전 투명 픽셀 없음|0개|1개, 처음 (3199,0)')), f.join('\n'));
  assert.ok(f.some((x) => x.startsWith('world/forest/forest-base.png|주요 이동 영역 완전 투명 픽셀 없음|0개|') && x.includes(`(${spawn.x},${spawn.y})`)));
  assert.ok(f.some((x) => x.startsWith('world/forest/forest-base.png|전체 불투명|알파 255만|') && x.includes('3개 반투명·투명')));
  // 알파 채널이 없는 RGB 배경은 불투명으로 통과
  const ok = verifyForestAssets({ assetsDir: dir, spec: (FOREST_ASSETS as Spec[]).filter((s) => s.path === 'world/forest/forest-base.png') });
  assert.ok(ok.checks.some((c) => c.check === '전체 불투명' && !c.ok));
  const dir2 = workspace();
  build(dir2, { 'world/forest/forest-base.png': png(3200, 2400, { mode: 'rgb' }) });
  assert.equal(verifyForestAssets({ assetsDir: dir2 }).ok, true);
});

test('닫힘/열림 문의 캔버스 크기가 다르면 두 크기를 함께 알려 준다', () => {
  const dir = workspace();
  const r = fail(dir, { 'world/forest/root-gate-open.png': png(480, 500, { fill: [0, 0, 0, 0] }) });
  const f = lines(r);
  assert.ok(f.includes('world/forest/root-gate-closed.png ↔ world/forest/root-gate-open.png|닫힘/열림 캔버스 크기 같음|480×520|480×500'));
  assert.ok(f.includes('world/forest/root-gate-open.png|가로×세로|480×520|480×500'));
});

test('파일명으로 계산되는 assetKey가 forest.json과 일치해야 한다 — 어긋나거나 파일명이 중복되면 실패', () => {
  const dir = workspace();
  build(dir);
  const forest = JSON.parse(readFileSync(DEFAULT_FOREST_JSON, 'utf8'));
  // forest.json이 다른 키를 가리킨다
  forest.render.overlays.find((o: { assetKey: string }) => o.assetKey === 'hidden-path-reveal').assetKey = 'hidden-path-revealed';
  forest.storyPoints[0].assetKey = 'placeholder-point'; // 임시 키는 검수 대상이 아니다
  const wrong = join(workspace(), 'forest.json');
  writeFileSync(wrong, JSON.stringify(forest));
  const r = verifyForestAssets({ assetsDir: dir, forestJsonPath: wrong });
  const f = lines(r);
  assert.ok(f.includes('hidden-path-reveal.png|forest.json에 assetKey 있음|forest.json의 assetKey "hidden-path-reveal"|없음'));
  assert.ok(f.includes('forest.json|assetKey "hidden-path-revealed"의 검수 대상 파일|hidden-path-revealed.png|검수 목록에 없음'));
  // 다른 폴더에 같은 파일명이 있으면 로더가 덮어쓴다
  mkdirSync(join(dir, 'ui'), { recursive: true });
  writeFileSync(join(dir, 'ui', 'dansuring.png'), png(8, 8));
  const dup = lines(verifyForestAssets({ assetsDir: dir }));
  assert.ok(dup.some((x) => x.startsWith('world/forest/npcs/dansuring.png|같은 파일명(assetKey) 중복 없음|한 파일|') && x.includes('ui/dansuring.png')));
  // forest.json을 읽지 못하면 그것도 실패로 보고한다
  const missing = lines(verifyForestAssets({ assetsDir: dir, forestJsonPath: join(dir, 'nope.json') }));
  assert.ok(missing.some((x) => x.startsWith('forest.json|지역 데이터 읽기|')));
});

test('현재 forest.json의 최종 에셋 키가 정확히 검수 대상 12개와 같다(런타임 키 = 파일명)', () => {
  const dir = workspace();
  build(dir);
  const r = verifyForestAssets({ assetsDir: dir });
  assert.equal(r.ok, true, formatReport(r));
  assert.equal(r.checks.filter((c) => c.check === 'forest.json에 assetKey 있음').length, 12);
  assert.equal(r.checks.filter((c) => c.file === 'forest.json').length > 0 && r.checks.filter((c) => c.file === 'forest.json').every((c) => c.ok), true, 'forest.json의 키는 전부 검수 목록에 있다');
});

test('npm 명령 verify:forest-assets가 등록돼 있고, 제품 에셋 폴더에는 시험 fixture가 남지 않는다', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.scripts['verify:forest-assets'], 'node scripts/verify-forest-assets.mjs');
  const assets = fileURLToPath(new URL('../src/assets', import.meta.url));
  const names = readdirSync(assets, { recursive: true }).map(String);
  // 최종 에셋이 들어온 뒤에는 숲 폴더에 검수 목록의 파일만 있어야 한다(시험 fixture·중간 파일 -v1/-v2가 섞이지 않는다)
  const norm = (n: string) => n.replace(/\\/g, '/');
  const known = new Set((FOREST_ASSETS as Spec[]).map((x) => x.path));
  const strays = names.map(norm).filter((n) => n.startsWith('world/forest/') && /\.[a-z0-9]+$/i.test(n) && !known.has(n));
  assert.deepEqual(strays, [], '숲 폴더에 검수 목록 밖의 파일이 있다');
  void cpSync;
});
