// 10-13 C2-2: 물풀 미로 이동 규칙 — 물풀문 개방, 얕은/깊은 물·물살·안전 앵커의 서버 권위 판정, 재접속 복원, 플레이어별 독립.
// 실제 지역 데이터(story-data/stages/lake.json)를 쓴다. 시험 시계는 now 인자로 직접 넘긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';
import { FakeDb } from './helpers/fake-prisma';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { RoomsGateway } from '../src/turby/rooms/rooms.gateway';
import { SessionService } from '../src/turby/session.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf, solidsFor, lockedZonesFor, checkMove } from '../src/turby/rooms/stage-collision';
import { DEEP_MARGIN_PX, MAX_CONSECUTIVE_PUSHES, SAFE_RETURN_PROTECT_MS, newWaterState, parseStageWater, resolveWater, returnTarget } from '../src/turby/rooms/stage-water';

const content = new StoryContentService();
const LAKE = content.stage('lake') as StageStoryData;
const C = collisionOf(LAKE, 3200, 2400, 'lake');
const WATER = parseStageWater(LAKE, C, 'lake')!;
const field = (id: string) => WATER.currents.find((f) => f.id === id)!;
const anchor = (id: string) => WATER.anchors.find((a) => a.id === id)!;
const area = (id: string) => WATER.areas.find((a) => a.id === id)!;

const CH01 = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const SETTLED = [...CH01, 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened'];
const BEFORE_DRUM = [...CH01, 'lake_entry_seen', 'lake_mulduri_met']; // 물결북 반응 전
const OPEN = SETTLED; // 입구 문·물살은 lake_wave_drum_awakened에서 파생(lake_safe_route_opened는 C2-3 구조 뒤)
const NUMBERS: Record<string, number> = { 'room.reconnectGraceMs': 1000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64, 'battle.encounterRadiusPx': 120 };

type P = '1' | '2';
function setup(events: string[] = OPEN) {
  const db = new FakeDb();
  for (const [id, dev] of [[1n, 'dev-water-one'], [2n, 'dev-water-two']] as const) {
    db.seed('player', { id, device_uuid: dev, nickname: `하늘${id}` });
    const nubi = db.rows('turby_character', {}).find((r) => r.code === 'nubi') ?? db.seed('turby_character', { code: 'nubi', name: '누비' });
    const inst = db.seed('turby_instance', { owner_player_id: id, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
    db.seed('player_story_progress', { player_id: id, checkpoint: 'CH02_SETTLEMENT_MET', nubi_growth_stage: 1, story_nubi_turby_instance_id: inst.id });
    for (const e of events) db.seed('player_story_event', { player_id: id, event_id: e });
  }
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d), number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  const gateway = new RoomsGateway(rooms, null as never, null as never);
  let clock = Date.now() + 60_000; // 입장 시각보다 뒤인 시험 시계
  const member = (p: P) => rooms.roomOf(p)!.members[0];
  const at = (p: P) => ({ x: Math.round(member(p).x), y: Math.round(member(p).y) });
  return {
    db,
    rooms,
    gateway,
    member,
    at,
    tick: (ms: number) => (clock += ms),
    async join(p: P) {
      await rooms.identify(`sock-${p}`, p === '1' ? 'dev-water-one' : 'dev-water-two');
      await rooms.createRoom(p, 'lake');
      rooms.startRoom(p);
      return rooms.enterMap(p, 'down');
    },
    // 시험 준비용: 서버가 승인한 위치를 직접 놓는다(이동 판정을 거치지 않는다)
    place(p: P, x: number, y: number) {
      member(p).x = x;
      member(p).y = y;
    },
    move(p: P, x: number, y: number, ms = 150) {
      clock += ms;
      return rooms.move(p, x, y, 'right', clock).result;
    },
  };
}

// ---------- 지역 데이터 ----------

test('지역 데이터: 물·물살·앵커가 3200×2400 안, ID 고유, 방향 단위벡터, 수치가 지시값(64/88px, 1200ms)이며 앵커는 서 있을 수 있는 자리다', () => {
  assert.deepEqual(WATER.areas.map((a) => a.kind).sort(), ['deep', 'deep', 'shallow']);
  assert.deepEqual(WATER.currents.map((f) => [f.id, f.pushDistancePx, f.cooldownMs]), [['current_weak_1', 64, 1200], ['current_strong_1', 88, 1200]]);
  for (const f of WATER.currents) assert.ok(Math.abs(Math.hypot(f.direction.x, f.direction.y) - 1) < 1e-9, `${f.id} 단위 벡터`);
  const ids = [...WATER.areas, ...WATER.currents, ...WATER.anchors].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of [...WATER.areas, ...WATER.currents]) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 3200 && r.y + r.height <= 2400, r.id);
  for (const a of WATER.anchors) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x <= 3200 && a.y <= 2400);
    for (const d of WATER.areas.filter((w) => w.kind === 'deep')) assert.ok(!(a.x > d.x - 20 && a.x < d.x + d.width + 20 && a.y > d.y - 20 && a.y < d.y + d.height + 20), `${a.id}가 깊은 물 근처`);
  }
  assert.equal(DEEP_MARGIN_PX, 12);
  assert.equal(MAX_CONSECUTIVE_PUSHES, 2);
  assert.equal(SAFE_RETURN_PROTECT_MS, 1500);
});

test('검증: 영벡터·중복 ID·지도 밖·깊은 물 위 앵커·앵커 없는 깊은 물은 서버가 받아들이지 않는다', () => {
  const clone = () => JSON.parse(JSON.stringify(LAKE)) as StageStoryData & { currentFields: Record<string, unknown>[]; waterAreas: Record<string, unknown>[]; safeAnchors: Record<string, unknown>[] };
  const bad = (patch: (d: ReturnType<typeof clone>) => void, re: RegExp) => {
    const d = clone();
    patch(d);
    assert.throws(() => parseStageWater(d, C, 'lake'), re);
  };
  bad((d) => (d.currentFields[0].direction = { x: 0, y: 0 }), /영벡터/);
  bad((d) => (d.currentFields[1].id = 'current_weak_1'), /id가 겹친다/);
  bad((d) => (d.waterAreas[1].x = 3100), /지도 밖/);
  bad((d) => (d.currentFields[0].pushDistancePx = 0), /pushDistancePx/);
  bad((d) => (d.currentFields[0].cooldownMs = 10), /cooldownMs/);
  bad((d) => (d.safeAnchors[1] = { id: 'anchor_dry_1', x: 2200, y: 1000, radius: 60 }), /깊은 물과 겹친다/);
  bad((d) => (d.safeAnchors = []), /safeAnchors가 없다/);
  bad((d) => (d.currentFields[0].direction = { x: 1, y: 0 }) && (d.currentFields[0].x = 3100), /지도 밖/);
});

// ---------- 물풀문 ----------

test('물풀문: 물결북 사건(lake_wave_drum_awakened) 전에는 통과할 수 없고, 기록된 뒤에는 그 플레이어만 통과한다', async () => {
  const s = setup(BEFORE_DRUM); // 물결북 사건이 아직 없다
  await s.join('1');
  const gate = C.gates.find((g) => g.id === 'gate_reed_maze')!;
  const front = { x: gate.x + gate.width / 2, y: gate.y + gate.height + 40 }; // 문 아래(안뜰)
  const beyond = { x: front.x, y: gate.y - 40 };
  const before = new Set(BEFORE_DRUM);
  assert.equal(checkMove(C, solidsFor(C, before), lockedZonesFor(C, before), front, beyond), 'tunnel');
  s.place('1', front.x, front.y);
  const r = s.move('1', beyond.x, beyond.y);
  assert.equal(r.kind, 'corrected');
  assert.deepEqual(s.at('1'), { x: front.x, y: front.y }, '거절되면 마지막 승인 위치');
  s.rooms.noteStoryEvents('1', ['lake_wave_drum_awakened']);
  s.place('1', front.x, front.y);
  assert.equal(s.move('1', front.x, front.y - 24).kind, 'ok');
  assert.equal(s.move('1', front.x, front.y - 48).kind, 'ok');
  // 다른 플레이어(이벤트 없음)는 같은 방이 아니므로 서로 영향이 없다 — 판정은 각자의 이벤트 기준
  assert.equal(checkMove(C, solidsFor(C, new Set(OPEN)), lockedZonesFor(C, new Set(OPEN)), front, beyond), 'ok');
});

// ---------- 물살 ----------

test('물살은 lake_wave_drum_awakened가 있는 플레이어에게만 적용된다(없으면 같은 자리에서도 밀리지 않는다)', async () => {
  assert.deepEqual(WATER.currents.map((f) => f.requires), [['lake_wave_drum_awakened'], ['lake_wave_drum_awakened']]);
  const s = setup(BEFORE_DRUM);
  await s.join('1');
  s.place('1', 1600, 1000);
  assert.equal(s.move('1', 1630, 1000).kind, 'ok');
  assert.deepEqual(s.at('1'), { x: 1630, y: 1000 });
  s.rooms.noteStoryEvents('1', ['lake_wave_drum_awakened']);
  s.place('1', 1600, 1000);
  s.tick(2000);
  assert.equal(s.move('1', 1630, 1000).kind, 'adjusted');
});

test('물결북 완료 뒤에도 lake_safe_route_opened는 기록되지 않는다(C2-3 구조 뒤 안전 물길의 사건) — 문은 물결북 사건에서 파생', () => {
  const gate = C.gates.find((g) => g.id === 'gate_reed_maze')!;
  assert.equal(gate.openEvent, 'lake_wave_drum_awakened');
  assert.equal(OPEN.includes('lake_safe_route_opened'), false);
  assert.equal(JSON.stringify(LAKE).includes('lake_safe_route_opened'), false, '지역 데이터가 이 사건을 요구·표시 조건으로 쓰지 않는다');
});

test('물살 밖의 이동은 일반 이동과 같다(위치 그대로 승인, 밀림 없음)', async () => {
  const s = setup();
  await s.join('1');
  s.place('1', 1440, 1100);
  const r = s.move('1', 1470, 1080);
  assert.deepEqual([r.kind, s.at('1')], ['ok', { x: 1470, y: 1080 }]);
});

test('물살 안: 지역 데이터의 방향·거리(64px)만 적용되고, 같은 물살은 cooldown 동안 다시 적용되지 않는다', async () => {
  const s = setup();
  await s.join('1');
  s.place('1', 1600, 1000);
  const r = s.move('1', 1630, 1000); // 물살(x 1620~1940) 안으로 들어옴
  assert.deepEqual(r, { kind: 'adjusted', x: 1694, y: 1000, dir: 'right', reason: 'current', currentFieldId: 'current_weak_1' });
  assert.deepEqual(s.at('1'), { x: 1694, y: 1000 });
  // 1,200ms 안에 다시: 적용 없음
  const r2 = s.move('1', 1720, 1000, 300);
  assert.equal(r2.kind, 'ok');
  assert.deepEqual(s.at('1'), { x: 1720, y: 1000 });
  // cooldown이 지나면 한 번 더(연속 2회까지)
  const r3 = s.move('1', 1740, 1000, 1300);
  assert.equal(r3.kind, 'adjusted');
  assert.equal((r3 as { x: number }).x, 1740 + 64);
  // 연속 상한(2회): 아직 물살 안에 있어도 더 밀지 않는다
  s.tick(1300);
  const r4 = s.move('1', 1810, 1000, 0);
  assert.equal(r4.kind, 'ok');
});

test('위조: 물살 ID·방향·거리·목적지를 요청에 실어도 결과는 서버 데이터로만 정해진다', async () => {
  const s = setup();
  await s.join('1');
  s.place('1', 1600, 1000);
  const sent: unknown[] = [];
  const client = { id: 'sock-1', emit: (...a: unknown[]) => sent.push(a), to: () => ({ emit: () => undefined }) };
  s.member('1').lastMoveAt = 0; // 게이트웨이는 실제 시계를 쓰므로 전송 빈도 제한을 비운다
  // 게이트웨이는 x·y·dir만 읽는다. 아래 위조 필드는 어디에도 쓰이지 않는다.
  await s.gateway.move(client as never, { x: 1630, y: 1000, dir: 'right', currentFieldId: 'current_strong_1', pushDistancePx: 9999, direction: { x: 0, y: -1 }, destination: { x: 10, y: 10 } } as never);
  assert.deepEqual(s.at('1'), { x: 1694, y: 1000 }, '약한 물살 64px 동쪽만 적용');
  const payload = (sent[0] as [string, { reason: string; currentFieldId: string }])[1];
  assert.equal(sent.length, 1);
  assert.deepEqual([payload.reason, payload.currentFieldId], ['current', 'current_weak_1'], '서버가 정한 물살 ID');
  // 물살 밖에서의 위조 필드는 밀림을 만들지 못한다
  s.place('1', 1440, 1100);
  s.member('1').lastMoveAt = 0;
  await s.gateway.move(client as never, { x: 1450, y: 1100, dir: 'right', currentFieldId: 'current_weak_1', pushDistancePx: 500 } as never);
  assert.deepEqual(s.at('1'), { x: 1450, y: 1100 });
});

test('목적지 보정: 밀림 목적지가 벽·깊은 물 여유와 겹치면 선분을 따라 가장 가까운 통행 가능 지점까지만 밀린다', () => {
  const st = newWaterState();
  const solids = solidsFor(C, new Set(OPEN));
  const locked = lockedZonesFor(C, new Set(OPEN));
  // 강한 물살(y 725~855)에서 동쪽 끝: 목적지가 동쪽 벽(x 2520) 안이면 벽 앞에서 멈춘다
  const f = field('current_strong_1');
  const nearWall = { x: f.x + f.width - 5, y: 790 }; // 2415
  const out = resolveWater(WATER, C, solids, locked, new Set(OPEN), st, nearWall, 10_000);
  assert.equal(out.kind, 'pushed');
  if (out.kind === 'pushed') {
    assert.ok(out.x > nearWall.x && out.x <= 2520 - 8, `벽 앞 ${out.x}`);
    assert.equal(out.y, 790);
  }
  // 깊은 물 쪽으로 미는 물살(시험용 데이터): 깊은 물 여유(몸 반지름 + 12) 밖에서 멈춘다
  const pool = area('deep_pool_south');
  const dataDown = { ...WATER, currents: [{ ...field('current_weak_1'), id: 'down', x: pool.x, y: pool.y - 130, width: pool.width, height: 120, direction: { x: 0, y: 1 }, pushDistancePx: 88 }] };
  const from = { x: pool.x + 100, y: pool.y - 40 };
  const r = resolveWater(dataDown, C, solids, locked, new Set(OPEN), newWaterState(), from, 20_000);
  assert.equal(r.kind, 'pushed');
  if (r.kind === 'pushed') assert.ok(r.y <= pool.y - 8 - DEEP_MARGIN_PX, `깊은 물 여유 밖 ${r.y}`);
  // 밀 자리가 전혀 없으면 적용 횟수를 쓰지 않고 그대로
  const blockedState = newWaterState();
  const none = resolveWater({ ...WATER, currents: [{ ...field('current_weak_1'), id: 'wall', x: 1300, y: 1160, width: 100, height: 30, direction: { x: 0, y: 1 }, pushDistancePx: 60 }] }, C, solids, locked, new Set(OPEN), blockedState, { x: 1340, y: 1170 }, 1);
  assert.equal(blockedState.consecutive, none.kind === 'pushed' ? 1 : 0);
});

// ---------- 깊은 물·안전 앵커 ----------

test('깊은 물: 마지막으로 확정한 안전 앵커로 돌아가고, 진행 이벤트·체크포인트·아이템은 그대로이며, 복귀 직후 1,500ms는 물살이 적용되지 않는다', async () => {
  const s = setup();
  await s.join('1');
  const events = () => s.db.rows('player_story_event', { player_id: 1n }).length;
  const items = () => s.db.rows('player_item', { player_id: 1n }).length;
  const before = [events(), items()];
  // 마른 발판 1에 서서 앵커를 확정한다
  const dry = anchor('anchor_dry_1');
  s.place('1', dry.x - 20, dry.y);
  assert.equal(s.move('1', dry.x, dry.y).kind, 'ok');
  // 깊은 물(남쪽 연못)로 들어간다
  const pool = area('deep_pool_south');
  s.place('1', pool.x - 30, pool.y + 100);
  const r = s.move('1', pool.x + 10, pool.y + 100);
  assert.deepEqual(r, { kind: 'adjusted', x: dry.x, y: dry.y, dir: 'right', reason: 'deep_water', currentFieldId: null });
  assert.deepEqual(s.at('1'), { x: dry.x, y: dry.y });
  assert.deepEqual([events(), items()], before, '진행 손실·추가 없음');
  // 보호 시간: 곧바로 물살 안으로 걸어 들어가도 밀리지 않는다
  s.place('1', 1610, 1000);
  assert.equal(s.move('1', 1640, 1000, 600).kind, 'ok');
  // 보호가 끝난 뒤에는 다시 적용(다른 물살 구역 밖으로 나갔다 들어온 새 진입)
  s.place('1', 1500, 1000);
  assert.equal(s.move('1', 1510, 1000, 1000).kind, 'ok');
  s.place('1', 1610, 1000);
  assert.equal(s.move('1', 1640, 1000, 200).kind, 'adjusted');
});

test('앵커를 한 번도 밟지 않았다면 가장 가까운 유효 앵커로, 다른 플레이어의 앵커와는 무관하게 돌아간다', async () => {
  const s = setup();
  await s.join('1');
  const pool = area('deep_pool_north');
  s.place('1', pool.x - 40, pool.y + 40);
  const r = s.move('1', pool.x + 20, pool.y + 40);
  assert.equal(r.kind, 'adjusted');
  const near = WATER.anchors.map((a) => ({ a, d: Math.hypot(a.x - (pool.x + 20), a.y - (pool.y + 40)) })).sort((x, y) => x.d - y.d)[0].a;
  assert.deepEqual(s.at('1'), { x: near.x, y: near.y });
});

// ---------- 재접속 ----------

test('저장된 위치가 깊은 물·벽 안·닫힌 문 안이면 재접속 때 이 플레이어의 안전 앵커(없으면 가장 가까운 앵커)로 복원된다', async () => {
  const s = setup();
  await s.join('1');
  const dry = anchor('anchor_dry_1');
  s.place('1', dry.x, dry.y);
  s.move('1', dry.x + 5, dry.y); // 앵커 확정
  const pool = area('deep_pool_south');
  // 깊은 물 안에 저장된 상태로 재입장
  s.place('1', pool.x + 50, pool.y + 100);
  const e1 = await s.rooms.enterMap('1', 'down');
  assert.deepEqual([e1.self.x, e1.self.y, e1.corrected], [dry.x, dry.y, true]);
  // 벽 안에 저장된 상태
  const wall = C.blockers.find((b) => b.id === 'wall_hall_south')!;
  s.place('1', wall.x + 100, wall.y + 20);
  const e2 = await s.rooms.enterMap('1', 'down');
  assert.deepEqual([e2.self.x, e2.self.y, e2.corrected], [dry.x, dry.y, true]);
  // 정상 위치는 그대로
  s.place('1', 1700, 1000);
  const e3 = await s.rooms.enterMap('1', 'down');
  assert.deepEqual([e3.self.x, e3.self.y, e3.corrected], [1700, 1000, false]);
  // 닫힌 문 안(문 개방 전 계정): 가장 가까운 유효 앵커
  const t = setup(BEFORE_DRUM);
  await t.join('1');
  const gate = C.gates.find((g) => g.id === 'gate_reed_maze')!;
  t.place('1', gate.x + 150, gate.y + 25);
  const e4 = await t.rooms.enterMap('1', 'down');
  assert.equal(e4.corrected, true);
  assert.ok(WATER.anchors.some((a) => a.x === e4.self.x && a.y === e4.self.y), '앵커 위로 복원');
});

test('물살 도중 연결이 끊겨도 서버가 확정한 마지막 위치가 기준이다(클라이언트 예상 좌표를 쓰지 않는다)', async () => {
  const s = setup();
  await s.join('1');
  s.place('1', 1600, 1000);
  const r = s.move('1', 1630, 1000);
  assert.equal(r.kind, 'adjusted');
  // 클라이언트가 밀린 뒤의 위치를 보고하기 전에 끊김 → 유예 안에 다시 접속해 입장
  s.rooms.disconnect('sock-1');
  await s.rooms.identify('sock-1b', 'dev-water-one');
  const e = await s.rooms.enterMap('1', 'down');
  assert.deepEqual([e.self.x, e.self.y, e.corrected], [1694, 1000, false]);
});

// ---------- 다인 독립 ----------

test('두 플레이어가 같은 물살에 있어도 cooldown·연속 횟수·안전 앵커를 서로 공유하지 않는다', async () => {
  const s = setup();
  await s.join('1');
  await s.join('2');
  s.place('1', 1600, 1000);
  s.place('2', 1600, 1000);
  const a = s.move('1', 1630, 1000);
  const b = s.move('2', 1630, 1000, 10); // 1번이 막 밀린 직후 같은 물살
  assert.equal(a.kind, 'adjusted');
  assert.equal(b.kind, 'adjusted', '2번도 자기 판정으로 밀린다');
  // 1번의 cooldown 중에도 2번의 상태는 따로다
  assert.equal(s.move('1', 1720, 1000, 300).kind, 'ok');
  assert.notEqual(s.member('1').water, s.member('2').water);
  // 안전 앵커: 1번만 마른 발판을 밟았다
  const dry = anchor('anchor_dry_1');
  s.place('1', dry.x, dry.y);
  s.move('1', dry.x + 3, dry.y, 200);
  assert.equal(s.member('1').water.anchorId, 'anchor_dry_1');
  assert.notEqual(s.member('2').water.anchorId, 'anchor_dry_1');
  // 같은 깊은 물에 들어가면 각자의 앵커로 돌아간다
  const pool = area('deep_pool_south');
  s.place('1', pool.x - 30, pool.y + 100);
  s.place('2', pool.x - 30, pool.y + 100);
  s.move('1', pool.x + 10, pool.y + 100, 200);
  s.move('2', pool.x + 10, pool.y + 100, 200);
  assert.deepEqual(s.at('1'), { x: dry.x, y: dry.y });
  const nearest = returnTarget(WATER, C, solidsFor(C, new Set(OPEN)), newWaterState(), { x: pool.x + 10, y: pool.y + 100 });
  assert.deepEqual(s.at('2'), { x: nearest.x, y: nearest.y }, '2번은 자기 상태(앵커 없음)로 가장 가까운 앵커');
});

test('안전 앵커로 복귀하는 위치는 언제나 통행 가능하고 깊은 물 밖이다(모든 앵커)', () => {
  const solids = solidsFor(C, new Set(OPEN));
  for (const a of WATER.anchors) {
    assert.equal(checkMove(C, solids, [], a, a), 'ok', a.id);
    assert.equal(WATER.areas.some((w) => w.kind === 'deep' && a.x > w.x && a.x < w.x + w.width && a.y > w.y && a.y < w.y + w.height), false, a.id);
  }
});

test('에셋 파일: 물살·물풀문 세 에셋이 런타임 폴더에 있다(키=파일명)', () => {
  const root = join(__dirname, '..', '..', 'save-a-turby', 'src', 'assets', 'world', 'lake');
  for (const f of ['fx/current-flow.png', 'maze/reed-gate-closed.png', 'maze/reed-gate-open.png']) assert.ok(existsSync(join(root, f)), f);
});
