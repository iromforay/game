// 개발 도구(10-23 C4-5): Codex가 보낸 4장 에셋 전달 폴더(delivery-v1-fix·delivery-v2·delivery-v3)를 계약과 대조하고 런타임 폴더로 복사한다.
// 런타임·빌드에서는 실행하지 않는다. 실행(BE 폴더에서):
//   node scripts/turby-intake-fridge-assets.mjs <Codex design/save-a-turby/chapter04-fridge 폴더> [--copy]
// 검사: 파일 존재, PNG 크기, 알파 유무, 시트 폭 = 프레임 크기 × 4, manifest에 적힌 SHA-256과 실제 해시. --copy일 때만 복사한다(검사 실패가 하나라도 있으면 복사하지 않는다).
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, '../../save-a-turby/src/assets');
const src = process.argv[2];
const doCopy = process.argv.includes('--copy');
if (!src) throw new Error('Codex chapter04-fridge 폴더 경로가 필요하다');

// [전달 폴더, 파일 키, 런타임 경로, 너비, 높이, 알파] — v4·v5·v6 지시서 계약
const CONTRACT = [
  ['delivery-v1-fix', 'chapter04-dialogue-bg', 'world/fridge', 1280, 720, false],
  ['delivery-v2', 'frozen-sewn-doll-idle', 'sprites/enemies', 640, 160, true],
  ['delivery-v2', 'ice-shard', 'sprites/enemies', 128, 128, true],
  ['delivery-v2', 'thimble-guard-idle', 'sprites/enemies', 640, 160, true],
  ['delivery-v2', 'thimble-guard-exposed', 'sprites/enemies', 640, 160, true],
  ['delivery-v2', 'black-stitch', 'sprites/enemies', 128, 128, true],
  ['delivery-v2', 'ice-cell', 'sprites/enemies', 160, 160, true],
  ['delivery-v2', 'frost-machine-idle', 'sprites/bosses', 1024, 256, true],
  ['delivery-v2', 'frost-machine-stopped', 'sprites/bosses', 1024, 256, true],
  ['delivery-v2', 'lower-thread', 'sprites/enemies', 128, 128, true],
  ['delivery-v2', 'upper-thread', 'sprites/enemies', 128, 128, true],
  ['delivery-v2', 'battle-needle-mark', 'sprites/enemies', 160, 160, true],
  ['delivery-v2', 'link-thread', 'sprites/enemies', 128, 128, true],
  ['delivery-v2', 'pinned-stitch', 'sprites/enemies', 160, 160, true],
  ['delivery-v2', 'ice-microfiber', 'items/relics', 160, 160, true],
  ['delivery-v2', 'frozen-guard-mark', 'world/fridge', 512, 512, true],
  ['delivery-v2', 'frost-machine-mark', 'world/fridge', 512, 512, true],
  ['delivery-v2', 'frost-machine-scar', 'fx/story', 768, 768, true],
  ['delivery-v2', 'sense-restore', 'fx/story', 768, 768, true],
  ['delivery-v2', 'warm-gold', 'fx/story', 768, 768, true],
  ['delivery-v3', 'storage-pattern-wall', 'world/fridge', 1200, 440, true],
  ['delivery-v3', 'ganeuri-pinned-stitches', 'world/fridge', 512, 512, true],
];
const SHEETS = { 'frozen-sewn-doll-idle': 160, 'thimble-guard-idle': 160, 'thimble-guard-exposed': 160, 'frost-machine-idle': 256, 'frost-machine-stopped': 256 };

const manifestHash = new Map();
for (const folder of new Set(CONTRACT.map((c) => c[0]))) {
  const m = join(src, folder, 'delivery-manifest.md');
  if (!existsSync(m)) continue;
  for (const line of readFileSync(m, 'utf8').split(/\r?\n/)) {
    const file = /([a-z0-9-]+)\.png/.exec(line)?.[1];
    const hash = /\b([0-9a-fA-F]{64})\b/.exec(line)?.[1];
    if (file && hash) manifestHash.set(`${folder}/${file}`, hash.toUpperCase());
  }
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
