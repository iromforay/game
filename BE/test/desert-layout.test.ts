// 10-26 C5-1: 5장 보일러 옆 사막 길 골격의 이동·충돌 계약. 실제 지역 데이터(story-data/stages/desert.json)로
// 서버 충돌 계약(collisionOf)과 같은 규칙을 8px 격자에서 따져 본다. 골격 원본은 scripts/data/desert-skeleton.json.
// 잘린 틈 3개(동료가 차례로 잇는다)·뜨거운 모래·아지랑이의 배치 계약도 여기서 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf, solidsFor, checkMove } from '../src/turby/rooms/stage-collision';
import { EVENT_BY_ID } from '../src/turby/story/story-data';

const content = new StoryContentService();
const DESERT = content.stage('desert') as StageStoryData;
const C = collisionOf(DESERT, 3200, 2400, 'desert');
const SKEL = JSON.parse(readFileSync(join(__dirname, '../scripts/data/desert-skeleton.json'), 'utf8')) as {
  corridors: { id: string; width: number; points: number[][] }[];
  points: { id: string; x: number; y: number; radius: number }[];
  gates: { id: string; openEvent: string }[];
  mirages: { id: string; x: number; y: number; width: number; height: number }[];
};
const point = (id: string) => DESERT.points.find((p) => p.id === id)!;
const CLIENT_HALF = 16;

const CELL = 8;
const GW = 3200 / CELL;
const GH = 2400 / CELL;
function reachable(events: Set<string>, half: number, from: { x: number; y: number }): Uint8Array {
  const blocked = new Uint8Array(GW * GH);
  for (const r of solidsFor(C, events)) {
    const x0 = Math.max(0, Math.floor((r.x - half) / CELL));
    const x1 = Math.min(GW - 1, Math.floor((r.x + r.width + half) / CELL));
    const y0 = Math.max(0, Math.floor((r.y - half) / CELL));
    const y1 = Math.min(GH - 1, Math.floor((r.y + r.height + half) / CELL));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        if (cx > r.x - half && cx < r.x + r.width + half && cy > r.y - half && cy < r.y + r.height + half) blocked[y * GW + x] = 1;
      }
  }
  const seen = new Uint8Array(GW * GH);
  const stack = [Math.floor(from.y / CELL) * GW + Math.floor(from.x / CELL)];
  if (blocked[stack[0]]) return seen;
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % GW;
    const y = (i - x) / GW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx;
      if (blocked[j] || seen[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
const at = (set: Uint8Array, p: { x: number; y: number }) => set[Math.floor(p.y / CELL) * GW + Math.floor(p.x / CELL)] === 1;
const SPAWN = C.spawn;
// 틈을 하나씩 열 때마다 새로 닿는 지점(동료가 차례로 길을 잇는다)
const STAGES: [string[], string[]][] = [
  [[], ['desert_clues', 'desert_scorched', 'desert_ridge_pad']],
  [['desert_ridge_pad'], ['desert_ridge_scent']],
  [['desert_ridge_pad', 'desert_ridge_scent'], ['desert_ridge_thread']],
  [['desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread'], ['desert_cut_face', 'desert_boss_entrance']],
];
const ALL_POINTS = STAGES.flatMap(([, pts]) => pts);
const OPEN = new Set(STAGES[3][0]);

test('지역 데이터: 3200×2400, 시작 지점·지점 좌표가 골격 명세 그대로이고 표시 정보가 있다', () => {
  assert.deepEqual(DESERT.size, { width: 3200, height: 2400 });
  assert.deepEqual(DESERT.spawnPoint, { x: 400, y: 2020 });
  assert.equal(DESERT.greybox, false, 'C5-2: 1차 에셋 배경 desert-base 연결');
  for (const p of SKEL.points.filter((x) => x.id.startsWith('desert_'))) {
    const mine = point(p.id);
    assert.deepEqual([mine.x, mine.y, mine.radius], [p.x, p.y, p.radius], `${p.id} 좌표·반경`);
    const look = DESERT.storyPoints!.find((s) => s.id === p.id)!;
    assert.ok(look.label && look.prompt && look.assetKey, `${p.id} 표시 정보`);
  }
  // 동료 셋은 1~4장 그림 그대로(NPC 124), 임무 대상(절단면)만 외곽광
  const look = (id: string) => DESERT.storyPoints!.find((s) => s.id === id)!;
  assert.deepEqual([look('desert_ridge_pad').assetKey, look('desert_ridge_scent').assetKey, look('desert_ridge_thread').assetKey], ['turby-muldeuli', 'elder-pokshini', 'ganeuri-freed']);
  for (const id of ['desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread']) assert.deepEqual(look(id).art, { width: 124, height: 124, pivot: [0.5, 0.7] });
  assert.equal(look('desert_cut_face').art!.glow, true);
  assert.deepEqual(DESERT.storyPoints!.filter((s) => s.art?.glow).map((s) => s.id), ['desert_cut_face']);
});

test('잘린 틈: 3개가 동료 사건(물들이 → 폭신이 → 가느리)으로 열리고, 열림 그림은 틈마다 다르다', () => {
  const gates = DESERT.layout!.gates;
  assert.deepEqual(gates.map((g) => [g.id, g.openEvent, g.closedAssetKey, g.openAssetKey]), [
    ['gate_ridge_gap_1', 'desert_ridge_pad', 'ridge-gap-closed', 'ridge-gap-pad'],
    ['gate_ridge_gap_2', 'desert_ridge_scent', 'ridge-gap-closed', 'ridge-gap-scent'],
    ['gate_ridge_gap_3', 'desert_ridge_thread', 'ridge-gap-closed', 'ridge-gap-thread'],
  ]);
  for (const g of gates) {
    assert.ok(EVENT_BY_ID.get(g.openEvent), `${g.openEvent} 사건`);
    assert.deepEqual([g.art!.x, g.art!.y, g.art!.width, g.art!.height], [g.x + g.width / 2, g.y + g.height / 2, 240, 120], `${g.id} 그림 가운데 = 틈 가운데`);
    assert.equal(g.openPieces, undefined, '틈은 바닥 그림 한 장(문처럼 반쪽으로 자르지 않는다)');
  }
});

test('도달성: 틈을 하나씩 열 때마다 다음 동료 지점만 새로 닿는다(몸 반지름 16)', () => {
  let before: string[] = [];
  for (const [opened, fresh] of STAGES) {
    const s = reachable(new Set(opened), CLIENT_HALF, SPAWN);
    const now = ALL_POINTS.filter((k) => at(s, point(k)));
    assert.deepEqual(now, [...before, ...fresh], `열린 틈 [${opened.join(', ')}]`);
    before = now;
  }
  const s0 = reachable(new Set(), CLIENT_HALF, SPAWN);
  assert.equal(at(s0, { x: 680, y: 1320 }), true, '막다른 갈래 끝에 닿는다');
});

test('우회 불가: 틈이 닫힌 동안 몸 반지름을 더 키워도(24) 다음 구간으로 새지 않는다', () => {
  for (let i = 0; i < 3; i++) {
    const wide = reachable(new Set(STAGES[i][0]), 24, SPAWN);
    for (const k of STAGES[i + 1][1]) assert.equal(at(wide, point(k)), false, `틈 ${i + 1}이 닫힌 동안 ${k} 누출`);
  }
});

test('필수 길 폭: 주 경로 폭 120px 이상, 경로를 따라 걸어도 막히지 않는다(틈 모두 열림)', () => {
  for (const c of SKEL.corridors.filter((x) => x.id !== 'side_branch')) assert.ok(c.width >= 120, `${c.id} 폭 ${c.width}`);
  const route: [number, number][] = [[400, 2020], [900, 1900], [1300, 1880], [1500, 1760], [1640, 1690], [1850, 1700], [2150, 1700], [2150, 1250], [2650, 1250], [2650, 880], [2950, 880], [2950, 600], [2950, 470], [2800, 470], [2300, 470], [2000, 460]];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = { x: route[i][0], y: route[i][1] };
    const b = { x: route[i + 1][0], y: route[i + 1][1] };
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12);
    let prev = a;
    for (let k = 1; k <= steps; k++) {
      const cur = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      assert.equal(checkMove(C, solidsFor(C, OPEN), [], prev, cur, CLIENT_HALF), 'ok', `경로 ${i}→${i + 1} 단계 ${k}에서 막힘 (${cur.x.toFixed(0)},${cur.y.toFixed(0)})`);
      prev = cur;
    }
  }
});

test('뜨거운 모래·아지랑이: 뜨거운 모래는 서리 구역 규칙(0.7배, kind heat)이고 능선 위, 아지랑이 가짜 길은 걸을 수 없는 모래 위로 뻗는다(판정 없음)', () => {
  const water = content.water('desert')!;
  assert.deepEqual(water.frost.map((z) => [z.id, z.slowFactor, z.kind]), [['hot_sand', 0.7, 'heat']]);
  assert.deepEqual(water.needles, [], '사막에는 바늘 칸이 없다');
  assert.deepEqual(water.mirages.map((m) => [m.id, m.periodMs, m.showMs, m.offsetMs]), [['mirage_a', 4000, 1600, 0], ['mirage_b', 4000, 1600, 2000]]);
  const s = reachable(OPEN, CLIENT_HALF, SPAWN);
  for (const m of SKEL.mirages) {
    // 진짜 길에서 갈라져 나오는 그림이라 한쪽 끝은 길에 닿고, 반대쪽 끝은 걸을 수 없다
    const ends = [{ x: m.x + 20, y: m.y + m.height / 2 }, { x: m.x + m.width - 20, y: m.y + m.height / 2 }];
    assert.equal(ends.filter((p) => at(s, p)).length, 1, `${m.id}: 한쪽 끝만 걸을 수 있다`);
  }
  const hot = water.frost[0];
  for (const k of ['desert_ridge_pad', 'desert_ridge_scent']) {
    const p = point(k);
    assert.ok(p.x > hot.x && p.x < hot.x + hot.width && p.y > hot.y && p.y < hot.y + hot.height, `${k}는 뜨거운 모래 안`);
  }
});

test('충돌 상한: blocker 300개 이하, 직렬화 30KB 이하, 지점 중심은 막힌 곳이 아니다', () => {
  const blockers = DESERT.layout!.blockers;
  assert.ok(blockers.length <= 300, `blocker ${blockers.length}개`);
  assert.ok(Buffer.byteLength(JSON.stringify(blockers)) <= 30 * 1024);
  const solids = solidsFor(C, OPEN);
  for (const p of DESERT.points) for (const r of solids) assert.equal(p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height, false, `${p.id}가 ${r.id}와 겹친다`);
});
