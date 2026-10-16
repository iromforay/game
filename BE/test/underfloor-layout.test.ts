// 10-16 C3-1: 3장 마루바닥 밑 길 골격의 이동·충돌 계약. 실제 지역 데이터(story-data/stages/underground.json)로
// 서버 충돌 계약(collisionOf)과 같은 규칙을 8px 격자에서 따져 본다. 골격 원본은 scripts/data/underfloor-skeleton.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf, solidsFor, checkMove } from '../src/turby/rooms/stage-collision';
import { EVENT_BY_ID } from '../src/turby/story/story-data';

const content = new StoryContentService();
const UG = content.stage('underground') as StageStoryData;
const C = collisionOf(UG, 3200, 2400, 'underground');
const SKEL = JSON.parse(readFileSync(join(__dirname, '../scripts/data/underfloor-skeleton.json'), 'utf8')) as { corridors: { id: string; width: number; points: number[][] }[]; points: { id: string; x: number; y: number; radius: number }[] };
const point = (id: string) => UG.points.find((p) => p.id === id)!;
const CLIENT_HALF = 16;
const KEY = ['underfloor_elder', 'underfloor_glove', 'underfloor_blanket', 'underfloor_doll', 'underfloor_ambush'];
const BEYOND = ['underfloor_fragment', 'underfloor_boss_entrance'];

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
const OPEN = new Set<string>([EVENT_BY_ID.get('underfloor_memory_trail_found')!.id]);

test('지역 데이터: 3200×2400, 시작 지점·지점 좌표가 골격 명세 그대로이고 표시 정보가 있다', () => {
  assert.deepEqual(UG.size, { width: 3200, height: 2400 });
  assert.deepEqual(UG.spawnPoint, { x: 330, y: 2080 });
  assert.equal(UG.greybox, true, 'C3-2에서 배경을 연결하기 전까지 회색상자');
  for (const p of SKEL.points.filter((x) => x.id.startsWith('underfloor_'))) {
    const mine = point(p.id);
    assert.deepEqual([mine.x, mine.y, mine.radius], [p.x, p.y, p.radius], `${p.id} 좌표·반경`);
    const look = UG.storyPoints!.find((s) => s.id === p.id)!;
    assert.ok(look.label && look.prompt && look.assetKey, `${p.id} 표시 정보`);
  }
  assert.equal(UG.layout!.gates.length, 1);
  assert.equal(UG.layout!.gates[0].openEvent, 'underfloor_memory_trail_found', '먼지 실타래 문은 매복 승리(기억실 방향 복구) 사건에서 파생');
});

test('도달성: 문이 닫힌 동안 입구에서 폭신이·조사 3곳·매복 지점에 닿고, 실패 자국 길·빈 공간은 닫혀 있다(몸 반지름 16)', () => {
  const s0 = reachable(CLOSED, CLIENT_HALF, SPAWN);
  for (const k of KEY) assert.equal(at(s0, point(k)), true, `${k} 도달`);
  for (const k of BEYOND) assert.equal(at(s0, point(k)), false, `${k}는 먼지 실타래 문 전에는 닿을 수 없다`);
  const s1 = reachable(OPEN, CLIENT_HALF, SPAWN);
  for (const k of [...KEY, ...BEYOND]) assert.equal(at(s1, point(k)), true, `${k} 도달(문 열림)`);
  // 막다른 갈래는 열려 있지만 어디에도 이어지지 않는다
  assert.equal(at(s0, { x: 560, y: 1330 }), true, '막다른 갈래 끝에 닿는다');
});

test('우회 불가: 문 열림 전, 몸 반지름을 더 키워도(24) 문 너머로 새지 않고, 문 주변 80px는 모두 막혀 있다', () => {
  const wide = reachable(CLOSED, 24, SPAWN);
  for (const k of BEYOND) assert.equal(at(wide, point(k)), false, `${k} 누출`);
  const g = UG.layout!.gates[0];
  const s0 = reachable(CLOSED, CLIENT_HALF, SPAWN);
  // 문 북쪽(지점 쪽) 칸은 닫힌 동안 전부 막혀 있다
  for (let y = g.y - 160; y < g.y; y += CELL) for (let x = g.x - 160; x < g.x + g.width + 160; x += CELL) assert.equal(at(s0, { x, y }), false, `문 북쪽 (${x},${y}) 누출`);
});

test('필수 길 폭: 골격의 주 경로 폭이 120px 이상이고, 경로 따라 걸어도 막히지 않는다(문 열림)', () => {
  for (const c of SKEL.corridors.filter((x) => x.id !== 'deadend_branch')) assert.ok(c.width >= 120, `${c.id} 폭 ${c.width}`);
  const route: [number, number][] = [[330, 2080], [560, 1880], [860, 1760], [1130, 1650], [1230, 1660], [1600, 1500], [2000, 1240], [2000, 900], [2180, 770], [2460, 700], [2580, 610]];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = { x: route[i][0], y: route[i][1] };
    const b = { x: route[i + 1][0], y: route[i + 1][1] };
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12);
    let prev = a;
    for (let k = 1; k <= steps; k++) {
      const cur = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      const r = checkMove(C, solidsFor(C, OPEN), [], prev, cur, CLIENT_HALF);
      assert.equal(r, 'ok', `경로 ${i}→${i + 1} 단계 ${k}에서 막힘 (${cur.x.toFixed(0)},${cur.y.toFixed(0)})`);
      prev = cur;
    }
  }
});

test('충돌 상한: blocker 300개 이하, 직렬화 30KB 이하, 지점 중심은 막힌 곳이 아니다', () => {
  const blockers = UG.layout!.blockers;
  assert.ok(blockers.length <= 300, `blocker ${blockers.length}개`);
  assert.ok(Buffer.byteLength(JSON.stringify(blockers)) <= 30 * 1024);
  const solids = solidsFor(C, OPEN);
  for (const p of UG.points) for (const r of solids) assert.equal(p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height, false, `${p.id}가 ${r.id}와 겹친다`);
});
