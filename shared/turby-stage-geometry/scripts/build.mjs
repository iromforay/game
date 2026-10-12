// 공용 패키지 빌드: 같은 소스(src/index.ts)에서 ESM(프런트·Vite)·CJS(BE의 Nest 빌드)·타입 선언을 만든다.
// 소스는 한 벌이고 복사본은 없다 — 산출물(dist)은 git에 올리지 않고 소비자의 build·test·dev 앞에서 이 스크립트가 만든다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const tsc = require.resolve('typescript/bin/tsc');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
const emit = (module, outDir, declaration) => {
  const args = [tsc, '-p', join(root, 'tsconfig.json'), '--module', module, '--outDir', outDir, '--declaration', String(declaration)];
  if (declaration) args.push('--declarationDir', join(dist, 'types'));
  if (module !== 'commonjs') args.push('--moduleResolution', 'bundler');
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
};

emit('commonjs', join(dist, 'cjs'), false);
emit('esnext', join(dist, 'esm'), true);
// dist 안의 .js가 어느 모듈 방식인지 Node가 알 수 있게 표시한다
mkdirSync(join(dist, 'cjs'), { recursive: true });
writeFileSync(join(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
writeFileSync(join(dist, 'esm', 'package.json'), '{"type":"module"}\n');
console.log('[turby-stage-geometry] dist 빌드 완료');
