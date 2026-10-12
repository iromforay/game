// 10-12 v1 §3: E2E 그룹 실행기(scripts/run-e2e-group.mjs) — manifest 검증·사전 실패·종료 코드 전달·전체 파일 포함 여부
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BE = join(__dirname, '..');
const SCRIPT = join(BE, 'scripts', 'run-e2e-group.mjs');
const E2E_DIR = join(BE, 'test', 'e2e');
const MANIFEST = join(E2E_DIR, 'groups.json');
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: BE });
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { groups: Record<string, { files: string[] }> };

test('필수 그룹 6개가 등록돼 있고, 각 파일이 실제로 존재하며 wildcard가 없다', () => {
  assert.deepEqual(Object.keys(manifest.groups).sort(), ['battle', 'inventory', 'map', 'smoke', 'story', 'visual']);
  const all = new Set(readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts')));
  for (const [name, g] of Object.entries(manifest.groups)) {
    assert.ok(g.files.length > 0, `${name}: 파일 없음`);
    for (const f of g.files) {
      assert.ok(!/[*?]/.test(f), `${name}: wildcard ${f}`);
      assert.ok(all.has(f), `${name}: 없는 파일 ${f}`);
    }
  }
});

test('모든 E2E 파일이 적어도 한 그룹에 속한다(전체 실행에서 빠지는 파일이 그룹 어디에도 없는 상태를 막는다)', () => {
  const grouped = new Set(Object.values(manifest.groups).flatMap((g) => g.files));
  const missing = readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts') && !grouped.has(f));
  assert.deepEqual(missing, [], '어느 그룹에도 없는 E2E 파일');
});

test('등록되지 않은 그룹은 실행 전에 종료 코드 2로 실패한다', () => {
  const r = run('nope');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /등록되지 않은 그룹: "nope"/);
  assert.equal(run().status, 2, '그룹 이름이 없어도 실패');
});

test('manifest에 없는 파일·wildcard가 있으면 실행 전에 종료 코드 2로 실패한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2eg-'));
  writeFileSync(join(dir, 'ok.e2e.js'), "require('node:test').test('x', () => {});\n");
  writeFileSync(join(dir, 'groups.json'), JSON.stringify({ groups: { g: { files: ['ok.e2e.js', 'ghost.e2e.js'] }, w: { files: ['*.e2e.js'] } } }));
  const a = run('g', '--manifest', join(dir, 'groups.json'), '--e2e-dir', dir);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /ghost\.e2e\.js/);
  const b = run('w', '--manifest', join(dir, 'groups.json'), '--e2e-dir', dir);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /wildcard/);
});

test('--dry-run은 그룹의 파일 목록만 출력하고 아무것도 실행하지 않는다', () => {
  const r = run('battle', '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /e2e-group\[battle\]/);
  assert.match(r.stdout, /파일 2개: wild\.e2e\.ts, wild2\.e2e\.ts/);
});

test('하위 프로세스 종료 코드를 그대로 반환하고 파일 수·테스트 수·성공·실패·시간을 출력한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2eg-run-'));
  writeFileSync(join(dir, 'pass.e2e.js'), "const t=require('node:test');t.test('a',()=>{});t.test('b',()=>{});\n");
  writeFileSync(join(dir, 'fail.e2e.js'), "require('node:test').test('boom',()=>{throw new Error('x')});\n");
  writeFileSync(join(dir, 'groups.json'), JSON.stringify({ groups: { good: { purpose: '성공', files: ['pass.e2e.js'] }, bad: { purpose: '실패', files: ['pass.e2e.js', 'fail.e2e.js'] } } }));
  const ok = run('good', '--manifest', join(dir, 'groups.json'), '--e2e-dir', dir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /파일 1 · 테스트 2 · 성공 2 · 실패 0 · [\d.]+초 · 종료 코드 0/);
  const bad = run('bad', '--manifest', join(dir, 'groups.json'), '--e2e-dir', dir);
  assert.notEqual(bad.status, 0, '하나라도 실패하면 0이 아니다');
  assert.match(bad.stdout, /파일 2 · 테스트 3 · 성공 2 · 실패 1 · [\d.]+초 · 종료 코드 [1-9]/);
});
