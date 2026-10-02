// 10-02 v3: 1장 숲 — 실제 지역 데이터(story-data/stages/forest.json)와 전이표의 정합, 고유 오브젝트 수집, 지점 표시.
// 좌표는 회색상자(임시) 값이다. 여기서는 "좌표가 무엇이든 지켜져야 하는 규칙"만 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
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
  const rooms = { roomOf: () => (pos ? { stageCode: pos.stageCode } : undefined), memberPosition: () => (pos ? { x: pos.x, y: pos.y, inMap: true, connected: true } : null) };
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
  assert.equal(FOREST.greybox, true, '회색상자(임시) 표시');
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
    ['CH01_STARTED', RESCUED.slice(0, 4), ['forest_cut_thread'], 'locked', [false, false], false],
    ['CH01_STARTED', RESCUED.slice(0, 5), ['forest_bopuli_ambush'], 'locked', [false, false], false],
    ['CH01_STARTED', RESCUED.slice(0, 7), ['forest_bopuli_ambush'], 'locked', [false, false], false],
    ['CH01_BOPUL_RESCUED', RESCUED, ['forest_bopuli_return'], 'available', [false, false], false],
    ['CH01_COMPASS_ACQUIRED', [...RESCUED, 'forest_compass_granted'], ['forest_hidden_path'], 'none', [false, false], false],
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
    assert.deepEqual(view.gates.map((g) => g.open), gates, `${label}: 문`);
    assert.equal(view.layout!.zones.some((z) => z.id === 'zone_hidden'), hiddenZone, `${label}: 숨은 구역 표시`);
    for (const p of view.points) assert.deepEqual([p.x, p.y], [pointOf(p.id).x, pointOf(p.id).y]);
  }
});

test('오프닝 전에는 숲 화면 데이터를 내려 주지 않는다', async () => {
  const s = setup('OPENING_NAME_SAVED', ['opening_fall_completed', 'opening_name_saved']);
  assert.equal(await codeOf(s.service.stageData(P1, 'forest')), 'STAGE_LOCKED');
  assert.equal(await codeOf(s.service.stageData(P1, 'nowhere')), 'INVALID_STAGE');
});
