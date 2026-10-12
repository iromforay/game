// 격리 빌드 검증(10-06 v1 §5): Save a Turby 프런트와 이 공용 패키지"만" 있는 임시 디렉터리에서 프런트가 빌드되는지 본다.
//   - BE 디렉터리가 없어도 프런트 빌드가 되어야 한다(프런트가 BE 소스를 참조하지 않는다는 증거).
//   - 공용 패키지를 빼면 어떤 모듈이 없는지 알 수 있는 오류가 나야 한다.
// 설치된 node_modules의 패키지는 junction으로 빌려 오고, 공용 패키지만 임시 디렉터리 안의 것으로 연결한다.
// 사용: node scripts/verify-isolated-build.mjs   (루트에서 npm install 이 끝난 상태)
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkgDir, '..', '..');
const NAME = 'turby-stage-geometry';
const WORKSPACES = new Set([NAME, 'be', 'save-a-turby', 'hub', 'tower-defense', 'offense-tower', 'strategy-marbles', 'number-hero-tower', 'steal_a_kirby', 'number-gate-runner', 'game-monorepo']);
const skip = (src) => !/[\/](node_modules|dist)([\/]|$)/.test(src);

function stage({ withShared }) {
  const tmp = mkdtempSync(join(tmpdir(), 'turby-isolated-'));
  cpSync(join(repo, 'save-a-turby'), join(tmp, 'save-a-turby'), { recursive: true, filter: skip });
  const nm = join(tmp, 'node_modules');
  mkdirSync(nm);
  for (const entry of readdirSync(join(repo, 'node_modules'))) {
    if (entry === '.bin' || WORKSPACES.has(entry)) continue; // 워크스페이스(BE·다른 게임·공용 패키지)는 가져오지 않는다
    symlinkSync(join(repo, 'node_modules', entry), join(nm, entry), 'junction');
  }
  symlinkSync(join(repo, 'node_modules', '.bin'), join(nm, '.bin'), 'junction');
  if (withShared) {
    cpSync(pkgDir, join(tmp, 'shared', NAME), { recursive: true, filter: skip });
    symlinkSync(join(tmp, 'shared', NAME), join(nm, NAME), 'junction');
    const built = spawnSync(process.execPath, [join(tmp, 'shared', NAME, 'scripts', 'build.mjs')], { cwd: join(tmp, 'shared', NAME), encoding: 'utf8' });
    if (built.status !== 0) throw new Error(`공용 패키지 빌드 실패:\n${built.stdout}${built.stderr}`);
  }
  return tmp;
}

function buildFrontend(tmp) {
  const cwd = join(tmp, 'save-a-turby');
  const tsc = spawnSync(process.execPath, [join(repo, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd, encoding: 'utf8' });
  if (tsc.status !== 0) return { ok: false, output: `${tsc.stdout}${tsc.stderr}` };
  const vite = spawnSync(process.execPath, [join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd, encoding: 'utf8' });
  return { ok: vite.status === 0 && existsSync(join(cwd, 'dist', 'index.html')), output: `${vite.stdout}${vite.stderr}` };
}

const results = {};
let tmp;
try {
  tmp = stage({ withShared: true });
  const ok = buildFrontend(tmp);
  if (!ok.ok) throw new Error(`격리된 디렉터리에서 프런트 빌드 실패:\n${ok.output}`);
  results.isolatedBuild = 'ok';
  console.log('[verify] 격리 프런트 빌드 통과(BE 없음)');
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

let tmp2;
try {
  tmp2 = stage({ withShared: false });
  const missing = buildFrontend(tmp2);
  if (missing.ok) throw new Error('공용 패키지가 없는데 빌드가 통과했다');
  if (!missing.output.includes(NAME)) throw new Error(`공용 패키지 누락 오류가 어떤 모듈인지 알려 주지 않는다:\n${missing.output}`);
  results.missingSharedMessage = missing.output.split('\n').find((l) => l.includes(NAME))?.trim();
  console.log(`[verify] 공용 패키지 누락 시 오류: ${results.missingSharedMessage}`);
} finally {
  if (tmp2) rmSync(tmp2, { recursive: true, force: true });
}
