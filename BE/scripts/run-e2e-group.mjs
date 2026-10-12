// E2E 그룹 실행기(10-12 v1 §3) — manifest(test/e2e/groups.json)의 파일 목록만 한 번에 실행한다. Node 표준 라이브러리만 쓴다.
// 사용: node scripts/run-e2e-group.mjs <그룹> [--manifest <경로>] [--e2e-dir <폴더>] [--dry-run]
// - 등록되지 않은 그룹·존재하지 않는 파일은 실행 전에 실패(종료 코드 2)
// - wildcard 없이 파일명을 명시해 넘긴다. 공유 DB·포트 조건 때문에 --test-concurrency=1 고정
// - 하위 프로세스의 종료 코드를 그대로 반환한다
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BE_ROOT = resolve(here, '..');
const DEFAULT_E2E_DIR = join(BE_ROOT, 'test', 'e2e');

export function resolveGroup(name, manifestPath, e2eDir) {
  if (!existsSync(manifestPath)) throw new Error(`manifest가 없다: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const groups = manifest.groups ?? {};
  if (!name || !Object.prototype.hasOwnProperty.call(groups, name)) {
    throw new Error(`등록되지 않은 그룹: "${name ?? ''}" (등록된 그룹: ${Object.keys(groups).join(', ')})`);
  }
  const files = groups[name].files ?? [];
  if (!Array.isArray(files) || files.length === 0) throw new Error(`그룹 "${name}"에 파일이 없다`);
  const missing = files.filter((f) => /[*?]/.test(f) || !existsSync(join(e2eDir, f)));
  if (missing.length) throw new Error(`manifest의 파일이 없거나 wildcard다: ${missing.join(', ')}`);
  return { name, purpose: groups[name].purpose ?? '', files, paths: files.map((f) => join(e2eDir, f)) };
}

function parse(argv) {
  const out = { group: undefined, manifest: join(DEFAULT_E2E_DIR, 'groups.json'), e2eDir: DEFAULT_E2E_DIR, dryRun: false };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--manifest') out.manifest = resolve(a[++i]);
    else if (a[i] === '--e2e-dir') out.e2eDir = resolve(a[++i]);
    else if (a[i] === '--dry-run') out.dryRun = true;
    else if (!a[i].startsWith('--') && out.group === undefined) out.group = a[i];
  }
  return out;
}

function main(argv) {
  const opts = parse(argv);
  let g;
  try {
    g = resolveGroup(opts.group, opts.manifest, opts.e2eDir);
  } catch (e) {
    console.error(`e2e-group: ${e instanceof Error ? e.message : e}`);
    return Promise.resolve(2);
  }
  console.log(`e2e-group[${g.name}] ${g.purpose}`);
  console.log(`파일 ${g.files.length}개: ${g.files.join(', ')}`);
  if (opts.dryRun) return Promise.resolve(0);
  const started = Date.now();
  console.log(`시작: ${new Date(started).toTimeString().slice(0, 8)}`);
  const args = ['--no-warnings', '--test', '--test-concurrency=1', '-r', 'ts-node/register/transpile-only', ...g.paths];
  return new Promise((resolveExit) => {
    // 다른 node --test 안에서 불려도(시험·CI) 독립된 러너로 돌도록 상위 러너의 컨텍스트 변수를 넘기지 않는다
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { cwd: BE_ROOT, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (d) => { text += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', (code, signal) => {
      const n = (k) => Number((text.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? 0);
      const exit = code ?? (signal ? 1 : 0);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\ne2e-group[${g.name}] 종료: ${new Date().toTimeString().slice(0, 8)} · 파일 ${g.files.length} · 테스트 ${n('tests')} · 성공 ${n('pass')} · 실패 ${n('fail')} · ${secs}초 · 종료 코드 ${exit}`);
      resolveExit(exit);
    });
    child.on('error', (e) => { console.error(`e2e-group: 실행 실패 ${e.message}`); resolveExit(1); });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
