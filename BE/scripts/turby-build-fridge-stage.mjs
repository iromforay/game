// 개발 도구(10-23 C4-1): 4장 냉장고 속 길 골격(scripts/data/fridge-skeleton.json)에서 지역 데이터
// story-data/save-a-turby/stages/ice.json을 만든다. 런타임·빌드에서는 실행하지 않는다.
//   node scripts/turby-build-fridge-stage.mjs            (BE 폴더에서)
// 규칙(3장 생성기 turby-build-underfloor-stage.mjs와 같다)
//   - 길(폴리라인+폭)·구역(타원/다각형)에서 8px 격자로 "걸을 수 있는 칸"을 만들고, 나머지를 충돌 사각형으로 병합한다.
//   - 섬(얼어붙은 상자 더미)은 걸을 수 없다. 문 자리는 걸을 수 있는 칸으로 두고 gates(닫힘 충돌)가 막는다.
//   - 열린 칸에서 MARGIN px 안쪽의 막힌 칸은 덮지 않아도 된다(사각형 병합 개수를 줄인다 — 길이 이어지지는 않는다).
//   - 문 주변 GUARD px 안의 막힌 칸은 모두 덮는다(닫힌 문을 돌아가지 못하게).
//   - 사건 ID·지점 ID는 고정이다. 좌표만 골격에서 온다. 서리 구역·바늘 칸은 골격의 zones(effect numb·needle)에서 온다.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SKEL = JSON.parse(readFileSync(join(here, 'data/fridge-skeleton.json'), 'utf8'));
const OUT = join(here, '../story-data/save-a-turby/stages/ice.json');

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
const POINT_IDS = ['fridge_ganeuri', 'fridge_guard', 'fridge_storage_wall', 'fridge_confession', 'fridge_boss_entrance'];
const art = (w, h, pivot = [0.5, 0.7], extra = {}) => ({ width: w, height: h, pivot, ...extra });
// 표시 크기는 3장 C3-6 검수 기준(NPC 124, 임무 대상 120~146 + 외곽광)을 처음부터 쓴다
const storyPoints = [
  { id: 'fridge_ganeuri', kind: 'npc', assetKey: 'ganeuri-pinned', label: '얼음에 박힌 가느리', prompt: '연결 실을 끊어 주기', art: art(124, 124, [0.5, 0.7]) },
  { id: 'fridge_guard', kind: 'inspect', assetKey: 'frozen-guard-mark', label: '얼어붙은 길목', prompt: '길을 막은 그림자에게 다가가기', art: art(120, 120, [0.5, 0.7]) }, // 그림은 2차 에셋(C4-4)
  { id: 'fridge_storage_wall', kind: 'inspect', assetKey: 'storage-pattern-mark', label: '완성된 도안', prompt: '벽의 도안을 올려다보기' }, // 그림은 도안 벽 오버레이(forPoints)가 대신한다
  { id: 'fridge_confession', kind: 'inspect', assetKey: 'frost-crack-light', label: '얼음 틈의 빛', prompt: '누비 곁에 멈춰 서기', art: art(120, 120, [0.5, 0.6], { glow: true }) },
  { id: 'fridge_boss_entrance', kind: 'inspect', assetKey: 'frost-machine-mark', label: '저장고 중심', prompt: '바늘 소리가 나는 쪽으로 들어가기', art: art(120, 120, [0.5, 0.7]) }, // 보스 연결은 C4-3, 그림은 2차 에셋
];
const goals = [
  { id: 'find_corridor_end', text: '성에 낀 통로 끝으로 가 보자.', requires: ['fridge_entry_seen'], unless: ['fridge_ganeuri_freed'] },
  { id: 'cross_needles', text: '바늘이 지나간 칸을 따라 통로를 건너 저장고로 가자.', requires: ['fridge_ganeuri_freed'], unless: ['fridge_frozen_guard_won'] },
  { id: 'enter_storage', text: '열린 저장고 안으로 들어가 보자.', requires: ['fridge_frozen_guard_won'], unless: ['fridge_storage_seen'] },
  { id: 'to_center', text: '저장고 중심으로 가자.', requires: ['fridge_storage_seen'], unless: ['fridge_confession_seen'] },
  { id: 'stop_machine', text: '바늘 소리가 나는 저장고 중심으로 들어가자.', requires: ['fridge_confession_seen'], unless: ['fridge_boss_defeated'] },
  { id: 'bring_microfiber', text: '얼음 극세사를 누비에게 감아 주자.', requires: ['fridge_boss_aftermath_seen'], unless: ['fridge_microfiber_equipped'] },
  { id: 'follow_warmth', text: '뜨거운 바람이 불어오는 보일러 쪽으로 가자.', requires: ['fridge_microfiber_equipped'] },
];
const zones = [
  { id: 'zone_entrance', label: '성에 낀 입구', x: 140, y: 1840, width: 440, height: 340 },
  { id: 'zone_frost', label: '성에 통로', x: 700, y: 1780, width: 700, height: 240 },
  { id: 'zone_ganeuri', label: '가느리 자리', x: 1450, y: 1470, width: 420, height: 300 },
  { id: 'zone_needle', label: '바늘 통로', x: 1800, y: 1460, width: 680, height: 200 },
  { id: 'zone_storage_front', label: '저장고 앞', x: 2480, y: 930, width: 440, height: 300 },
  { id: 'zone_storage', label: '얼어붙은 저장고', x: 2150, y: 250, width: 930, height: 550 },
  { id: 'zone_machine', label: '저장고 중심', x: 1170, y: 210, width: 660, height: 520 },
];
const gate = SKEL.gates[0];
const gcx = gate.x + gate.width / 2;
const gates = [
  {
    id: gate.id,
    label: '얼어붙은 저장고 문',
    x: gate.x,
    y: gate.y,
    width: gate.width,
    height: gate.height,
    openEvent: gate.openEvent,
    closedAssetKey: 'storage-door-closed',
    openAssetKey: 'storage-door-open',
    art: { x: gcx, y: gate.y + gate.height, width: 220, height: 140, pivot: [0.5, 0.85] },
    // 열린 문: 열림 그림을 가운데(x 768)에서 좌우 반쪽으로 잘라 0.8배로 줄이고 벽 쪽에 붙인다(3장 C3-6 QA-04 기준)
    openPieces: [
      { x: gcx - 76, y: gate.y + gate.height, width: 88, height: 112, pivot: [0.5, 0.85], frame: [0, 0, 768, 1024] },
      { x: gcx + 76, y: gate.y + gate.height, width: 88, height: 112, pivot: [0.5, 0.85], frame: [768, 0, 768, 1024] },
    ],
  },
];
const C = Object.fromEntries(SKEL.corridors.map((c) => [c.id, c]));
const paths = [{ points: [...C.entry_path.points, [1660, 1620], ...C.needle_corridor.points, ...C.to_storage_front.points.slice(1), ...C.storage_door_path.points, [2400, 560], ...C.to_boss.points] }];

// ---- 서리 구역·바늘 칸·안전 앵커(rooms/stage-water.ts가 판정) ----
const frostZones = SKEL.zones.filter((z) => z.effect === 'numb').map((z) => ({ id: z.id, x: z.x, y: z.y, width: z.width, height: z.height, slowFactor: 0.7 }));
// 바늘 칸 3개: 3초 주기(예고 1초 → 내려찍기 0.5초 → 쉼), 1 → 2 → 3 순서로 0.6초씩 늦게 — 내려찍은 칸 뒤를 따라가면 지나갈 수 있다
const NEEDLE = { periodMs: 3000, warnMs: 1000, strikeMs: 500 };
const needleFields = SKEL.zones
  .filter((z) => z.effect === 'needle')
  .map((z, i) => ({ id: z.id, x: z.x, y: z.y, width: z.width, height: z.height, ...NEEDLE, offsetMs: (NEEDLE.periodMs - i * 600) % NEEDLE.periodMs }));
const safeAnchors = [
  { id: 'anchor_needle_west', x: 1760, y: 1560, radius: 90 },
  { id: 'anchor_needle_east', x: 2560, y: 1540, radius: 90 },
];

const doc = {
  stageCode: 'ice',
  greybox: false, // 10-23 C4-3: 1차 에셋(C4-2) 연결 — 최종 배경 fridge-base
  note: '4장 냉장고 속 길 골격 v1(10-23 C4-1). 좌표는 BE/scripts/data/fridge-skeleton.json에서 BE/scripts/turby-build-fridge-stage.mjs로 만든다(blockers는 생성물 — 손으로 고치지 않는다). 사건·지점 ID는 바뀌지 않는다. C4-3: 1차 에셋(배경·가느리·저장고 문·고백 빛·도안 벽·바늘 표식) 연결, 길목·서리 미싱 입구 표식은 2차 에셋(C4-4).',
  size: SKEL.size,
  regions: [],
  points: POINT_IDS.map(pt),
  objects: [],
  storyPoints,
  goals,
  layout: { zones, paths, blockers: rects.map((r, i) => ({ id: `wall_${String(i).padStart(3, '0')}`, ...r })), gates },
  spawnPoint: { x: P.spawn.x, y: P.spawn.y },
  frostZones,
  needleFields,
  safeAnchors,
  render: {
    markerMode: 'final',
    background: { assetKey: 'fridge-base' },
    overlays: [
      // 완성된 도안 벽(W04-OVL-01): 저장고 위쪽 벽. 도안 벽 지점의 표식을 대신한다
      { id: 'overlay_storage_pattern', assetKey: 'storage-pattern-wall', x: SKEL.overlay_regions[0].x, y: SKEL.overlay_regions[0].y, width: SKEL.overlay_regions[0].width, height: SKEL.overlay_regions[0].height, pivot: [0, 0], layer: 'overlay', forPoints: ['fridge_storage_wall'] },
      // 풀려난 가느리(W04-NPC-02): 구조 뒤 바늘 통로 입구에서 길을 알려 준다. 저장고 앞 전투를 이기면 함께 들어가 사라진다
      { id: 'overlay_ganeuri_guide', assetKey: 'ganeuri-freed', x: 1740, y: 1500, width: 124, height: 124, pivot: [0.5, 0.7], layer: 'story', visibleAfter: 'fridge_ganeuri_freed', hiddenAfter: 'fridge_frozen_guard_won' },
    ],
  },
};

const text = JSON.stringify(doc, (k, v) => (k === 'blockers' ? '@@B' : v), 2).replace('"@@B"', () => `[\n${doc.layout.blockers.map((b) => `      ${JSON.stringify(b)}`).join(',\n')}\n    ]`);
writeFileSync(OUT, `${text}\n`);
console.log(`blockers ${rects.length} → ${OUT}`);
