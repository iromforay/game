// 개발 도구(10-26 F-1): 종장 집의 중심 길 골격(scripts/data/home-core-skeleton.json)에서 지역 데이터
// story-data/save-a-turby/stages/home_core.json을 만든다. 런타임·빌드에서는 실행하지 않는다.
//   node scripts/turby-build-home-core-stage.mjs            (BE 폴더에서)
// 규칙(5장 생성기 turby-build-desert-stage.mjs와 같다)
//   - 길(폴리라인+폭)·구역(타원/다각형)에서 8px 격자로 "걸을 수 있는 칸"을 만들고, 나머지를 충돌 사각형으로 병합한다.
//   - 열린 칸에서 MARGIN px 안쪽의 막힌 칸은 덮지 않아도 된다(사각형 병합 개수를 줄인다 — 길이 이어지지는 않는다).
//   - 사건 ID·지점 ID는 고정이다. 좌표만 골격에서 온다. 종장은 닫힌 문·특수 구역이 없다(gates·zones·mirages 빈 배열).
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SKEL = JSON.parse(readFileSync(join(here, 'data/home-core-skeleton.json'), 'utf8'));
const OUT = join(here, '../story-data/save-a-turby/stages/home_core.json');

const CELL = 8;
const MARGIN = 16;
const GUARD = 80;
const W = SKEL.size.width / CELL;
const H = SKEL.size.height / CELL;

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
// 이야기 지점: 도착(CHFINAL_STARTED) → 중앙의 빈자리(결속·정체 공개) → 검은 틈(가위, F-3에서 전투 연결)
const POINT_IDS = ['final_arrival', 'final_core', 'final_scissors'];
const storyPoints = [
  { id: 'final_arrival', kind: 'inspect', assetKey: 'final-arrival-mark', label: '다섯 실이 모이는 곳', prompt: '집의 중심으로 들어가기' }, // 표식 그림 없음 — 대화 지점(임시 고리)
  { id: 'final_core', kind: 'inspect', assetKey: 'final-core-mark', label: '중앙의 빈자리', prompt: '누비와 함께 중앙으로 가기' },
  { id: 'final_scissors', kind: 'inspect', assetKey: 'final-scissors-mark', label: '검은 틈', prompt: '검은 틈 앞에 서기' },
];
const goals = [
  { id: 'to_core', text: '금빛 길을 따라 다섯 실이 모이는 곳으로 가자.', requires: ['final_unlocked'], unless: ['final_entry_seen'] },
  { id: 'bind', text: '누비와 함께 중앙의 빈자리로 가자.', requires: ['final_entry_seen'], unless: ['final_identity_revealed'] },
  { id: 'face_scissors', text: '검은 틈 앞에 서자.', requires: ['final_identity_revealed'], unless: ['final_boss_defeated'] },
];
const zones = [
  { id: 'zone_golden_path', label: '금빛 길의 끝', x: 1340, y: 1440, width: 520, height: 920 },
  { id: 'zone_core', label: '집의 중심', x: 1080, y: 760, width: 1040, height: 720 },
  { id: 'zone_forest_thread', label: '먼지숲의 실', x: 340, y: 270, width: 960, height: 680 },
  { id: 'zone_lake_thread', label: '호수의 실', x: 350, y: 1020, width: 750, height: 280 },
  { id: 'zone_underfloor_thread', label: '마루 밑의 실', x: 400, y: 1380, width: 900, height: 610 },
  { id: 'zone_fridge_thread', label: '냉장고의 실', x: 2100, y: 1020, width: 750, height: 280 },
];
const C = Object.fromEntries(SKEL.corridors.map((c) => [c.id, c]));
const paths = [{ points: [...C.golden_path.points, [P.final_core.x, P.final_core.y], [P.final_scissors.x, P.final_scissors.y]] }];
// 동료 넷은 각자 자기 지역의 실을 붙잡고 서 있다(1~5장 그림 그대로, 말 걸기 없음 — 도착 장면에서 함께 말한다)
const companion = (id, assetKey, at) => ({ id: `overlay_companion_${id}`, assetKey, x: P[at].x, y: P[at].y, width: 124, height: 124, pivot: [0.5, 0.7], layer: 'story' });
const gap = SKEL.overlay_regions.find((o) => o.id === 'core_gap');

const doc = {
  stageCode: 'home_core',
  greybox: false, // 10-26 F-2: 1차 에셋 배경 home-core-base 연결(codex/turby-final-assets 9e64b65)
  note: '종장 집의 중심 길 골격 v1(10-26 F-1). 좌표는 BE/scripts/data/home-core-skeleton.json에서 BE/scripts/turby-build-home-core-stage.mjs로 만든다(blockers는 생성물 — 손으로 고치지 않는다). 사건·지점 ID는 바뀌지 않는다.',
  size: SKEL.size,
  regions: [],
  points: POINT_IDS.map(pt),
  objects: [],
  storyPoints,
  goals,
  layout: { zones, paths, blockers: rects.map((r, i) => ({ id: `wall_${String(i).padStart(3, '0')}`, ...r })), gates: [] },
  spawnPoint: { x: P.spawn.x, y: P.spawn.y },
  render: {
    markerMode: 'final',
    background: { assetKey: 'home-core-base' },
    overlays: [
      companion('muldeuli', 'turby-muldeuli', 'final_muldeuli'),
      companion('pokshini', 'elder-pokshini', 'final_pokshini'),
      companion('ganeuri', 'ganeuri-freed', 'final_ganeuri'),
      companion('bopuli', 'turby-bopuli', 'final_bopuli'),
      // 중앙의 검은 틈(WF-OVL-01) — 가위 최종전 승리 뒤 걷힌다(F-3)
      { id: 'overlay_core_gap', assetKey: 'core-gap', x: gap.x, y: gap.y, width: gap.width, height: gap.height, pivot: [0, 0], layer: 'overlay', hiddenAfter: 'final_boss_defeated' },
      // 가위가 물러난 뒤 이어진 중앙(WF-OVL-02) — 같은 자리
      { id: 'overlay_core_joined', assetKey: 'core-joined', x: gap.x, y: gap.y, width: gap.width, height: gap.height, pivot: [0, 0], layer: 'overlay', visibleAfter: 'final_boss_defeated' },
    ],
  },
};

const text = JSON.stringify(doc, (k, v) => (k === 'blockers' ? '@@B' : v), 2).replace('"@@B"', () => `[\n${doc.layout.blockers.map((b) => `      ${JSON.stringify(b)}`).join(',\n')}\n    ]`);
writeFileSync(OUT, `${text}\n`);
console.log(`blockers ${rects.length} → ${OUT}`);
