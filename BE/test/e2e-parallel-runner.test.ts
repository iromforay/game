// 10-12 v6: E2E 병렬 shard manifest와 실행기(scripts/run-e2e-parallel.mjs) — 누락·중복·집계·환경 분리·종료 코드
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BE = join(__dirname, '..');
const SCRIPT = join(BE, 'scripts', 'run-e2e-parallel.mjs');
const E2E_DIR = join(BE, 'test', 'e2e');
const MANIFEST = join(E2E_DIR, 'shards.json');
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: BE });
const real = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { shards: Record<string, { files: string[]; expectedTests: number; estimatedSeconds: number }> };
const testCount = (f: string) => (readFileSync(join(E2E_DIR, f), 'utf8').match(/^test\(/gm) ?? []).length;

test('실제 manifest: shard 정확히 2개, 모든(23개) 파일이 정확히 한 shard에만(누락 0·중복 0·wildcard 0)', () => {
  assert.deepEqual(Object.keys(real.shards).sort(), ['1', '2']);
  const all = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts')).sort();
  const listed = Object.values(real.shards).flatMap((s) => s.files);
  assert.equal(all.length, 23); // 10-13~14: lake.e2e.ts, lake-maze.e2e.ts, lake-rescue.e2e.ts, lake-crisis.e2e.ts, lake-boss-combat.e2e.ts, lake-boss-reward.e2e.ts 추가
  assert.equal(new Set(listed).size, listed.length, '중복 없음');
  assert.deepEqual([...listed].sort(), all, '누락 없음');
  assert.equal(listed.some((f) => /[*?]/.test(f)), false);
});

test('실제 manifest: 예상 시험 수 = 파일의 test() 선언 수, 합계 84, 예상 시간 균형(차이 10% 이내)', () => {
  let total = 0;
  for (const [id, s] of Object.entries(real.shards)) {
    const n = s.files.reduce((a, f) => a + testCount(f), 0);
    assert.equal(s.expectedTests, n, `shard ${id}`);
    total += n;
  }
  assert.equal(total, 84); // 기존 68 + 2장 호수 2개(C2-1) + 물풀 미로 3개(C2-2) + 구조 4개(C2-3) + 위기 3개(C2-4) + 보스 2개(C2-5A) + 보상 2개(C2-5B)
  const [a, b] = Object.values(real.shards).map((s) => s.estimatedSeconds);
  assert.ok(Math.abs(a - b) / Math.max(a, b) <= 0.1, `예상 시간 ${a}초 vs ${b}초`);
});

test('--dry-run: 파일 23개·누락 0·중복 0을 출력하고 아무것도 실행하지 않는다', () => {
  const r = run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /shard 2개 · 파일 23개\(누락 0·중복 0\) · 예상 시험 84개/);
  assert.match(r.stdout, /shard 1: 파일 11개 · 시험 40개/);
  assert.match(r.stdout, /shard 2: 파일 12개 · 시험 44개/);
});

test('--workers는 2만 허용한다(1·3·8은 실행 전 종료 코드 2)', () => {
  for (const w of ['1', '3', '8']) {
    const r = run('--dry-run', '--workers', w);
    assert.equal(r.status, 2, `workers ${w}`);
    assert.match(r.stderr, /--workers는 2만 허용/);
  }
});

const man = (dir: string, shards: unknown) => {
  const p = join(dir, 'shards.json');
  writeFileSync(p, JSON.stringify({ shards }));
  return p;
};
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `e2ep-${name}-`));

test('검증 실패는 실행 전에 종료 코드 2: 누락·중복·wildcard·shard 수·예상 시험 수 불일치', () => {
  const dir = tmp('v');
  writeFileSync(join(dir, 'a.e2e.ts'), "import { test } from 'node:test';\ntest('a', () => {});\n");
  writeFileSync(join(dir, 'b.e2e.ts'), "import { test } from 'node:test';\ntest('b', () => {});\n");
  const check = (shards: unknown, re: RegExp) => {
    const r = run('--dry-run', '--manifest', man(dir, shards), '--e2e-dir', dir);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, re);
  };
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: [], expectedTests: 0 } }, /파일이 없다/);
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['a.e2e.ts', 'b.e2e.ts'], expectedTests: 2 } }, /중복/);
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['c.e2e.ts'], expectedTests: 1 } }, /없거나 wildcard/);
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['*.e2e.ts'], expectedTests: 1 } }, /wildcard/);
  check({ 1: { files: ['a.e2e.ts', 'b.e2e.ts'], expectedTests: 2 } }, /shard는 정확히 2개/);
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['b.e2e.ts'], expectedTests: 1 }, 3: { files: [], expectedTests: 0 } }, /shard는 정확히 2개/);
  check({ 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['b.e2e.ts'], expectedTests: 5 } }, /expectedTests 5 ≠ 실제 test\(\) 1/);
});

test('누락: 폴더의 파일이 어느 shard에도 없으면 실행 전 종료 코드 2', () => {
  const dir = tmp('miss');
  for (const f of ['a', 'b', 'c']) writeFileSync(join(dir, `${f}.e2e.ts`), "import { test } from 'node:test';\ntest('x', () => {});\n");
  const r = run('--dry-run', '--manifest', man(dir, { 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['b.e2e.ts'], expectedTests: 1 } }), '--e2e-dir', dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /누락: c\.e2e\.ts/);
});

// 환경 분리를 시험 안에서 확인하는 가짜 E2E 파일(CommonJS, ts-node transpile-only가 처리)
const ENV_TEST = [
  "const { test } = require('node:test');",
  "const assert = require('node:assert/strict');",
  "test('shard 환경 분리', () => {",
  '  const id = process.env.E2E_SHARD_ID;',
  "  assert.ok(id, 'E2E_SHARD_ID');",
  "  assert.ok((process.env.E2E_ARTIFACT_DIR || '').endsWith('shard-' + id), 'E2E_ARTIFACT_DIR는 shard별');",
  "  assert.ok((process.env.VITE_CACHE_DIR || '').startsWith(process.env.E2E_ARTIFACT_DIR), 'VITE_CACHE_DIR는 shard 폴더 안');",
  "  assert.equal(Number(process.env.E2E_PORT_BASE), 41000 + Number(id) * 1000, '포트 범위는 shard별');",
  "  console.log('SHARD_ENV ' + id);",
  '});',
  '',
].join('\n');

test('병렬 실행: 두 shard가 동시에 시작하고 shard별 환경이 다르며 합계(2/2)를 집계해 종료 코드 0', () => {
  const dir = tmp('ok');
  writeFileSync(join(dir, 'a.e2e.ts'), ENV_TEST);
  writeFileSync(join(dir, 'b.e2e.ts'), ENV_TEST);
  const shards = { 1: { files: ['a.e2e.ts'], expectedTests: 1, estimatedSeconds: 1 }, 2: { files: ['b.e2e.ts'], expectedTests: 1, estimatedSeconds: 1 } };
  const r = run('--manifest', man(dir, shards), '--e2e-dir', dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const starts = [...r.stdout.matchAll(/\[shard (\d)\] 시작/g)].map((m) => m.index as number);
  const firstEnd = r.stdout.search(/\[shard \d\] 종료/);
  assert.equal(starts.length, 2);
  assert.ok(starts.every((i) => i < firstEnd), '두 shard 모두 어느 쪽이 끝나기 전에 시작');
  assert.match(r.stdout, /합계: 테스트 2 · pass 2 · fail 0 · 기대 2/);
  assert.match(r.stdout, /e2e-parallel: 통과 2\/2/);
  assert.match(readFileSync(join(dir, '.artifacts', 'shard-1', 'e2e.log'), 'utf8'), /SHARD_ENV 1/);
  assert.match(readFileSync(join(dir, '.artifacts', 'shard-2', 'e2e.log'), 'utf8'), /SHARD_ENV 2/);
});

test('한 shard라도 실패하면 전체 종료 코드 1이고, 실패한 시험을 자동 재실행하지 않는다', () => {
  const dir = tmp('bad');
  const counter = join(dir, 'runs.txt');
  writeFileSync(join(dir, 'a.e2e.ts'), ENV_TEST);
  writeFileSync(
    join(dir, 'b.e2e.ts'),
    ["const { test } = require('node:test');", `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');`, "test('boom', () => { throw new Error('x'); });", ''].join('\n'),
  );
  const shards = { 1: { files: ['a.e2e.ts'], expectedTests: 1 }, 2: { files: ['b.e2e.ts'], expectedTests: 1 } };
  const r = run('--manifest', man(dir, shards), '--e2e-dir', dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /합계: 테스트 2 · pass 1 · fail 1 · 기대 2/);
  assert.match(r.stdout, /집계 불일치: 1\/2/);
  assert.match(r.stdout, /e2e-parallel: 실패/);
  assert.equal(readFileSync(counter, 'utf8'), 'x', '파일은 한 번만 실행(자동 재실행 없음)');
});
