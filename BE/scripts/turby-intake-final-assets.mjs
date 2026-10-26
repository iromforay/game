// 개발 도구(10-26 F-2): Codex가 보낸 종장 에셋 전달 폴더(delivery-v1)를 계약과 대조하고 런타임 폴더로 복사한다(5장 turby-intake-desert-assets.mjs와 같은 검사).
// 런타임·빌드에서는 실행하지 않는다. 실행(BE 폴더에서):
//   node scripts/turby-intake-final-assets.mjs <Codex design/save-a-turby/chapter-final-home 폴더> [--copy]
// 검사: 파일 존재, PNG 크기, 알파 유무, 시트 폭 = 프레임 크기 × 4, manifest(md 표 또는 json)에 적힌 SHA-256과 실제 해시. --copy일 때만 복사한다(검사 실패가 하나라도 있으면 복사하지 않는다).
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '../../save-a-turby/src/assets');
const src = process.argv[2];
const doCopy = process.argv.includes('--copy');
if (!src) throw new Error('Codex chapter-final-home 폴더 경로가 필요하다');

// [전달 폴더, 파일 키, 런타임 경로, 너비, 높이, 알파] — to_codex/2026-10-26 v7(1차) 지시서 계약
const CONTRACT = [
  ['delivery-v1', 'home-core-base', 'world/home-core', 3200, 2400, false],
  ['delivery-v1', 'core-gap', 'world/home-core', 1280, 480, true],
  ['delivery-v1', 'final-dialogue-bg', 'world/home-core', 1280, 720, false],
  ['delivery-v1', 'nubi-origin', 'sprites/story', 512, 512, true],
  ['delivery-v1', 'five-bind', 'fx/story', 768, 768, true],
  ['delivery-v1', 'origin-fall', 'fx/story', 768, 768, true],
];
const SHEETS = {};

const manifestHash = new Map();
for (const folder of new Set(CONTRACT.map((c) => c[0]))) {
  const md = join(src, folder, 'delivery-manifest.md');
  if (existsSync(md)) {
    for (const line of readFileSync(md, 'utf8').split(/\r?\n/)) {
      const file = /([a-z0-9-]+)\.png/.exec(line)?.[1];
      const hash = /\b([0-9a-fA-F]{64})\b/.exec(line)?.[1];
      if (file && hash) manifestHash.set(`${folder}/${file}`, hash.toUpperCase());
    }
  }
  const json = join(src, folder, 'delivery-manifest.json');
  if (existsSync(json)) for (const a of JSON.parse(readFileSync(json, 'utf8')).assets ?? []) manifestHash.set(`${folder}/${String(a.file).replace(/\.png$/, '')}`, String(a.sha256).toUpperCase());
}

const bad = [];
const rows = [];
for (const [folder, key, rel, w, h, alpha] of CONTRACT) {
  const f = join(src, folder, `${key}.png`);
  if (!existsSync(f)) {
    bad.push(`${folder}/${key}.png 없음`);
    continue;
  }
  const b = readFileSync(f);
  const [W, H] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  const hasAlpha = b[25] === 6 || b[25] === 4 || b.includes(Buffer.from('tRNS'));
  const sha = createHash('sha256').update(b).digest('hex').toUpperCase();
  if (W !== w || H !== h) bad.push(`${key}: 크기 ${W}×${H} (계약 ${w}×${h})`);
  if (hasAlpha !== alpha) bad.push(`${key}: 알파 ${hasAlpha} (계약 ${alpha})`);
  if (SHEETS[key] && W !== SHEETS[key] * 4) bad.push(`${key}: 시트 폭 ${W} ≠ ${SHEETS[key]}×4`);
  const m = manifestHash.get(`${folder}/${key}`);
  if (!m) bad.push(`${key}: manifest에 해시 없음`);
  else if (m !== sha) bad.push(`${key}: 해시 불일치(manifest ${m.slice(0, 12)} / 실제 ${sha.slice(0, 12)})`);
  rows.push({ key, rel: `${rel}/${key}.png`, size: `${W}×${H}`, sha });
}
for (const r of rows) console.log(`${r.key.padEnd(26)} ${r.size.padEnd(10)} ${r.sha}`);
if (bad.length > 0) {
  console.log(`\n검사 실패 ${bad.length}건:\n- ${bad.join('\n- ')}`);
  process.exitCode = 1;
} else if (doCopy) {
  for (const [folder, key, rel] of CONTRACT) {
    mkdirSync(join(ASSETS, rel), { recursive: true });
    copyFileSync(join(src, folder, `${key}.png`), join(ASSETS, rel, `${key}.png`));
  }
  console.log(`\n${CONTRACT.length}종 복사 완료 → ${ASSETS}`);
} else console.log(`\n검사 통과 ${rows.length}종(복사하려면 --copy)`);
