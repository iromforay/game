// 개발 도구(10-16 C3-1): 3장 마루바닥 밑 길 골격(scripts/data/underfloor-skeleton.json)에서 지역 데이터
// story-data/save-a-turby/stages/underground.json을 만든다. 런타임·빌드에서는 실행하지 않는다.
//   node scripts/turby-build-underfloor-stage.mjs            (BE 폴더에서)
// 규칙
//   - 길(폴리라인+폭)·구역(타원/다각형)에서 8px 격자로 "걸을 수 있는 칸"을 만들고, 나머지를 충돌 사각형으로 병합한다.
//   - 섬(물건 더미)은 걸을 수 없다. 문 자리는 걸을 수 있는 칸으로 두고 gates(닫힘 충돌)가 막는다.
//   - 열린 칸에서 MARGIN px 안쪽의 막힌 칸은 덮지 않아도 된다(사각형 병합 개수를 줄인다 — 길이 이어지지는 않는다).
//   - 문 주변 GUARD px 안의 막힌 칸은 모두 덮는다(닫힌 문을 돌아가지 못하게).
//   - 사건 ID·지점 ID는 고정이다. 좌표만 골격에서 온다.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SKEL = JSON.parse(readFileSync(join(here, 'data/underfloor-skeleton.json'), 'utf8'));
const OUT = join(here, '../story-data/save-a-turby/stages/underground.json');

const CELL = 8;
const MARGIN = 16;
const GUARD = 80;
const W = SKEL.size.width / CELL;
const H = SKEL.size.height / CELL;

// ---- 걸을 수 있는 칸 ----
const free = new Uint8Array(W * H);
const distSeg = (px, py, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};
const inPoly = (px, py, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inEllipse = (px, py, e) => ((px - e.cx) / e.rx) ** 2 + ((py - e.cy) / e.ry) ** 2 <= 1;
const inArea = (px, py, a) => (a.kind === 'ellipse' ? inEllipse(px, py, a) : inPoly(px, py, a.points));
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const px = x * CELL + CELL / 2;
    const py = y * CELL + CELL / 2;
    let ok = false;
    for (const c of SKEL.corridors) {
      for (let i = 0; i + 1 < c.points.length && !ok; i++) if (distSeg(px, py, c.points[i], c.points[i + 1]) <= c.width / 2) ok = true;
      if (ok) break;
    }
    if (!ok) ok = SKEL.areas.some((a) => inArea(px, py, a));
    if (ok && SKEL.islands.some((e) => inEllipse(px, py, e))) ok = false;
    free[y * W + x] = ok ? 1 : 0;
  }

// ---- 덮어야 하는 칸 → 사각형 병합 ----
const at = (x, y) => free[y * W + x] === 0; // 막힌 칸
const m = MARGIN / CELL;
const guard = new Uint8Array(W * H);
for (const g of SKEL.gates) {
  const k = GUARD / CELL;
  const cx0 = Math.floor(g.x / CELL);
  const cy0 = Math.floor(g.y / CELL);
  const cx1 = Math.floor((g.x + g.width) / CELL);
  const cy1 = Math.floor((g.y + g.height) / CELL);
  for (let y = Math.max(0, cy0 - k); y < Math.min(H, cy1 + k); y++) for (let x = Math.max(0, cx0 - k); x < Math.min(W, cx1 + k); x++) guard[y * W + x] = 1;
}
const need = new Uint8Array(W * H);
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

// ---- 지점·표시 정보 ----
const P = Object.fromEntries(SKEL.points.map((p) => [p.id, p]));
const pt = (id) => ({ id, x: P[id].x, y: P[id].y, radius: P[id].radius });
const POINT_IDS = ['underfloor_elder', 'underfloor_glove', 'underfloor_blanket', 'underfloor_doll', 'underfloor_ambush', 'underfloor_fragment', 'underfloor_boss_entrance'];
const art = (w, h, pivot = [0.5, 0.7]) => ({ width: w, height: h, pivot });
const storyPoints = [
  { id: 'underfloor_elder', kind: 'npc', assetKey: 'elder-pokshini', label: '오래된 폭신이', prompt: '오래된 폭신이에게 다가가기', art: art(96, 96, [0.5, 0.7]) },
  { id: 'underfloor_glove', kind: 'inspect', assetKey: 'inspect-glove', label: '낡은 장갑', prompt: '낡은 장갑을 살펴보기', art: art(104, 104, [0.5, 0.75]) },
  { id: 'underfloor_blanket', kind: 'inspect', assetKey: 'inspect-blanket', label: '작은 담요', prompt: '작은 담요를 살펴보기', art: art(104, 104, [0.5, 0.75]) },
  { id: 'underfloor_doll', kind: 'inspect', assetKey: 'inspect-doll', label: '찢어진 인형', prompt: '찢어진 인형을 살펴보기', art: art(104, 104, [0.5, 0.75]) },
  { id: 'underfloor_ambush', kind: 'inspect', assetKey: 'pressed-stitchling-hidden', label: '수상한 물건 더미', prompt: '소리가 나는 쪽으로 다가가기', art: art(120, 80) },
  { id: 'underfloor_fragment', kind: 'inspect', assetKey: 'memory-trail-mark', label: '굴러간 실패 자국', prompt: '자국을 따라가기', art: art(96, 96) },
  { id: 'underfloor_boss_entrance', kind: 'inspect', assetKey: 'memory-spool-gate', label: '넓은 빈 공간 입구', prompt: '넓은 빈 공간으로 들어가기', art: art(120, 120) },
];
const goals = [
  { id: 'meet_elder', text: '오래된 흔적을 따라 물건 더미 쪽으로 가자.', requires: ['underfloor_entry_seen'], unless: ['underfloor_elder_met'] },
  { id: 'inspect_0', text: '오래된 물건을 살펴보자. 0/3', requires: ['underfloor_elder_met'], count: { of: ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected'], is: 0 } },
  { id: 'inspect_1', text: '오래된 물건을 살펴보자. 1/3', requires: ['underfloor_elder_met'], count: { of: ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected'], is: 1 } },
  { id: 'inspect_2', text: '오래된 물건을 살펴보자. 2/3', requires: ['underfloor_elder_met'], count: { of: ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected'], is: 2 } },
  { id: 'find_sound', text: '기계음이 나는 쪽을 확인하자.', requires: ['underfloor_items_inspected'], unless: ['underfloor_memory_trail_found'] },
  { id: 'follow_trail', text: '굴러간 실패 자국을 따라가자.', requires: ['underfloor_memory_trail_found'], unless: ['underfloor_memory_fragment_seen'] },
  { id: 'reach_arena', text: '넓은 빈 공간으로 가자.', requires: ['underfloor_memory_fragment_seen'], unless: ['underfloor_boss_defeated'] },
  { id: 'bring_core', text: '오래된 솜심을 누비에게 가져가자.', requires: ['underfloor_boss_aftermath_seen'], unless: ['underfloor_cotton_core_equipped'] },
  { id: 'follow_silver', text: '은빛 실이 가리키는 북쪽으로 가자.', requires: ['underfloor_cotton_core_equipped'] },
];
const zones = [
  { id: 'zone_crack', label: '마루 틈새', x: 120, y: 1750, width: 800, height: 500 },
  { id: 'zone_fork', label: '첫 갈림길', x: 400, y: 1250, width: 520, height: 600 },
  { id: 'zone_junk_hall', label: '물건 더미 홀', x: 1100, y: 1150, width: 960, height: 760 },
  { id: 'zone_trail', label: '실패 자국 길', x: 1900, y: 600, width: 720, height: 680 },
  { id: 'zone_arena', label: '넓은 빈 공간', x: 2500, y: 190, width: 600, height: 500 },
];
const gate = SKEL.gates[0];
const gates = [
  {
    id: gate.id,
    label: '먼지 실타래 문',
    x: gate.x,
    y: gate.y,
    width: gate.width,
    height: gate.height,
    openEvent: gate.openEvent,
    closedAssetKey: 'dust-yarn-gate-closed',
    openAssetKey: 'dust-yarn-gate-open',
    art: { x: gate.x + gate.width / 2, y: gate.y + gate.height, width: 220, height: 140, pivot: [0.5, 0.85] },
  },
];
const paths = [{ points: [[330, 2080], ...SKEL.corridors[0].points.slice(1), [1130, 1650], [1600, 1500], [2000, 1240], ...SKEL.corridors[3].points.slice(1)] }];

const doc = {
  stageCode: 'underground',
  greybox: false,
  note: '3장 마루바닥 밑 길 골격 v1(10-16 C3-1). 좌표는 BE/scripts/data/underfloor-skeleton.json에서 BE/scripts/turby-build-underfloor-stage.mjs로 만든다(blockers는 생성물 — 손으로 고치지 않는다). 사건·지점 ID는 바뀌지 않는다. 지점 좌표·반경은 골격 명세 그대로다. C3-2: 1차 에셋(배경·폭신이·조사 3종·문·실패 자국) 연결, 매복·기억 조각·보스 입구 지점은 그림 없이 안내 버튼만 쓴다(2차 에셋 C3-4).',
  size: SKEL.size,
  regions: [],
  points: POINT_IDS.map(pt),
  objects: [],
  storyPoints,
  goals,
  layout: { zones, paths, blockers: rects.map((r, i) => ({ id: `wall_${String(i).padStart(3, '0')}`, ...r })), gates },
  spawnPoint: { x: P.spawn.x, y: P.spawn.y },
  render: {
    markerMode: 'final',
    background: { assetKey: 'underfloor-base' },
    overlays: [{ id: 'overlay_memory_trail', assetKey: 'memory-trail', x: SKEL.overlay_regions[0].x, y: SKEL.overlay_regions[0].y, width: SKEL.overlay_regions[0].width, height: SKEL.overlay_regions[0].height, pivot: [0, 0], layer: 'overlay', alpha: 0.7, visibleAfter: 'underfloor_memory_trail_found' }],
  },
};

const text = JSON.stringify(doc, (k, v) => (k === 'blockers' ? '@@B' : v), 2).replace('"@@B"', () => `[\n${doc.layout.blockers.map((b) => `      ${JSON.stringify(b)}`).join(',\n')}\n    ]`);
writeFileSync(OUT, `${text}\n`);
console.log(`blockers ${rects.length} → ${OUT}`);
