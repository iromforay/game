// 개발 도구(10-26 C5-1): 5장 보일러 옆 사막 길 골격(scripts/data/desert-skeleton.json)에서 지역 데이터
// story-data/save-a-turby/stages/desert.json을 만든다. 런타임·빌드에서는 실행하지 않는다.
//   node scripts/turby-build-desert-stage.mjs            (BE 폴더에서)
// 규칙(4장 생성기 turby-build-fridge-stage.mjs와 같다)
//   - 길(폴리라인+폭)·구역(타원/다각형)에서 8px 격자로 "걸을 수 있는 칸"을 만들고, 나머지를 충돌 사각형으로 병합한다.
//   - 섬(그을린 천 더미)은 걸을 수 없다. 틈 자리는 걸을 수 있는 칸으로 두고 gates(닫힘 충돌)가 막는다.
//   - 열린 칸에서 MARGIN px 안쪽의 막힌 칸은 덮지 않아도 된다(사각형 병합 개수를 줄인다 — 길이 이어지지는 않는다).
//   - 틈 주변 GUARD px 안의 막힌 칸은 모두 덮는다(닫힌 틈을 돌아가지 못하게).
//   - 사건 ID·지점 ID는 고정이다. 좌표만 골격에서 온다. 뜨거운 모래는 zones(effect hot), 아지랑이는 mirages에서 온다.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SKEL = JSON.parse(readFileSync(join(here, 'data/desert-skeleton.json'), 'utf8'));
const OUT = join(here, '../story-data/save-a-turby/stages/desert.json');

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
const POINT_IDS = ['desert_clues', 'desert_scorched', 'desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread', 'desert_cut_face', 'desert_boss_entrance'];
const art = (w, h, pivot = [0.5, 0.7], extra = {}) => ({ width: w, height: h, pivot, ...extra });
// 동료 셋은 1~4장 그림을 그대로 쓴다(새 그림 없음). 표시 크기는 4장 기준(NPC 124, 임무 대상 120~146, 외곽광은 필요한 대상에만)
const storyPoints = [
  { id: 'desert_clues', kind: 'inspect', assetKey: 'desert-clues-mark', label: '금빛 실이 가리키는 길', prompt: '동료들과 함께 걸어가기' }, // 표식 그림 없음 — 대화 지점(임시 고리)
  { id: 'desert_scorched', kind: 'inspect', assetKey: 'scorched-mark', label: '그을린 실 더미', prompt: '실을 나르는 그림자에게 다가가기', art: art(120, 120, [0.5, 0.7]) }, // 그림은 2차 에셋(C5-4)
  { id: 'desert_ridge_pad', kind: 'npc', assetKey: 'turby-muldeuli', label: '물들이', prompt: '물들이에게 길을 부탁하기', art: art(124, 124, [0.5, 0.7]) },
  { id: 'desert_ridge_scent', kind: 'npc', assetKey: 'elder-pokshini', label: '오래된 폭신이', prompt: '오래된 폭신이에게 길을 부탁하기', art: art(124, 124, [0.5, 0.7]) },
  { id: 'desert_ridge_thread', kind: 'npc', assetKey: 'ganeuri-freed', label: '가느리', prompt: '가느리에게 길을 부탁하기', art: art(124, 124, [0.5, 0.7]) },
  { id: 'desert_cut_face', kind: 'inspect', assetKey: 'cut-face', label: '거대한 절단면', prompt: '잘린 실의 끝을 살펴보기', art: art(146, 146, [0.5, 0.7], { glow: true }) },
  { id: 'desert_boss_entrance', kind: 'inspect', assetKey: 'golden-doll-mark', label: '금빛 마감실이 잠든 자리', prompt: '금빛 실이 내려온 곳으로 들어가기', art: art(120, 120, [0.5, 0.7]) }, // 보스 연결은 C5-3, 그림은 2차 에셋
];
const goals = [
  { id: 'follow_gold', text: '금빛 실이 가리키는 쪽으로 동료들과 걸어가자.', requires: ['desert_entry_seen'], unless: ['desert_clues_seen'] },
  { id: 'clear_scorched', text: '끊어진 실을 나르는 그을린 박음이들을 막자.', requires: ['desert_clues_seen'], unless: ['desert_scorched_won'] },
  { id: 'ridge_pad', text: '능선의 틈 앞에서 물들이에게 길을 부탁하자.', requires: ['desert_scorched_won'], unless: ['desert_ridge_pad'] },
  { id: 'ridge_scent', text: '다음 틈 앞에서 오래된 폭신이에게 길을 부탁하자.', requires: ['desert_ridge_pad'], unless: ['desert_ridge_scent'] },
  { id: 'ridge_thread', text: '마지막 틈 앞에서 가느리에게 길을 부탁하자.', requires: ['desert_ridge_scent'], unless: ['desert_ridge_thread'] },
  { id: 'to_cut_face', text: '능선 끝의 커다란 절단면으로 가 보자.', requires: ['desert_ridge_thread'], unless: ['desert_ridge_crossed'] },
  { id: 'to_last_knot', text: '금빛 마감실이 잠든 자리로 가자.', requires: ['desert_ridge_crossed'], unless: ['desert_boss_defeated'] },
];
const zones = [
  { id: 'zone_entrance', label: '사막 초입', x: 150, y: 1840, width: 460, height: 340 },
  { id: 'zone_clues', label: '단서 길', x: 600, y: 1760, width: 900, height: 240 },
  { id: 'zone_scorched', label: '능선 앞', x: 1450, y: 1560, width: 460, height: 320 },
  { id: 'zone_ridge', label: '뜨거운 모래 능선', x: 1950, y: 600, width: 1100, height: 1200 },
  { id: 'zone_cut_face', label: '절단면', x: 2750, y: 350, width: 400, height: 280 },
  { id: 'zone_last_knot', label: '금빛 마감실이 잠든 자리', x: 1660, y: 200, width: 680, height: 520 },
];
// 잘린 틈 3개: 세로로 가는 길을 가로로 끊는다. 닫힘 = 틈, 열림 = 동료가 이은 길(틈마다 다른 그림). 그림 가운데 = 틈 사각형 가운데
const GAP_OPEN = { gate_ridge_gap_1: ['ridge-gap-pad', '물들이가 식힌 발판'], gate_ridge_gap_2: ['ridge-gap-scent', '냄새로 찾은 진짜 길'], gate_ridge_gap_3: ['ridge-gap-thread', '금빛 실을 따라 놓인 실 다리'] };
const gates = SKEL.gates.map((g) => ({
  id: g.id,
  label: GAP_OPEN[g.id][1],
  x: g.x,
  y: g.y,
  width: g.width,
  height: g.height,
  openEvent: g.openEvent,
  closedAssetKey: 'ridge-gap-closed',
  openAssetKey: GAP_OPEN[g.id][0],
  art: { x: g.x + g.width / 2, y: g.y + g.height / 2, width: 240, height: 120, pivot: [0.5, 0.5] },
}));
const C = Object.fromEntries(SKEL.corridors.map((c) => [c.id, c]));
const paths = [{ points: [...C.entry_path.points, ...C.ridge_1.points, ...C.ridge_2.points.slice(1), ...C.ridge_3.points.slice(1), [2950, 470], ...C.to_boss.points] }];

// ---- 뜨거운 모래(속도 배율 — 4장 서리 구역 규칙, kind heat)·아지랑이(표시 전용 주기) ----
const frostZones = SKEL.zones.filter((z) => z.effect === 'hot').map((z) => ({ id: z.id, x: z.x, y: z.y, width: z.width, height: z.height, slowFactor: 0.7, kind: 'heat' }));
// 아지랑이 가짜 길: 4초 주기로 1.6초 보였다 사라진다(두 자리는 2초 엇갈림). 걸을 수 있는지와 무관한 그림뿐이다(판정 없음)
const MIRAGE = { periodMs: 4000, showMs: 1600 };
const mirages = SKEL.mirages.map((m, i) => ({ id: m.id, x: m.x, y: m.y, width: m.width, height: m.height, ...MIRAGE, offsetMs: i * 2000 }));

const doc = {
  stageCode: 'desert',
  greybox: false, // 10-26 C5-2: 1차 에셋 배경 desert-base 연결(codex/turby-ch5-assets ee5ef70)
  note: '5장 보일러 옆 사막 길 골격 v1(10-26 C5-1). 좌표는 BE/scripts/data/desert-skeleton.json에서 BE/scripts/turby-build-desert-stage.mjs로 만든다(blockers는 생성물 — 손으로 고치지 않는다). 사건·지점 ID는 바뀌지 않는다.',
  size: SKEL.size,
  regions: [],
  points: POINT_IDS.map(pt),
  objects: [],
  storyPoints,
  goals,
  layout: { zones, paths, blockers: rects.map((r, i) => ({ id: `wall_${String(i).padStart(3, '0')}`, ...r })), gates },
  spawnPoint: { x: P.spawn.x, y: P.spawn.y },
  frostZones,
  mirages,
  render: {
    markerMode: 'final',
    background: { assetKey: 'desert-base' },
    overlays: [
      // 사막 초입의 동료 셋(뜨거운 침묵) — 단서 길 장면을 본 뒤에는 각자 능선의 틈 앞으로 간다(지점 NPC)
      { id: 'overlay_companion_muldeuli', assetKey: 'turby-muldeuli', x: 560, y: 1900, width: 124, height: 124, pivot: [0.5, 0.7], layer: 'story', hiddenAfter: 'desert_clues_seen' },
      { id: 'overlay_companion_pokshini', assetKey: 'elder-pokshini', x: 660, y: 2010, width: 124, height: 124, pivot: [0.5, 0.7], layer: 'story', hiddenAfter: 'desert_clues_seen' },
      { id: 'overlay_companion_ganeuri', assetKey: 'ganeuri-freed', x: 560, y: 2110, width: 124, height: 124, pivot: [0.5, 0.7], layer: 'story', hiddenAfter: 'desert_clues_seen' },
      // 가위 장면 뒤 반듯하게 갈라진 바닥(W05-OVL-01)
      { id: 'overlay_boss_floor_cut', assetKey: 'boss-floor-cut', x: SKEL.overlay_regions[0].x, y: SKEL.overlay_regions[0].y, width: SKEL.overlay_regions[0].width, height: SKEL.overlay_regions[0].height, pivot: [0, 0], layer: 'overlay', visibleAfter: 'desert_scissors_seen' },
    ],
  },
};

const text = JSON.stringify(doc, (k, v) => (k === 'blockers' ? '@@B' : v), 2).replace('"@@B"', () => `[\n${doc.layout.blockers.map((b) => `      ${JSON.stringify(b)}`).join(',\n')}\n    ]`);
writeFileSync(OUT, `${text}\n`);
console.log(`blockers ${rects.length} → ${OUT}`);
