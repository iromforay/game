// 10-02 v4 §1·§2: 서버 권위 입장 위치와 이동 충돌 검증. 실제 지역 데이터(story-data/stages/forest.json)의 회색상자 배치를 쓴다.
// 좌표는 임시지만 규칙은 그대로다: 입장 좌표는 서버가 정하고, 이동은 마지막 승인 위치에서의 선분으로 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { SessionService } from '../src/turby/session.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { RoomError } from '../src/turby/rooms/types';
import { HttpException } from '@nestjs/common';
import { checkMove, collisionOf, lockedZonesFor, pointBlocked, reachable, safePosition, segmentCrosses, solidsFor, SERVER_BODY_HALF } from '../src/turby/rooms/stage-collision';
import { BEYOND_ROOT, BOPULI, CUT, eastAt, HIDDEN_INSIDE, KNOT, pointData, ROOT_FRONT, ROOT_GATE, WIND_FRONT, WIND_GATE, walkRoute } from './helpers/forest-geo';

const realContent = new StoryContentService();
const FOREST = realContent.stage('forest') as StageStoryData;
const C = collisionOf(FOREST, 3200, 2400);
const SPAWN = FOREST.spawnPoint!;
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
const P = '1';
const BASE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned'];
const COMPASS = [...BASE, 'forest_compass_granted'];

// ---------- 순수 함수 ----------

test('충돌 데이터: 시작 지점·경계·막힌 곳·문·잠긴 구역을 지역 데이터에서 읽는다. 데이터가 없는 지역은 한가운데에서 시작하고 막힌 곳이 없다', () => {
  assert.deepEqual([C.width, C.height, C.spawn], [3200, 2400, SPAWN]);
  assert.equal(C.blockers.length, FOREST.layout!.blockers.length, '지도에 숨긴 벽도 통과 판정에는 모두 쓴다');
  assert.deepEqual(C.gates.map((g) => [g.id, g.openEvent]), [['gate_hidden_path', 'forest_hidden_path_opened'], ['gate_root', 'forest_first_knot_equipped']]);
  assert.deepEqual(C.zones.map((z) => [z.id, z.accessAfter]), [['zone_hidden', 'forest_hidden_path_opened'], ['zone_root_gate', 'forest_first_knot_equipped']]);
  assert.ok(!pointBlocked(solidsFor(C, new Set()), C.spawn), '시작 지점은 막힌 곳이 아니다');
  const none = collisionOf(null, 4000, 3000);
  assert.deepEqual([none.spawn, none.blockers.length, none.gates.length], [{ x: 2000, y: 1500 }, 0, 0]);
});

test('선분 판정: 사각형 내부를 지나면 관통, 가장자리를 스치거나 바깥을 지나면 통과', () => {
  const r = { x: 100, y: 100, width: 40, height: 200 };
  assert.equal(segmentCrosses(r, { x: 50, y: 200 }, { x: 200, y: 200 }), true, '얇은 벽을 가로지르는 큰 점프');
  assert.equal(segmentCrosses(r, { x: 50, y: 50 }, { x: 200, y: 50 }), false, '벽 위쪽으로 지나감');
  assert.equal(segmentCrosses(r, { x: 100, y: 0 }, { x: 100, y: 400 }), false, '왼쪽 가장자리를 따라감');
  assert.equal(segmentCrosses(r, { x: 50, y: 99 }, { x: 99, y: 150 }), false, '모서리 바깥');
  assert.equal(segmentCrosses(r, { x: 50, y: 90 }, { x: 150, y: 110 }), true, '모서리를 잘라 내부를 지남');
  assert.equal(segmentCrosses(r, { x: 120, y: 150 }, { x: 120, y: 150 }), true, '벽 안의 제자리');
  assert.equal(segmentCrosses(r, { x: 120, y: 150 }, { x: 300, y: 150 }), true, '벽 안에서 밖으로');
  assert.equal(segmentCrosses(r, { x: 50, y: 200 }, { x: 90, y: 200 }), false, '벽 앞에서 멈춤');
});

test('이동 판정: 지도 밖·벽 끝점·선분 관통·닫힌 문·잠긴 구역을 거절하고, 문이 열리면 통과한다', () => {
  const closed = new Set(COMPASS);
  const solids = solidsFor(C, closed);
  const locked = lockedZonesFor(C, closed);
  const front = WIND_FRONT; // 숨은 길 문 바로 앞
  const gateIn = { x: WIND_GATE.x + 10, y: front.y };
  const beyond = { x: WIND_GATE.x + WIND_GATE.width + 30, y: front.y };
  const mid = { x: 1800, y: 940 }; // 숨은 길 입구 앞 길(먼지풀 아래)
  assert.equal(checkMove(C, solids, locked, SPAWN, { x: SPAWN.x + 30, y: SPAWN.y - 20 }), 'ok');
  assert.equal(checkMove(C, solids, locked, SPAWN, { x: -1, y: SPAWN.y }), 'out_of_bounds');
  assert.equal(checkMove(C, solids, locked, SPAWN, { x: 3201, y: SPAWN.y }), 'out_of_bounds');
  assert.equal(checkMove(C, solids, locked, SPAWN, { x: Number.NaN, y: SPAWN.y }), 'out_of_bounds');
  assert.equal(checkMove(C, solids, locked, mid, { x: 1800, y: 840 }), 'blocked', '먼지풀 안으로');
  assert.equal(checkMove(C, solids, locked, mid, { x: 1800, y: 780 }), 'tunnel', '먼지풀을 건너뛰는 점프');
  assert.equal(checkMove(C, solids, locked, front, gateIn), 'blocked', '닫힌 문 안으로');
  assert.equal(checkMove(C, solids, locked, front, beyond), 'tunnel', '닫힌 문을 건너뛰는 점프');
  assert.equal(checkMove(C, solids, locked, { x: front.x, y: front.y - 70 }, { x: beyond.x, y: front.y + 10 }), 'tunnel', '벽을 비스듬히 관통');
  assert.equal(checkMove(C, solids, locked, HIDDEN_INSIDE, { x: HIDDEN_INSIDE.x + 20, y: HIDDEN_INSIDE.y }), 'locked_zone', '어떻게든 안에 있어도 잠긴 구역 안의 이동은 승인하지 않는다');
  // 벽에 붙어 걷는 정상 위치(클라이언트 몸 반지름 16)는 통과한다
  assert.equal(checkMove(C, solids, locked, { x: WIND_GATE.x - 24, y: front.y }, { x: WIND_GATE.x - 24, y: front.y + 30 }), 'ok');
  assert.ok(SERVER_BODY_HALF < 16);

  const open = new Set([...COMPASS, 'forest_hidden_path_opened']);
  const s2 = solidsFor(C, open);
  const l2 = lockedZonesFor(C, open);
  assert.equal(checkMove(C, s2, l2, front, gateIn), 'ok', '열린 문 안으로');
  assert.equal(checkMove(C, s2, l2, front, beyond), 'ok', '열린 문을 지나');
  assert.equal(checkMove(C, s2, l2, front, { x: gateIn.x, y: WIND_GATE.y - 40 }), 'blocked', '문 옆의 벽은 그대로 막힌다');
  const rootFront = ROOT_FRONT;
  const rootBeyond = { x: ROOT_GATE.x + ROOT_GATE.width + 30, y: rootFront.y };
  assert.equal(checkMove(C, s2, l2, rootFront, rootBeyond), 'tunnel', '실뿌리 문은 아직 닫혀 있다');
  const s3 = solidsFor(C, new Set([...open, 'forest_first_knot_equipped']));
  assert.equal(checkMove(C, s3, [], rootFront, rootBeyond), 'ok', '첫 매듭 장착 뒤 실뿌리 문 통과');
});

test('저장된 위치의 안전 보정: 지도 밖·벽 안·닫힌 문 너머는 시작 지점으로, 정상 위치는 그대로', () => {
  const ev = new Set(COMPASS);
  const opened = new Set([...COMPASS, 'forest_hidden_path_opened']);
  const fix = (p: { x: number; y: number }, events = ev) => safePosition(C, solidsFor(C, events), lockedZonesFor(C, events), p);
  assert.deepEqual(fix(CUT), { ...CUT, corrected: false });
  assert.deepEqual(fix({ x: 5000, y: 100 }), { ...SPAWN, corrected: true }, '지도 밖');
  assert.deepEqual(fix({ x: 1800, y: 840 }), { ...SPAWN, corrected: true }, '먼지풀 안');
  assert.deepEqual(fix(HIDDEN_INSIDE), { ...SPAWN, corrected: true }, '닫힌 숨은 길 문 너머');
  assert.deepEqual(fix(HIDDEN_INSIDE, opened), { ...HIDDEN_INSIDE, corrected: false }, '문이 열린 뒤에는 그 자리 그대로');
  assert.deepEqual(fix(BEYOND_ROOT, opened), { ...SPAWN, corrected: true }, '닫힌 실뿌리 문 너머');
  // 닿을 수 있는가: 벽 반대편은 가까워도 닿지 않는다(먼지풀 위쪽 바깥에서 길 위의 점으로)
  const onRoad = { x: 1800, y: 1000 };
  assert.equal(reachable(solidsFor(C, ev), { x: 1800, y: 780 }, onRoad), false);
  assert.equal(reachable(solidsFor(C, ev), { x: 1800, y: 940 }, onRoad), true);
});

// ---------- 서비스: 입장·이동·증거 ----------

const NUMBERS: Record<string, number> = { 'room.reconnectGraceMs': 1000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64, 'battle.encounterRadiusPx': 120 };

function setup(events: string[] = BASE, checkpoint = 'CH01_BOPUL_RESCUED', extraBlockers: { id: string; label: string; x: number; y: number; width: number; height: number }[] = []) {
  const db = new FakeDb();
  db.seed('player', { id: 1n, device_uuid: 'dev-test-position', nickname: '하늘' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 4000, map_height: 3000 });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  const inst = db.seed('turby_instance', { owner_player_id: 1n, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('item_definition', { code: 'yarn_tremor_compass', name: '실의 떨림을 찾는 나침판', category: 'mission' });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('player_story_progress', { player_id: 1n, checkpoint, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: 1n, event_id: e });
  // 지역 데이터: 실제 숲 + (시험에 따라) 덧붙인 막힌 곳
  const stage: StageStoryData = { ...FOREST, layout: { ...FOREST.layout!, blockers: [...FOREST.layout!.blockers, ...extraBlockers] } };
  const content = Object.assign(Object.create(realContent) as StoryContentService, { stage: (code: string) => (code === 'forest' ? stage : realContent.stage(code)) });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d, number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  const story = new StoryService(db.client(), rooms, settings as never, content, access);
  let clock = Date.now() + 60_000; // 시험 시계(입장 시각보다 뒤)
  // 걸어서 이동: 한 번에 allowed 거리 안쪽으로 나눠 보고(시험 시계 사용). 거절되면 그 결과를 돌려준다
  const walk = (to: { x: number; y: number }) => {
    for (let i = 0; i < 400; i++) {
      const at = rooms.memberPosition(rooms.roomOf(P)!, P)!;
      const d = Math.hypot(to.x - at.x, to.y - at.y);
      if (d < 0.5) return 'ok' as const;
      const step = Math.min(d, 30);
      clock += 100;
      const r = rooms.move(P, at.x + ((to.x - at.x) / d) * step, at.y + ((to.y - at.y) / d) * step, 'down', clock).result;
      if (r.kind !== 'ok') return r.kind === 'corrected' ? r.reason : r.kind;
    }
    throw new Error('도착하지 못함');
  };
  // 길 중심선을 따라 걸어서 이동(길이 굽어 있어 직선으로는 갈 수 없다)
  const go = (to: { x: number; y: number }) => {
    for (const w of walkRoute(pos(), to)) {
      const r = walk(w);
      if (r !== 'ok') return r;
    }
    return 'ok' as const;
  };
  const jump = (to: { x: number; y: number }, ms = 100) => rooms.move(P, to.x, to.y, 'down', (clock += ms)).result;
  const pos = () => {
    const m = rooms.memberPosition(rooms.roomOf(P)!, P)!;
    return { x: Math.round(m.x), y: Math.round(m.y) };
  };
  const enter = async (stage = 'forest') => {
    await rooms.identify('sock-1', 'dev-test-position');
    await rooms.createRoom(P, stage);
    rooms.startRoom(P);
    return rooms.enterMap(P, 'down');
  };
  return { db, rooms, story, walk, go, jump, pos, enter };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    if (e instanceof RoomError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

test('입장: 첫 입장은 시작 지점(요청 좌표는 받지 않는다), 같은 세션의 재입장·유예 재접속은 마지막 승인 위치, 새 세션은 다시 시작 지점', async () => {
  const s = setup();
  const first = await s.enter();
  assert.deepEqual([first.self.x, first.self.y, first.corrected], [SPAWN.x, SPAWN.y, false]);
  assert.equal(s.rooms.enterMap.length <= 2, true, '입장 함수는 좌표 인자를 받지 않는다');
  // 클라이언트가 좌표를 끼워 보내도(옛 형식) 위치는 바뀌지 않는다
  await (s.rooms.enterMap as unknown as (...a: unknown[]) => Promise<unknown>)(P, 'down', BEYOND_ROOT.x, BEYOND_ROOT.y);
  assert.deepEqual(s.pos(), SPAWN);

  assert.equal(s.go(CUT), 'ok');
  // 전투 뒤 복귀·새로고침: 같은 탐험 세션의 재입장 → 마지막 승인 위치
  const again = await s.rooms.enterMap(P, 'down');
  assert.deepEqual([again.self.x, again.self.y, again.corrected], [CUT.x, CUT.y, false]);
  // 연결이 끊겼다가 유예 안에 돌아옴(새 소켓)
  s.rooms.disconnect('sock-1');
  await s.rooms.identify('sock-2', 'dev-test-position');
  const back = await s.rooms.enterMap(P, 'down');
  assert.deepEqual([back.self.x, back.self.y], [CUT.x, CUT.y]);
  // 세션이 끝난 뒤 새 숲 입장 → 시작 지점
  s.rooms.leaveRoom(P);
  await s.rooms.createRoom(P, 'forest');
  s.rooms.startRoom(P);
  const fresh = await s.rooms.enterMap(P, 'down');
  assert.deepEqual([fresh.self.x, fresh.self.y, fresh.corrected], [SPAWN.x, SPAWN.y, false]);
  // 진행이 앞서 있어도 시작 지점이다(체크포인트로 순간 이동시키지 않는다)
  const late = setup([...COMPASS, 'forest_hidden_path_opened'], 'CH01_COMPASS_ACQUIRED');
  assert.deepEqual([(await late.enter()).self.x, (await late.rooms.enterMap(P)).self.y], [SPAWN.x, SPAWN.y]);
});

test('입장: 저장돼 있던 위치가 허용되지 않으면 시작 지점으로 보정하고 보정 사실을 알려 준다', async () => {
  const s = setup(COMPASS, 'CH01_COMPASS_ACQUIRED');
  await s.enter();
  const member = s.rooms.roomOf(P)!.members[0];
  for (const bad of [HIDDEN_INSIDE, { x: 1800, y: 840 }, { x: 9999, y: 9999 }]) {
    Object.assign(member, bad); // 잘못 저장된 마지막 위치(문 너머·벽 안·지도 밖)
    const r = await s.rooms.enterMap(P, 'down');
    assert.deepEqual([r.self.x, r.self.y, r.corrected], [SPAWN.x, SPAWN.y, true], JSON.stringify(bad));
  }
});

test('이동: 지도 밖·벽 안·벽 관통·닫힌 문 관통은 승인하지 않고 마지막 승인 위치를 돌려준다. 속도 검증은 그대로다', async () => {
  const s = setup(COMPASS, 'CH01_COMPASS_ACQUIRED');
  await s.enter();
  assert.equal(s.go(WIND_FRONT), 'ok', '길을 따라 숨은 길 문 앞까지');
  const before = s.pos();
  const gateIn = { x: WIND_GATE.x + 10, y: before.y };
  const beyond = { x: WIND_GATE.x + WIND_GATE.width + 30, y: before.y };
  const rejected = (r: { kind: string; reason?: string }) => [r.kind, r.reason];
  assert.deepEqual(rejected(s.jump(gateIn) as { kind: string; reason?: string }), ['corrected', 'blocked']);
  assert.deepEqual(rejected(s.jump(beyond) as { kind: string; reason?: string }), ['corrected', 'tunnel'], '닫힌 문을 건너뛰는 점프');
  assert.deepEqual(s.pos(), before, '거절된 좌표는 저장하지 않는다');
  assert.equal(s.jump(BEYOND_ROOT).kind, 'corrected', '속도 초과');
  assert.equal((s.jump(BEYOND_ROOT) as { reason: string }).reason, 'speed');
  assert.equal((s.jump({ x: before.x, y: -30 }, 60_000) as { reason: string }).reason, 'out_of_bounds', '시간이 충분해도 지도 밖은 거절');
  assert.equal((s.jump(KNOT, 60_000) as { reason: string }).reason, 'tunnel', '시간이 충분해도 벽 너머는 거절(큰 점프 터널링)');
  assert.deepEqual(s.pos(), before);
  assert.equal(await codeOf(Promise.resolve().then(() => s.rooms.move(P, 'x', 1, 'down'))), 'INVALID_PAYLOAD');
  // 보정 뒤에도 정상 이동은 계속 승인된다
  assert.equal(s.walk({ x: before.x - 60, y: before.y }), 'ok');

  // 길 둘레의 먼지풀: 끝점 진입·관통 거절, 길로 돌아오면 통과
  assert.equal(s.walk({ x: before.x - 60, y: before.y - 200 }), 'blocked', '먼지풀을 뚫고 올라갈 수 없다');
  assert.equal(s.go(WIND_FRONT), 'ok', '길로 돌아와 도착');
});

test('문: 닫혀 있으면 지나갈 수 없고, 지점이 이벤트를 기록하면 바로 지나갈 수 있다(나침판 → 숨은 길, 첫 매듭 장착 → 실뿌리 문)', async () => {
  const s = setup(COMPASS, 'CH01_COMPASS_ACQUIRED');
  await s.enter();
  assert.equal(s.go(pointData('forest_hidden_path')), 'ok');
  const at = s.pos();
  assert.equal(s.walk({ x: WIND_GATE.x + WIND_GATE.width + 20, y: at.y }), 'blocked', '닫힌 숨은 길 문');
  // 닫힌 문 너머의 지점: 서 있는 자리에서 요청해도 거부(지점이 아직 닫혀 있고, 닿지도 않는다)
  assert.equal(await codeOf(s.story.trigger(1n, 'forest_giant_knot')), 'STORY_EVIDENCE_INVALID');
  const opened = await s.story.trigger(1n, 'forest_hidden_path');
  assert.ok(opened.play, '나침판을 꺼내 길이 열린다');
  assert.equal(s.go(KNOT), 'ok', '이벤트 기록 직후 문 통과(재입장 없이)');
  assert.equal(s.go(ROOT_FRONT), 'ok');
  assert.equal(s.walk({ x: ROOT_GATE.x + ROOT_GATE.width + 20, y: s.pos().y }), 'blocked', '닫힌 실뿌리 문');
  assert.equal(await codeOf(s.story.trigger(1n, 'forest_dansuring')), 'STORY_EVIDENCE_INVALID', '문 너머의 단수링 지점은 닫혀 있다');

  await s.story.completeEvent(1n, 'forest_giant_knot_defeated', 'server');
  await s.story.completeEvent(1n, 'forest_first_knot_awakened');
  await s.story.equipRelic(1n, 'first_knot');
  assert.equal(s.go(BEYOND_ROOT), 'ok', '첫 매듭 장착 뒤 실뿌리 문 통과');
  assert.ok((await s.story.trigger(1n, 'forest_dansuring')).play);
  // 재입장: 문 너머에 있어도 열린 문이면 그 자리 그대로
  assert.deepEqual([(await s.rooms.enterMap(P)).self.x, (await s.rooms.enterMap(P)).corrected], [BEYOND_ROOT.x, false]);
});

test('위치 증거: 거부된 이동의 좌표는 쓰지 않는다 — 수집은 마지막 승인 위치로만 판정하고, 벽 반대편의 가까운 오브젝트는 닿지 않는다', async () => {
  // 공터 위쪽 길의 실가루(forest_dust_01) 바로 아래에 시험이 덧붙인 얇은 벽 — 거리는 가깝지만 벽이 가로막는다
  const wall = { id: 'test_dust_wall', label: '', x: 1400, y: 1318, width: 80, height: 10 }; // 길 중심선(x≈1515)은 비켜 있다
  const s = setup(BASE, 'CH01_BOPUL_RESCUED', [wall]);
  await s.enter();
  const collect = (id: string) => s.story.collectObject(1n, 'forest_glowing_dust', id);
  const d1 = pointOf('forest_dust_01');
  // 벽 아래쪽: 거리는 허용 범위(반경 56 + 여유 48 = 104) 안이지만 벽이 가로막고 있다 → 거리가 아니라 "막힘"으로 거부
  assert.equal(s.go({ x: 1470, y: 1350 }), 'ok');
  assert.ok(Math.hypot(s.pos().x - d1.x, s.pos().y - d1.y) <= d1.radius + 48, '거리 한도 안');
  const blockedMsg = await collect('forest_dust_01').then(() => 'NO_ERROR', (e: HttpException) => (e.getResponse() as { code: string; message: string }).message);
  assert.equal(blockedMsg, '막혀 있어 닿지 않습니다.', '벽 반대편');
  // 실가루 자리로 순간 이동을 보고 → 거절. 직후의 수집 요청도 거부(승인된 위치는 그대로)
  const before = s.pos();
  assert.equal(s.jump({ x: d1.x, y: d1.y }).kind, 'corrected');
  assert.deepEqual(s.pos(), before);
  assert.equal(await codeOf(collect('forest_dust_01')), 'STORY_EVIDENCE_INVALID', '거부된 이동 직후');
  // 벽 끝을 돌아서 가면 수집된다
  for (const w of [{ x: 1530, y: 1350 }, { x: 1530, y: 1290 }, { x: d1.x + 20, y: 1290 }]) assert.equal(s.walk(w), 'ok');
  assert.equal((await collect('forest_dust_01')).collected, 1);

  // 이동과 수집이 동시에: 수집 요청이 도착한 시점의 승인 위치로 판정한다
  const d2 = pointOf('forest_dust_02');
  assert.equal(s.go({ x: d2.x, y: d2.y }), 'ok');
  const pending = collect('forest_dust_02'); // 도착(범위 안) — 응답 전
  assert.equal(s.go(eastAt(1700)), 'ok'); // 그 사이 멀리 걸어감
  assert.equal((await pending).alreadyCollected, false, '먼저 도착한 수집은 그때의 위치로 승인');
  const d3 = pointOf('forest_dust_03');
  const early = codeOf(collect('forest_dust_03')); // 아직 멀리 있을 때 도착한 요청
  assert.equal(s.go({ x: d3.x, y: d3.y }), 'ok'); // 그 뒤에 도착
  assert.equal(await early, 'STORY_EVIDENCE_INVALID', '나중에 가까워져도 먼저 온 요청은 거부');
  assert.equal((await collect('forest_dust_03')).collected, 3);

  // 재접속 뒤 마지막 승인 위치에서 정상 수집
  const d10 = pointOf('forest_dust_10');
  assert.equal(s.go({ x: d10.x, y: d10.y }), 'ok');
  s.rooms.disconnect('sock-1');
  await s.rooms.identify('sock-2', 'dev-test-position');
  await s.rooms.enterMap(P, 'down');
  assert.equal((await collect('forest_dust_10')).collected, 4);
});

test('지역 데이터가 없는 지역(호수 등)은 한가운데에서 시작하고 충돌 판정 없이 경계만 지킨다', async () => {
  const s = setup([...COMPASS, 'lake_unlocked'], 'CH01_COMPLETE');
  // 구 판정(기본): 1장 대표 터비를 포획한 계정은 호수에 들어갈 수 있다
  s.db.seed('turby_instance', { owner_player_id: 1n, character_id: s.db.rows('turby_character', { code: 'nubi' })[0].id, acquired_via: 'wild_capture' });
  const r = await s.enter('lake');
  assert.deepEqual([r.self.x, r.self.y], [2000, 1500]);
  assert.equal(s.walk({ x: 2100, y: 1500 }), 'ok');
  assert.equal((s.jump({ x: 2100, y: 3001 }, 60_000) as { reason: string }).reason, 'out_of_bounds');
});
