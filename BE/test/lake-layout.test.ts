// 10-14 C2-7B: 최종 호수 배경에 맞춘 이동·충돌·수역·사건 좌표 정합성 계약.
// 실제 지역 데이터(story-data/stages/lake.json)로 서버 충돌 계약(collisionOf)과 같은 규칙을 8px 격자에서 따져 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf, solidsFor, lockedZonesFor, checkMove, safePosition, SERVER_BODY_HALF } from '../src/turby/rooms/stage-collision';
import { parseStageWater, resolveWater, returnTarget, newWaterState } from '../src/turby/rooms/stage-water';
import { CHECKPOINTS, EVENT_BY_ID, STORY_EVENTS, STORY_TRIGGERS } from '../src/turby/story/story-data';
import { DRY_1, DRY_1_TO_DEEP_SOUTH, TO_GATE_FRONT, TO_DEEP_NORTH, ROUTE_TO_BOSS, ROUTE_TO_JUNCTION, JUNCTION_TO, C_TO_SAFE_ROUTE, JUNCTION_TO_SAFE_ROUTE, TO_BOSS, THROUGH_SAFE_GATE } from './helpers/lake-route';

const content = new StoryContentService();
const LAKE = content.stage('lake') as StageStoryData;
const C = collisionOf(LAKE, 3200, 2400, 'lake');
const WATER = parseStageWater(LAKE, C, 'lake')!;
const point = (id: string) => LAKE.points.find((p) => p.id === id)!;
const CLIENT_HALF = 16;

const CH01 = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const START = new Set([...CH01, 'lake_entry_seen', 'lake_mulduri_met']);
const DRUM = new Set([...START, 'lake_wave_drum_awakened']);
const RESCUED = new Set([...DRUM, 'lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued']);
const SAFE = new Set([...RESCUED, 'lake_safe_route_opened']);

// 격자(8px) 위에서 "몸(반지름 half)이 서 있을 수 있는 자리" 도달 가능 집합
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
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x * CELL + CELL / 2;
      const cy = y * CELL + CELL / 2;
      if (cx > r.x - half && cx < r.x + r.width + half && cy > r.y - half && cy < r.y + r.height + half) blocked[y * GW + x] = 1;
    }
  }
  const seen = new Uint8Array(GW * GH);
  const sx = Math.floor(from.x / CELL);
  const sy = Math.floor(from.y / CELL);
  const stack = [sy * GW + sx];
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
const KEY = ['lake_mulduri', 'lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_nubi_crisis', 'lake_boss_entrance'];

test('도달성: 각 진행 상태에서 입구 스폰부터 다음 필수 목표까지 연속 경로가 있고, 닫힌 문 너머는 막혀 있다(몸 반지름 16)', () => {
  const s0 = reachable(START, CLIENT_HALF, SPAWN); // 물풀문 닫힘
  assert.equal(at(s0, point('lake_mulduri')), true, '정착지 물들이');
  assert.equal(at(s0, point('lake_wave_drum')) || at(s0, { x: point('lake_wave_drum').x - 40, y: point('lake_wave_drum').y }), true, '물결북 부근');
  for (const k of ['lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_nubi_crisis', 'lake_boss_entrance']) assert.equal(at(s0, point(k)), false, `${k}는 물풀문 전에는 닿을 수 없다`);
  const s1 = reachable(DRUM, CLIENT_HALF, SPAWN); // 물풀문 열림, 안전 물길 닫힘
  for (const k of ['lake_mulduri', 'lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route']) assert.equal(at(s1, point(k)), true, `${k} 도달`);
  for (const k of ['lake_nubi_crisis', 'lake_boss_entrance']) assert.equal(at(s1, point(k)), false, `${k}는 안전 물길 전에는 닿을 수 없다`);
  const s2 = reachable(SAFE, CLIENT_HALF, SPAWN); // 안전 물길 열림
  for (const k of KEY) assert.equal(at(s2, point(k)), true, `${k} 도달`);
});

test('통과 폭: 입구 → 정착지 → 미로 → 안전 물길 → 염색 샘 주 이동로는 몸 지름 32 + 좌우 12px(반지름 28)로도 이어진다', () => {
  const s = reachable(SAFE, 28, SPAWN);
  assert.equal(at(s, point('lake_mulduri')), true);
  for (const k of ['lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_nubi_crisis', 'lake_boss_entrance']) assert.equal(at(s, point(k)), true, `${k}까지 폭 56px 이상`);
});

test('경유지(시험·E2E용 길 경유지): 서버 승인 규칙으로 처음부터 끝까지 한 칸도 막히지 않고 이어진다', () => {
  const chain = [SPAWN, ...ROUTE_TO_BOSS];
  const solids = solidsFor(C, SAFE);
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const q = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      assert.equal(checkMove(C, solids, [], prev, q, CLIENT_HALF), 'ok', `(${prev.x | 0},${prev.y | 0})→(${q.x | 0},${q.y | 0})`);
      prev = q;
    }
  }
  // 깊은 물 연못 접근 경유지(마른 발판 1 → 남쪽 연못, 물풀문 앞 → 북쪽 연못)
  for (const [start, list] of [[DRY_1, DRY_1_TO_DEEP_SOUTH], [TO_GATE_FRONT[TO_GATE_FRONT.length - 1], TO_DEEP_NORTH]] as const) {
    let prev = start;
    for (const q of list) {
      const n = Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 4);
      for (let i = 1; i <= n; i++) assert.equal(checkMove(C, solids, [], prev, { x: prev.x + ((q.x - prev.x) * i) / n, y: prev.y + ((q.y - prev.y) * i) / n }, CLIENT_HALF), 'ok', `연못 접근 (${q.x},${q.y})`);
      prev = q;
    }
  }
  // 분기 경유지도 같다
  for (const k of ['a', 'b', 'c'] as const) {
    let prev = ROUTE_TO_JUNCTION[ROUTE_TO_JUNCTION.length - 1];
    for (const q of JUNCTION_TO[k]) {
      const n = Math.ceil(Math.hypot(q.x - prev.x, q.y - prev.y) / 4);
      for (let i = 1; i <= n; i++) assert.equal(checkMove(C, solids, [], prev, { x: prev.x + ((q.x - prev.x) * i) / n, y: prev.y + ((q.y - prev.y) * i) / n }, CLIENT_HALF), 'ok', `${k} 가지`);
      prev = q;
    }
  }
  for (const list of [C_TO_SAFE_ROUTE, JUNCTION_TO_SAFE_ROUTE, THROUGH_SAFE_GATE, TO_BOSS]) for (const q of list) assert.equal(safePosition(C, solids, [], q, CLIENT_HALF).corrected, false);
});

test('충돌·수역: blocker와 필수 이동 경로 겹침 0, 깊은 물 판정이 길을 가로지르는 구간 0, 핵심 지점·앵커·덫·문 중심이 서 있을 수 있는 자리다', () => {
  const solids = solidsFor(C, SAFE);
  const pts = [...KEY.map(point), ...WATER.anchors, ...WATER.traps];
  for (const p of pts) {
    assert.equal(solids.some((r) => p.x > r.x - CLIENT_HALF && p.x < r.x + r.width + CLIENT_HALF && p.y > r.y - CLIENT_HALF && p.y < r.y + r.height + CLIENT_HALF), false, `${(p as { id: string }).id} 몸이 벽과 겹침`);
    for (const d of WATER.areas.filter((w) => w.kind === 'deep')) assert.equal(p.x > d.x && p.x < d.x + d.width && p.y > d.y && p.y < d.y + d.height, false, `${(p as { id: string }).id}가 깊은 물 안`);
  }
  // 필수 경유지 선분이 깊은 물 영역을 지나지 않는다
  const deep = WATER.areas.filter((w) => w.kind === 'deep');
  const chain = [SPAWN, ...ROUTE_TO_BOSS];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    for (let k = 0; k <= 40; k++) {
      const x = a.x + ((b.x - a.x) * k) / 40;
      const y = a.y + ((b.y - a.y) * k) / 40;
      assert.equal(deep.some((d) => x > d.x - 8 && x < d.x + d.width + 8 && y > d.y - 8 && y < d.y + d.height + 8), false, `경유지 ${i} 깊은 물`);
    }
  }
  // 깊은 물은 실제로 걸어 들어갈 수 있다(걷기 영역과 이어짐)
  const reach = reachable(SAFE, 8, SPAWN);
  for (const d of deep) assert.equal(at(reach, { x: d.x + d.width / 2, y: d.y + d.height / 2 }), true, `${d.id} 접근 가능`);
});

test('문: 두 문은 동서 길목 단면 전체를 막고(닫히면 우회로가 없다), 서로 다른 사건으로 열리며 클라이언트 그림 위치가 문 사각형 안이다', () => {
  const g1 = C.gates.find((g) => g.id === 'gate_reed_maze')!;
  const g2 = C.gates.find((g) => g.id === 'gate_lake_safe_route')!;
  assert.deepEqual([g1.openEvent, g2.openEvent], ['lake_wave_drum_awakened', 'lake_safe_route_opened']);
  for (const g of LAKE.layout!.gates) {
    const art = (g as unknown as { art: { x: number; y: number; width: number; height: number } }).art;
    assert.ok(art.x >= g.x && art.x <= g.x + g.width, `${g.id} 그림 x`);
    assert.ok(art.y >= g.y - 20 && art.y <= g.y + g.height + 80, `${g.id} 그림 y`);
  }
  assert.ok(g1.x < point('lake_rescue_b').x && point('lake_safe_route').x < g2.x && g2.x < point('lake_nubi_crisis').x, '문 순서: 물풀문 → 구조 → 안전 물길 지점 → 안전 물길 문 → 누비 위기');
});

test('물살: 적용 뒤 결과 좌표는 언제나 이동 가능 영역이고 깊은 물 여유 밖이다(모든 물살·경계 입장 위치)', () => {
  const solids = solidsFor(C, SAFE);
  for (const f of WATER.currents) {
    for (const fy of [f.y + 4, f.y + f.height / 2, f.y + f.height - 4]) {
      for (const fx of [f.x + 4, f.x + f.width / 2, f.x + f.width - 4]) {
        if (checkMove(C, solids, [], { x: fx, y: fy }, { x: fx, y: fy }, SERVER_BODY_HALF) !== 'ok') continue;
        const st = newWaterState();
        const out = resolveWater(WATER, C, solids, lockedZonesFor(C, SAFE), SAFE, st, { x: fx, y: fy }, 10_000);
        if (out.kind !== 'pushed') continue;
        assert.equal(checkMove(C, solids, [], { x: fx, y: fy }, { x: out.x, y: out.y }), 'ok', `${f.id} (${fx | 0},${fy | 0})→(${out.x | 0},${out.y | 0})`);
        for (const d of WATER.areas.filter((w) => w.kind === 'deep')) assert.equal(out.x > d.x - SERVER_BODY_HALF && out.x < d.x + d.width + SERVER_BODY_HALF && out.y > d.y - SERVER_BODY_HALF && out.y < d.y + d.height + SERVER_BODY_HALF, false, `${f.id} 깊은 물 안으로 밀림`);
      }
    }
  }
});

test('구 좌표 복구: 옛 최종 전 좌표에 저장된 위치는 새 길 안이면 그대로, 아니면 이 플레이어가 쓸 수 있는 가장 가까운 안전 앵커로 복구된다', () => {
  // 51370ab 시절 기능 맵의 대표 좌표(문 앞 안뜰·홀·마른 발판·덫·위기 지점·보스 입구)
  const old = [{ x: 1440, y: 1350 }, { x: 1440, y: 1100 }, { x: 1900, y: 1000 }, { x: 2020, y: 1000 }, { x: 2400, y: 790 }, { x: 2370, y: 700 }, { x: 1990, y: 1085 }, { x: 2440, y: 945 }, { x: 900, y: 1500 }];
  const events = DRUM; // 안전 물길을 열지 않은 진행 중 사용자
  const solids = solidsFor(C, events);
  const reach = reachable(events, SERVER_BODY_HALF, SPAWN);
  for (const stored of old) {
    const safe = safePosition(C, solids, lockedZonesFor(C, events), stored);
    let p = { x: safe.x, y: safe.y };
    if (safe.corrected) {
      const back = returnTarget(WATER, C, solids, newWaterState(), stored, events);
      p = { x: back.x, y: back.y };
      assert.ok(WATER.anchors.some((a) => a.x === p.x && a.y === p.y) || (p.x === C.spawn.x && p.y === C.spawn.y), '앵커 또는 시작 지점');
      assert.ok(!['anchor_maze_exit'].includes(WATER.anchors.find((a) => a.x === p.x && a.y === p.y)?.id ?? ''), '문 너머 앵커는 쓰지 않는다');
    }
    assert.equal(at(reach, p), true, `(${stored.x},${stored.y}) → (${p.x},${p.y})가 도달 가능한 위치`);
  }
});

test('계약 불변: 상태 ID·사건 순서·보상 정의·체크포인트와 지점 ID가 C2-7A와 같다(좌표만 바뀌었다)', () => {
  const lake = STORY_EVENTS.filter((e) => e.id.startsWith('lake_') || e.id === 'underfloor_unlocked').map((e) => e.id);
  assert.deepEqual(lake, ['lake_unlocked', 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened', 'lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued', 'lake_safe_route_opened', 'lake_nubi_crisis_seen', 'lake_boss_defeated', 'lake_dye_thread_granted', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_chapter_complete_seen', 'lake_boss_aftermath_seen']);
  assert.deepEqual(EVENT_BY_ID.get('lake_boss_defeated')!.grant, [{ itemCode: 'water_dye_yarn', quantity: 1 }]);
  assert.equal(EVENT_BY_ID.get('lake_dye_thread_equipped')!.to, 'CH02_COMPLETE');
  assert.ok(CHECKPOINTS.includes('CH02_BOSS_DEFEATED' as never));
  assert.deepEqual(LAKE.points.map((p) => p.id).sort(), ['lake_boss_entrance', 'lake_mulduri', 'lake_nubi_crisis', 'lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_wave_drum']);
  assert.deepEqual(STORY_TRIGGERS.filter((t) => t.stageCode === 'lake').map((t) => t.id), ['lake_entry', 'lake_mulduri', 'lake_wave_drum', 'lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_nubi_crisis', 'lake_boss_entrance']);
  assert.deepEqual(WATER.anchors.map((a) => a.id), ['anchor_maze_entry', 'anchor_dry_1', 'anchor_dry_2', 'anchor_maze_exit']);
  // 배경 이미지는 C2-7A 그대로
  const png = readFileSync(join(__dirname, '..', '..', 'save-a-turby', 'src', 'assets', 'world', 'lake', 'lake-base.png'));
  assert.equal(createHash('sha256').update(png).digest('hex').toUpperCase(), '357342612CE77CE7E0E90FCF9EF96035221B3AFF34F754CC8F8FA4E8C215FE12');
});
