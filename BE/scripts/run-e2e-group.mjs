// E2E 그룹 실행기(10-12 v1 §3) — manifest(test/e2e/groups.json)의 파일 목록만 한 번에 실행한다. Node 표준 라이브러리만 쓴다.
// 사용: node scripts/run-e2e-group.mjs <그룹> [--manifest <경로>] [--e2e-dir <폴더>] [--dry-run]
// - 등록되지 않은 그룹·존재하지 않는 파일은 실행 전에 실패(종료 코드 2)
// - wildcard 없이 파일명을 명시해 넘긴다. 공유 DB·포트 조건 때문에 --test-concurrency=1 고정
// - 하위 프로세스의 종료 코드를 그대로 반환한다
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_E2E_DIR, assertFiles, hhmmss, readJson, runNodeTest, summaryLine } from './e2e-common.mjs';

export function resolveGroup(name, manifestPath, e2eDir) {
  const manifest = readJson(manifestPath);
  const groups = manifest.groups ?? {};
  if (!name || !Object.prototype.hasOwnProperty.call(groups, name)) {
    throw new Error(`등록되지 않은 그룹: "${name ?? ''}" (등록된 그룹: ${Object.keys(groups).join(', ')})`);
  }
  const files = groups[name].files ?? [];
  assertFiles(`그룹 "${name}"`, files, e2eDir);
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
  console.log(`시작: ${hhmmss()}`);
  return runNodeTest({
    files: g.paths,
    onLine: (l) => process.stdout.write(`${l}
`),
    onStderr: (d) => process.stderr.write(d),
  }).then((r) => {
    console.log(`
${summaryLine(`e2e-group[${g.name}]`, g.files.length, r)}`);
    return r.exit;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
