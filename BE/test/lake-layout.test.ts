// 10-14 C2-7B: 최종 호수 배경에 맞춘 이동·충돌·수역·사건 좌표 정합성 계약. 10-15 C2-7C: 충돌 띠 병합(개수·DTO 크기·판정 시간·누출·우회)과 문·구조 장면 표시 거리.
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
function reachable(events: Set<string>, half: number, from: { x: number; y: number }, coll = C): Uint8Array {
  const blocked = new Uint8Array(GW * GH);
  for (const r of solidsFor(coll, events)) {
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

// ----- 10-15 C2-7C: 충돌 띠 병합 -----
// C2-7B(127b28a)의 가는 띠 1279개(시험 고정 자료)로 만든 같은 지역의 충돌 계약 — 병합 전후 비교용
const FINE = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lake-blockers-c27b.json'), 'utf8')) as { blockers: number[][] }).blockers;
const C_FINE = collisionOf({ ...LAKE, layout: { ...LAKE.layout!, blockers: FINE.map(([x, y, width, height], i) => ({ id: `edge_${i}`, x, y, width, height })) } }, 3200, 2400, 'lake');

test('병합 상한: blocker 300개 이하, StageView layout.blockers 직렬화 30KB 이하, 원래 막힌 칸만 덮는다', () => {
  const blockers = LAKE.layout!.blockers;
  assert.ok(blockers.length <= 300, `blocker ${blockers.length}개`);
  const bytes = Buffer.byteLength(JSON.stringify(blockers.map((b) => ({ id: b.id, label: b.label, x: b.x, y: b.y, width: b.width, height: b.height }))));
  assert.ok(bytes <= 30 * 1024, `DTO blockers ${bytes} bytes`);
  // 병합은 원래 막힌 칸만 덮는다 — 새 blocker는 모두 C2-7B 띠의 합집합 안이다(길을 새로 막지 않는다)
  const fine = new Uint8Array(GW * GH);
  for (const [x, y, w, h] of FINE) for (let gy = y / CELL; gy < (y + h) / CELL; gy++) for (let gx = x / CELL; gx < (x + w) / CELL; gx++) fine[gy * GW + gx] = 1;
  for (const b of blockers) for (let gy = b.y / CELL; gy < (b.y + b.height) / CELL; gy++) for (let gx = b.x / CELL; gx < (b.x + b.width) / CELL; gx++) assert.equal(fine[gy * GW + gx], 1, `${b.id}가 C2-7B에서 열린 칸(${gx * CELL},${gy * CELL})을 막는다`);
});

test('병합 후 도달성·누출·우회: 반지름 8·16·28에서 세 진행 상태의 필수 목표가 C2-7B만큼 닿고, 닫힌 문 우회 0, C2-7B 도달 영역 밖으로 32px 넘게 새는 칸 0', () => {
  const gateBlocked: [Set<string>, string[]][] = [
    [START, ['lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c', 'lake_safe_route', 'lake_nubi_crisis', 'lake_boss_entrance']],
    [DRUM, ['lake_nubi_crisis', 'lake_boss_entrance']],
    [SAFE, []],
  ];
  for (const half of [SERVER_BODY_HALF, CLIENT_HALF, 28]) {
    for (const [events, closed] of gateBlocked) {
      const now = reachable(events, half, SPAWN);
      const before = reachable(events, half, SPAWN, C_FINE);
      for (const k of KEY) {
        if (closed.includes(k)) assert.equal(at(now, point(k)), false, `반지름 ${half}: 닫힌 문 너머 ${k}에 닿는다(우회)`);
        else if (at(before, point(k))) assert.equal(at(now, point(k)), true, `반지름 ${half}: C2-7B에서 닿던 ${k}에 닿지 않는다`);
      }
      // 누출: 지금 닿는 칸은 C2-7B(서버 몸 반지름 8)에서 닿던 칸에서 32px(4칸) 안이다 — 장식·깊은 물 쪽으로 새 길이 생기지 않았다
      const base = half === SERVER_BODY_HALF ? before : reachable(events, SERVER_BODY_HALF, SPAWN, C_FINE);
      const near = new Uint8Array(GW * GH);
      for (let i = 0; i < GW * GH; i++) {
        if (!base[i]) continue;
        const x = i % GW;
        const y = (i - x) / GW;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < GW && y + dy < GH) near[(y + dy) * GW + x + dx] = 1;
      }
      let leak = 0;
      for (let i = 0; i < GW * GH; i++) if (now[i] && !near[i]) leak++;
      assert.equal(leak, 0, `반지름 ${half}: 새는 칸 ${leak}개`);
    }
  }
});

test('판정 비용: 대표 이동 묶음 checkMove 10,000회가 C2-7B(띠 1279개)보다 빠르다(같은 프로세스)', (t) => {
  // 대표 이동: 시험 경유지 전체를 4px 걸음으로 쪼갠 이동(안전 물길 열림 상태)을 10,000회가 될 때까지 되풀이
  const chain = [SPAWN, ...ROUTE_TO_BOSS];
  const moves: [{ x: number; y: number }, { x: number; y: number }][] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    for (let k = 0; k < n; k++) moves.push([{ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n }]);
  }
  const batch = Array.from({ length: 10_000 }, (_, i) => moves[i % moves.length]);
  const run = (coll: typeof C) => {
    const solids = solidsFor(coll, SAFE);
    let ok = 0;
    const t0 = performance.now();
    for (const [a, b] of batch) if (checkMove(coll, solids, [], a, b) === 'ok') ok++;
    return { ms: performance.now() - t0, ok };
  };
  run(C_FINE);
  run(C); // 데우기(JIT)
  const fine = run(C_FINE);
  const merged = run(C);
  t.diagnostic(`checkMove 10,000회: C2-7B 띠 ${FINE.length}개 ${fine.ms.toFixed(1)}ms(ok ${fine.ok}) → 병합 ${LAKE.layout!.blockers.length}개 ${merged.ms.toFixed(1)}ms(ok ${merged.ok})`);
  assert.equal(merged.ok, fine.ok, '같은 이동 묶음의 판정 결과가 같다');
  assert.ok(merged.ms < fine.ms, `병합 후 ${merged.ms.toFixed(1)}ms < C2-7B ${fine.ms.toFixed(1)}ms`);
});

test('문 화면 위치: 닫힌 문 그림·열린 문 조각의 화면 중심과 서버 문 사각형 중심의 차이 24px 이하, 열린 문은 가운데 틈이 있다', () => {
  type Box = { x: number; y: number; width: number; height: number; pivot?: [number, number] };
  const box = (r: Box) => {
    const [px, py] = r.pivot ?? [0.5, 0.5];
    return { x0: r.x - r.width * px, y0: r.y - r.height * py, x1: r.x - r.width * px + r.width, y1: r.y - r.height * py + r.height };
  };
  for (const g of LAKE.layout!.gates) {
    const gc = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    const closed = box(g.art!);
    assert.ok(Math.hypot((closed.x0 + closed.x1) / 2 - gc.x, (closed.y0 + closed.y1) / 2 - gc.y) <= 24, `${g.id} 닫힌 문 그림 중심`);
    assert.ok(closed.x1 - closed.x0 <= 64, `${g.id} 닫힌 문 그림 너비 ${closed.x1 - closed.x0}(길목보다 과도하게 크지 않다)`);
    const pieces = (g.openPieces ?? []).map(box);
    assert.equal(pieces.length, 2, `${g.id} 열린 문 조각 2개(위·아래 기둥)`);
    const u = { x0: Math.min(...pieces.map((p) => p.x0)), y0: Math.min(...pieces.map((p) => p.y0)), x1: Math.max(...pieces.map((p) => p.x1)), y1: Math.max(...pieces.map((p) => p.y1)) };
    assert.ok(Math.hypot((u.x0 + u.x1) / 2 - gc.x, (u.y0 + u.y1) / 2 - gc.y) <= 24, `${g.id} 열린 문 조각 중심`);
    const [top, bottom] = [...pieces].sort((a, b) => a.y0 - b.y0);
    assert.ok(bottom.y0 - top.y1 >= 24, `${g.id} 열린 문 가운데 틈 ${bottom.y0 - top.y1}px`);
  }
});

// 그림의 보이는 외곽(투명 여백 제외) — 원본 PNG 알파(>40) 경계를 표시 크기로 줄인 값. 물들이 512px→88, 젖은 꿰매기 128px 프레임(4프레임 합)→104
const VISIBLE = { mulduri: { x0: 44 / 512, y0: 49 / 512, x1: 485 / 512, y1: 459 / 512 }, guard: { x0: 5 / 128, y0: 13 / 128, x1: 126 / 128, y1: 128 / 128 } };
type Box = { x0: number; y0: number; x1: number; y1: number };
const visibleBox = (x: number, y: number, w: number, h: number, pivot: [number, number], v: Box): Box => {
  const left = x - w * pivot[0];
  const top = y - h * pivot[1];
  return { x0: left + w * v.x0, y0: top + h * v.y0, x1: left + w * v.x1, y1: top + h * v.y1 };
};
const boxGap = (a: Box, b: Box) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1); // 양수 = 떨어진 간격, 0 이하 = 겹침

test('구조 장면 표시(C2-7D): 붙잡힌 물들이·지키는 적의 보이는 외곽이 서로 8px 이상 떨어지고, 적은 다가오는 길 반대쪽 모래 위(blocker 밖)다. 사건 좌표·반경은 그대로', () => {
  const ov = LAKE.render!.overlays!;
  const blockers = LAKE.layout!.blockers;
  // 사건 좌표·반경은 C2-7B와 같다
  assert.deepEqual(['a', 'b', 'c'].map((k) => { const p = point(`lake_rescue_${k}`); return [p.x, p.y, p.radius]; }), [[1933, 1083, 90], [1638, 884, 90], [1600, 1465, 90]]);
  for (const k of ['a', 'b', 'c'] as const) {
    const pt = point(`lake_rescue_${k}`);
    const look = LAKE.storyPoints!.find((p) => p.id === `lake_rescue_${k}`)!.art!;
    const m = visibleBox(pt.x, pt.y, look.width, look.height, look.pivot ?? [0.5, 0.7], VISIBLE.mulduri);
    const guards = ov.filter((o) => o.id.startsWith(`overlay_guard_${k}`));
    assert.equal(guards.length, k === 'c' ? 2 : 1);
    const gb = guards.map((o) => ({ id: o.id, o, box: visibleBox(o.x, o.y, o.width, o.height, o.pivot ?? [0.5, 0.5], VISIBLE.guard) }));
    const route = JUNCTION_TO[k];
    const from = route[Math.max(0, route.length - 3)]; // 다가오는 쪽
    for (const g of gb) {
      assert.ok(boxGap(g.box, m) >= 8, `${g.id} ↔ 물들이 보이는 외곽 간격 ${boxGap(g.box, m).toFixed(1)}px`);
      assert.equal(blockers.some((b) => g.o.x > b.x - 12 && g.o.x < b.x + b.width + 12 && g.o.y > b.y - 12 && g.o.y < b.y + b.height + 12), false, `${g.id} 발이 blocker 안`);
      // 접근 반대쪽: 사건 지점에서 적 쪽 방향이 다가오는 방향과 같은 쪽(내적 > 0)
      const dot = (g.o.x - pt.x) * (pt.x - from.x) + (g.o.y - pt.y) * (pt.y - from.y);
      assert.ok(dot > 0, `${g.id}가 다가오는 쪽에 있다`);
    }
    for (let i = 0; i < gb.length; i++) for (let j = i + 1; j < gb.length; j++) assert.ok(boxGap(gb[i].box, gb[j].box) >= 8, `적끼리 보이는 외곽 간격 ${boxGap(gb[i].box, gb[j].box).toFixed(1)}px`);
  }
});

test('최종 표식 모드(C2-7D): 호수 render.markerMode는 final이다', () => {
  assert.equal(LAKE.render!.markerMode, 'final');
});
