// 10-02 v3: 1장 숲 — 실제 지역 데이터(story-data/stages/forest.json)와 전이표의 정합, 고유 오브젝트 수집, 지점 표시.
// 좌표는 회색상자(임시) 값이다. 여기서는 "좌표가 무엇이든 지켜져야 하는 규칙"만 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, validateRender, type StageStoryData } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { collisionOf, lockedZonesFor, reachVerdict, solidsFor } from '../src/turby/rooms/stage-collision';
import { CHECKPOINTS, EVENT_BY_ID, ENCOUNTER_BY_KEY, OBJECTIVE_BY_KEY, STORY_TRIGGERS, FIRST_PATH_INTRO, type StoryPlayRange } from '../src/turby/story/story-data';

const P1 = 1n;
const content = new StoryContentService();
const FOREST = content.stage('forest') as StageStoryData;
const CH01 = JSON.parse(readFileSync(join(content.dir, 'dialogue/ch01.json'), 'utf8')) as { segments: { segmentId: string; entries: { dialogueId: string; kind: string; encounterKey?: string }[] }[] };
const DUST = OBJECTIVE_BY_KEY.get('forest_glowing_dust')!.objectIds;
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
const RESCUED = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned'];

function setup(checkpoint = 'CH01_BOPUL_RESCUED', events: string[] = RESCUED) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-forest', nickname: '하늘', session_token: 'token-forest-aaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('item_definition', { code: 'yarn_tremor_compass', name: '실의 떨림을 찾는 나침판', category: 'mission' });
  db.seed('player_story_progress', { player_id: P1, checkpoint, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  // 방 서비스 모의: 위치는 시험이 정하고, "닿을 수 있는가"는 실제 충돌 데이터와 이 플레이어의 완료 이벤트로 판정한다
  const C = collisionOf(FOREST, 3200, 2400);
  const done = () => new Set(db.rows('player_story_event', { player_id: P1 }).map((r) => r.event_id as string));
  const rooms = {
    roomOf: () => (pos ? { stageCode: pos.stageCode } : undefined),
    memberPosition: () => (pos ? { x: pos.x, y: pos.y, inMap: true, connected: true } : null),
    reachOf: (_room: unknown, _id: string, target: { x: number; y: number }) => (pos ? reachVerdict(solidsFor(C, done()), lockedZonesFor(C, done()), pos, target) : 'blocked'),
    noteStoryEvents: () => undefined,
  };
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d };
  // 재접속 = 새 서비스 인스턴스(같은 DB)
  const connect = () => new StoryService(db.client(), rooms as never, settings as never, content, new StageAccessService(db.client(), settings as never));
  const standAt = (id: string, dx = 0) => (pos = { stageCode: 'forest', x: pointOf(id).x + dx, y: pointOf(id).y });
  const qty = () => (db.rows('player_item', { player_id: P1, item_definition_id: db.rows('item_definition', { code: 'glowing_yarn_dust' })[0].id })[0]?.quantity as number | undefined) ?? 0;
  const collected = () => db.rows('player_story_objective_progress', { player_id: P1 }).map((r) => r.object_id as string).sort();
  return { db, service: connect(), connect, standAt, leave: () => (pos = null), goStage: (stageCode: string) => (pos = { stageCode, x: 100, y: 100 }), qty, collected };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return 'NO_ERROR';
}

// ---------- 데이터 정합 ----------

test('오브젝트 ID: 실가루는 forest_dust_01~10 고정, 지역 데이터의 오브젝트·좌표와 1:1', () => {
  assert.deepEqual(DUST, Array.from({ length: 10 }, (_, i) => `forest_dust_${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual((FOREST.objects ?? []).map((o) => o.id).sort(), [...DUST].sort(), '지역 데이터의 오브젝트 = 서버 정의');
  assert.equal(new Set(FOREST.points.map((p) => p.id)).size, FOREST.points.length, '좌표 ID 중복 없음');
  for (const o of FOREST.objects ?? []) {
    assert.equal(o.objectiveKey, 'forest_glowing_dust');
    assert.ok(pointOf(o.id), `${o.id} 좌표`);
    assert.ok(o.assetKey && o.label && o.prompt, `${o.id} 표시 정보`);
  }
  assert.equal(FOREST.greybox, false, '최종 지도(회색상자 단계 끝)');
});

test('이야기 지점: 여덟 지점이 정의돼 있고, 지도에 놓이는 지점은 좌표·표시 정보를 가진다. 완료 이벤트·전투 키·재생 범위는 실제 데이터에 있다', () => {
  assert.deepEqual(
    STORY_TRIGGERS.map((t) => t.id),
    ['forest_entry', 'forest_cut_thread', 'forest_bopuli_ambush', 'forest_bopuli_return', 'forest_hidden_path', 'forest_giant_knot', 'forest_first_knot_awaken', 'forest_dansuring'],
  );
  const entryIds = new Map(CH01.segments.map((s) => [s.segmentId, s.entries.map((e) => e.dialogueId)]));
  const checkRange = (id: string, r: StoryPlayRange) => {
    assert.ok(entryIds.has(r.segmentId), `${id}: 구간 ${r.segmentId}`);
    if (r.endAfter) assert.ok(entryIds.has(r.endAfter), `${id}: 끝 구간 ${r.endAfter}`);
    if (r.fromEntry) assert.ok(entryIds.get(r.segmentId)!.includes(r.fromEntry), `${id}: 시작 항목 ${r.fromEntry}`);
    if (r.untilEntry) assert.ok(entryIds.get(r.endAfter ?? r.segmentId)!.includes(r.untilEntry), `${id}: 끝 항목 ${r.untilEntry}`);
  };
  checkRange('forest_entry', FIRST_PATH_INTRO);
  for (const t of STORY_TRIGGERS) {
    assert.equal(t.stageCode, 'forest');
    if (t.event) assert.ok(EVENT_BY_ID.get(t.event)?.serverOnly, `${t.id}: 완료 이벤트는 서버 전용`);
    for (const e of [...(t.requires ?? []), ...(t.unless ?? [])]) assert.ok(EVENT_BY_ID.has(e), `${t.id}: 이벤트 ${e}`);
    for (const c of t.activeAt ?? []) assert.ok((CHECKPOINTS as readonly string[]).includes(c));
    const ranges = t.play === 'resume' ? [] : typeof t.play === 'function' ? [t.play(new Set()), t.play(new Set(['forest_bopul_rescued']))] : [t.play];
    ranges.forEach((r) => checkRange(t.id, r));
    if (t.encounterKey) {
      assert.ok(ENCOUNTER_BY_KEY.has(t.encounterKey));
      // 전투 지점의 첫 재생 범위 안에 그 전투 항목이 있다
      const r = ranges[0];
      const seg = CH01.segments.find((s) => s.segmentId === r.segmentId)!;
      const from = r.fromEntry ? seg.entries.findIndex((e) => e.dialogueId === r.fromEntry) : 0;
      assert.ok(seg.entries.slice(from).some((e) => e.kind === 'storyBattle' && e.encounterKey === t.encounterKey), `${t.id}: 범위 안에 전투 항목`);
    }
    if (t.auto) continue;
    assert.equal(t.evidence.kind, 'point', `${t.id}: 좌표 증거`);
    assert.ok(pointOf(t.id), `${t.id} 좌표`);
    assert.ok(FOREST.storyPoints?.some((s) => s.id === t.id && s.label && s.prompt && s.assetKey), `${t.id} 표시 정보`);
  }
  // 한 구간을 나눠 재생하는 범위는 빠지거나 겹치는 항목이 없다(첫 길 16항목 = 001~004 + 005~009 + 010~016)
  const fp = entryIds.get('ch01.first_path')!;
  assert.deepEqual([fp.indexOf('ch01.first_path.004'), fp.indexOf('ch01.first_path.005'), fp.indexOf('ch01.first_path.009'), fp.indexOf('ch01.first_path.010'), fp.length], [3, 4, 8, 9, 16]);
  assert.deepEqual(entryIds.get('ch01.hidden_path'), ['ch01.hidden_path.001', 'ch01.hidden_path.002', 'ch01.hidden_path.003']);
});

test('회색상자 배치: 좌표는 지도 안, 실가루·지점은 막힌 곳 안에 있지 않고, 문은 실제 이벤트로 열린다', () => {
  const { width, height } = FOREST.size!;
  const solid = [...FOREST.layout!.blockers, ...FOREST.layout!.gates];
  for (const p of FOREST.points) {
    assert.ok(p.x > 0 && p.x < width && p.y > 0 && p.y < height, `${p.id} 지도 안`);
    assert.ok(p.radius >= 40, `${p.id} 상호작용 반경`);
    for (const b of solid) assert.ok(!(p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height), `${p.id}가 ${b.id} 안에 있음`);
  }
  for (const g of FOREST.layout!.gates) assert.ok(EVENT_BY_ID.has(g.openEvent), `${g.id}: ${g.openEvent}`);
  for (const z of FOREST.layout!.zones) if (z.visibleAfter) assert.ok(EVENT_BY_ID.has(z.visibleAfter));
  // 서로 다른 실가루는 한 자리에서 둘을 주울 수 없을 만큼 떨어져 있다
  const dust = DUST.map(pointOf);
  for (let i = 0; i < dust.length; i++) for (let j = i + 1; j < dust.length; j++) assert.ok(Math.hypot(dust[i].x - dust[j].x, dust[i].y - dust[j].y) > dust[i].radius + dust[j].radius + 96, `${dust[i].id}·${dust[j].id}`);
});

// ---------- 수집 ----------

test('수집 가능 조건: 오프닝·구조 전, 탐험 세션 밖, 다른 지역, 먼 거리, 정의에 없는 ID는 모두 거부되고 아무것도 바뀌지 않는다', async () => {
  for (const [checkpoint, events, code] of [
    ['OPENING_NAME_SAVED', ['opening_fall_completed', 'opening_name_saved'], 'CHAPTER_LOCKED'],
    ['CH01_STARTED', RESCUED.slice(0, 5), 'OBJECTIVE_NOT_ACTIVE'],
    ['CH01_STARTED', RESCUED.slice(0, 7), 'OBJECTIVE_NOT_ACTIVE'], // 구조했지만 단서(의뢰)를 듣기 전
  ] as const) {
    const s = setup(checkpoint, [...events]);
    s.standAt('forest_dust_01');
    assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01')), code, checkpoint);
    assert.deepEqual([s.qty(), s.collected()], [0, []]);
  }
  const s = setup();
  const collect = (id: unknown) => codeOf(s.service.collectObject(P1, 'forest_glowing_dust', id));
  assert.equal(await collect('forest_dust_01'), 'STORY_EVIDENCE_INVALID', '탐험 세션 밖');
  s.goStage('lake');
  assert.equal(await collect('forest_dust_01'), 'STORY_EVIDENCE_INVALID', '다른 지역');
  const p = pointOf('forest_dust_01');
  s.standAt('forest_dust_01', p.radius + 48 + 1);
  assert.equal(await collect('forest_dust_01'), 'STORY_EVIDENCE_INVALID', '허용 범위(반경 + 여유 48px) 바로 밖');
  s.standAt('forest_dust_01', p.radius + 48);
  for (const bad of ['forest_dust_00', 'forest_dust_11', 'dust_01', 'forest_cut_thread', '', null, 3, { id: 'forest_dust_01' }]) assert.equal(await collect(bad), 'OBJECT_UNKNOWN', JSON.stringify(bad));
  assert.deepEqual([s.qty(), s.collected()], [0, []]);
  assert.equal(await collect('forest_dust_01'), 'NO_ERROR', '허용 범위 경계 안');
  assert.deepEqual([s.qty(), s.collected()], [1, ['forest_dust_01']]);
});

test('멱등: 같은 실가루 동시 10건(직렬화 경유·우회 모두) → 기록 1행·아이템 1개, 서로 다른 실가루 10개 → 정확히 10개', async () => {
  const s = setup();
  s.standAt('forest_dust_03');
  const ten = await Promise.all(Array.from({ length: 10 }, () => s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_03')));
  assert.equal(ten.filter((r) => !r.alreadyCollected).length, 1);
  assert.equal(ten.filter((r) => r.grants.length === 1).length, 1);
  assert.deepEqual([s.qty(), s.collected()], [1, ['forest_dust_03']]);

  // 프로세스 안 직렬화를 건너뛴 동시 요청(서버 인스턴스가 여럿일 때): DB unique만으로 한 번
  const a = setup();
  a.standAt('forest_dust_05');
  const many = await Promise.all(Array.from({ length: 10 }, () => a.connect().collectObject(P1, 'forest_glowing_dust', 'forest_dust_05')));
  assert.equal(many.filter((r) => !r.alreadyCollected).length, 1, '새 수집으로 처리된 요청은 하나');
  assert.deepEqual([a.qty(), a.collected()], [1, ['forest_dust_05']]);

  for (const id of DUST) {
    s.standAt(id);
    const r = await s.service.collectObject(P1, 'forest_glowing_dust', id);
    assert.equal(r.collected, s.collected().length);
  }
  assert.deepEqual([s.qty(), s.collected().length], [10, 10]);
  for (const id of DUST) {
    s.standAt(id);
    assert.equal((await s.service.collectObject(P1, 'forest_glowing_dust', id)).alreadyCollected, true);
  }
  assert.equal(s.qty(), 10, '10개를 넘겨 지급하지 않는다');
});

test('트랜잭션: 아이템 지급이 실패하면 수집 기록도 남지 않고, 다시 시도하면 정상 처리된다', async () => {
  const s = setup();
  s.standAt('forest_dust_02');
  s.db.failOn = (table) => table === 'player_item';
  await assert.rejects(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_02'));
  assert.deepEqual([s.qty(), s.collected()], [0, []], '기록·아이템 모두 롤백');
  assert.ok((await s.connect().stageData(P1, 'forest')).objects.some((o) => o.id === 'forest_dust_02'), '지도에 그대로 남아 있다');
  s.db.failOn = null;
  const r = await s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_02');
  assert.deepEqual([r.alreadyCollected, r.collected, s.qty()], [false, 1, 1]);
});

test('재접속 복원: 0·1·5·9·10개 상태에서 새 접속의 지도·목표·인벤토리가 같은 상태다. 나침판 제작 뒤에는 수집할 수 없다', async () => {
  const s = setup();
  const check = async (n: number) => {
    const fresh = s.connect(); // 재접속
    const view = await fresh.stageData(P1, 'forest');
    const story = await fresh.getState(P1);
    assert.deepEqual(view.objects.map((o) => o.id), DUST.slice(n), `${n}개: 남은 오브젝트`);
    assert.deepEqual(view.objectives, [{ key: 'forest_glowing_dust', collected: n, required: 10, active: true }]);
    assert.deepEqual([story.delivery?.have, story.objectives.forest_glowing_dust?.length ?? 0, s.qty()], [n, n, n], `${n}개: 목표·기록·인벤토리 일치`);
  };
  await check(0);
  for (let i = 0; i < 10; i++) {
    s.standAt(DUST[i]);
    await s.service.collectObject(P1, 'forest_glowing_dust', DUST[i]);
    if ([1, 5, 9, 10].includes(i + 1)) await check(i + 1);
  }
  // 수집 완료 뒤 숲 재입장: 실가루는 다시 생기지 않고, 지도에는 보풀이 지점만
  const back = await s.connect().stageData(P1, 'forest');
  assert.deepEqual([back.objects.length, back.points.map((p) => p.id)], [0, ['forest_bopuli_return']]);

  s.standAt('forest_bopuli_return');
  const made = await s.service.trigger(P1, 'forest_bopuli_return');
  assert.equal(made.story.checkpoint, 'CH01_COMPASS_ACQUIRED');
  s.standAt('forest_dust_04');
  assert.equal((await s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_04')).alreadyCollected, true);
  assert.equal(s.qty(), 0, '제작 뒤 재요청으로 실가루가 다시 생기지 않는다');
  // 제작 뒤에는 수집 목표가 닫힌다: 기록이 없는 오브젝트라도 수집할 수 없다
  s.db.rows('player_story_objective_progress', { player_id: P1, object_id: 'forest_dust_04' }).forEach((r) => Object.assign(r, { object_id: 'removed_for_test' }));
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_04')), 'OBJECTIVE_NOT_ACTIVE');
  assert.equal((await s.connect().stageData(P1, 'forest')).objects.length, 0, '목표가 끝난 뒤에는 남은 오브젝트를 보여 주지 않는다');
});

// ---------- 지점 표시 ----------

test('지도에 보이는 것: 진행에 따라 활성 지점만, 구조 전 실가루는 잠김, 문은 이벤트로 열리고, 숨은 구역은 열린 뒤에만 보인다', async () => {
  const stages: [string, string[], string[], string, boolean[], boolean][] = [
    ['CH01_STARTED', RESCUED.slice(0, 4), ['forest_cut_thread'], 'locked', [false], false],
    ['CH01_STARTED', RESCUED.slice(0, 5), ['forest_bopuli_ambush'], 'locked', [false], false],
    ['CH01_STARTED', RESCUED.slice(0, 7), ['forest_bopuli_ambush'], 'locked', [false], false],
    ['CH01_BOPUL_RESCUED', RESCUED, ['forest_bopuli_return'], 'available', [false], false],
    ['CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted'], ['forest_hidden_path'], 'none', [false], false],
    ['CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened'], ['forest_giant_knot'], 'none', [true, false], true],
    ['CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated'], ['forest_first_knot_awaken'], 'none', [true, false], true],
    ['CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened'], [], 'none', [true, false], true],
    ['CH01_FIRST_KNOT_EQUIPPED', [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped'], ['forest_dansuring'], 'none', [true, true], true],
    ['CH01_COMPLETE', [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'], [], 'none', [true, true], true],
  ];
  for (const [checkpoint, events, points, dust, gates, hiddenZone] of stages) {
    const view = await setup(checkpoint, events).service.stageData(P1, 'forest');
    const label = `${checkpoint} / ${events[events.length - 1]}`;
    assert.deepEqual(view.points.map((p) => p.id), points, `${label}: 활성 지점`);
    assert.deepEqual(dust === 'none' ? view.objects.length : [view.objects.length, [...new Set(view.objects.map((o) => o.state))]], dust === 'none' ? 0 : [10, [dust]], `${label}: 실가루`);
    assert.deepEqual(view.gates.map((g) => g.open), gates, `${label}: 문(실뿌리 문은 숨은 길이 열린 뒤에만 지도에 나온다)`);
    assert.equal(view.layout!.zones.some((z) => z.id === 'zone_hidden'), hiddenZone, `${label}: 숨은 구역 표시`);
    // 숨은 구역의 내부 정보(안쪽 벽·안쪽 길)는 열리기 전에는 내려 주지 않는다. 바깥 벽은 처음부터 보인다(부딪히는 벽)
    assert.equal(view.layout!.blockers.some((b) => b.id.startsWith('wall_root')), hiddenZone, `${label}: 안쪽 벽`);
    assert.ok(view.layout!.blockers.some((b) => b.id === 'wall_hidden_top'), `${label}: 바깥 벽`);
    const inner = view.layout!.paths.some((path) => path.some(([x]) => x > 2300));
    assert.equal(inner, hiddenZone, `${label}: 문 안쪽 길`);
    assert.equal(view.layout!.paths.some((path) => path.some(([x]) => x === pointOf('forest_hidden_path').x)), events.includes('forest_compass_granted'), `${label}: 숨은 길로 가는 길은 나침판 뒤에`);
    assert.ok(view.layout!.blockers.every((b) => !('visibleAfter' in b)) && view.gates.every((g) => !('openEvent' in g)), '규칙 필드는 내려 주지 않는다');
    for (const p of view.points) assert.deepEqual([p.x, p.y], [pointOf(p.id).x, pointOf(p.id).y]);
  }
});

test('오프닝 전에는 숲 화면 데이터를 내려 주지 않는다', async () => {
  const s = setup('OPENING_NAME_SAVED', ['opening_fall_completed', 'opening_name_saved']);
  assert.equal(await codeOf(s.service.stageData(P1, 'forest')), 'STAGE_LOCKED');
  assert.equal(await codeOf(s.service.stageData(P1, 'nowhere')), 'INVALID_STAGE');
});

test('최종 에셋 연결 계약(10-06 v2): 배경 키·진행별 오버레이·문 닫힘/열림 키가 같은 서버 스냅샷에서 함께 바뀐다(숨은 길 그림·먼지바람·충돌)', async () => {
  const base = [...RESCUED, 'forest_compass_granted'];
  const before = await setup('CH01_COMPASS_ACQUIRED', base).service.stageData(P1, 'forest');
  const after = await setup('CH01_COMPASS_ACQUIRED', [...base, 'forest_hidden_path_opened']).service.stageData(P1, 'forest');
  assert.deepEqual(before.render.background, { assetKey: 'forest-base' });
  // 개방 전: 숨은 길 오버레이 없음, 먼지바람 문은 닫힘(닫힘 텍스처 키 + 충돌), 길 자체가 내려가지 않는다
  assert.deepEqual(before.render.overlays.map((o) => o.id), ['hidden_area_thicket_locked', 'npc_bopuli'], '숨은 길 오버레이 없음 — 길은 수풀이 가리고 보풀이 NPC만 보인다');
  assert.deepEqual(after.render.overlays.map((o) => o.id).includes('hidden_area_thicket_locked'), false, '개방 뒤에는 수풀이 걷힌다');
  const windBefore = before.gates.find((g) => g.id === 'gate_hidden_path')!;
  assert.deepEqual([windBefore.open, windBefore.closedAssetKey, windBefore.openAssetKey], [false, 'dust-wind-closed', null]);
  // 개방 뒤: 같은 스냅샷에서 오버레이 공개 + 문 열림(열림 텍스처 없음 = 먼지바람이 사라진다) + 실뿌리 문이 닫힘 상태로 나타남
  assert.deepEqual(after.render.overlays.map((o) => o.assetKey), ['hidden-yarn-path', 'giant-thread-knot-map', 'turby-bopuli']);
  const windAfter = after.gates.find((g) => g.id === 'gate_hidden_path')!;
  assert.deepEqual([windAfter.open, windAfter.openAssetKey], [true, null]);
  const root = after.gates.find((g) => g.id === 'gate_root')!;
  assert.deepEqual([root.open, root.closedAssetKey, root.openAssetKey, root.art], [false, 'root-gate-closed', 'root-gate-open', { x: 2800, y: 1050, width: 300, height: 325, pivot: [0.5, 0.92] }]);
  // 실뿌리 문: 첫 매듭 장착 뒤에 같은 문이 열림 텍스처로
  const equipped = await setup('CH01_FIRST_KNOT_EQUIPPED', [...base, 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped']).service.stageData(P1, 'forest');
  const rootOpen = equipped.gates.find((g) => g.id === 'gate_root')!;
  assert.deepEqual([rootOpen.open, rootOpen.openAssetKey], [true, 'root-gate-open']);
  // 지점·수집 오브젝트의 에셋 키는 실제 런타임 키다
  assert.ok((await setup('CH01_BOPUL_RESCUED', RESCUED).service.stageData(P1, 'forest')).objects.every((o) => o.assetKey === 'glowing-yarn-dust'));
  const cut = await setup('CH01_STARTED', RESCUED.slice(0, 4)).service.stageData(P1, 'forest');
  const cutArt = cut.render.overlays.find((o) => o.id === 'prop_cut_thread')!;
  assert.deepEqual([cutArt.assetKey, cutArt.width, cutArt.height, cutArt.forPoints], ['cut-yarn-strand', 360, 150, ['forest_cut_thread']], '잘린 실은 월드 그림 360×150');
  assert.equal(cutArt.y, cut.points[0].y - 85, '조사 지점 위 85px — 플레이어와 겹치지 않는다');
  // 기존 ID·이벤트 ID는 그대로
  assert.deepEqual(after.gates.map((g) => g.id), ['gate_hidden_path', 'gate_root']);
});

test('render 데이터 검증: 잘못된 에셋 키·크기·문 그림은 서버가 거부한다(실제 숲 데이터는 통과)', async () => {
  const { validateRender } = await import('../src/turby/story/story-content.service');
  const real = JSON.parse(JSON.stringify(new StoryContentService().stage('forest')));
  assert.doesNotThrow(() => validateRender(real, 'forest'));
  const bad = (mutate: (d: any) => void, re: RegExp) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(JSON.stringify(real));
    mutate(d);
    assert.throws(() => validateRender(d, 'forest'), re);
  };
  bad((d) => (d.render.background.assetKey = '../evil.png'), /render\.background\.assetKey/);
  bad((d) => (d.render.overlays[0].width = 0), /render\.overlays\[0\]/);
  bad((d) => (d.render.overlays[1].id = d.render.overlays[0].id), /id가 없거나 겹친다/);
  bad((d) => delete d.layout.gates[1].art, /gate_root\)\.art/);
  bad((d) => (d.layout.gates[0].closedAssetKey = 'Bad Key'), /closedAssetKey/);
});

test('월드 표시 상태 조건(10-06 v6): 거대 매듭은 숨은 길 개방 뒤~격파 전, 보풀이는 구조 전 먼지실 오버레이·구조 뒤 정상·이후에도 NPC 유지, 단수링은 첫 매듭 장착 뒤', async () => {
  const ids = async (checkpoint: string, events: string[]) => (await setup(checkpoint, events).service.stageData(P1, 'forest')).render.overlays.map((o) => o.id);
  const OPEN = [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened'];
  const DEFEATED = [...OPEN, 'forest_giant_knot_defeated'];
  const EQUIPPED = [...DEFEATED, 'forest_first_knot_awakened', 'forest_first_knot_equipped'];
  // 보풀이: 구조 전(먼지실에 붙잡힘) → 구조 뒤 정상, 전달·장 진행 뒤에도 NPC는 남는다
  assert.deepEqual(await ids('CH01_STARTED', RESCUED.slice(0, 5)), ['hidden_area_thicket_locked', 'npc_bopuli', 'npc_bopuli_tangled']);
  assert.deepEqual(await ids('CH01_BOPUL_RESCUED', RESCUED), ['hidden_area_thicket_locked', 'npc_bopuli']);
  assert.ok((await ids('CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted'])).includes('npc_bopuli'), '실가루 전달 뒤에도 NPC 유지');
  // 거대 매듭: 개방 전 없음 → 개방 뒤 표시 → 격파 기록 직후 제거
  assert.ok(!(await ids('CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted'])).includes('prop_giant_knot_map'));
  assert.ok((await ids('CH01_COMPASS_ACQUIRED', OPEN)).includes('prop_giant_knot_map'));
  assert.ok(!(await ids('CH01_COMPASS_ACQUIRED', DEFEATED)).includes('prop_giant_knot_map'));
  // 단수링: 첫 매듭 장착 전에는 없고 장착 뒤에만
  assert.ok(!(await ids('CH01_COMPASS_ACQUIRED', DEFEATED)).includes('npc_dansuring'));
  assert.ok((await ids('CH01_FIRST_KNOT_EQUIPPED', EQUIPPED)).includes('npc_dansuring'));
  assert.ok((await ids('CH01_FIRST_KNOT_EQUIPPED', EQUIPPED)).includes('npc_bopuli'), '장 진행 뒤에도 보풀이 NPC 유지');
  // 규격: 피벗·크기·표시층, 그림이 대신하는 지점
  const view = await setup('CH01_FIRST_KNOT_EQUIPPED', EQUIPPED).service.stageData(P1, 'forest');
  const by = (id: string) => view.render.overlays.find((o) => o.id === id)!;
  assert.deepEqual([by('npc_dansuring').assetKey, by('npc_dansuring').width, by('npc_dansuring').height, by('npc_dansuring').pivot, by('npc_dansuring').layer], ['dansuring', 96, 96, [0.5, 0.82], 'story']);
  const knot = (await setup('CH01_COMPASS_ACQUIRED', OPEN).service.stageData(P1, 'forest')).render.overlays.find((o) => o.id === 'prop_giant_knot_map')!;
  assert.deepEqual([knot.assetKey, knot.width, knot.height, knot.pivot, knot.forPoints], ['giant-thread-knot-map', 320, 320, [0.5, 0.5], ['forest_giant_knot']]);
  assert.equal(view.render.markerMode, 'final', '최종 에셋이 모두 연결돼 임시 표식은 그림이 있는 대상에서 없어진다');
  assert.deepEqual(view.gates.find((g) => g.id === 'gate_root')!.art!.pivot, [0.5, 0.92], '실뿌리 문 피벗(하단 중앙 0.92) — 닫힘·열림 같은 캔버스·피벗');
});

// 10-08 v1 §1·§2: 월드 그림 표시 크기·피벗·위치 계약과 HUD 안전영역
test('표시 크기·피벗 계약(10-08 v1): 보풀이 128/먼지실 176 같은 바닥 접점, 먼지바람 240×270, 별도 바닥 패치 없음·안내 실 폭 180~230, 매듭 320 중심=지점, 문 300×325 닫힘·열림 같은 위치, 단수링 96', async () => {
  const OPEN = [...RESCUED, 'forest_compass_granted', 'forest_hidden_path_opened'];
  const view = await setup('CH01_FIRST_KNOT_EQUIPPED', [...OPEN, 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped']).service.stageData(P1, 'forest');
  const by = (id: string) => view.render.overlays.find((o) => o.id === id)!;
  const tangled = (await setup('CH01_STARTED', RESCUED.slice(0, 5)).service.stageData(P1, 'forest')).render.overlays.find((o) => o.id === 'npc_bopuli_tangled')!;
  const bop = by('npc_bopuli');
  assert.deepEqual([bop.width, bop.height, tangled.width, tangled.height], [128, 128, 176, 176]);
  assert.deepEqual([tangled.x, tangled.y, tangled.pivot], [bop.x, bop.y, bop.pivot], '두 그림의 바닥 접점(피벗과 위치)이 같다 — 오버레이가 사라져도 보풀이는 그대로');
  assert.equal(view.render.overlays.some((o) => o.id === 'overlay_hidden_path_reveal'), false, '별도 바닥 패치 없음(10-08 v5)');
  const yarn = by('overlay_hidden_yarn_path');
  assert.ok(yarn.width >= 180 && yarn.width <= 230 && Math.abs(yarn.width / yarn.height - 3) < 0.05, '안내 실 폭 180~230·원본 3:1 비율');
  const knot = by('prop_giant_knot_map');
  void knot;
  const wind = (await setup('CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted']).service.stageData(P1, 'forest')).gates.find((g) => g.id === 'gate_hidden_path')!;
  assert.deepEqual([wind.art!.width, wind.art!.height], [240, 270]);
  assert.ok(wind.art!.x - wind.art!.width / 2 >= wind.x + wind.width - 70 && wind.art!.x - wind.x - wind.width >= 40, '먼지바람은 닫힌 문 충돌선보다 40px 이상 뒤');
  const root = view.gates.find((g) => g.id === 'gate_root')!;
  assert.deepEqual([root.art!.width, root.art!.height, root.art!.pivot], [300, 325, [0.5, 0.92]]);
  const closedView = (await setup('CH01_COMPASS_ACQUIRED', OPEN).service.stageData(P1, 'forest')).gates.find((g) => g.id === 'gate_root')!;
  assert.deepEqual(closedView.art, root.art, '닫힘·열림 상태가 같은 art(위치·크기·피벗) — 전환 때 위치가 튀지 않는다');
  const knotPoint = view.points.length >= 0 ? FOREST.points.find((p) => p.id === 'forest_giant_knot')! : null;
  const knotView = (await setup('CH01_COMPASS_ACQUIRED', OPEN).service.stageData(P1, 'forest')).render.overlays.find((o) => o.id === 'prop_giant_knot_map')!;
  assert.deepEqual([knotView.x, knotView.y, knotView.pivot], [knotPoint!.x, knotPoint!.y, [0.5, 0.5]], '매듭 그림 중심 = 전투 시작 지점');
});

// 10-08 v4: 털실 수풀 잠금 오버레이 — 배경은 개방 전후 forest-base 그대로, 수풀·새 바닥 에셋 크기·알파·해시 고정, 검은 안개 키 없음
test('수풀 잠금(10-08 v4): 배경은 항상 forest-base, 개방 전 수풀만·개방 뒤 수풀 제거와 새 바닥+안내 실 표시, fog-veil 키가 응답에 없다', async () => {
  const base = [...RESCUED, 'forest_compass_granted'];
  const before = await setup('CH01_COMPASS_ACQUIRED', base).service.stageData(P1, 'forest');
  const after = await setup('CH01_COMPASS_ACQUIRED', [...base, 'forest_hidden_path_opened']).service.stageData(P1, 'forest');
  for (const v of [before, after]) {
    assert.deepEqual(v.render.background, { assetKey: 'forest-base' }, '배경은 개방 전후 같은 한 장');
    assert.equal(v.render.backgroundLocked, undefined, '운영 데이터는 backgroundLocked를 쓰지 않는다');
    assert.equal(JSON.stringify(v).includes('fog-veil'), false, '검은 안개 키 없음');
  }
  const thicket = before.render.overlays.find((o) => o.id === 'hidden_area_thicket_locked')!;
  assert.deepEqual([thicket.assetKey, thicket.x, thicket.y, thicket.width, thicket.height, thicket.pivot], ['hidden-area-thicket-locked', 2020, 990, 540, 405, [0.5, 0.5]]);
  const ids = (v: typeof before) => v.render.overlays.map((o) => o.id);
  assert.equal(ids(before).includes('overlay_hidden_yarn_path'), false, '개방 전 안내 실은 표시하지 않는다');
  assert.equal(JSON.stringify([before, after]).includes('hidden-path-reveal'), false, '별도 바닥 패치 키가 서버 응답에 없다(10-08 v5)');
  assert.equal(ids(after).includes('hidden_area_thicket_locked'), false, '개방 뒤 수풀 제거');
  assert.deepEqual(after.render.overlays.filter((o) => o.assetKey.startsWith('hidden-')).map((o) => o.assetKey), ['hidden-yarn-path'], '개방 뒤 길 안내 오버레이는 안내 실뿐');
  const yarnO = after.render.overlays.find((o) => o.id === 'overlay_hidden_yarn_path')!;
  assert.deepEqual([yarnO.x, yarnO.y, yarnO.width, yarnO.height], [1960, 985, 190, 63]);
  const knotO = after.render.overlays.find((o) => o.id === 'prop_giant_knot_map')!;
  assert.ok(yarnO.x + yarnO.width / 2 <= knotO.x - knotO.width / 2, '안내 실과 거대 매듭 객체 경계가 겹치지 않는다');
  assert.ok(ids(after).includes('overlay_hidden_yarn_path'));
  assert.deepEqual([before.gates.find((g) => g.id === 'gate_hidden_path')!.open, after.gates.find((g) => g.id === 'gate_hidden_path')!.open], [false, true], '먼지바람 문이 같은 스냅샷에서 개방');
  // 허용 범위(10-08 v5): 수풀 중심 x 2020~2140·y 880~1000·폭 540~700, 안내 실 x 1930~2000
  assert.ok(thicket.x >= 2020 && thicket.x <= 2140 && thicket.y >= 880 && thicket.y <= 1000 && thicket.width >= 540 && thicket.width <= 700 && Math.abs(thicket.width / thicket.height - 1448 / 1086) < 0.01);
  assert.ok(Math.abs(yarnO.x - 1960) <= 40 && Math.abs(yarnO.y - 985) <= 25);
});

test('신규 PNG 고정(10-08 v4): hidden-area-thicket-locked 1448×1086 · 알파 채널, SHA-256(바닥 패치 v2는 런타임에 없음)', () => {
  const dir = join(__dirname, '..', '..', 'save-a-turby', 'src', 'assets', 'world', 'forest');
  const want: [string, number, number, string][] = [
    ['hidden-area-thicket-locked.png', 1448, 1086, '61b0fdb7ffedd845a00e7a9671474238f4dc3e597e514a112f4e87045c3da272'],
  ];
  assert.equal(existsSync(join(dir, 'hidden-path-reveal-v2.png')), false, '별도 바닥 패치 런타임 파일은 없는 것이 정상');
  for (const [f, w, h, sha] of want) {
    const buf = readFileSync(join(dir, f));
    assert.equal(buf.readUInt32BE(16), w, `${f} 너비`);
    assert.equal(buf.readUInt32BE(20), h, `${f} 높이`);
    assert.ok([4, 6].includes(buf[25]), `${f} 알파 채널(컬러 타입 ${buf[25]})`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), sha, `${f} SHA-256`);
  }
});

test('HUD 안전영역(10-08 v1 §2): 목표 중심은 지도 오른쪽 끝에서 카메라가 멈춰도 오른쪽 HUD(데스크톱 170px·640×360은 논리 250px) 안에 들지 않고, 단수링은 문 안쪽에 있다', () => {
  // 카메라 최대 이동: 가로 3200−1280 = 1920 → 목표의 화면 x = x − 1920. 안전: ≤ 1280 − 250(640×360의 125px는 논리 좌표 250px)
  const limit = 3200 - 1280 + (1280 - 250);
  const targets = [...FOREST.points.map((p) => [p.id, p.x] as [string, number]), ...FOREST.render!.overlays!.map((o) => [o.id, o.x] as [string, number])];
  for (const [id, x] of targets) assert.ok(x <= limit, `${id} x=${x} > ${limit}`);
  const door = FOREST.layout!.gates.find((g) => g.id === 'gate_root')!;
  // 카메라가 지도 오른쪽 끝에 멈춰도 문 그림의 오른쪽 끝(보수적 사각형)이 HUD 시작(논리 1064, 640×360 실측 x=532)에서 16px 이상 떨어진다
  assert.ok(door.art!.x + door.art!.width / 2 - 1920 <= 1064 - 16, `문 오른쪽 끝 ${door.art!.x + door.art!.width / 2}`);
  const knot = FOREST.points.find((p) => p.id === 'forest_giant_knot')!;
  assert.deepEqual([knot.x, FOREST.points.find((p) => p.id === 'forest_first_knot_awaken')!.x, FOREST.render!.overlays!.find((o) => o.id === 'prop_giant_knot_map')!.x], [2220, 2220, 2220], '매듭 그림·전투·각성 지점이 같은 중심');
  const dansuring = FOREST.points.find((p) => p.id === 'forest_dansuring')!;
  assert.ok(Math.abs(dansuring.x - door.art!.x) <= 120, '단수링은 열린 문 중앙 근처(좌우 120px 이내)');
});

// 10-08 v2 §3.1: 잠금 배경 필드 — 두 필드가 모두 있을 때만 내려가고, 해제 여부는 같은 스냅샷의 이벤트로 정해진다(시험용 지역 데이터 fixture)
test('잠금 배경 계약: 미지정이면 필드 없음, 둘 다 있으면 이벤트 전 backgroundUnlocked=false·후 true, 하나만 있으면 내려가지 않는다. 형식이 틀리면 서버가 뜨지 않는다', async () => {
  const withRender = async (patch: (r: NonNullable<StageStoryData['render']>) => void, events: string[]) => {
    const s = setup('CH01_COMPASS_ACQUIRED', events);
    const stage: StageStoryData = JSON.parse(JSON.stringify(FOREST));
    patch(stage.render!);
    const fake = Object.assign(Object.create(content) as typeof content, { stage: (c: string) => (c === 'forest' ? stage : content.stage(c)) });
    const svc = new StoryService(s.db.client(), { roomOf: () => undefined, memberPosition: () => null, reachOf: () => 'ok', noteStoryEvents: () => undefined } as never, { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d } as never, fake, new StageAccessService(s.db.client(), { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d } as never));
    return (await svc.stageData(P1, 'forest')).render;
  };
  const base = [...RESCUED, 'forest_compass_granted'];
  const none = await withRender(() => undefined, base);
  assert.deepEqual([none.backgroundLocked, none.unlockedBy, none.backgroundUnlocked], [undefined, undefined, undefined], '운영 데이터는 잠금 배경을 참조하지 않는다');
  const lock = (r: NonNullable<StageStoryData['render']>) => { r.backgroundLocked = 'forest-base-locked'; r.unlockedBy = 'forest_hidden_path_opened'; };
  const before = await withRender(lock, base);
  assert.deepEqual([before.background, before.backgroundLocked, before.unlockedBy, before.backgroundUnlocked], [{ assetKey: 'forest-base' }, 'forest-base-locked', 'forest_hidden_path_opened', false]);
  const after = await withRender(lock, [...base, 'forest_hidden_path_opened']);
  assert.equal(after.backgroundUnlocked, true);
  const half = await withRender((r) => { r.backgroundLocked = 'forest-base-locked'; }, base);
  assert.deepEqual([half.backgroundLocked, half.backgroundUnlocked], [undefined, undefined], '하나만 있으면 기존 배경');
  const bad = JSON.parse(JSON.stringify(FOREST)) as StageStoryData;
  bad.render!.backgroundLocked = 'Bad Key!';
  assert.throws(() => validateRender(bad, 'forest'), /backgroundLocked/);
});
