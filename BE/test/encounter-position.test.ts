// 10-02 v5 §1·§2·§4: 야생 조우와 새 스토리 전투 시작의 위치 검증. 수집·이야기 지점과 같은 충돌 데이터·같은 판정 함수를 쓴다.
// 실제 지역 데이터(story-data/stages/forest.json)의 회색상자 배치를 쓰고, 필요한 시험만 막힌 곳을 덧붙인다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { SessionService } from '../src/turby/session.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { BattleError } from '../src/turby/battle/battle-types';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { reachVerdict } from '../src/turby/rooms/stage-collision';
import { eastAt, SPAWN, WIND_FRONT, walkRoute } from './helpers/forest-geo';

const real = new StoryContentService();
const FOREST = real.stage('forest') as StageStoryData;
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
const P = '1';
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'battle.encounterRadiusPx': 120,
  'room.reconnectGraceMs': 45000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};
const STARTED = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected'];
const RESCUED = [...STARTED, 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned'];
const COMPASS = [...RESCUED, 'forest_compass_granted'];
const OPENED = [...COMPASS, 'forest_hidden_path_opened'];
type Blocker = { id: string; label: string; x: number; y: number; width: number; height: number };

function setup(opts: { events: string[]; checkpoint: string; wilds?: { index: number; x: number; y: number }[]; extraBlockers?: Blocker[] }) {
  const db = new FakeDb();
  db.seed('player', { id: 1n, device_uuid: 'dev-test-encounter', nickname: '하늘' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  const inst = db.seed('turby_instance', { owner_player_id: 1n, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('player_story_progress', { player_id: 1n, checkpoint: opts.checkpoint, story_nubi_turby_instance_id: inst.id, nubi_growth_stage: 0 });
  for (const e of opts.events) db.seed('player_story_event', { player_id: 1n, event_id: e });
  for (const w of opts.wilds ?? []) db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: w.index, character_code: 'bopuli', x: w.x, y: w.y });

  // 지역 데이터: 실제 숲 + (시험에 따라) 덧붙인 막힌 곳. 방 서비스·스토리 서비스·전투 서비스가 같은 데이터를 읽는다
  const stage: StageStoryData = { ...FOREST, layout: { ...FOREST.layout!, blockers: [...FOREST.layout!.blockers, ...(opts.extraBlockers ?? [])] } };
  const content = Object.assign(Object.create(real) as StoryContentService, { stage: (code: string) => (code === 'forest' ? stage : null) });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d, number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  const story = new StoryService(db.client(), rooms, settings as never, content, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content);
  battles.onModuleInit();
  let clock = Date.now() + 60_000;
  const member = () => rooms.roomOf(P)!.members[0];
  // 서버가 승인하는 걸음으로만 이동한다(거절되면 그 사유)
  const walk = (...stops: { x: number; y: number }[]) => {
    for (const to of stops) {
      for (let i = 0; i < 400; i++) {
        const d = Math.hypot(to.x - member().x, to.y - member().y);
        if (d < 0.5) break;
        const step = Math.min(d, 30);
        const r = rooms.move(P, member().x + ((to.x - member().x) / d) * step, member().y + ((to.y - member().y) / d) * step, 'down', (clock += 100)).result;
        if (r.kind !== 'ok') return r.kind === 'corrected' ? r.reason : r.kind;
      }
    }
    return 'ok' as const;
  };
  // 길 중심선을 따라 걸어간다(길이 굽어 있어 직선으로는 갈 수 없다)
  const go = (to: { x: number; y: number }) => walk(...walkRoute({ x: member().x, y: member().y }, to));
  const enter = async (socket = 'sock-1') => {
    await rooms.identify(socket, 'dev-test-encounter');
    if (!rooms.roomOf(P)) {
      await rooms.createRoom(P, 'forest');
      rooms.startRoom(P);
    }
    return rooms.enterMap(P, 'down');
  };
  return { db, rooms, story, battles, walk, go, enter, member };
}

// 오류 코드와 내부 사유
async function failure(p: Promise<unknown>): Promise<[string, string | null]> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BattleError) return [e.code, e.reason];
    if (e instanceof HttpException) {
      const b = e.getResponse() as { code: string; reason?: string };
      return [b.code, b.reason ?? null];
    }
    throw e;
  }
  return ['NO_ERROR', null];
}

// 야생 3번은 입구 공터 북쪽, 그 바로 아래에 시험이 덧붙인 얇은 울타리(시작 지점 40px 위)가 있다. 시작 지점(울타리 남쪽)에서 가깝지만 막혀 있다
const FENCE: Blocker = { id: 'test_fence', label: '', x: SPAWN.x - 70, y: SPAWN.y - 40, width: 140, height: 8 };
const WILD3 = { index: 3, x: SPAWN.x, y: SPAWN.y - 80 };

test('야생 조우: 울타리 반대편에서는 가까워도 시작되지 않고(상태 변화 없음), 돌아서 다가가면 시작된다', async () => {
  const s = setup({ events: RESCUED, checkpoint: 'CH01_BOPUL_RESCUED', wilds: [WILD3], extraBlockers: [FENCE] });
  await s.enter();
  assert.ok(Math.hypot(0, SPAWN.y - WILD3.y) <= NUMBERS['battle.encounterRadiusPx'], '조우 거리 안(울타리 아래쪽 시작 지점)');
  assert.deepEqual(await failure(s.battles.start(P, 3)), ['WILD_UNREACHABLE', 'blocked']);
  assert.equal(s.rooms.roomOf(P)!.wilds[0].state, 'free', '거부된 조우는 야생 상태를 바꾸지 않는다');
  assert.equal(await s.battles.activeSnapshotOf(P), null, '전투도 만들어지지 않는다');
  // 여러 번 요청해도 같다(요청마다 판정)
  assert.deepEqual(await failure(s.battles.start(P, 3)), ['WILD_UNREACHABLE', 'blocked']);

  // 울타리 끝을 돌아 위쪽으로
  assert.equal(s.walk({ x: SPAWN.x + 110, y: SPAWN.y }, { x: SPAWN.x + 110, y: SPAWN.y - 100 }, { x: SPAWN.x + 30, y: SPAWN.y - 100 }), 'ok');
  const snap = await s.battles.start(P, 3);
  assert.equal(snap.phase, 'party_select');
  assert.equal(s.rooms.roomOf(P)!.wilds[0].state, 'engaged');
});

test('야생 조우: 닫힌 문 너머·잠긴 구역 안의 야생은 조우할 수 없고, 문이 열린 뒤 안으로 들어가면 정상 조우한다', async () => {
  const inside = { index: 9, ...eastAt(WIND_FRONT.x + 100) }; // 숨은 구역 안(문 바로 너머)
  const closed = setup({ events: COMPASS, checkpoint: 'CH01_COMPASS_ACQUIRED', wilds: [inside] });
  await closed.enter();
  assert.equal(closed.go(WIND_FRONT), 'ok', '닫힌 숨은 길 문 바로 앞');
  assert.ok(Math.hypot(WIND_FRONT.x - inside.x, WIND_FRONT.y - inside.y) <= 120, '조우 거리 안');
  // 10-06 v1 §2: 잠긴 구역 안의 야생은 이 플레이어에게 없는 것과 같다 — 목록에도 없고 조우 요청도 존재하지 않는 마커와 같은 응답이다
  assert.deepEqual(closed.rooms.wildsFor(closed.rooms.roomOf(P)!, P), []);
  assert.deepEqual(await failure(closed.battles.start(P, 9)), ['INVALID_SPAWN', null], '플레이어는 구역 밖, 야생은 잠긴 구역 안 — 사유(locked_zone)도 드러내지 않는다');
  assert.equal(closed.rooms.roomOf(P)!.wilds[0].state, 'free');

  const open = setup({ events: OPENED, checkpoint: 'CH01_COMPASS_ACQUIRED', wilds: [inside] });
  await open.enter();
  assert.equal(open.go(WIND_FRONT), 'ok');
  // 문이 열리면 그 문은 가로막힘 판정에서 빠진다: 문 앞에서도, 안으로 들어가서도 조우된다
  assert.equal((await open.battles.start(P, 9)).phase, 'party_select');
  const open2 = setup({ events: OPENED, checkpoint: 'CH01_COMPASS_ACQUIRED', wilds: [inside] });
  await open2.enter();
  assert.equal(open2.go(eastAt(WIND_FRONT.x + 70)), 'ok', '열린 문을 지나 안으로');
  assert.equal((await open2.battles.start(P, 9)).phase, 'party_select');
  // 길 둘레의 벽은 그대로 막힌다: 벽 바깥쪽에서 벽 너머의 야생
  const behind = { index: 9, x: WIND_FRONT.x + 90, y: WIND_FRONT.y - 140 };
  const wall = setup({ events: OPENED, checkpoint: 'CH01_COMPASS_ACQUIRED', wilds: [behind] });
  await wall.enter();
  assert.equal(wall.go(WIND_FRONT), 'ok');
  assert.equal(wall.walk({ x: WIND_FRONT.x, y: WIND_FRONT.y - 65 }), 'ok');
  assert.ok(Math.hypot(wall.member().x - behind.x, wall.member().y - behind.y) <= 120, '조우 거리 안');
  assert.deepEqual(await failure(wall.battles.start(P, 9)), ['WILD_UNREACHABLE', 'blocked']);
});

test('스토리 전투: 멀리서 encounterKey만 보내면 거부, 지점에 서 있으면 시작, 이미 진행 중인 전투는 멀리서 재접속해도 이어진다, 이긴 전투는 DONE', async () => {
  const s = setup({ events: STARTED, checkpoint: 'CH01_STARTED' });
  await s.enter();
  // 시작 지점(공터에서 먼 곳)에서 직접 요청
  assert.deepEqual(await failure(s.battles.startStory(P, 'forest_stitchling_ambush')), ['STORY_EVIDENCE_INVALID', 'too_far']);
  assert.equal(await s.battles.activeSnapshotOf(P), null);
  // 선행 지점·체크포인트 검증은 그대로(위치보다 먼저)
  assert.deepEqual((await failure(s.battles.startStory(P, 'forest_giant_knot')))[0], 'STORY_ENCOUNTER_NOT_AVAILABLE');

  const amb = pointOf('forest_bopuli_ambush');
  assert.equal(s.go({ x: amb.x + 60, y: amb.y }), 'ok', '공터 지점 반경 안');
  const first = await s.battles.startStory(P, 'forest_stitchling_ambush');
  assert.equal(first.story?.encounterKey, 'forest_stitchling_ambush');

  // 진행 중: 서버 위치가 멀어져도(시험에서 직접 옮김), 연결이 끊겼다 돌아와도 같은 전투
  Object.assign(s.member(), { x: 3000, y: 2200 });
  assert.equal((await s.battles.startStory(P, 'forest_stitchling_ambush')).battleId, first.battleId, '재요청');
  s.rooms.disconnect('sock-1');
  await s.enter('sock-2');
  assert.equal((await s.battles.startStory(P, 'forest_stitchling_ambush')).battleId, first.battleId, '유예 안 재접속');
  assert.equal((await s.battles.activeSnapshotOf(P))?.battleId, first.battleId);

  // 이미 이긴 전투는 어디서 요청해도 DONE(위치 증거보다 먼저)
  const won = setup({ events: [...STARTED, 'forest_stitchling_battle_won', 'forest_bopul_rescued'], checkpoint: 'CH01_STARTED' });
  await won.enter();
  assert.deepEqual((await failure(won.battles.startStory(P, 'forest_stitchling_ambush')))[0], 'STORY_ENCOUNTER_DONE');
});

test('스토리 전투: 탐험 세션 밖·벽 반대편·닫힌 문 너머에서는 시작되지 않는다', async () => {
  // 탐험 세션 밖
  const out = setup({ events: STARTED, checkpoint: 'CH01_STARTED' });
  await out.rooms.identify('sock-1', 'dev-test-encounter');
  assert.deepEqual((await failure(out.battles.startStory(P, 'forest_stitchling_ambush')))[0], 'NOT_IN_ROOM');

  // 벽 반대편: 공터 지점 아래에 얇은 벽을 덧붙인 배치
  const amb = pointOf('forest_bopuli_ambush');
  const wall: Blocker = { id: 'test_wall', label: '', x: amb.x - 60, y: amb.y + 40, width: 120, height: 10 };
  const s = setup({ events: STARTED, checkpoint: 'CH01_STARTED', extraBlockers: [wall] });
  await s.enter();
  assert.equal(s.go({ x: amb.x, y: amb.y + 80 }), 'ok', '벽 아래쪽(지점에서 80px)');
  assert.deepEqual(await failure(s.battles.startStory(P, 'forest_stitchling_ambush')), ['STORY_EVIDENCE_INVALID', 'blocked']);
  assert.equal(s.walk({ x: amb.x + 110, y: amb.y + 80 }, { x: amb.x + 110, y: amb.y }, { x: amb.x + 40, y: amb.y }), 'ok', '벽을 돌아서');
  assert.equal((await s.battles.startStory(P, 'forest_stitchling_ambush')).phase, 'party_select');

  // 거대 매듭: 숨은 길을 열었지만 문 앞에서 요청(지점까지 먼 거리) → 거리로 거부. 안으로 걸어가면 시작
  const g = setup({ events: OPENED, checkpoint: 'CH01_COMPASS_ACQUIRED' });
  await g.enter();
  assert.equal(g.go(WIND_FRONT), 'ok');
  assert.deepEqual(await failure(g.battles.startStory(P, 'forest_giant_knot')), ['STORY_EVIDENCE_INVALID', 'too_far']);
  assert.equal(g.go(pointOf('forest_giant_knot')), 'ok');
  assert.equal((await g.battles.startStory(P, 'forest_giant_knot')).story?.encounterKey, 'forest_giant_knot');
});

test('같은 충돌 데이터·같은 판정: 한 자리에서 벽에 막힌 수집·이야기 지점·야생 조우·스토리 전투가 모두 "blocked"로 거부되고, 벽이 없으면 모두 승인된다', async () => {
  const amb = pointOf('forest_bopuli_ambush'); // 공터 한가운데(남쪽)
  const d2 = pointOf('forest_dust_01'); // 공터 위쪽 길의 실가루(북쪽)
  const here = { x: 1490, y: 1363 };
  const wild = { index: 7, x: 1530, y: 1300 };
  // 서 있는 자리의 위(실가루·야생 쪽)와 아래(공터 지점 쪽)에 시험이 덧붙인 얇은 벽
  const walls: Blocker[] = [
    { id: 'test_north', label: '', x: 1430, y: 1318, width: 120, height: 10 },
    { id: 'test_south', label: '', x: 1430, y: 1405, width: 120, height: 10 },
  ];
  for (const d of [amb, d2, wild]) assert.ok(Math.hypot(here.x - d.x, here.y - d.y) <= 104, '모두 거리 한도 안');

  const run = async (extraBlockers: Blocker[], events: string[], checkpoint: string) => {
    const s = setup({ events, checkpoint, wilds: [wild], extraBlockers });
    await s.enter();
    assert.equal(s.go({ x: 1600, y: 1530 }), 'ok');
    assert.equal(s.walk({ x: 1600, y: here.y }, here), 'ok', '두 벽 사이의 통로로 옆에서 들어온다');
    return s;
  };
  // 구조 전(CH01_STARTED): 이야기 지점·스토리 전투·야생
  let s = await run(walls, STARTED, 'CH01_STARTED');
  assert.deepEqual(await failure(s.story.trigger(1n, 'forest_bopuli_ambush')), ['STORY_EVIDENCE_INVALID', 'blocked'], '이야기 지점');
  assert.deepEqual(await failure(s.battles.startStory(P, 'forest_stitchling_ambush')), ['STORY_EVIDENCE_INVALID', 'blocked'], '스토리 전투');
  assert.deepEqual(await failure(s.battles.start(P, 7)), ['WILD_UNREACHABLE', 'blocked'], '야생 조우');
  // 구조 뒤(CH01_BOPUL_RESCUED): 수집
  s = await run(walls, RESCUED, 'CH01_BOPUL_RESCUED');
  assert.deepEqual(await failure(s.story.collectObject(1n, 'forest_glowing_dust', 'forest_dust_01')), ['STORY_EVIDENCE_INVALID', 'blocked'], '수집');
  // 이동도 같은 벽에 막힌다
  assert.equal(s.walk({ x: here.x, y: 1290 }), 'blocked');
  // 네 판정이 쓰는 함수가 같은 답을 낸다(직접 호출)
  const m = s.member();
  assert.equal(s.rooms.reachOf(s.rooms.roomOf(P)!, P, d2), 'blocked');
  assert.equal(reachVerdict(walls, [], { x: m.x, y: m.y }, d2), 'blocked');

  // 벽이 없으면 같은 자리에서 모두 승인
  s = await run([], STARTED, 'CH01_STARTED');
  assert.ok((await s.story.trigger(1n, 'forest_bopuli_ambush')).play, '이야기 지점');
  assert.equal((await s.battles.startStory(P, 'forest_stitchling_ambush')).phase, 'party_select', '스토리 전투');
  s = await run([], RESCUED, 'CH01_BOPUL_RESCUED');
  assert.equal((await s.story.collectObject(1n, 'forest_glowing_dust', 'forest_dust_01')).collected, 1, '수집');
  assert.equal((await s.battles.start(P, 7)).phase, 'party_select', '야생 조우');
});
