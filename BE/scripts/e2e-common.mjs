// E2E 실행 공용 모듈(10-12 v1 그룹 실행기·v6 병렬 실행기가 같이 쓴다) — Node 표준 라이브러리만.
// 결과 형식(시작·종료·파일 수·테스트 수·성공·실패·시간·종료 코드)이 실행기마다 달라지지 않게 여기서 한 번만 만든다.
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BE_ROOT = resolve(here, '..');
export const DEFAULT_E2E_DIR = join(BE_ROOT, 'test', 'e2e');

export const hhmmss = (d = new Date()) => d.toTimeString().slice(0, 8);

// 파일 목록을 실행 전에 검증한다: 비어 있지 않음, wildcard 없음, 실제로 존재
export function assertFiles(label, files, e2eDir) {
  if (!Array.isArray(files) || files.length === 0) throw new Error(`${label}: 파일이 없다`);
  const missing = files.filter((f) => /[*?]/.test(f) || !existsSync(join(e2eDir, f)));
  if (missing.length) throw new Error(`manifest의 파일이 없거나 wildcard다: ${missing.join(', ')}`);
}

export function readJson(path) {
  if (!existsSync(path)) throw new Error(`manifest가 없다: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// node --test 하위 프로세스를 실행한다. 파일명은 명시적으로 넘기고 --test-concurrency=1을 유지한다.
// onLine: stdout 줄 단위 콜백(선택). 반환: { exit, tests, pass, fail, secs, startedAt, endedAt, text }
export function runNodeTest({ files, cwd = BE_ROOT, env = {}, onLine, onStderr }) {
  const args = ['--no-warnings', '--test', '--test-concurrency=1', '-r', 'ts-node/register/transpile-only', ...files];
  return new Promise((resolveRun) => {
    const startedAt = new Date();
    const childEnv = { ...process.env, ...env };
    delete childEnv.NODE_TEST_CONTEXT; // 다른 node --test 안에서 불려도 독립된 러너로 돌게 한다
    const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    let pending = '';
    child.stdout.on('data', (d) => {
      text += d;
      if (!onLine) return;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    });
    child.stderr.on('data', (d) => onStderr?.(String(d)));
    const finish = (code, signal, error) => {
      if (pending && onLine) onLine(pending);
      const n = (k) => Number((text.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [])[1] ?? 0);
      const endedAt = new Date();
      resolveRun({
        exit: error ? 1 : (code ?? (signal ? 1 : 0)),
        tests: n('tests'), pass: n('pass'), fail: n('fail'),
        secs: (endedAt - startedAt) / 1000, startedAt, endedAt, text, pid: child.pid, error: error?.message,
      });
    };
    child.on('close', (code, signal) => finish(code, signal));
    child.on('error', (e) => finish(1, null, e));
  });
}

export function summaryLine(label, fileCount, r) {
  return `${label} 종료: ${hhmmss(r.endedAt)} · 파일 ${fileCount} · 테스트 ${r.tests} · 성공 ${r.pass} · 실패 ${r.fail} · ${r.secs.toFixed(1)}초 · 종료 코드 ${r.exit}`;
}
