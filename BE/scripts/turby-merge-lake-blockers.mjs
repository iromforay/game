// 개발 도구(10-15 C2-7C): 호수 지역 데이터의 가는 충돌 띠(8px 격자 가로 띠)를 큰 사각형으로 병합해 lake.json의 layout.blockers를 다시 쓴다.
// 런타임·빌드에서는 실행하지 않는다. 입력은 C2-7B의 가는 띠 데이터이며, 재현 명령은 아래와 같다(BE 폴더에서).
//   git show 127b28a:BE/story-data/save-a-turby/stages/lake.json > ../lake-fine.json
//   node scripts/turby-merge-lake-blockers.mjs ../lake-fine.json story-data/save-a-turby/stages/lake.json
// 규칙
//   - 원래 막힌 칸만 덮는다(열린 칸을 새로 막지 않는다 — 길이 좁아지지 않는다).
//   - 열린 칸에서 MARGIN px 안쪽의 막힌 칸은 덮지 않아도 된다(장식 가장자리가 조금 걸을 수 있게 될 뿐, 길과 길이 이어지지는 않는다).
//   - 문 주변 GUARD px 안의 막힌 칸은 모두 덮는다(여유 폭 때문에 길목이 넓어져 닫힌 문을 돌아가지 않게).
//   - 덮어야 하는 칸을 행 우선으로 훑어, 그 칸에서 시작하는 최대 사각형(가로 먼저/세로 먼저 중 더 많이 덮는 쪽)을 고른다.
import { readFileSync, writeFileSync } from 'fs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error('사용법: node scripts/turby-merge-lake-blockers.mjs <가는 띠 lake.json> <쓸 lake.json>');
const CELL = 8;
const MARGIN = 24;
const GUARD = 80;
const fine = JSON.parse(readFileSync(src, 'utf8'));
const text = readFileSync(dst, 'utf8');
const target = JSON.parse(text);
const W = target.size.width / CELL;
const H = target.size.height / CELL;
const B = new Uint8Array(W * H);
for (const r of fine.layout.blockers) {
  if (r.x % CELL || r.y % CELL || r.width % CELL || r.height % CELL) throw new Error(`8px 격자가 아닌 띠: ${r.id}`);
  for (let y = r.y / CELL; y < (r.y + r.height) / CELL; y++) for (let x = r.x / CELL; x < (r.x + r.width) / CELL; x++) B[y * W + x] = 1;
}
const at = (x, y) => B[y * W + x] === 1;
// 덮어야 하는 칸: 가장 가까운 열린 칸이 MARGIN보다 멀거나 문 주변이다
const need = new Uint8Array(W * H);
const m = MARGIN / CELL;
const guard = new Uint8Array(W * H);
for (const g of target.layout.gates) {
  const k = GUARD / CELL;
  const cx0 = Math.floor(g.x / CELL);
  const cy0 = Math.floor(g.y / CELL);
  const cx1 = Math.floor((g.x + g.width) / CELL);
  const cy1 = Math.floor((g.y + g.height) / CELL);
  for (let y = Math.max(0, cy0 - k); y < Math.min(H, cy1 + k); y++) for (let x = Math.max(0, cx0 - k); x < Math.min(W, cx1 + k); x++) guard[y * W + x] = 1;
}
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (!at(x, y)) continue;
    let nearFree = false;
    for (let dy = -m; dy <= m && !nearFree; dy++)
      for (let dx = -m; dx <= m; dx++) {
        if (dx * dx + dy * dy > m * m) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && !at(xx, yy)) {
          nearFree = true;
          break;
        }
      }
    if (!nearFree || guard[y * W + x]) need[y * W + x] = 1;
  }
const rowAll = (y, x0, x1) => {
  for (let x = x0; x <= x1; x++) if (!at(x, y)) return false;
  return true;
};
const colAll = (x, y0, y1) => {
  for (let y = y0; y <= y1; y++) if (!at(x, y)) return false;
  return true;
};
const gain = (xa, ya, x1, y1) => {
  let n = 0;
  for (let y = ya; y <= y1; y++) for (let x = xa; x <= x1; x++) n += need[y * W + x];
  return n;
};
const rects = [];
for (let i = 0; i < W * H; i++) {
  if (!need[i]) continue;
  const y0 = Math.floor(i / W);
  const x0 = i % W;
  let best = null;
  for (const mode of [0, 1]) {
    let x1 = x0;
    let y1 = y0;
    if (mode === 0) {
      while (x1 + 1 < W && at(x1 + 1, y0)) x1++;
      while (y1 + 1 < H && rowAll(y1 + 1, x0, x1)) y1++;
    } else {
      while (y1 + 1 < H && at(x0, y1 + 1)) y1++;
      while (x1 + 1 < W && colAll(x1 + 1, y0, y1)) x1++;
    }
    let xa = x0;
    while (xa > 0 && colAll(xa - 1, y0, y1)) xa--;
    let ya = y0;
    while (ya > 0 && rowAll(ya - 1, xa, x1)) ya--;
    const g = gain(xa, ya, x1, y1);
    if (!best || g > best.g) best = { g, xa, ya, x1, y1 };
  }
  for (let y = best.ya; y <= best.y1; y++) for (let x = best.xa; x <= best.x1; x++) need[y * W + x] = 0;
  rects.push({ x: best.xa * CELL, y: best.ya * CELL, width: (best.x1 - best.xa + 1) * CELL, height: (best.y1 - best.ya + 1) * CELL });
}
// lake.json의 blockers 배열만 바꿔 쓴다(한 줄에 사각형 하나, 나머지 서식은 그대로)
const lines = rects.map((r, i) => `      {"id": "wall_${String(i).padStart(3, '0')}", "x": ${r.x}, "y": ${r.y}, "width": ${r.width}, "height": ${r.height}}`);
const nl = text.includes('\r\n') ? '\r\n' : '\n';
const re = /("blockers": \[)[\s\S]*?(\r?\n {4}\],\r?\n {4}"gates")/;
if (!re.test(text)) throw new Error('lake.json에서 layout.blockers 배열을 찾지 못했다');
writeFileSync(dst, text.replace(re, `$1${nl}${lines.join(`,${nl}`)}$2`));
console.log(`blockers ${fine.layout.blockers.length} → ${rects.length}`);
