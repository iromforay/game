// v5 §3·§6: 통합 검증용 DB 도구는 기본 거부이고, 앱·일반 테스트·빌드에 섞이지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { refusal, targetOf } from './integration/db-tool';

const T = 'db.example:3306/game';
const ON = { TURBY_DB_TOOL: 'enable' };

test('DB 도구: 기본은 항상 거부, production 거부, 명령별 권한·확인 값 분리', () => {
  assert.match(refusal('check', {}, [], T)!, /TURBY_DB_TOOL=enable/, '환경 변수 없으면 읽기도 거부');
  assert.match(refusal('check', { ...ON, NODE_ENV: 'production' }, [], T)!, /production/);
  assert.equal(refusal('check', ON, [], T), null, '읽기는 enable만으로');
  assert.equal(refusal('inspect', ON, [], T), null);
  assert.match(refusal('drop', ON, [], T)!, /알 수 없는 명령/);
  // 픽스처·정리: 전용 권한 + 명령별 확인 값(대상 포함)
  assert.match(refusal('cleanup', ON, ['cleanup', '--confirm', `cleanup:${T}`], T)!, /TURBY_DB_TOOL_FIXTURE=allow/);
  const fx = { ...ON, TURBY_DB_TOOL_FIXTURE: 'allow' };
  assert.match(refusal('cleanup', fx, ['cleanup'], T)!, /--confirm cleanup:/);
  assert.match(refusal('cleanup', fx, ['cleanup', '--confirm', `fixture:${T}`], T)!, /확인 값/, '다른 명령의 확인 값으로는 안 됨');
  assert.match(refusal('cleanup', fx, ['cleanup', '--confirm', 'cleanup:other:3306/game'], T)!, /확인 값/, '다른 대상의 확인 값으로는 안 됨');
  assert.equal(refusal('cleanup', fx, ['cleanup', '--confirm', `cleanup:${T}`], T), null);
  // SQL 적용은 픽스처 권한으로 열리지 않는다
  assert.match(refusal('apply', fx, ['apply', 'x.sql', '--confirm', `apply:${T}`], T)!, /TURBY_DB_TOOL_SQL=allow/);
  assert.equal(refusal('apply', { ...ON, TURBY_DB_TOOL_SQL: 'allow' }, ['apply', 'x.sql', '--confirm', `apply:${T}`], T), null);
  assert.match(refusal('fixture', { ...ON, TURBY_DB_TOOL_SQL: 'allow' }, ['fixture', '--confirm', `fixture:${T}`], T)!, /TURBY_DB_TOOL_FIXTURE=allow/, 'SQL 권한으로 픽스처가 열리지 않음');
});

test('DB 도구: 연결 대상은 호스트/DB만 표시(사용자명·비밀번호 없음)', () => {
  const shown = targetOf('mysql://someuser:s3cret@db.example:3306/game?ssl=true');
  assert.equal(shown, 'db.example:3306/game');
  assert.ok(!shown.includes('s3cret') && !shown.includes('someuser'));
  assert.equal(targetOf(undefined), '(DATABASE_URL 없음)');
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('격리: 앱 소스(src)·일반 테스트·빌드·npm 스크립트가 개발 도구를 불러오지 않음', () => {
  const root = join(__dirname, '..');
  for (const f of tsFiles(join(root, 'src'))) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/from ['"][^'"]*(test\/|db-tool|\/e2e\/)/.test(src), `앱 소스가 테스트·도구를 import: ${f}`);
  }
  const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
  assert.deepEqual(tsconfig.include, ['src'], 'build(tsc)는 src만 컴파일');
  for (const f of readdirSync(join(root, 'test')).filter((n) => n.endsWith('.test.ts') && n !== 'dev-tools-isolation.test.ts')) {
    assert.ok(!readFileSync(join(root, 'test', f), 'utf8').includes('db-tool'), `일반 테스트가 DB 도구를 import: ${f}`);
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) assert.ok(!String(cmd).includes('db-tool'), `npm 스크립트 ${name}가 DB 도구를 실행`);
  // 운영 API에 픽스처·정리·SQL 경로가 없다
  for (const f of tsFiles(join(root, 'src'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\(['"]([^'"]*)['"]/g)) assert.ok(!/fixture|cleanup|seed|sql|cheat|debug/i.test(m[2]), `운영 API 경로 의심: ${m[2]} (${f})`);
  }
});
