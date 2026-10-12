// 10-06 v1 §5: Save a Turby 프런트와 이 패키지만 있는 임시 디렉터리에서 프런트가 빌드되고, 패키지가 없으면 어떤 모듈이 없는지 알려 주는 오류가 난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('격리된 디렉터리(BE 없음)에서 프런트 빌드 통과, 패키지 누락은 모듈 이름이 보이는 오류', { timeout: 240_000 }, () => {
  const script = fileURLToPath(new URL('../scripts/verify-isolated-build.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /격리 프런트 빌드 통과/);
  assert.match(run.stdout, /Cannot find module 'turby-stage-geometry'/);
});
