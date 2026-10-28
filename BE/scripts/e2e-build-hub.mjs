// 허브 E2E용 빌드(10-28) — 허브 시험이 Vite 개발 서버 대신 빌드 결과물을 열도록, 병렬 shard 시작 전에 한 번만 빌드한다. Node 표준 라이브러리만.
// 사용: node scripts/e2e-build-hub.mjs [--if-stale]
// - 운영 배포(build.sh)와 같은 `vite build`이고, 출력 폴더와 서버 주소만 다르다(.env·hub/dist·build/는 건드리지 않음)
// - 터비 서버 주소는 자리표시 주소로 박고, 시험이 정적 서버에서 실제 시험 서버 주소로 바꿔 내려준다(harness.startHubBuild)
// - 그 밖의 서버 주소는 .invalid 주소로 막는다(운영 서버에 요청하지 않음)
// - --if-stale: 소스 지문(HEAD·변경 내용)이 지난 빌드와 같으면 다시 빌드하지 않는다
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT, DEFAULT_E2E_DIR, hhmmss } from './e2e-common.mjs';

const REPO = join(BE_ROOT, '..');
export const HUB_DIST = join(DEFAULT_E2E_DIR, '.artifacts', 'hub-dist'); // shard 폴더 밖 — 두 shard가 같은 빌드를 읽는다
export const TURBY_PLACEHOLDER = 'http://e2e-turby.invalid';
const DEAD = 'http://e2e-dead.invalid';
const ENV = {
  VITE_TURBY_SERVER_URL: TURBY_PLACEHOLDER,
  VITE_ACCOUNT_SERVER_URL: DEAD,
  VITE_KIRBY_SERVER_URL: DEAD,
  VITE_MULTIPLAYER_SERVER_URL: DEAD,
  VITE_MY_ROOM_DUNGEON_SERVER_URL: DEAD,
  VITE_SWEET_SHOP_SERVER_URL: DEAD,
  VITE_COLOR_BLASTERS_SERVER_URL: DEAD,
  SPIN_GATHER_SERVER_URL: DEAD,
};

// 소스 지문: HEAD + 추적 파일 변경 내용 + 추적 안 된 파일 목록(빌드 결과물 폴더는 제외)
function fingerprint() {
  const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return createHash('sha256').update(git(['rev-parse', 'HEAD'])).update(git(['diff', 'HEAD'])).update(git(['ls-files', '--others', '--exclude-standard'])).digest('hex');
}

// 빌드가 필요하면 빌드한다. 반환: 빌드했으면 true
export function buildHub({ ifStale = false } = {}) {
  const stamp = join(HUB_DIST, '.e2e-stamp');
  const fp = fingerprint();
  if (ifStale && existsSync(stamp) && readFileSync(stamp, 'utf8') === fp && existsSync(join(HUB_DIST, 'index.html'))) {
    console.log(`e2e-build-hub: 변경 없음 — 기존 빌드 사용(${HUB_DIST})`);
    return false;
  }
  const started = Date.now();
  console.log(`e2e-build-hub: 빌드 시작 ${hhmmss()}`);
  const r = spawnSync('npx', ['vite', 'build', '--outDir', HUB_DIST, '--emptyOutDir', '--logLevel', 'error'], { cwd: join(REPO, 'hub'), env: { ...process.env, ...ENV }, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`허브 빌드 실패(종료 코드 ${r.status})`);
  writeFileSync(stamp, fp);
  console.log(`e2e-build-hub: 빌드 완료 ${((Date.now() - started) / 1000).toFixed(1)}초 → ${HUB_DIST}`);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('e2e-build-hub.mjs')) {
  try {
    buildHub({ ifStale: process.argv.includes('--if-stale') });
  } catch (e) {
    console.error(`e2e-build-hub: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
