import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StoryService } from '../src/turby/story/story.service';
import { SessionService } from '../src/turby/session.service';
import { EquipmentService } from '../src/turby/equipment.service';
import { EVENT_BY_ID } from '../src/turby/story/story-data';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { InventoryService } from '../src/turby/inventory.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';

const P1 = 1n;
const P2 = 2n;

type Pos = { stageCode: string; x: number; y: number } | null;

function setup(opts: { nickname?: string; starters?: number; flags?: Record<string, boolean> } = {}) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-p1', nickname: opts.nickname ?? '터비 탐험가', session_token: 'token-p1-aaaaaaaa' });
  db.seed('player', { id: P2, device_uuid: 'dev-test-p2', nickname: '다른사람', session_token: 'token-p2-bbbbbbbb' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음'], [5, 'desert', 'geumbiti', '5장 — 사막']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 1000, map_height: 1000 });
    if (code !== 'nubi') db.seed('turby_character', { code, name: code });
  }
  for (let i = 0; i < (opts.starters ?? 1); i++) {
    db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', created_at: new Date(2026, 0, 10 - i), base_slot_id: 7n });
  }
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('item_definition', { code: 'yarn_tremor_compass', name: '실의 떨림을 찾는 나침판', category: 'mission' });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon' });

  let pos: Pos = null;
  const rooms = {
    roomOf: () => (pos ? { stageCode: pos.stageCode } : undefined),
    memberPosition: () => (pos ? { x: pos.x, y: pos.y, inMap: true, connected: true } : null),
    reachOf: () => 'ok',
    noteStoryEvents: () => undefined,
  };
  const flags = opts.flags ?? {};
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => flags[k] ?? d };
  const content = {
    stage: (code: string) => (code === 'forest' ? FOREST : null),
    dialogue: () => null,
    bannedNameWords: () => [],
  };
  const stageAccess = new StageAccessService(db.client(), settings as never);
  const service = new StoryService(db.client(), rooms as never, settings as never, content as never, stageAccess);
  const session = new SessionService(db.client(), settings as never);
  return { db, service, session, stageAccess, moveTo: (p: Pos) => (pos = p) };
}

// 시험용 숲 데이터(좌표는 임의 — 실제 회색상자 좌표는 story-data/stages/forest.json, test/story-forest.test.ts가 검증)
const DUST = Array.from({ length: 10 }, (_, i) => `forest_dust_${String(i + 1).padStart(2, '0')}`);
const POINT_AT: Record<string, { x: number; y: number }> = {
  ...Object.fromEntries(DUST.map((id, i) => [id, { x: 1000 + i * 100, y: 500 }])),
  forest_cut_thread: { x: 200, y: 200 },
  forest_bopuli_ambush: { x: 300, y: 300 },
  forest_bopuli_return: { x: 300, y: 300 },
  forest_hidden_path: { x: 1500, y: 1500 },
  forest_giant_knot: { x: 1700, y: 1500 },
  forest_first_knot_awaken: { x: 1700, y: 1500 },
  forest_dansuring: { x: 2000, y: 2000 },
};
const FOREST = {
  stageCode: 'forest',
  greybox: true,
  size: { width: 3200, height: 2400 },
  regions: [],
  points: Object.entries(POINT_AT).map(([id, p]) => ({ id, ...p, radius: 20 })),
  objects: DUST.map((id) => ({ id, objectiveKey: 'forest_glowing_dust', group: 'test', assetKey: 'placeholder-dust', label: '실가루', prompt: '줍기' })),
  storyPoints: Object.keys(POINT_AT).filter((id) => !id.startsWith('forest_dust_')).map((id) => ({ id, kind: 'inspect', assetKey: 'placeholder-point', label: id, prompt: '살펴보기' })),
  layout: { zones: [], paths: [], blockers: [], gates: [{ id: 'gate_hidden_path', label: '', x: 0, y: 0, width: 10, height: 10, openEvent: 'forest_hidden_path_opened' }] },
};
const at = (id: string) => ({ stageCode: 'forest', ...POINT_AT[id] });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return 'NO_ERROR';
}

const progressOf = (db: FakeDb) => db.rows('player_story_progress', { player_id: P1 })[0] ?? null;
const eventsOf = (db: FakeDb) => db.rows('player_story_event', { player_id: P1 }).map((r) => r.event_id as string);
const qty = (db: FakeDb, code: string) => {
  const def = db.rows('item_definition', { code })[0];
  return (db.rows('player_item', { player_id: P1, item_definition_id: def.id })[0]?.quantity as number | undefined) ?? 0;
};

// 테스트 준비용: 전이표를 거치지 않고 특정 상태를 만든다
function forceState(db: FakeDb, checkpoint: string, events: string[], extra: Record<string, unknown> = {}) {
  const existing = progressOf(db);
  if (existing) Object.assign(existing, { checkpoint, ...extra });
  else db.seed('player_story_progress', { player_id: P1, checkpoint, ...extra });
  for (const e of events) if (!eventsOf(db).includes(e)) db.seed('player_story_event', { player_id: P1, event_id: e });
}

async function finishOpening(s: ReturnType<typeof setup>) {
  await s.service.completeEvent(P1, 'opening_fall_completed');
  await s.service.saveName(P1, '하늘');
  return s.service.completeEvent(P1, 'story_nubi_granted');
}

test('오프닝 전체: 이름 저장, 가장 오래된 스타터 누비를 이야기 누비로(선반 → 가방)', async () => {
  const s = setup({ starters: 2 });
  const res = await finishOpening(s);
  assert.equal(res.story.checkpoint, 'OPENING_COMPLETE');
  assert.equal(res.story.playerName, '하늘');
  const nubis = s.db.rows('turby_instance', { owner_player_id: P1 });
  assert.equal(nubis.length, 2, '새 누비를 만들지 않고 나머지 스타터도 유지');
  const oldest = nubis.reduce((a, b) => ((a.created_at as Date) < (b.created_at as Date) ? a : b));
  assert.equal(String(progressOf(s.db).story_nubi_turby_instance_id), String(oldest.id));
  assert.equal(oldest.is_story_companion, true);
  assert.equal(oldest.base_slot_id, null, '가방으로 이동(C8)');
  assert.equal(nubis.filter((n) => n.is_story_companion).length, 1);
  assert.deepEqual(eventsOf(s.db).sort(), ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted']);
});

test('스타터가 없는 계정은 오프닝 완료 때 이야기 누비를 새로 만든다', async () => {
  const s = setup({ starters: 0 });
  await finishOpening(s);
  const nubis = s.db.rows('turby_instance', { owner_player_id: P1 });
  assert.equal(nubis.length, 1);
  assert.equal(nubis[0].is_story_companion, true);
});

test('같은 이벤트 재요청: 성공 응답, 영구 효과 1회', async () => {
  const s = setup({ starters: 0 });
  await finishOpening(s);
  const again = await s.service.completeEvent(P1, 'story_nubi_granted');
  assert.equal(again.alreadyCompleted, true);
  assert.equal(s.db.rows('turby_instance', { owner_player_id: P1 }).length, 1, '누비 중복 생성 없음');
  assert.equal(s.db.rows('player_story_event', { player_id: P1, event_id: 'story_nubi_granted' }).length, 1);
});

test('동시 재요청(직렬화 경유 3건): 보상 1회', async () => {
  const s = setup({ starters: 0 });
  await s.service.completeEvent(P1, 'opening_fall_completed');
  await s.service.saveName(P1, '하늘');
  const results = await Promise.all([1, 2, 3].map(() => s.service.completeEvent(P1, 'story_nubi_granted')));
  assert.equal(results.filter((r) => !r.alreadyCompleted).length, 1);
  assert.equal(s.db.rows('turby_instance', { owner_player_id: P1 }).length, 1);
});

test('동시 재요청(직렬화 우회 — DB unique만으로 방어): 한 건만 반영되고 나머지는 전부 롤백', async () => {
  const s = setup({ starters: 0 });
  await s.service.completeEvent(P1, 'opening_fall_completed');
  await s.service.saveName(P1, '하늘');
  const def = EVENT_BY_ID.get('story_nubi_granted')!;
  const results = await Promise.all([s.service.runEvent(P1, def, null), s.service.runEvent(P1, def, null)]);
  assert.equal(results.filter((r) => !r.alreadyCompleted).length, 1);
  assert.equal(s.db.rows('player_story_event', { player_id: P1, event_id: 'story_nubi_granted' }).length, 1);
  assert.equal(s.db.rows('turby_instance', { owner_player_id: P1 }).length, 1, '늦은 트랜잭션이 만든 누비는 롤백');
  assert.equal(progressOf(s.db).checkpoint, 'OPENING_COMPLETE');
});

test('잘못된 순서·없는 이벤트·서버 전용 이벤트 거부, 상태 변화 없음', async () => {
  const s = setup();
  assert.equal(await codeOf(s.service.completeEvent(P1, 'story_nubi_granted')), 'STORY_EVENT_NOT_ALLOWED');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'no_such_event')), 'STORY_EVENT_UNKNOWN');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_giant_knot_defeated')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_unlocked')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_first_path_started')), 'STORY_EVENT_SERVER_ONLY', '1장 시작은 숲 진입 트리거만(M4-C)');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_compass_granted')), 'STORY_EVENT_SERVER_ONLY', '나침판은 보풀이 전달 트리거만(M4-C)');
  assert.equal(progressOf(s.db)?.checkpoint ?? 'OPENING_NOT_STARTED', 'OPENING_NOT_STARTED');
  assert.deepEqual(eventsOf(s.db), []);
});

test('이름: 규칙 위반 거부, 같은 이름 재시도는 성공, 다른 이름은 NAME_ALREADY_SET', async () => {
  const s = setup();
  await s.service.completeEvent(P1, 'opening_fall_completed');
  assert.equal(await codeOf(s.service.saveName(P1, '하늘!!')), 'NAME_INVALID');
  assert.equal(await codeOf(s.service.saveName(P1, '터비 탐험가')), 'NAME_INVALID');
  const first = await s.service.saveName(P1, '하늘');
  assert.equal(first.alreadyCompleted, false);
  assert.equal((await s.service.saveName(P1, ' 하늘 ')).alreadyCompleted, true);
  assert.equal(await codeOf(s.service.saveName(P1, '바다')), 'NAME_ALREADY_SET');
  assert.equal(s.db.rows('player', { id: P1 })[0].nickname, '하늘');
});

test('이름 저장 전 이벤트 직접 요청: 기본 닉네임이면 거부, 기존 계정의 사용자 이름이면 입력 생략', async () => {
  const fresh = setup();
  await fresh.service.completeEvent(P1, 'opening_fall_completed');
  assert.equal(await codeOf(fresh.service.completeEvent(P1, 'opening_name_saved')), 'STORY_PREREQUISITE_MISSING');
  const legacy = setup({ nickname: '옛날유저' });
  await legacy.service.completeEvent(P1, 'opening_fall_completed');
  const state = await legacy.service.getState(P1);
  assert.equal(state.needsName, false);
  assert.equal((await legacy.service.completeEvent(P1, 'opening_name_saved')).story.checkpoint, 'OPENING_NAME_SAVED');
});

test('숲 첫 진입: 탐험 세션 밖·다른 지역 거부, 숲 입장 시 1회 기록하고 첫 길의 걷는 장면만 재생, 재진입·동시 요청은 중복 없음', async () => {
  const s = setup();
  const INTRO = { segmentId: 'ch01.first_path', endAfter: 'ch01.first_path', untilEntry: 'ch01.first_path.004' };
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_entry')), 'OPENING_REQUIRED', '오프닝 전');
  await finishOpening(s);
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_entry')), 'STORY_EVIDENCE_INVALID', '탐험 세션 밖');
  s.moveTo({ stageCode: 'underground', x: 120, y: 120 });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_entry')), 'STORY_EVIDENCE_INVALID', '다른 지역');
  assert.equal(await s.service.onStageEntered(P1, 'underground'), null, '진입 트리거가 없는 지역(10-13: 호수는 2장 입구 트리거가 생겨 지하로 바꿨다)');
  s.moveTo({ stageCode: 'forest', x: 400, y: 400 }); // 숲 어디로 들어와도(입구 지점은 탐험 세션 진입 자체)
  const results = await Promise.all([1, 2, 3].map(() => s.service.onStageEntered(P1, 'forest')));
  for (const r of results) assert.deepEqual(r!.play, INTRO, '전투·보풀이 장면은 숲 안의 지점이 연다');
  assert.equal(results[0]!.story.checkpoint, 'CH01_STARTED');
  assert.equal(eventsOf(s.db).filter((e) => e === 'forest_first_path_started').length, 1, '동시 진입에도 시작 이벤트 1회');
  // 새로고침·재진입: 잘린 실을 살펴보기 전까지는 걷는 장면을 다시 — 시작 이벤트는 다시 기록하지 않는다
  assert.deepEqual((await s.service.onStageEntered(P1, 'forest'))!.play, INTRO);
  // 잘린 실을 살펴본 뒤 재진입: 자동 재생 없음(공터 지점이 이어 간다)
  forceState(s.db, 'CH01_STARTED', ['forest_cut_thread_inspected']);
  assert.equal((await s.service.onStageEntered(P1, 'forest'))!.play, null);
  // 보풀이 구조 뒤 재진입은 단서 대화부터, 단서까지 끝났으면 자동 재생 없음(목표만)
  forceState(s.db, 'CH01_STARTED', ['forest_stitchling_battle_won', 'forest_bopul_rescued']);
  assert.deepEqual((await s.service.onStageEntered(P1, 'forest'))!.play, { segmentId: 'ch01.bopul_clue', endAfter: 'ch01.bopul_clue' });
  await s.service.completeEvent(P1, 'forest_dansuring_clue_learned');
  const quiet = await s.service.onStageEntered(P1, 'forest');
  assert.equal(quiet!.play, null, '이미 본 장면을 거짓으로 다시 시작하지 않음');
  assert.deepEqual(quiet!.story.delivery, { triggerId: 'forest_bopuli_return', itemCode: 'glowing_yarn_dust', have: 0, need: 10 }, '실가루 목표 0/10(인벤토리 기준)');
  assert.equal(await codeOf(s.service.trigger(P1, 'no_such_trigger')), 'STORY_TRIGGER_UNKNOWN');
});

test('숲 안의 이야기 지점: 선행 조건 전에는 거부, 좌표 밖 거부, 일회성 지점은 한 번만 기록·재생, 전투 지점은 끝나기 전까지 다시 열린다', async () => {
  const s = setup();
  await finishOpening(s);
  const play = async (id: string) => (await s.service.trigger(P1, id)).play;
  const FP = 'ch01.first_path';

  // 숲에 들어오기 전(장 시작 전): 잘린 실 지점은 닫혀 있다
  s.moveTo(at('forest_cut_thread'));
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_cut_thread')), 'STORY_EVENT_NOT_ALLOWED');
  await s.service.onStageEntered(P1, 'forest');

  // 잘린 실오라기: 멀리서는 거부, 가까이서 한 번만 기록(동시 3건 → 재생 1번)
  s.moveTo({ stageCode: 'forest', x: 900, y: 900 });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_cut_thread')), 'STORY_EVIDENCE_INVALID');
  s.moveTo(at('forest_bopuli_ambush'));
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_bopuli_ambush')), 'STORY_EVENT_NOT_ALLOWED', '잘린 실을 보기 전에는 공터 지점이 열리지 않는다');
  s.moveTo(at('forest_cut_thread'));
  const three = await Promise.all([1, 2, 3].map(() => s.service.trigger(P1, 'forest_cut_thread')));
  assert.deepEqual(three.filter((r) => r.play).map((r) => r.play), [{ segmentId: FP, endAfter: FP, fromEntry: `${FP}.005`, untilEntry: `${FP}.009` }]);
  assert.equal(eventsOf(s.db).filter((e) => e === 'forest_cut_thread_inspected').length, 1);
  assert.equal(progressOf(s.db).checkpoint, 'CH01_STARTED', '지점 진입은 체크포인트를 바꾸지 않는다');
  assert.equal(await play('forest_cut_thread'), null, '완료한 일회성 지점은 다시 발동하지 않는다');

  // 공터(매복): 이벤트를 기록하지 않고 전투가 든 범위를 연다. 지거나 끊기면 같은 지점에서 다시
  s.moveTo(at('forest_bopuli_ambush'));
  const ambush = { segmentId: FP, endAfter: 'ch01.bopul_clue', fromEntry: `${FP}.010` };
  assert.deepEqual(await play('forest_bopuli_ambush'), ambush);
  assert.deepEqual(await play('forest_bopuli_ambush'), ambush, '전투에서 이기기 전까지 다시 열린다');
  assert.ok(!eventsOf(s.db).includes('forest_stitchling_battle_won'), '지점 발동만으로는 승리가 기록되지 않는다');
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_bopuli_return')), 'STORY_EVENT_NOT_ALLOWED', '구조 전에는 전달 지점이 없다');
  await s.service.completeEvent(P1, 'forest_stitchling_battle_won', 'server'); // 전투 확정 경로
  assert.deepEqual(await play('forest_bopuli_ambush'), { segmentId: 'ch01.bopul_clue', endAfter: 'ch01.bopul_clue' }, '이긴 뒤에는 단서 대화부터');
  await s.service.completeEvent(P1, 'forest_dansuring_clue_learned');
  assert.equal(await play('forest_bopuli_ambush'), null, '끝난 지점');

  // 숨은 길: 나침판 전에는 거부. 나침판 뒤 한 번 열리고, 그 뒤에야 거대 매듭 지점이 열린다
  s.moveTo(at('forest_hidden_path'));
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_hidden_path')), 'STORY_EVENT_NOT_ALLOWED');
  forceState(s.db, 'CH01_COMPASS_ACQUIRED', ['forest_compass_granted']);
  s.moveTo(at('forest_giant_knot'));
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_giant_knot')), 'STORY_EVENT_NOT_ALLOWED', '숨은 길을 열기 전');
  s.moveTo(at('forest_hidden_path'));
  const HP = 'ch01.hidden_path';
  assert.deepEqual(await play('forest_hidden_path'), { segmentId: HP, endAfter: HP, untilEntry: `${HP}.002` });
  assert.equal(await play('forest_hidden_path'), null);
  s.moveTo(at('forest_giant_knot'));
  assert.deepEqual(await play('forest_giant_knot'), { segmentId: HP, endAfter: 'ch01.first_knot_awaken', fromEntry: `${HP}.003` });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_first_knot_awaken')), 'STORY_EVENT_NOT_ALLOWED', '보스 승리 전');
  await s.service.completeEvent(P1, 'forest_giant_knot_defeated', 'server');
  assert.equal(await play('forest_giant_knot'), null, '이긴 전투 지점은 닫힌다');
  assert.deepEqual(await play('forest_first_knot_awaken'), { segmentId: 'ch01.first_knot_awaken', endAfter: 'ch01.first_knot_awaken' }, '각성 장면을 끝내지 못했으면 이어 본다');
  await s.service.completeEvent(P1, 'forest_first_knot_awakened');
  assert.equal(await play('forest_first_knot_awaken'), null);

  // 단수링: 첫 매듭 장착 전 거부, 멀리서 거부, 발견 기록은 한 번, 장 완료 전까지 장면을 이어 볼 수 있다
  s.moveTo(at('forest_dansuring'));
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_dansuring')), 'STORY_EVENT_NOT_ALLOWED', '첫 매듭 장착 전');
  await s.service.equipRelic(P1, 'first_knot');
  s.moveTo({ stageCode: 'forest', x: 100, y: 100 });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_dansuring')), 'STORY_EVIDENCE_INVALID', '단수링에서 멀리');
  s.moveTo(at('forest_dansuring'));
  const PK = { segmentId: 'ch01.primordial_knot', endAfter: 'ch01.primordial_knot' };
  assert.deepEqual(await play('forest_dansuring'), PK);
  assert.deepEqual(await play('forest_dansuring'), PK, '장면이 끊겼으면 같은 지점에서 이어 본다');
  assert.equal(eventsOf(s.db).filter((e) => e === 'forest_dansuring_found').length, 1);
  assert.deepEqual((await s.service.onStageEntered(P1, 'forest'))!.play, PK, '재접속 복귀 범위도 같다');
  await s.service.completeEvent(P1, 'forest_primordial_knot_seen');
  assert.equal(await play('forest_dansuring'), null, '장 완료 뒤에는 다시 발동하지 않는다');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_cut_thread_inspected')), 'STORY_EVENT_SERVER_ONLY', '지점 완료 이벤트는 직접 요청할 수 없다');
});

test('지역 데이터가 없으면 좌표가 필요한 지점·수집은 진행되지 않는다(거짓 진행 없음)', async () => {
  const s = setup();
  (s.service as unknown as { content: { stage: () => null } }).content.stage = () => null;
  forceState(s.db, 'CH01_COMPASS_ACQUIRED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted']);
  s.moveTo({ stageCode: 'forest', x: 2000, y: 2000 });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_hidden_path')), 'STORY_DATA_MISSING');
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01')), 'OBJECT_UNKNOWN');
});

test('서버 전투 확정 이벤트: 동반 이벤트(보풀이 구조)와 함께 기록', async () => {
  const s = setup();
  forceState(s.db, 'CH01_STARTED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started']);
  const res = await s.service.completeEvent(P1, 'forest_stitchling_battle_won', 'server');
  assert.ok(res.story.completedEvents.includes('forest_bopul_rescued'));
  assert.equal(res.story.checkpoint, 'CH01_STARTED', '전투 승리는 체크포인트를 바꾸지 않음');
  assert.equal(res.story.resume.segmentId, 'ch01.bopul_clue');
});

test('실가루: 활성 전 거부, 없는 오브젝트·먼 위치 거부, 중복 조사 1회, 10개 전달 후 나침판과 목표 종료', async () => {
  const s = setup();
  forceState(s.db, 'CH01_STARTED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_bopul_rescued']);
  s.moveTo(at('forest_dust_01'));
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01')), 'OBJECTIVE_NOT_ACTIVE', '단서 전');

  await s.service.completeEvent(P1, 'forest_dansuring_clue_learned');
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_11')), 'OBJECT_UNKNOWN', '11번째 오브젝트 없음(수량 초과 불가)');
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'dust_01')), 'OBJECT_UNKNOWN', '옛 표기 ID는 정의에 없다');
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', -1)), 'OBJECT_UNKNOWN');
  assert.equal(await codeOf(s.service.collectObject(P1, 'nope', 'forest_dust_01')), 'OBJECTIVE_UNKNOWN');
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_02')), 'STORY_EVIDENCE_INVALID', '02는 100px 떨어져 있음');

  const first = await s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01');
  const dup = await s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01');
  assert.deepEqual([first.alreadyCollected, first.collected, first.required], [false, 1, 10]);
  assert.deepEqual(first.grants, [{ itemCode: 'glowing_yarn_dust', quantity: 1, destination: 'story' }]);
  assert.deepEqual([dup.alreadyCollected, dup.collected, dup.grants.length], [true, 1, 0]);
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 1, '재조사로 실가루가 늘지 않음');
  assert.equal(first.stage.objects.length, 9, '응답의 지역 화면에서 방금 주운 것이 빠진다');

  s.moveTo(at('forest_bopuli_return'));
  const short = await s.service.trigger(P1, 'forest_bopuli_return');
  assert.deepEqual([short.play, short.shortage], [null, { itemCode: 'glowing_yarn_dust', have: 1, need: 10 }], '1/10 — 부족 수량만 알려 주고 제작하지 않음');
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 1, '부족할 때는 소비 없음');
  assert.equal(short.story.checkpoint, 'CH01_BOPUL_RESCUED');

  for (const id of DUST.slice(1)) {
    s.moveTo(at(id));
    await s.service.collectObject(P1, 'forest_glowing_dust', id);
  }
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 10);
  s.moveTo({ stageCode: 'forest', x: 900, y: 900 });
  assert.equal(await codeOf(s.service.trigger(P1, 'forest_bopuli_return')), 'STORY_EVIDENCE_INVALID', '보풀이에게서 멀리 — 전달은 보풀이 곁에서만');
  s.moveTo(at('forest_bopuli_return'));
  const res = await s.service.trigger(P1, 'forest_bopuli_return');
  assert.equal(res.story.checkpoint, 'CH01_COMPASS_ACQUIRED');
  assert.deepEqual(res.play, { segmentId: 'ch01.compass_craft', endAfter: 'ch01.compass_craft' }, '제작 연출 구간');
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 0, '10개 차감');
  assert.equal(qty(s.db, 'yarn_tremor_compass'), 1);
  assert.equal(res.story.delivery, null, '전달 목표 종료');

  s.moveTo(at('forest_dust_01'));
  assert.equal(await codeOf(s.service.collectObject(P1, 'forest_glowing_dust', 'forest_dust_01')), 'NO_ERROR', '완료 후 재요청은 이미 수집으로 성공 응답');
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 0, '완료 후 변경 없음');
});

test('트랜잭션 실패 시 이벤트·차감·체크포인트 모두 롤백', async () => {
  const s = setup();
  forceState(s.db, 'CH01_BOPUL_RESCUED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned']);
  for (const id of DUST) s.db.seed('player_story_objective_progress', { player_id: P1, objective_key: 'forest_glowing_dust', object_id: id });
  const dust = s.db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: dust.id, quantity: 10 });
  s.moveTo(at('forest_bopuli_return'));
  s.db.failOn = (table) => table === 'player_item'; // 나침판 지급(create) 단계에서 실패
  await assert.rejects(s.service.trigger(P1, 'forest_bopuli_return'));
  assert.equal(qty(s.db, 'glowing_yarn_dust'), 10, '차감 롤백');
  assert.equal(qty(s.db, 'yarn_tremor_compass'), 0);
  assert.equal(progressOf(s.db).checkpoint, 'CH01_BOPUL_RESCUED');
  assert.ok(!eventsOf(s.db).includes('forest_compass_granted'));
  s.db.failOn = null;
  assert.deepEqual((await s.service.trigger(P1, 'forest_bopuli_return')).play?.segmentId, 'ch01.compass_craft', '실패 뒤 재시도 가능');
});

test('실가루 전달: 이중 클릭·재전송(동시 3건, 직렬화 우회 2건)에도 10개 한 번만 소비·나침판 한 번만 지급, 제작 뒤 재요청은 재생 없이 완료 상태', async () => {
  for (const bypass of [false, true]) {
    const s = setup();
    forceState(s.db, 'CH01_BOPUL_RESCUED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned']);
    const dust = s.db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
    s.db.seed('player_item', { player_id: P1, item_definition_id: dust.id, quantity: 13 }); // 개발 픽스처: 10개 이상 보유
    s.moveTo(at('forest_bopuli_return'));
    if (bypass) {
      const def = EVENT_BY_ID.get('forest_compass_granted')!;
      const r = await Promise.all([s.service.runEvent(P1, def, null), s.service.runEvent(P1, def, null)]);
      assert.equal(r.filter((x) => !x.alreadyCompleted).length, 1, 'DB 방어선만으로 1회');
    } else {
      const r = await Promise.all([1, 2, 3].map(() => s.service.trigger(P1, 'forest_bopuli_return')));
      assert.equal(r.filter((x) => x.play).length, 1, '제작 연출은 한 번만');
    }
    assert.equal(qty(s.db, 'glowing_yarn_dust'), 3, '10개만 차감');
    assert.equal(qty(s.db, 'yarn_tremor_compass'), 1, '나침판 1개');
    assert.equal(eventsOf(s.db).filter((e) => e === 'forest_compass_granted').length, 1);
    const later = await s.service.trigger(P1, 'forest_bopuli_return');
    assert.deepEqual([later.play, later.shortage, later.story.checkpoint], [null, null, 'CH01_COMPASS_ACQUIRED'], '새로고침 뒤: 다시 소비·재생하지 않고 제작 완료 상태');
  }
});

test('첫 매듭: 획득(미장착)과 장착은 별개, 장착 때만 성장 단계 1, 동시 장착 1회', async () => {
  const s = setup();
  await finishOpening(s);
  forceState(s.db, 'CH01_COMPASS_ACQUIRED', ['forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted']);

  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_first_knot_awakened')), 'STORY_PREREQUISITE_MISSING', '보스 승리 전');
  await s.service.completeEvent(P1, 'forest_giant_knot_defeated', 'server');
  const awakened = await s.service.completeEvent(P1, 'forest_first_knot_awakened');
  assert.deepEqual(awakened.grants, [{ itemCode: 'first_knot', quantity: 1, destination: 'story' }]);
  assert.equal(awakened.story.resume.tutorial, 'relic_equip');
  assert.equal(progressOf(s.db).nubi_growth_stage, 0, '획득만으로는 성장하지 않음(D2)');
  assert.equal(s.db.rows('turby_equipment').length, 0);

  const def = EVENT_BY_ID.get('forest_first_knot_equipped')!;
  const both = await Promise.all([s.service.runEvent(P1, def, null), s.service.runEvent(P1, def, null)]);
  assert.equal(both.filter((r) => !r.alreadyCompleted).length, 1);
  const equip = s.db.rows('turby_equipment');
  assert.equal(equip.length, 1);
  assert.equal(equip[0].slot_key, 'story_1');
  assert.equal(String(equip[0].turby_instance_id), String(progressOf(s.db).story_nubi_turby_instance_id));
  assert.equal(progressOf(s.db).nubi_growth_stage, 1);
  assert.equal(progressOf(s.db).checkpoint, 'CH01_FIRST_KNOT_EQUIPPED');
  assert.equal(qty(s.db, 'first_knot'), 1, '장착 후에도 기록으로 남음');
});

test('1장 완료: 단수링 발견 → 태초의 매듭 → 호수 개방(같은 트랜잭션)', async () => {
  const s = setup({ flags: { 'story.stageAccessV2': true } });
  forceState(s.db, 'CH01_FIRST_KNOT_EQUIPPED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_knot_equipped'], { nubi_growth_stage: 1 });
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_primordial_knot_seen')), 'STORY_PREREQUISITE_MISSING', '단수링 발견 전');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_dansuring_found')), 'STORY_EVENT_SERVER_ONLY', '발견은 지점 발동으로만 기록');
  s.moveTo({ stageCode: 'forest', x: 2000, y: 2010 });
  await s.service.trigger(P1, 'forest_dansuring');
  const res = await s.service.completeEvent(P1, 'forest_primordial_knot_seen');
  assert.equal(res.story.checkpoint, 'CH01_COMPLETE');
  assert.equal(res.story.chapterCode, 'ch02');
  const lake = res.story.stages.find((x) => x.stageCode === 'lake')!;
  assert.deepEqual([lake.canEnter, lake.canProgress], [true, true]);
});
test('대화 데이터: 진행할 수 없는 장은 CHAPTER_LOCKED(스포일러 방지), 파일 없으면 DIALOGUE_NOT_FOUND', async () => {
  const s = setup();
  assert.equal(await codeOf(s.service.dialogue(P1, 'ch02')), 'CHAPTER_LOCKED');
  assert.equal(await codeOf(s.service.dialogue(P1, 'opening')), 'DIALOGUE_NOT_FOUND', '가짜 콘텐츠에는 파일 없음');
  assert.equal(await codeOf(s.service.dialogue(P1, '../etc')), 'DIALOGUE_NOT_FOUND');
  assert.equal(await codeOf(s.service.stageData(P1, 'lake')), 'STAGE_LOCKED');
});

test('세션: 토큰으로만 플레이어 결정, 다른 플레이어 번호 사용 거부', async () => {
  const s = setup();
  assert.equal(await s.session.require('token-p1-aaaaaaaa'), P1);
  assert.equal(await codeOf(s.session.require(undefined)), 'SESSION_REQUIRED');
  assert.equal(await codeOf(s.session.require('forged-token-000')), 'SESSION_INVALID');
  assert.equal(await codeOf(s.session.checkLegacy('2', 'token-p1-aaaaaaaa')), 'SESSION_PLAYER_MISMATCH', 'P1 토큰으로 P2 경로 조작');
  assert.equal(await codeOf(s.session.checkLegacy('1', 'token-p1-aaaaaaaa')), 'NO_ERROR');
  assert.equal(await codeOf(s.session.checkLegacy('2', undefined)), 'NO_ERROR', '전환 기간: 토큰 없는 구 클라이언트 허용');
  const strict = setup({ flags: { 'auth.requireSession': true } });
  assert.equal(await codeOf(strict.session.checkLegacy('2', undefined)), 'SESSION_REQUIRED');
  assert.equal(strict.session.socketTokenOk('token-p1-aaaaaaaa', undefined), false);
  assert.equal(s.session.socketTokenOk('token-p1-aaaaaaaa', 'wrong-token-xyz'), false);
  assert.equal(s.session.socketTokenOk('token-p1-aaaaaaaa', 'token-p1-aaaaaaaa'), true);
  const token = await s.session.ensureToken(P2, null);
  assert.equal(s.db.rows('player', { id: P2 })[0].session_token, token);
  assert.equal(await s.session.ensureToken(P1, 'token-p1-aaaaaaaa'), 'token-p1-aaaaaaaa', '기존 토큰 유지');
});

test('일반 장착 API는 이야기 슬롯을 바꿀 수 없다', async () => {
  const s = setup();
  const equipment = new EquipmentService(s.db.client());
  assert.equal(await codeOf(equipment.unequip('1', '10', 'story_1')), 'STORY_SLOT_RESERVED');
  assert.equal(await codeOf(equipment.unequip('1', '10', '')), 'INVALID_SLOT');
  const mine = s.db.rows('turby_instance', { owner_player_id: P1 })[0];
  assert.equal(await codeOf(equipment.equip('1', String(mine.id), 'first_knot')), 'NOT_EQUIPPABLE', '유물은 일반 장착 불가');
});

test('일반 보상: 가방 40칸이 차면 넘친 수량만 임시 보관함, 이야기 보상은 항상 지급', async () => {
  const s = setup();
  const needle = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: needle.id, quantity: 39 });
  const tx = s.db.client() as unknown as Parameters<StoryService['grantItem']>[0];
  const g1 = await s.service.grantItem(tx, P1, { itemCode: 'knit_needle', quantity: 3 }, 'test:a');
  assert.deepEqual(g1, { itemCode: 'knit_needle', quantity: 2, destination: 'overflow' });
  assert.equal(qty(s.db, 'knit_needle'), 40);
  assert.equal(s.db.rows('player_item_overflow', { player_id: P1 })[0].quantity, 2);
  await assert.rejects(s.service.grantItem(tx, P1, { itemCode: 'knit_needle', quantity: 1 }, 'test:a'), (e: { code?: string }) => e.code === 'P2002', '같은 보상 키는 한 번만');
  const g2 = await s.service.grantItem(tx, P1, { itemCode: 'glowing_yarn_dust', quantity: 5 }, 'test:b');
  assert.deepEqual(g2, { itemCode: 'glowing_yarn_dust', quantity: 5, destination: 'story' });
});

test('최초 세션 토큰 동시 발급: 두 요청 모두 DB에 최종 저장된 같은 토큰을 받는다', async () => {
  const s = setup();
  s.db.seed('player', { id: 3n, device_uuid: 'dev-test-p3', nickname: '셋째', session_token: null });
  const [a, b] = await Promise.all([s.session.ensureToken(3n, null), s.session.ensureToken(3n, null)]);
  assert.equal(a, b);
  assert.equal(s.db.rows('player', { id: 3n })[0].session_token, a);
  assert.equal(await s.session.require(a), 3n, '받은 토큰이 실제로 유효');
});

test('이벤트가 아닌 다른 unique 충돌은 완료 성공으로 오인하지 않는다(보관함 키 충돌)', async () => {
  const s = setup();
  const needle = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: needle.id, quantity: 40 });
  s.db.seed('player_item_overflow', { player_id: P1, item_definition_id: needle.id, quantity: 1, source_key: 'story:test_general_reward:knit_needle' });
  const def = { id: 'test_general_reward', chapter: 0, allowedAt: ['OPENING_NOT_STARTED' as const], requires: [], evidence: { kind: 'none' as const }, grant: [{ itemCode: 'knit_needle', quantity: 1 }] };
  await assert.rejects(s.service.runEvent(P1, def, null), (e: { code?: string }) => e.code === 'P2002', '원래 오류 그대로 전달');
  assert.equal(s.db.rows('player_story_event', { player_id: P1, event_id: 'test_general_reward' }).length, 0, '이벤트 행도 롤백');
  assert.equal(qty(s.db, 'knit_needle'), 40);
});

// ---------- M1-B: 임시 보관함 수령 ----------

function overflowSetup(bagQuantity: number, overflowQuantity: number) {
  const s = setup();
  const needle = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: needle.id, quantity: bagQuantity });
  const row = s.db.seed('player_item_overflow', { player_id: P1, item_definition_id: needle.id, quantity: overflowQuantity, source_key: 'test:ovf' });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d };
  const inventory = new InventoryService(s.db.client(), settings as never);
  return { ...s, inventory, rowId: String(row.id), row };
}

test('보관함 전체 수령: 가방 여유가 충분하면 모두 옮기고 claimed_at 기록, 목록에서 사라짐', async () => {
  const o = overflowSetup(30, 3);
  assert.equal((await o.inventory.listOverflow(P1)).length, 1);
  const res = await o.inventory.claimOverflow(P1, o.rowId);
  assert.deepEqual(res, { id: o.rowId, itemCode: 'knit_needle', claimed: 3, remaining: 0, fullyClaimed: true });
  assert.equal(qty(o.db, 'knit_needle'), 33);
  assert.ok(o.row.claimed_at instanceof Date);
  assert.equal((await o.inventory.listOverflow(P1)).length, 0);
  assert.equal(await codeOf(o.inventory.claimOverflow(P1, o.rowId)), 'OVERFLOW_NOT_FOUND', '이미 수령한 항목');
});

test('보관함 부분 수령: 들어가는 만큼만 옮기고 나머지는 보관함에 유지', async () => {
  const o = overflowSetup(38, 5);
  const res = await o.inventory.claimOverflow(P1, o.rowId);
  assert.deepEqual([res.claimed, res.remaining, res.fullyClaimed], [2, 3, false]);
  assert.equal(qty(o.db, 'knit_needle'), 40);
  assert.equal(o.row.quantity, 3);
  assert.equal(o.row.claimed_at, null);
});

test('보관함: 가방에 빈 칸이 없으면 상태를 바꾸지 않고 BAG_FULL', async () => {
  const o = overflowSetup(40, 2);
  assert.equal(await codeOf(o.inventory.claimOverflow(P1, o.rowId)), 'BAG_FULL');
  assert.equal(o.row.quantity, 2);
  assert.equal(o.row.claimed_at, null);
  assert.equal(qty(o.db, 'knit_needle'), 40);
});

test('보관함: 다른 플레이어의 항목은 조회·수령 불가, 잘못된 번호 거부', async () => {
  const o = overflowSetup(0, 2);
  assert.equal((await o.inventory.listOverflow(P2)).length, 0);
  assert.equal(await codeOf(o.inventory.claimOverflow(P2, o.rowId)), 'OVERFLOW_NOT_FOUND', '존재 여부도 알려 주지 않음');
  assert.equal(await codeOf(o.inventory.claimOverflow(P1, 'abc')), 'INVALID_OVERFLOW');
  assert.equal(await codeOf(o.inventory.claimOverflow(P1, '-1')), 'INVALID_OVERFLOW');
  assert.equal(o.row.quantity, 2);
});

test('보관함 동시 수령: 같은 항목을 동시에 두 번 수령해도 한 번만 지급', async () => {
  const full = overflowSetup(10, 4);
  const r1 = await Promise.allSettled([full.inventory.claimOverflow(P1, full.rowId), full.inventory.claimOverflow(P1, full.rowId)]);
  assert.equal(r1.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(qty(full.db, 'knit_needle'), 14, '4개만 지급');

  const partial = overflowSetup(37, 6); // 3칸만 비어 있음
  await Promise.allSettled([partial.inventory.claimOverflow(P1, partial.rowId), partial.inventory.claimOverflow(P1, partial.rowId)]);
  assert.equal(qty(partial.db, 'knit_needle'), 40, '가방을 넘치게 채우지 않음');
  assert.equal((partial.row.quantity as number) + qty(partial.db, 'knit_needle'), 43, '보관함+가방 합계 보존(중복 지급·유실 없음)');
});

// ---------- M1-B: 오프닝 런타임 대화 ----------

test('오프닝 대화 API: 런타임 파일이 검증된 4구간 39항목을 그대로 반환', async () => {
  const s = setup();
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d };
  const rooms = { roomOf: () => undefined, memberPosition: () => null, reachOf: () => 'ok', noteStoryEvents: () => undefined };
  const service = new StoryService(s.db.client(), rooms as never, settings as never, new StoryContentService(), s.stageAccess);
  const data = (await service.dialogue(P1, 'opening')) as { chapterCode: string; segments: { segmentId: string; entries: unknown[] }[] };
  assert.equal(data.chapterCode, 'opening');
  assert.deepEqual(data.segments.map((x) => x.segmentId), ['opening.fall', 'opening.meeting', 'opening.name_echo', 'opening.promise']);
  assert.equal(data.segments.reduce((n, x) => n + x.entries.length, 0), 39);
  assert.equal(await codeOf(service.dialogue(P1, 'ch01')), 'CHAPTER_LOCKED', '다른 장은 오프닝 완료 전 잠김');
});

// ---------- M3: 스타터 지급을 오프닝 완료 이벤트로 이전 ----------

test('신규 계정: identify는 스타터를 주지 않고, 오프닝 완료 때 이야기 누비가 정확히 하나 생긴다', async () => {
  const s = setup({ starters: 0 });
  const { PlayerService } = await import('../src/turby/player.service');
  // getInventory의 include(캐릭터·등급·장비)는 가짜 DB가 지원하지 않으므로 여기서는 개체 수만 본다
  const players = new PlayerService(s.db.client(), s.session);
  (players as unknown as { getInventory: (id: bigint) => Promise<unknown[]> }).getInventory = async (id: bigint) => s.db.rows('turby_instance', { owner_player_id: id });

  const first = await players.identify('dev-test-newcomer');
  assert.deepEqual(first.turbys, [], '이름 입력 전 스타터 없음');
  const again = await players.identify('dev-test-newcomer');
  assert.equal(again.sessionToken, first.sessionToken, '재식별해도 같은 토큰');
  const newId = BigInt(first.playerId);
  assert.equal(s.db.rows('turby_instance', { owner_player_id: newId }).length, 0);

  await s.service.completeEvent(newId, 'opening_fall_completed');
  assert.equal(s.db.rows('turby_instance', { owner_player_id: newId }).length, 0, '이름 입력 전 스타터 없음');
  await s.service.saveName(newId, '새싹');
  await s.service.completeEvent(newId, 'story_nubi_granted');
  await s.service.completeEvent(newId, 'story_nubi_granted');
  const nubis = s.db.rows('turby_instance', { owner_player_id: newId });
  assert.equal(nubis.length, 1, '재요청해도 하나');
  assert.equal(nubis[0].is_story_companion, true);
  assert.equal(nubis[0].acquired_via, 'starter');
  await players.identify('dev-test-newcomer');
  assert.equal(s.db.rows('turby_instance', { owner_player_id: newId }).length, 1, 'identify가 다시 지급하지 않음');
});


// ---------- v3 M4-D: 인벤토리 기본 기능·첫 매듭 장착 ----------

const settingsStub = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d };
const knotReady = (s: ReturnType<typeof setup>) =>
  forceState(s.db, 'CH01_COMPASS_ACQUIRED', ['opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_giant_knot_defeated']);

test('v3 인벤토리 조회: 분류(재료·소비·장비·스토리)·필수 필드·중첩(max_stack 초과는 다음 칸)·스토리 아이템 잠금', async () => {
  const s = setup();
  await finishOpening(s);
  const dust = s.db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
  dust.category = 'material'; // 재료로 쓰는 경우의 중첩 확인(정의 max_stack 99)
  s.db.seed('item_definition', { code: 'tonic', name: '회복 실타래', category: 'consumable', max_stack: 5, description: '체력 회복' });
  const tonic = s.db.rows('item_definition', { code: 'tonic' })[0];
  const needle = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: dust.id, quantity: 150, is_new: true, first_acquired_at: new Date(2026, 8, 1), last_acquired_at: new Date(2026, 8, 2) });
  s.db.seed('player_item', { player_id: P1, item_definition_id: tonic.id, quantity: 7, is_new: false });
  s.db.seed('player_item', { player_id: P1, item_definition_id: needle.id, quantity: 1, is_new: false });
  knotReady(s);
  await s.service.completeEvent(P1, 'forest_first_knot_awakened'); // 첫 매듭 지급(스토리 아이템 → 지급 때 잠금 기록)

  const inv = new InventoryService(s.db.client(), settingsStub as never);
  const { items } = await inv.list(P1);
  const by = (code: string) => items.find((i) => i.itemCode === code)!;
  assert.deepEqual(items.map((i) => [i.itemCode, i.tabLabel]).sort(), [['first_knot', '스토리'], ['glowing_yarn_dust', '재료'], ['knit_needle', '장비'], ['tonic', '소비']]);
  const d = by('glowing_yarn_dust');
  assert.deepEqual([d.recordId, d.itemDefinitionId, d.iconKey, d.name, d.quantity, d.maxStack, d.isNew], [String(dust.id), dust.id, 'glowing_yarn_dust', '빛나는 실가루', 150, 99, true]);
  assert.deepEqual(d.stacks, [99, 51], '한 칸은 max_stack까지');
  assert.equal(d.firstAcquiredAt, new Date(2026, 8, 1).toISOString());
  assert.deepEqual(by('tonic').stacks, [5, 2]);
  const knot = by('first_knot');
  assert.equal(knot.isLocked, true, '스토리 아이템 잠금');
  assert.equal(s.db.rows('player_item', { player_id: P1, item_definition_id: s.db.rows('item_definition', { code: 'first_knot' })[0].id })[0].is_locked, true, 'DB에도 잠금 기록');
  assert.deepEqual(knot.permissions, { sell: false, discard: false, trade: false, consume: false, unequip: false }, '판매·폐기·일반 소비·해제 불가');
  assert.ok(knot.lockReason);
  assert.equal(knot.storySlot, 'story_1');
  assert.deepEqual(knot.storyAction, { kind: 'equip_story_nubi', label: '누비에게 장착', available: true, reason: null });
  assert.equal(by('knit_needle').isLocked, false);
  assert.equal(by('tonic').permissions.consume, true);
});

test('v3 신규 표시: 상세를 연 아이템 하나만 읽음 처리, 다른 항목은 유지, 재접속(새 서비스) 후에도 유지', async () => {
  const s = setup();
  const dust = s.db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
  const needle = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  s.db.seed('player_item', { player_id: P1, item_definition_id: dust.id, quantity: 3, is_new: true });
  s.db.seed('player_item', { player_id: P1, item_definition_id: needle.id, quantity: 1, is_new: true });
  const inv = new InventoryService(s.db.client(), settingsStub as never);
  await inv.list(P1); // 화면을 여는 것만으로는 읽음 처리하지 않음
  assert.deepEqual((await inv.list(P1)).items.map((i) => i.isNew), [true, true]);
  assert.deepEqual(await inv.markItemSeen(P1, 'glowing_yarn_dust'), { itemCode: 'glowing_yarn_dust', cleared: true });
  assert.deepEqual(await inv.markItemSeen(P1, 'glowing_yarn_dust'), { itemCode: 'glowing_yarn_dust', cleared: false }, '재요청은 변화 없음');
  const again = new InventoryService(s.db.client(), settingsStub as never);
  const items = (await again.list(P1)).items;
  assert.equal(items.find((i) => i.itemCode === 'glowing_yarn_dust')!.isNew, false);
  assert.equal(items.find((i) => i.itemCode === 'knit_needle')!.isNew, true, '다른 항목은 그대로');
  assert.equal(await codeOf(inv.markItemSeen(P1, '../x')), 'INVALID_ITEM');
  assert.equal(await codeOf(inv.markItemSeen(P1, 'no_such_item')), 'ITEM_NOT_FOUND');
});

test('v3 첫 매듭 장착 거부: 알 수 없는 유물·잘못된 체크포인트·미보유·서버 전용 이벤트 직접 요청·다른 터비(일반 장착 API)', async () => {
  const s = setup();
  await finishOpening(s);
  assert.equal(await codeOf(s.service.equipRelic(P1, 'knit_needle')), 'RELIC_UNKNOWN', '유물 코드만(이벤트 ID를 보내지 않음)');
  assert.equal(await codeOf(s.service.equipRelic(P1, 'first_knot')), 'STORY_EVENT_NOT_ALLOWED', '1장 나침판 전');
  knotReady(s);
  assert.equal(await codeOf(s.service.equipRelic(P1, 'first_knot')), 'STORY_PREREQUISITE_MISSING', '각성 전(선행 이벤트 없음)');
  forceState(s.db, 'CH01_COMPASS_ACQUIRED', ['forest_first_knot_awakened']); // 이벤트만 있고 아이템은 없음
  assert.equal(await codeOf(s.service.equipRelic(P1, 'first_knot')), 'STORY_PREREQUISITE_MISSING', '첫 매듭 미보유');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'forest_first_knot_equipped')), 'STORY_EVENT_SERVER_ONLY');
  const other = s.db.seed('turby_instance', { owner_player_id: P1, character_id: s.db.rows('turby_character', { code: 'nubi' })[0].id, acquired_via: 'wild_capture' });
  assert.equal(await codeOf(new EquipmentService(s.db.client()).equip('1', String(other.id), 'first_knot')), 'NOT_EQUIPPABLE', '다른 터비·일반 슬롯 장착 불가');
  assert.equal(s.db.rows('turby_equipment').length, 0);
  assert.ok(!eventsOf(s.db).includes('forest_first_knot_equipped'));
});

test('v3 첫 매듭 장착: 이야기 누비 story_1에 1회(동시 3건), 아이템은 소비 없이 보유·잠금, 장착 장면 재생 지시, 재요청은 현재 상태, 재접속 후 유지', async () => {
  const s = setup();
  await finishOpening(s);
  knotReady(s);
  await s.service.completeEvent(P1, 'forest_first_knot_awakened');
  const results = await Promise.all([1, 2, 3].map(() => s.service.equipRelic(P1, 'first_knot')));
  const fresh = results.filter((r) => !r.alreadyCompleted);
  assert.equal(fresh.length, 1);
  assert.deepEqual(fresh[0].play, { segmentId: 'ch01.first_knot_equipped', endAfter: 'ch01.first_knot_equipped' });
  assert.ok(results.filter((r) => r.alreadyCompleted).every((r) => r.play === null), '재요청은 장면을 다시 틀지 않음');
  assert.equal(s.db.rows('turby_equipment').length, 1);
  assert.equal(eventsOf(s.db).filter((e) => e === 'forest_first_knot_equipped').length, 1);
  assert.equal(qty(s.db, 'first_knot'), 1, '소비 없이 보유');
  assert.equal(progressOf(s.db).checkpoint, 'CH01_FIRST_KNOT_EQUIPPED');

  // 재접속: 새 서비스 인스턴스로 같은 DB를 읽어도 장착 상태 유지
  const again = setupSameDb(s);
  const state = await again.getState(P1);
  assert.deepEqual(state.storyNubi!.slots, [{ slotKey: 'story_1', itemCode: 'first_knot', name: '첫 매듭' }]);
  const knot = (await new InventoryService(s.db.client(), settingsStub as never).list(P1)).items.find((i) => i.itemCode === 'first_knot')!;
  assert.deepEqual([knot.equippedOnStoryNubi, knot.storyAction, knot.isLocked, knot.permissions.unequip], [true, null, true, false]);
  assert.equal(await codeOf(new EquipmentService(s.db.client()).unequip('1', String(progressOf(s.db).story_nubi_turby_instance_id), 'story_1')), 'STORY_SLOT_RESERVED', '해제 불가');
  const later = await again.equipRelic(P1, 'first_knot');
  assert.deepEqual([later.alreadyCompleted, later.play], [true, null]);
});

function setupSameDb(s: ReturnType<typeof setup>) {
  const content = { stage: () => null, dialogue: () => null, bannedNameWords: () => [] };
  const rooms = { roomOf: () => undefined, memberPosition: () => null, reachOf: () => 'ok', noteStoryEvents: () => undefined };
  return new StoryService(s.db.client(), rooms as never, settingsStub as never, content as never, new StageAccessService(s.db.client(), settingsStub as never));
}
