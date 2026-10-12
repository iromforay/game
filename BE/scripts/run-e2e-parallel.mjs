// E2E 병렬 실행기(10-12 v6) — 17개 파일을 중복 없는 2개 shard로 나눠 동시에 실행하는 선택 명령. Node 표준 라이브러리만.
// 사용: node scripts/run-e2e-parallel.mjs [--workers 2] [--dry-run] [--manifest <경로>] [--e2e-dir <폴더>]
// - 기존 순차 `npm run test:e2e`는 그대로이고 이 명령은 선택이다(대체·삭제하지 않는다)
// - shard마다 별도 Node 프로세스, 프로세스 안은 --test-concurrency=1 유지, 자동 재실행 없음, timeout 변경 없음
// - shard마다 고유 산출물 폴더·캡처 폴더·Vite 캐시·포트 범위(E2E_SHARD_ID·E2E_ARTIFACT_DIR·E2E_CAPTURE_DIR·VITE_CACHE_DIR·E2E_PORT_BASE)
// - 종료 코드: 0 = 전체 통과 + 테스트 수가 manifest·실제 파일과 같음, 1 = 실패 또는 집계 불일치, 2 = 실행 전 검증 실패
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BE_ROOT, DEFAULT_E2E_DIR, assertFiles, hhmmss, readJson, runNodeTest, summaryLine } from './e2e-common.mjs';

export const WORKERS = 2; // 이번에는 2로 고정(허용 범위도 2)
const PORT_BASE = 41000; // shard N의 포트 범위: PORT_BASE + N*1000 ~ +999 (서로 겹치지 않는다)

// test() 선언 수를 센다(파일마다 예상 시험 수와 대조)
export function countTests(path) {
  return (readFileSync(path, 'utf8').match(/^test\(/gm) ?? []).length;
}

// manifest 검증: shard 정확히 2개, 모든 *.e2e.ts가 정확히 한 shard에만, 누락·중복·wildcard 없음, expectedTests가 실제 선언 수와 같음
export function loadShards(manifestPath, e2eDir, workers = WORKERS) {
  if (workers !== WORKERS) throw new Error(`--workers는 ${WORKERS}만 허용한다(요청 ${workers})`);
  const manifest = readJson(manifestPath);
  const ids = Object.keys(manifest.shards ?? {});
  if (ids.length !== WORKERS) throw new Error(`shard는 정확히 ${WORKERS}개여야 한다(현재 ${ids.length}개)`);
  const all = readdirSync(e2eDir).filter((f) => f.endsWith('.e2e.ts')).sort();
  const seen = new Map();
  const shards = ids.sort().map((id) => {
    const s = manifest.shards[id];
    assertFiles(`shard ${id}`, s.files, e2eDir);
    for (const f of s.files) {
      if (seen.has(f)) throw new Error(`중복: ${f}가 shard ${seen.get(f)}와 ${id}에 모두 있다`);
      seen.set(f, id);
    }
    const expected = s.files.reduce((n, f) => n + countTests(join(e2eDir, f)), 0);
    if (s.expectedTests !== expected) throw new Error(`shard ${id}: expectedTests ${s.expectedTests} ≠ 실제 test() ${expected}`);
    return { id, files: s.files, expectedTests: expected, estimatedSeconds: s.estimatedSeconds ?? null };
  });
  const missing = all.filter((f) => !seen.has(f));
  if (missing.length) throw new Error(`누락: ${missing.join(', ')}`);
  return { shards, totalFiles: all.length, totalTests: shards.reduce((n, s) => n + s.expectedTests, 0) };
}

function parse(argv) {
  const out = { workers: WORKERS, dryRun: false, manifest: join(DEFAULT_E2E_DIR, 'shards.json'), e2eDir: DEFAULT_E2E_DIR };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--workers') out.workers = Number(a[++i]);
    else if (a[i] === '--manifest') out.manifest = resolve(a[++i]);
    else if (a[i] === '--e2e-dir') out.e2eDir = resolve(a[++i]);
    else if (a[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function main(argv) {
  const opts = parse(argv);
  let plan;
  try {
    plan = loadShards(opts.manifest, opts.e2eDir, opts.workers);
  } catch (e) {
    console.error(`e2e-parallel: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  console.log(`e2e-parallel: shard ${plan.shards.length}개 · 파일 ${plan.totalFiles}개(누락 0·중복 0) · 예상 시험 ${plan.totalTests}개`);
  for (const s of plan.shards) console.log(`  shard ${s.id}: 파일 ${s.files.length}개 · 시험 ${s.expectedTests}개 · 예상 ${s.estimatedSeconds ?? '?'}초 — ${s.files.join(', ')}`);
  if (opts.dryRun) return 0;

  // shard별 고유 산출물 — 파일이 서로 덮어써지지 않게 한다
  const artifactsRoot = process.env.E2E_ARTIFACT_DIR ? resolve(process.env.E2E_ARTIFACT_DIR) : join(opts.e2eDir, '.artifacts');
  const viteBase = join(BE_ROOT, '..', 'save-a-turby', 'node_modules', '.vite');
  const started = Date.now();
  console.log(`시작: ${hhmmss()}`);
  const runs = plan.shards.map((s) => {
    const dir = join(artifactsRoot, `shard-${s.id}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const viteCache = join(dir, 'vite-cache');
    if (opts.e2eDir === DEFAULT_E2E_DIR && existsSync(viteBase)) cpSync(viteBase, viteCache, { recursive: true }); // 따뜻한 캐시로 시작(공유 캐시 동시 갱신 방지)
    const env = {
      E2E_SHARD_ID: s.id,
      E2E_ARTIFACT_DIR: dir,
      VITE_CACHE_DIR: viteCache,
      E2E_PORT_BASE: String(PORT_BASE + Number(s.id) * 1000),
    };
    if (process.env.E2E_CAPTURE_DIR) env.E2E_CAPTURE_DIR = join(resolve(process.env.E2E_CAPTURE_DIR), `shard-${s.id}`);
    const log = join(dir, 'e2e.log');
    const lines = [];
    console.log(`[shard ${s.id}] 시작 ${hhmmss()} · 파일 ${s.files.length} · 예상 시험 ${s.expectedTests}`);
    const p = runNodeTest({
      files: s.files.map((f) => join(opts.e2eDir, f)),
      env,
      onLine: (l) => {
        lines.push(l);
        if (/^not ok /.test(l)) console.log(`[shard ${s.id}] ${l}`); // 실패는 바로 보여 준다
      },
      onStderr: (d) => lines.push(d),
    }).then((r) => {
      writeFileSync(log, lines.join('\n'));
      console.log(`${summaryLine(`[shard ${s.id}]`, s.files.length, r)} · 로그 ${log}`);
      return { shard: s, r, log, dir };
    });
    return p;
  });
  const results = await Promise.all(runs);
  const secs = (Date.now() - started) / 1000;

  // 집계: 테스트 수·pass·fail 합계와 manifest·실제 선언 수 대조
  const sum = results.reduce((a, { r }) => ({ tests: a.tests + r.tests, pass: a.pass + r.pass, fail: a.fail + r.fail }), { tests: 0, pass: 0, fail: 0 });
  const exits = results.map(({ r }) => r.exit);
  const perShardOk = results.every(({ shard, r }) => r.tests === shard.expectedTests && r.pass === shard.expectedTests && r.fail === 0 && r.exit === 0);
  const totalOk = sum.tests === plan.totalTests && sum.pass === plan.totalTests && sum.fail === 0;
  console.log('\n=== e2e-parallel 요약 ===');
  for (const { shard, r } of results) {
    console.log(`shard ${shard.id}: 시작 ${hhmmss(r.startedAt)} · 종료 ${hhmmss(r.endedAt)} · ${r.secs.toFixed(1)}초(예상 ${shard.estimatedSeconds}초) · 테스트 ${r.tests}/${shard.expectedTests} · pass ${r.pass} · fail ${r.fail} · 종료 코드 ${r.exit}`);
  }
  console.log(`합계: 테스트 ${sum.tests} · pass ${sum.pass} · fail ${sum.fail} · 기대 ${plan.totalTests} · wall clock ${secs.toFixed(1)}초`);
  const ok = perShardOk && totalOk && exits.every((c) => c === 0);
  if (!ok) {
    if (!totalOk) console.log(`집계 불일치: ${sum.pass}/${sum.tests} (기대 ${plan.totalTests}/${plan.totalTests})`);
    for (const { shard, r, log } of results) if (r.exit !== 0 || r.fail > 0) console.log(`shard ${shard.id} 실패 — 로그: ${log}`);
    console.log('e2e-parallel: 실패');
    return 1;
  }
  console.log(`e2e-parallel: 통과 ${sum.pass}/${plan.totalTests}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
