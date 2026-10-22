import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const root = process.cwd();
const testRoot = join(root, 'test');
const feEnv = readEnv(join(root, 'hub', '.env'));
const backendByGame = {
  'tower-defense': server('ACCOUNT_TEST_SERVER_URL', ['VITE_ACCOUNT_SERVER_URL', 'VITE_KIRBY_SERVER_URL'], 'http://127.0.0.1:3003'),
  'offense-tower': server('ACCOUNT_TEST_SERVER_URL', ['VITE_ACCOUNT_SERVER_URL', 'VITE_KIRBY_SERVER_URL'], 'http://127.0.0.1:3003'),
  'strategy-marbles': server('MULTIPLAYER_TEST_SERVER_URL', 'VITE_MULTIPLAYER_SERVER_URL', 'http://127.0.0.1:3001'),
  'save-a-turby': server('TURBY_TEST_SERVER_URL', 'VITE_TURBY_SERVER_URL', 'http://127.0.0.1:3002'),
  'steal_a_kirby': server('KIRBY_TEST_SERVER_URL', 'VITE_KIRBY_SERVER_URL', 'http://127.0.0.1:3003'),
  'merge-defense': server('ACCOUNT_TEST_SERVER_URL', ['VITE_ACCOUNT_SERVER_URL', 'VITE_KIRBY_SERVER_URL'], 'http://127.0.0.1:3003'),
  'my-room-dungeon': server('MY_ROOM_DUNGEON_TEST_SERVER_URL', 'VITE_MY_ROOM_DUNGEON_SERVER_URL', 'http://127.0.0.1:3004'),
  'sweet-shop': server('SWEET_SHOP_TEST_SERVER_URL', 'VITE_SWEET_SHOP_SERVER_URL', 'http://127.0.0.1:3005'),
  'spin-gather-king': server('SPIN_GATHER_TEST_SERVER_URL', 'SPIN_GATHER_SERVER_URL', 'http://127.0.0.1:3006'),
  'number-hero-tower': server('ACCOUNT_TEST_SERVER_URL', ['VITE_ACCOUNT_SERVER_URL', 'VITE_KIRBY_SERVER_URL'], 'http://127.0.0.1:3003'),
  'number-gate-runner': server('ACCOUNT_TEST_SERVER_URL', ['VITE_ACCOUNT_SERVER_URL', 'VITE_KIRBY_SERVER_URL'], 'http://127.0.0.1:3003'),
};
const gameCodes = readdirSync(testRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const results = [];
let totalTests = 0;
const pingByUrl = new Map();
for (const url of new Set(Object.values(backendByGame))) pingByUrl.set(url, pingServer(url));

for (const gameCode of gameCodes) {
  const directory = join(testRoot, gameCode);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.test.ts'))
    .map((file) => relative(root, join(directory, file)));

  if (files.length === 0) continue;

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--test', ...files],
    { cwd: root, encoding: 'utf8' },
  );
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = `${stdout}${stderr}`.trim();
  const backendUrl = backendByGame[gameCode];
  const ping = backendUrl ? await pingByUrl.get(backendUrl) : { ok: true };
  const unitTests = Number(output.match(/# tests (\d+)/)?.[1] ?? 0);
  const unitPassed = Number(output.match(/# pass (\d+)/)?.[1] ?? 0);
  const unitFailed = Number(output.match(/# fail (\d+)/)?.[1] ?? (result.status === 0 ? 0 : 1));
  const tests = unitTests + (backendUrl ? 1 : 0);
  const passed = unitPassed + (backendUrl && ping.ok ? 1 : 0);
  const failed = unitFailed + (backendUrl && !ping.ok ? 1 : 0);
  totalTests += tests;
  results.push({ gameCode, tests, passed, failed, output, stderr: stderr.trim(), serverError: ping.ok ? '' : ping.error });
}

console.log('[게임코드] 테스트케이스 / 성공 / 실패');
for (const result of results) {
  console.log(`[${result.gameCode}] ${result.tests} / ${result.passed} / ${result.failed}`);
  if (result.failed > 0) {
    console.log(`  실패 내용:`);
    const details = [result.serverError, extractFailures(result.output) || result.stderr].filter(Boolean).join('\n');
    console.log(indent(details || result.output, '    '));
  }
}

const failedGames = results.filter((result) => result.failed > 0);
if (failedGames.length > 0) {
  console.log(`\n실패: ${failedGames.length}/${results.length}개 게임`);
  process.exitCode = 1;
} else {
  console.log(`\n전체 통과: ${results.length}개 게임, ${totalTests}개 테스트`);
}

function extractFailures(output) {
  const lines = output.split(/\r?\n/);
  const blocks = [];
  let block = [];
  let collecting = false;

  for (const line of lines) {
    if (/^not ok\s/.test(line)) {
      if (block.length) blocks.push(block.join('\n'));
      block = [line];
      collecting = true;
      continue;
    }
    if (collecting && (/^# Subtest:/.test(line) || /^ok\s/.test(line) || /^1\.\./.test(line))) {
      blocks.push(block.join('\n'));
      block = [];
      collecting = false;
    }
    if (collecting) block.push(line);
  }
  if (block.length) blocks.push(block.join('\n'));
  return blocks.join('\n');
}

function indent(value, prefix) {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}

function readEnv(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) return [];
      return [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]];
    }));
  } catch {
    return {};
  }
}

function server(testKey, feKeys, fallback) {
  const keys = Array.isArray(feKeys) ? feKeys : [feKeys];
  return process.env[testKey] ?? keys.map((key) => feEnv[key]).find(Boolean) ?? fallback;
}

async function pingServer(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return { ok: true, status: response.status };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = cause && typeof cause === 'object' && 'message' in cause
      ? String(cause.message)
      : error instanceof Error
        ? error.message
        : String(error);
    return { ok: false, error: `서버 로딩 실패: FE → ${url} 연결 실패 (${detail || '연결 거부 또는 응답 없음'})` };
  }
}
