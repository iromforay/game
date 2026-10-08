// 시험용: 실제 숲 데이터(story-data/stages/forest.json)에서 의미 있는 자리(문 앞·구역 안·길 위의 점)를 계산한다.
// 최종 지도에서는 좌표가 배경 그림을 따르므로, 시험은 숫자를 직접 쓰지 않고 이 도우미로 "문 바로 앞", "숨은 길 안쪽"처럼 읽는다.
// 제품 코드가 아니다.
import { StoryContentService, type StageStoryData } from '../../src/turby/story/story-content.service';

export interface Pt {
  x: number;
  y: number;
}
const content = new StoryContentService();
export const FOREST = content.stage('forest') as StageStoryData;
const layout = FOREST.layout!;
export const SPAWN = FOREST.spawnPoint!;
export const pointData = (id: string) => FOREST.points.find((p) => p.id === id)!;
export const gateData = (id: string) => layout.gates.find((g) => g.id === id)!;
export const zoneData = (id: string) => layout.zones.find((z) => z.id === id)!;
export const blockerData = (id: string) => layout.blockers.find((b) => b.id === id)!;

const WIND = gateData('gate_hidden_path');
const ROOT = gateData('gate_root');
const rectCenter = (r: { x: number; y: number; width: number; height: number }): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

// 동쪽 길(갈림길 → 먼지바람 → 숨은 길 → 실뿌리 문) 중심선: layout.paths 중 이어지는 세 줄
const EAST: Pt[] = layout.paths.slice(2).flatMap((p) => p.points.map(([x, y]) => ({ x, y })));
// 중심선 위에서 x가 같은 점(중심선이 x축 방향으로 단조롭다고 보고 선형 보간)
export function eastAt(x: number): Pt {
  for (let i = 0; i < EAST.length - 1; i++) {
    const a = EAST[i];
    const b = EAST[i + 1];
    if ((a.x <= x && x <= b.x) || (b.x <= x && x <= a.x)) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return { x, y: Math.round(a.y + (b.y - a.y) * t) };
    }
  }
  throw new Error(`동쪽 길에 x=${x}가 없다`);
}

export const WIND_GATE = WIND;
export const ROOT_GATE = ROOT;
// 먼지바람(닫힌 문) 바로 앞 / 열린 뒤 숨은 길 안쪽(구역 안) / 거대 매듭 공터 / 실뿌리 문 앞 / 문 너머
export const WIND_FRONT: Pt = eastAt(WIND.x - 30);
export const HIDDEN_INSIDE: Pt = eastAt(WIND.x + WIND.width + 60);
export const KNOT: Pt = { x: pointData('forest_giant_knot').x, y: pointData('forest_giant_knot').y };
export const ROOT_FRONT: Pt = eastAt(ROOT.x - 30);
export const BEYOND_ROOT: Pt = { x: pointData('forest_dansuring').x, y: pointData('forest_dansuring').y };
export const BOPULI: Pt = { x: pointData('forest_bopuli_ambush').x, y: pointData('forest_bopuli_ambush').y };
export const CUT: Pt = { x: pointData('forest_cut_thread').x, y: pointData('forest_cut_thread').y };
export const WIND_CENTER = rectCenter(WIND);
export const ROOT_CENTER = rectCenter(ROOT);

// 길 중심선을 따라가는 경유지(걸어서 가는 시험용). 지도의 길은 굽어 있어서 직선으로는 갈 수 없다.
// 같은 길의 끝점이 맞닿는 곳(1px 이내)은 하나로 잇는다. from/to는 가장 가까운 선분 위의 점으로 붙인다.
const SEGMENTS: [Pt, Pt][] = layout.paths.flatMap((p) => p.points.slice(0, -1).map((a, i) => [{ x: a[0], y: a[1] }, { x: p.points[i + 1][0], y: p.points[i + 1][1] }] as [Pt, Pt]));
const NODES: Pt[] = [];
const nodeIndex = (p: Pt): number => {
  const i = NODES.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) < 2);
  if (i >= 0) return i;
  NODES.push({ ...p });
  return NODES.length - 1;
};
const EDGES: [number, number][] = SEGMENTS.map(([a, b]) => [nodeIndex(a), nodeIndex(b)]);

function project(p: Pt): { at: Pt; seg: number } {
  let best = { d: Infinity, at: SEGMENTS[0][0], seg: 0 };
  SEGMENTS.forEach(([a, b], i) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, at: q, seg: i };
  });
  return { at: best.at, seg: best.seg };
}

// from → to 로 가는 경유지(끝점 포함). 길 중심선 그래프에서 최단 경로를 찾는다
export function walkRoute(from: Pt, to: Pt): Pt[] {
  const nodes = [...NODES];
  const edges = EDGES.map((e) => [...e] as [number, number]);
  const attach = (p: Pt): number => {
    const { at, seg } = project(p);
    nodes.push(at);
    const k = nodes.length - 1;
    const [a, b] = edges[seg];
    edges.push([a, k], [k, b]);
    return k;
  };
  const s = attach(from);
  const t = attach(to);
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) throw new Error('길이 이어지지 않는다');
    if (u === t) break;
    done[u] = true;
    for (const [a, b] of edges) {
      const v = a === u ? b : b === u ? a : -1;
      if (v < 0 || done[v]) continue;
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const out: Pt[] = [];
  for (let at = t; at !== s; at = prev[at]) out.unshift(nodes[at]);
  // 중간점이 너무 멀면(서버 이동 한도) 잘게 나눈다
  const dense: Pt[] = [];
  let cur = from;
  for (const w of [...out, to]) {
    const n = Math.max(1, Math.ceil(Math.hypot(w.x - cur.x, w.y - cur.y) / 120));
    for (let i = 1; i <= n; i++) dense.push({ x: cur.x + ((w.x - cur.x) * i) / n, y: cur.y + ((w.y - cur.y) * i) / n });
    cur = w;
  }
  return dense;
}

// ----- E2E 자리(걸을 수 있는 열린 곳) -----
export const E2E = {
  trunkNorth: { x: 1404, y: 1100 } as Pt, // 갈림길 가까운 첫 길(걷다 새로고침 시험의 자리)
  // 울타리 시험: 시험이 덧붙인 얇은 울타리(시작 지점 50px 위)와 그 바로 위의 야생 — 시작 지점에서 가깝지만 막혀 있다
  fence: { id: 'e2e_fence', label: '', x: SPAWN.x - 70, y: SPAWN.y - 50, width: 140, height: 8 },
  fenceWild: { index: 3, x: SPAWN.x, y: SPAWN.y - 70 },
  wildTrunk: { x: 1480, y: 1700 } as Pt, // 약한 야생(첫 길 위)
  wildMid: { x: 1488, y: 1560 } as Pt, // 일반 전투 시험용 야생(공터 아래 길)
  wildPlaza: { x: 1330, y: 2100 } as Pt, // 강한 야생(입구 공터 서쪽 끝)
};
