// 10-23 C4-1: 4장 냉장고 속 길 골격의 이동·충돌 계약. 실제 지역 데이터(story-data/stages/ice.json)로
// 서버 충돌 계약(collisionOf)과 같은 규칙을 8px 격자에서 따져 본다. 골격 원본은 scripts/data/fridge-skeleton.json.
// 서리 구역·바늘 칸·안전 앵커의 배치 계약도 여기서 본다(판정 규칙 자체는 fridge-hazards.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf, solidsFor, checkMove } from '../src/turby/rooms/stage-collision';
import { EVENT_BY_ID } from '../src/turby/story/story-data';

const content = new StoryContentService();
const ICE = content.stage('ice') as StageStoryData;
const C = collisionOf(ICE, 3200, 2400, 'ice');
const SKEL = JSON.parse(readFileSync(join(__dirname, '../scripts/data/fridge-skeleton.json'), 'utf8')) as {
  corridors: { id: string; width: number; points: number[][] }[];
  points: { id: string; x: number; y: number; radius: number }[];
  zones: { id: string; x: number; y: number; width: number; height: number; effect: string }[];
};
const point = (id: string) => ICE.points.find((p) => p.id === id)!;
const CLIENT_HALF = 16;
const BEFORE_DOOR = ['fridge_ganeuri', 'fridge_guard'];
const BEYOND = ['fridge_storage_wall', 'fridge_confession', 'fridge_boss_entrance'];

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
const CLOSED = new Set<string>();
const OPEN = new Set<string>([EVENT_BY_ID.get('fridge_frozen_guard_won')!.id]);

test('지역 데이터: 3200×2400, 시작 지점·지점 좌표가 골격 명세 그대로이고 표시 정보가 있다', () => {
  assert.deepEqual(ICE.size, { width: 3200, height: 2400 });
  assert.deepEqual(ICE.spawnPoint, { x: 380, y: 2020 });
  assert.equal(ICE.greybox, false, 'C4-3: 1차 에셋(C4-2) 연결 — 최종 배경 fridge-base');
  for (const p of SKEL.points.filter((x) => x.id.startsWith('fridge_'))) {
    const mine = point(p.id);
    assert.deepEqual([mine.x, mine.y, mine.radius], [p.x, p.y, p.radius], `${p.id} 좌표·반경`);
    const look = ICE.storyPoints!.find((s) => s.id === p.id)!;
    assert.ok(look.label && look.prompt && look.assetKey, `${p.id} 표시 정보`);
  }
  // 3장 C3-6 기준: NPC 124, 임무 대상 120(외곽광)
  assert.deepEqual(ICE.storyPoints!.find((s) => s.id === 'fridge_ganeuri')!.art, { width: 124, height: 124, pivot: [0.5, 0.7] }); // 외곽광은 실 땀 층(overlay_ganeuri_stitches)
  assert.equal(ICE.storyPoints!.find((s) => s.id === 'fridge_confession')!.art!.glow, true);
  assert.equal(ICE.layout!.gates.length, 1);
  assert.equal(ICE.layout!.gates[0].openEvent, 'fridge_frozen_guard_won', '저장고 문은 저장고 앞 전투 승리에서 파생');
  assert.equal(ICE.layout!.gates[0].openPieces!.length, 2, '열린 문은 좌우 반쪽(3장 QA-04 기준)');
});

test('도달성: 문이 닫힌 동안 입구에서 가느리·저장고 앞 길목에 닿고, 저장고 안은 닫혀 있다(몸 반지름 16)', () => {
  const s0 = reachable(CLOSED, CLIENT_HALF, SPAWN);
  for (const k of BEFORE_DOOR) assert.equal(at(s0, point(k)), true, `${k} 도달`);
  for (const k of BEYOND) assert.equal(at(s0, point(k)), false, `${k}는 저장고 문 전에는 닿을 수 없다`);
  const s1 = reachable(OPEN, CLIENT_HALF, SPAWN);
  for (const k of [...BEFORE_DOOR, ...BEYOND]) assert.equal(at(s1, point(k)), true, `${k} 도달(문 열림)`);
  assert.equal(at(s0, { x: 600, y: 1360 }), true, '막다른 갈래 끝에 닿는다');
});

test('우회 불가: 문 열림 전, 몸 반지름을 더 키워도(24) 문 너머로 새지 않고, 문 북쪽 160px는 모두 막혀 있다', () => {
  const wide = reachable(CLOSED, 24, SPAWN);
  for (const k of BEYOND) assert.equal(at(wide, point(k)), false, `${k} 누출`);
  const g = ICE.layout!.gates[0];
  const s0 = reachable(CLOSED, CLIENT_HALF, SPAWN);
  for (let y = g.y - 160; y < g.y; y += CELL) for (let x = g.x - 160; x < g.x + g.width + 160; x += CELL) assert.equal(at(s0, { x, y }), false, `문 북쪽 (${x},${y}) 누출`);
});

test('필수 길 폭: 주 경로 폭 120px 이상, 경로를 따라 걸어도 막히지 않는다(문 열림)', () => {
  for (const c of SKEL.corridors.filter((x) => x.id !== 'side_branch')) assert.ok(c.width >= 120, `${c.id} 폭 ${c.width}`);
  const route: [number, number][] = [[380, 2020], [800, 1900], [1250, 1900], [1520, 1680], [1680, 1600], [1800, 1560], [2480, 1560], [2650, 1380], [2700, 1180], [2700, 1050], [2700, 760], [2400, 560], [2260, 520], [2050, 495], [1820, 470], [1500, 470]];
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

test('서리 구역·바늘 칸·안전 앵커 배치: 서리 구역은 성에 통로 위, 바늘 칸 3개는 바늘 통로를 가로지르고 사이에 설 틈이 있다, 앵커는 통로 양 끝', () => {
  const water = content.water('ice')!;
  assert.ok(water, '물 규칙 모듈이 서리·바늘을 읽는다');
  assert.deepEqual(water.frost.map((z) => [z.id, z.slowFactor]), [['frost_zone', 0.7]]);
  const corridorY = 1560;
  const ids = water.needles.map((n) => n.id);
  assert.deepEqual(ids, ['needle_1', 'needle_2', 'needle_3']);
  for (const n of water.needles) {
    assert.ok(n.y < corridorY - 80 && n.y + n.height > corridorY + 80, `${n.id}는 통로 폭(200)을 모두 덮는다 — 옆으로 비켜 지나갈 수 없다`);
    assert.deepEqual([n.periodMs, n.warnMs, n.strikeMs], [3000, 1000, 500]);
  }
  for (let i = 0; i + 1 < water.needles.length; i++) {
    const gap = water.needles[i + 1].x - (water.needles[i].x + water.needles[i].width);
    assert.ok(gap >= 2 * 16 + 20, `${ids[i]}~${ids[i + 1]} 사이 설 틈 ${gap}px(몸 지름 + 여유)`);
  }
  // 1 → 2 → 3 순서로 0.6초씩 늦게 내려찍는다(내려찍은 칸 뒤를 따라가면 지나갈 수 있다)
  assert.deepEqual(water.needles.map((n) => n.offsetMs), [0, 2400, 1800]);
  const [west, east] = water.anchors;
  assert.ok(west.x < water.needles[0].x && east.x > water.needles[2].x + water.needles[2].width, '앵커는 바늘 통로 양 끝');
  const s0 = reachable(CLOSED, CLIENT_HALF, SPAWN);
  for (const a of water.anchors) assert.equal(at(s0, a), true, `${a.id}에 닿는다`);
});

test('충돌 상한: blocker 300개 이하, 직렬화 30KB 이하, 지점 중심은 막힌 곳이 아니다', () => {
  const blockers = ICE.layout!.blockers;
  assert.ok(blockers.length <= 300, `blocker ${blockers.length}개`);
  assert.ok(Buffer.byteLength(JSON.stringify(blockers)) <= 30 * 1024);
  const solids = solidsFor(C, OPEN);
  for (const p of ICE.points) for (const r of solids) assert.equal(p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height, false, `${p.id}가 ${r.id}와 겹친다`);
});
