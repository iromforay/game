// 10-13 C2-1: 2장 호수 입구·정착지·물결북 — 체크포인트 전이, 서버 권위, 멱등, 재접속, 대화·맵 데이터 정합
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, validateRender, type StageStoryData } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { collisionOf, lockedZonesFor, reachVerdict, solidsFor } from '../src/turby/rooms/stage-collision';
import { resumeOf } from '../src/turby/story/story-rules';
import { CHECKPOINTS, EVENT_BY_ID, STORY_TRIGGERS, TRIGGER_BY_ID, type Checkpoint } from '../src/turby/story/story-data';

const P1 = 1n;
const content = new StoryContentService();
const LAKE = content.stage('lake') as StageStoryData;
const CH02 = JSON.parse(readFileSync(join(content.dir, 'dialogue/ch02.json'), 'utf8')) as { segments: { segmentId: string; resumeFrom: string; completesWith: string | null; entries: { dialogueId: string; kind: string; speaker?: string; speakerLabel?: string; text?: string; cameraCue?: string | null }[] }[] };
const pointOf = (id: string) => LAKE.points.find((p) => p.id === id)!;
const CH01_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];

function setup(checkpoint: string = 'CH01_COMPLETE', events: string[] = CH01_DONE, growth = 1) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-lake', nickname: '하늘', session_token: 'token-lake-aaaaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 4000, map_height: 3000 });
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: P1, checkpoint, nubi_growth_stage: growth, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  const C = collisionOf(LAKE, 3200, 2400);
  const done = () => new Set(db.rows('player_story_event', { player_id: P1 }).map((r) => r.event_id as string));
  const rooms = {
    roomOf: () => (pos ? { stageCode: pos.stageCode } : undefined),
    memberPosition: () => (pos ? { x: pos.x, y: pos.y, inMap: true, connected: true } : null),
    reachOf: (_room: unknown, _id: string, target: { x: number; y: number }) => (pos ? reachVerdict(solidsFor(C, done()), lockedZonesFor(C, done()), pos, target) : 'blocked'),
    noteStoryEvents: () => undefined,
  };
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d) }; // 신 판정(이벤트 기반 개방)
  const connect = () => new StoryService(db.client(), rooms as never, settings as never, content, new StageAccessService(db.client(), settings as never));
  const events$ = () => [...done()].sort();
  const cp = () => (db.rows('player_story_progress', { player_id: P1 })[0] as { checkpoint: string }).checkpoint;
  return {
    db, service: connect(), connect, events: events$, checkpoint: cp,
    goLake: () => (pos = { stageCode: 'lake', x: LAKE.spawnPoint!.x, y: LAKE.spawnPoint!.y }),
    standAt: (id: string, dx = 0) => (pos = { stageCode: 'lake', x: pointOf(id).x + dx, y: pointOf(id).y }),
    goForest: () => (pos = { stageCode: 'forest', x: 100, y: 100 }),
    leave: () => (pos = null),
    items: () => db.rows('player_item', { player_id: P1 }).length,
  };
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

test('호수 지역 데이터: 3200×2400, 시작 지점·이야기 지점 좌표가 서버·클라이언트 같은 계약(지역 JSON 한 곳)에 있고 표시 정보가 있다', () => {
  assert.deepEqual(LAKE.size, { width: 3200, height: 2400 });
  assert.deepEqual(LAKE.spawnPoint, { x: 380, y: 2040 });
  assert.deepEqual(LAKE.points.map((p) => p.id).sort(), ['lake_mulduri', 'lake_wave_drum']);
  for (const id of ['lake_mulduri', 'lake_wave_drum']) {
    const look = LAKE.storyPoints!.find((s) => s.id === id)!;
    assert.ok(look.label && look.prompt && look.assetKey, `${id} 표시 정보`);
  }
  // 기능 맵 구역(asset-contract-v1.md §2 권장 범위 안): 입구·정착지는 계약 범위, 물풀 미로 입구는 정착지 경계
  const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  assert.ok(inside(LAKE.spawnPoint!, { x: 120, y: 1750, w: 580, h: 530 }), '시작 지점은 숲 연결 입구 범위');
  assert.ok(inside(pointOf('lake_mulduri'), { x: 400, y: 760, w: 850, h: 890 }), '물들이는 정착지 범위');
  assert.ok(inside(pointOf('lake_wave_drum'), { x: 400, y: 760, w: 850, h: 890 }), '물결북은 정착지 범위');
  assert.equal(LAKE.greybox, true, '기능 맵 단계(최종 미술 좌표 아님)');
  assert.equal((LAKE.layout!.gates[0].openEvent), 'lake_safe_route_opened', '물풀 미로 입구는 다음 단계 이벤트 전까지 닫힘');
});

test('이벤트·지점 정의: 이름·체크포인트 전이·서버 전용 여부가 계약대로이고 보상이 없다', () => {
  const e = (id: string) => EVENT_BY_ID.get(id)!;
  assert.deepEqual([e('lake_entry_seen').allowedAt, e('lake_entry_seen').to, e('lake_entry_seen').serverOnly ?? false], [['CH01_COMPLETE'], 'CH02_STARTED', false]);
  assert.deepEqual([e('lake_mulduri_met').allowedAt, e('lake_mulduri_met').to ?? null, e('lake_mulduri_met').serverOnly], [['CH02_STARTED'], null, true]);
  assert.deepEqual([e('lake_wave_drum_awakened').allowedAt, e('lake_wave_drum_awakened').to, e('lake_wave_drum_awakened').serverOnly], [['CH02_STARTED'], 'CH02_SETTLEMENT_MET', true]);
  for (const id of ['lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened', 'lake_safe_route_opened']) {
    const d = e(id);
    assert.equal(d.chapter, 2);
    assert.deepEqual([d.grant, d.consume, d.equipRelic, d.grantStoryNubi], [undefined, undefined, undefined, undefined], `${id}: 아이템·통화·성장 없음`);
  }
  // 10-13 C2-2: 미로 개방 사건은 물결북 반응과 같은 트랜잭션에서만 기록된다(서버 전용, 새 체크포인트 없음)
  assert.deepEqual(e('lake_wave_drum_awakened').alsoComplete, ['lake_safe_route_opened']);
  assert.deepEqual([e('lake_safe_route_opened').allowedAt, e('lake_safe_route_opened').requires, e('lake_safe_route_opened').serverOnly, e('lake_safe_route_opened').to ?? null], [['CH02_SETTLEMENT_MET'], ['lake_wave_drum_awakened'], true, null]);
  assert.equal(EVENT_BY_ID.has('lake_maze_cleared'), false, 'CH02_MAZE_CLEARED·통과 완료 사건은 C2-3');
  assert.deepEqual(STORY_TRIGGERS.filter((t) => t.stageCode === 'lake').map((t) => t.id), ['lake_entry', 'lake_mulduri', 'lake_wave_drum']);
  assert.ok((CHECKPOINTS as readonly string[]).indexOf('CH02_STARTED') < (CHECKPOINTS as readonly string[]).indexOf('CH02_SETTLEMENT_MET'));
});

test('대화 데이터: 물빛 입구 8항목·색을 잃은 정착지 12항목이 정본 순서·화자·{playerName}를 지키고, 재생 범위·완료 이벤트가 실제 항목을 가리킨다', () => {
  assert.deepEqual(CH02.segments.map((s) => [s.segmentId, s.resumeFrom, s.completesWith]), [['ch02.lake_entry', 'CH01_COMPLETE', 'lake_entry_seen'], ['ch02.settlement', 'CH02_STARTED', null]]);
  const entry = CH02.segments[0].entries;
  assert.deepEqual(entry.map((x) => x.kind), ['title', 'narration', 'narration', 'line', 'line', 'narration', 'line', 'narration']);
  assert.deepEqual(entry.filter((x) => x.kind === 'line').map((x) => [x.speaker, x.speakerLabel, x.text]), [
    ['player', '{playerName}', '누비, 몸이 더 하얘졌어.'],
    ['nubi', '누비', '추운 건 아닌데…… 내 색이 물속으로 빠져나가는 것 같아.'],
    ['nubi', '누비', '방금 저 실, 숲에서 본 것과 비슷했어.'],
  ]);
  assert.equal(entry[5].cameraCue, 'lake-black-thread-pass', '검은 실 연출 cue');
  assert.equal(entry[2].cameraCue, 'lake-nubi-color-fade', '누비 색 빠짐 cue');
  const settle = CH02.segments[1].entries;
  assert.deepEqual(settle.filter((x) => x.kind === 'line').map((x) => [x.speaker, x.speakerLabel]), [['muldeuli', '물들이'], ['muldeuli', '물들이'], ['player', '{playerName}'], ['muldeuli', '물들이'], ['muldeuli', '물들이'], ['nubi', '누비']]);
  assert.equal(settle[8].cameraCue, 'lake-wave-drum-react');
  assert.equal(settle[11].cameraCue, 'lake-wave-drum-ripple');
  // 문구 전수: 정본 장면 문서의 대사·서술과 같다(양끝 따옴표 제외)
  const texts = [...entry, ...settle].map((x) => x.text).filter(Boolean) as string[];
  assert.ok(texts.includes('거기서 멈춰! 물에 오래 서 있으면 색을 빼앗겨.'));
  assert.ok(texts.includes('이상하네. 이건 염색 샘의 길을 찾는 물결북이야. 우리에겐 며칠째 반응하지 않았는데.'));
  assert.ok(texts.includes('물결북에서 나온 파문이 물풀 미로를 향해 번진다.'));
  // 재생 범위: 물들이 지점 = 001~008(물결북 앞까지), 물결북 지점 = 009~012
  const ids = CH02.segments[1].entries.map((x) => x.dialogueId);
  const mulduri = TRIGGER_BY_ID.get('lake_mulduri')!.play as { fromEntry?: string; untilEntry: string };
  const drum = TRIGGER_BY_ID.get('lake_wave_drum')!.play as { fromEntry: string };
  assert.ok(ids.includes(mulduri.untilEntry) && ids.indexOf(mulduri.untilEntry) === 7, '물들이 구간 끝 = 정착지 008');
  assert.ok(ids.includes(drum.fromEntry) && ids.indexOf(drum.fromEntry) === 8, '물결북 구간 시작 = 정착지 009');
  // 정본에 없는 개발 문구가 대화·지점에 들어 있지 않다
  const all = JSON.stringify([CH02, LAKE.storyPoints, LAKE.goals]);
  assert.equal(/개발 단계|다음 개발|임시|TODO|회색상자/.test(all), false);
});

// ---------- 서버 권위·전이 ----------

test('1장을 마치지 않은 계정은 2장 이벤트를 시작할 수 없다(CHAPTER_LOCKED) — 백필 호수 입장 권한만 있어도 마찬가지', async () => {
  const s = setup('OPENING_COMPLETE', ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'legacy_access_lake'], 0);
  s.goLake();
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_entry_seen')), 'CHAPTER_LOCKED');
  s.standAt('lake_mulduri');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'lake_mulduri')), 'NO_ERROR', '1장 미완료: 물들이 지점도 거부');
  const entered = await s.service.onStageEntered(P1, 'lake');
  assert.equal(entered!.play, null, '자유 탐험만 — 도입 장면이 재생되지 않는다');
  assert.equal(s.checkpoint(), 'OPENING_COMPLETE');
  assert.equal(s.events().includes('lake_entry_seen'), false);
});

test('호수 입장 → 도입 구간 재생 → 완료 요청으로 CH02_STARTED(보상 없음). 재접속은 도입을 반복하지 않는다', async () => {
  const s = setup();
  const before = s.items();
  assert.deepEqual([resumeOf({ checkpoint: 'CH01_COMPLETE', events: new Set(CH01_DONE), objectives: new Map(), growthStage: 1 }).segmentId], ['ch02.lake_entry']);
  s.goLake();
  const enter = await s.service.onStageEntered(P1, 'lake');
  assert.deepEqual(enter!.play, { segmentId: 'ch02.lake_entry', endAfter: 'ch02.lake_entry' });
  assert.equal(s.checkpoint(), 'CH01_COMPLETE', '도입을 끝내기 전에는 전이하지 않는다');
  // 도입 도중 새로고침: 같은 도입을 다시 보여 준다(완료 전)
  assert.deepEqual((await s.connect().onStageEntered(P1, 'lake'))!.play, { segmentId: 'ch02.lake_entry', endAfter: 'ch02.lake_entry' });
  const r = await s.service.completeEvent(P1, 'lake_entry_seen');
  assert.deepEqual([r.alreadyCompleted, r.grants, r.consumed, r.story.checkpoint], [false, [], [], 'CH02_STARTED']);
  assert.equal(s.items(), before, '아이템·통화 보상 없음');
  assert.equal(r.story.storyNubi!.growthStage, 1, '성장 단계 변화 없음');
  // 재접속: 도입을 다시 재생하지 않는다
  const again = await s.connect().onStageEntered(P1, 'lake');
  assert.equal(again!.play, null);
  assert.equal(again!.story.checkpoint, 'CH02_STARTED');
});

test('도입 완료 요청은 직렬·동시 중복에도 이벤트 한 번, 같은 결과(멱등)', async () => {
  const s = setup();
  s.goLake();
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => s.connect().completeEvent(P1, 'lake_entry_seen')));
  assert.equal(results.filter((x) => !x.alreadyCompleted).length, 1, '새로 기록한 응답은 하나');
  assert.equal(s.events().filter((e) => e === 'lake_entry_seen').length, 1);
  const serial = await s.service.completeEvent(P1, 'lake_entry_seen');
  assert.deepEqual([serial.alreadyCompleted, serial.story.checkpoint], [true, 'CH02_STARTED']);
});

test('도입 완료는 호수 탐험 세션 안에서만 — 세션 밖·다른 지역은 거부', async () => {
  const s = setup();
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_entry_seen')), 'STORY_EVIDENCE_INVALID', '세션 밖');
  s.goForest();
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_entry_seen')), 'STORY_EVIDENCE_INVALID', '다른 지역');
  assert.equal(s.checkpoint(), 'CH01_COMPLETE');
});

test('순서: 도입 전 물들이·물결북 거부 → 도입 뒤 물들이 → 물결북이면 CH02_SETTLEMENT_MET. 서버 전용 이벤트는 직접 완료할 수 없다', async () => {
  const s = setup();
  s.goLake();
  s.standAt('lake_mulduri');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'lake_mulduri')), 'NO_ERROR', '도입 전 물들이 거부');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_mulduri_met')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_wave_drum_awakened')), 'STORY_EVENT_SERVER_ONLY');
  await s.service.completeEvent(P1, 'lake_entry_seen');

  // 물결북을 먼저(물들이를 만나기 전) — 거부
  s.standAt('lake_wave_drum');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'lake_wave_drum')), 'NO_ERROR');
  assert.equal(s.checkpoint(), 'CH02_STARTED');

  // 먼 곳에서 물들이 — 위치 증거 거부
  s.standAt('lake_mulduri', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'lake_mulduri')), 'STORY_EVIDENCE_INVALID');

  // 물들이 — 정착지 대화(물결북 앞까지) 재생, 체크포인트는 그대로
  s.standAt('lake_mulduri');
  const m1 = await s.service.trigger(P1, 'lake_mulduri');
  assert.deepEqual(m1.play, { segmentId: 'ch02.settlement', endAfter: 'ch02.settlement', untilEntry: 'ch02.settlement.008' });
  assert.deepEqual([s.checkpoint(), s.events().includes('lake_mulduri_met')], ['CH02_STARTED', true]);
  // 같은 지점 다시: 물결북 반응 전까지는 끊긴 대화를 이어 볼 수 있다(이벤트 중복 없음)
  const m2 = await s.service.trigger(P1, 'lake_mulduri');
  assert.equal(m2.play!.segmentId, 'ch02.settlement');
  assert.equal(s.events().filter((e) => e === 'lake_mulduri_met').length, 1);

  // 물결북 — 반응 구간 재생 + CH02_SETTLEMENT_MET (보상 없음)
  s.standAt('lake_wave_drum');
  const before = s.items();
  const d = await s.service.trigger(P1, 'lake_wave_drum');
  assert.deepEqual(d.play, { segmentId: 'ch02.settlement', fromEntry: 'ch02.settlement.009', endAfter: 'ch02.settlement' });
  assert.equal(d.story.checkpoint, 'CH02_SETTLEMENT_MET');
  assert.equal(s.items(), before);
  // 재요청: 아무 효과 없이 재생하지 않음(멱등)
  const d2 = await s.service.trigger(P1, 'lake_wave_drum');
  assert.deepEqual([d2.play, s.events().filter((e) => e === 'lake_wave_drum_awakened').length], [null, 1]);
  // 정착지 물들이 지점은 닫힌다
  s.standAt('lake_mulduri');
  const m3 = await s.service.trigger(P1, 'lake_mulduri');
  assert.equal(m3.play, null);
});

test('동시 물결북 요청: 이벤트 한 번, 재생은 먼저 기록한 요청만', async () => {
  const s = setup('CH02_STARTED', [...CH01_DONE, 'lake_entry_seen', 'lake_mulduri_met']);
  s.goLake();
  s.standAt('lake_wave_drum');
  const rs = await Promise.all([1, 2, 3, 4].map(() => s.connect().trigger(P1, 'lake_wave_drum')));
  assert.equal(rs.filter((x) => x.play !== null).length, 1);
  assert.equal(s.events().filter((e) => e === 'lake_wave_drum_awakened').length, 1);
  assert.equal(s.events().filter((e) => e === 'lake_safe_route_opened').length, 1, '미로 개방 사건도 한 번');
  assert.equal(s.checkpoint(), 'CH02_SETTLEMENT_MET');
});

test('lake_safe_route_opened: 직접 요청은 선행 사건 전·후 모두 거부(서버 전용)되고, 물결북 반응 전에는 기록되지 않으며 체크포인트를 바꾸지 않는다', async () => {
  const s = setup('CH02_STARTED', [...CH01_DONE, 'lake_entry_seen', 'lake_mulduri_met']);
  s.goLake();
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_safe_route_opened')), 'STORY_EVENT_SERVER_ONLY', '물결북 전');
  assert.equal(s.events().includes('lake_safe_route_opened'), false);
  s.standAt('lake_wave_drum');
  await s.service.trigger(P1, 'lake_wave_drum');
  assert.equal(s.events().filter((e) => e === 'lake_safe_route_opened').length, 1, '물결북과 같은 트랜잭션');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'lake_safe_route_opened')), 'STORY_EVENT_SERVER_ONLY', '물결북 뒤에도 직접 요청 거부');
  assert.equal(s.events().filter((e) => e === 'lake_safe_route_opened').length, 1);
  assert.equal(s.checkpoint(), 'CH02_SETTLEMENT_MET', '새 체크포인트·장 완료 없음');
});

// ---------- 지역 화면(지점·목표)·재접속 ----------

test('지역 화면: 단계마다 보이는 지점·목표 문구가 정해진 대로이고, 물풀 미로 입구는 닫혀 있다', async () => {
  const s = setup();
  s.goLake();
  const view = (svc = s.service) => svc.stageData(P1, 'lake');
  let v = await view();
  assert.deepEqual([v.points.map((p) => p.id), v.goal], [[], null], '도입 전: 지점·목표 없음(도입 장면이 먼저)');
  await s.service.completeEvent(P1, 'lake_entry_seen');
  v = await view();
  assert.deepEqual(v.points.map((p) => p.id).sort(), ['lake_mulduri'], '도입 뒤: 정착지의 물들이');
  assert.equal(v.goal!.text, '검은 실이 사라진 방향을 따라가자');
  s.standAt('lake_mulduri');
  await s.service.trigger(P1, 'lake_mulduri');
  v = await view();
  assert.deepEqual(v.points.map((p) => p.id).sort(), ['lake_mulduri', 'lake_wave_drum'], '물들이를 만난 뒤: 물결북 지점도 열림');
  s.standAt('lake_wave_drum');
  await s.service.trigger(P1, 'lake_wave_drum');
  v = await view(s.connect());
  assert.deepEqual(v.points.map((p) => p.id), [], '물결북 반응 뒤: 상호작용 지점 없음(임시 미로 표식 제거)');
  assert.equal(v.goal!.text, '물결북의 파문을 따라 물풀 미로를 지나가자.');
  const gate = v.gates.find((g) => g.id === 'gate_reed_maze')!;
  assert.equal(gate.open, true, '물결북 반응과 함께 물풀문이 열린다(lake_safe_route_opened)');
  assert.deepEqual([gate.closedAssetKey, gate.openAssetKey], ['reed-gate-closed', 'reed-gate-open']);
  assert.equal(s.events().includes('lake_safe_route_opened'), true);
  assert.equal(s.events().some((e) => e.startsWith('lake_') && !['lake_unlocked', 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened', 'lake_safe_route_opened'].includes(e)), false, '다른 호수 이벤트는 기록되지 않음');
});

test('체크포인트별 재접속: CH02_STARTED·CH02_SETTLEMENT_MET에서는 도입·정착지 구간을 자동 재생하지 않는다', async () => {
  for (const [cp, evs] of [['CH02_STARTED', [...CH01_DONE, 'lake_entry_seen']], ['CH02_SETTLEMENT_MET', [...CH01_DONE, 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened']]] as [Checkpoint, string[]][]) {
    const s = setup(cp, evs);
    s.goLake();
    const r = await s.connect().onStageEntered(P1, 'lake');
    assert.equal(r!.play, null, `${cp}: 지역 진입 때 재생 없음`);
    assert.equal(resumeOf({ checkpoint: cp, events: new Set(evs), objectives: new Map(), growthStage: 1 }).segmentId, null);
    assert.equal(r!.story.checkpoint, cp);
  }
});

test('대화 API: 1장을 마친 계정만 ch02 대화를 받는다', async () => {
  const done = setup();
  done.db.seed('item_definition', { code: 'x', name: 'x', category: 'mission' });
  assert.ok(await done.service.dialogue(P1, 'ch02'));
  const early = setup('OPENING_COMPLETE', ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted'], 0);
  assert.equal(await codeOf(early.service.dialogue(P1, 'ch02')), 'CHAPTER_LOCKED');
});

// ---------- 10-13 v1c: 물결북 에셋 연결(상태별 표시) ----------

const MET = [...CH01_DONE, 'lake_entry_seen', 'lake_mulduri_met'];
const AWAKENED = [...MET, 'lake_wave_drum_awakened'];
const WAVE_ASSETS = ['wave-drum-idle', 'wave-drum-active', 'wave-path'];

test('물결북 반응 전: 이야기 지점 그림은 wave-drum-idle(88~112px)이고 오버레이(active·파문)는 내려오지 않으며, 물들이는 turby-muldeuli다', async () => {
  const s = setup('CH02_STARTED', MET);
  const v = await s.service.stageData(P1, 'lake');
  const drum = v.points.find((p) => p.id === 'lake_wave_drum')!;
  assert.equal(drum.assetKey, 'wave-drum-idle');
  assert.ok(drum.art && drum.art.width >= 88 && drum.art.width <= 112 && drum.art.height >= 88 && drum.art.height <= 112, '표시 크기 88~112px(서버 데이터가 단일 출처)');
  assert.deepEqual(drum.art!.pivot, [0.5, 0.78]);
  assert.deepEqual(v.render.overlays.filter((o) => o.assetKey !== 'current-flow'), [], '반응 전에는 active·파문이 없다(물살 그림은 별개)');
  const fresh = setup('CH02_STARTED', [...CH01_DONE, 'lake_entry_seen']);
  const early = await fresh.service.stageData(P1, 'lake');
  assert.equal(early.points.find((p) => p.id === 'lake_mulduri')!.assetKey, 'turby-muldeuli');
  assert.ok(early.points.find((p) => p.id === 'lake_mulduri')!.art, '물들이도 표시 크기를 서버가 정한다(원본 512px 그대로 그리지 않는다)');
});

test('물결북 반응 뒤: idle 지점 그림이 남지 않고 active·wave-path 오버레이가 내려오며, 같은 중심·피벗·크기다', async () => {
  const s = setup('CH02_SETTLEMENT_MET', AWAKENED);
  const v = await s.service.stageData(P1, 'lake');
  assert.equal(v.points.some((p) => p.id === 'lake_wave_drum'), false, 'idle 그림이 있던 지점은 사라진다');
  assert.equal(v.points.some((p) => p.assetKey === 'wave-drum-idle'), false);
  const byKey = new Map(v.render.overlays.filter((o) => o.assetKey !== 'current-flow').map((o) => [o.assetKey, o]));
  assert.deepEqual([...byKey.keys()].sort(), ['wave-drum-active', 'wave-path']);
  const active = byKey.get('wave-drum-active')!;
  const idle = LAKE.storyPoints!.find((p) => p.id === 'lake_wave_drum')!.art!;
  const drumPoint = pointOf('lake_wave_drum');
  assert.deepEqual([active.x, active.y, active.width, active.height, active.pivot], [drumPoint.x, drumPoint.y, idle.width, idle.height, idle.pivot], 'idle과 같은 좌표·크기·피벗');
  assert.equal(active.layer, 'story');
  assert.ok(active.width >= 88 && active.width <= 112);
});

test('wave-path: 물결북에서 미로 입구 방향, 420~560×140~190px, 맵 안, 알파 0.72 이하, 바닥(overlay) 층 — 충돌·판정에 쓰이지 않는다', async () => {
  const s = setup('CH02_SETTLEMENT_MET', AWAKENED);
  const v = await s.service.stageData(P1, 'lake');
  const path = v.render.overlays.find((o) => o.assetKey === 'wave-path')!;
  assert.ok(path.width >= 420 && path.width <= 560 && path.height >= 140 && path.height <= 190, `${path.width}×${path.height}`);
  assert.ok(path.alpha! > 0 && path.alpha! <= 0.72);
  assert.equal(path.layer, 'overlay');
  const drum = pointOf('lake_wave_drum');
  const gateRect = LAKE.layout!.gates[0];
  const maze = { x: gateRect.x - 25, y: gateRect.y + 200, radius: 100 }; // 미로 입구(문 왼쪽 통로 중심)
  // 방향: 파문 축(회전각)이 물결북→미로 입구 방위각과 5° 이내
  const want = (Math.atan2(maze.y - drum.y, maze.x - drum.x) * 180) / Math.PI;
  assert.ok(Math.abs((path.rotation ?? 0) - want) <= 5, `회전 ${path.rotation}° / 방위 ${want.toFixed(1)}°`);
  assert.ok(maze.x > drum.x, '미로 입구는 물결북의 오른쪽(파문이 시작해 향하는 쪽)');
  // 범위: 시작점(피벗)에서 회전축을 따라 끝점까지가 맵 안, 물결북과 미로 입구 근처에 닿는다
  const px = path.pivot![0], r = (path.rotation! * Math.PI) / 180;
  const len = path.width * (1 - px);
  const end = { x: path.x + Math.cos(r) * len, y: path.y + Math.sin(r) * len };
  const half = (path.height / 2) * Math.abs(Math.cos(r)) + (path.width * px * Math.abs(Math.sin(r)));
  assert.ok(path.x - path.width * px >= 0 && end.x <= 3200 && end.y - half >= 0 && end.y + half <= 2400, `맵 안 ${JSON.stringify(end)}`);
  assert.ok(Math.hypot(end.x - maze.x, end.y - maze.y) <= maze.radius + 60, '끝이 미로 입구 근처');
  // 오버레이는 충돌 체로 내려오지 않는다: 반응 뒤에도 layout 막힌 곳 수는 그대로
  const before = await setup('CH02_STARTED', MET).service.stageData(P1, 'lake');
  assert.deepEqual(v.layout!.blockers, before.layout!.blockers);
});

test('서버 지역 데이터 검증: art·rotation·alpha가 잘못되면 서버가 뜨지 않는다', () => {
  const bad = (patch: (d: StageStoryData) => void) => {
    const d = JSON.parse(JSON.stringify(LAKE)) as StageStoryData;
    patch(d);
    assert.throws(() => validateRender(d, 'lake'), /render 검증 실패/);
  };
  bad((d) => (d.storyPoints![1].art!.width = 0));
  bad((d) => (d.storyPoints![1].art!.pivot = [2, 0] as never));
  bad((d) => (d.render!.overlays![0].alpha = 1.5));
  bad((d) => (d.render!.overlays![0].rotation = 900));
  assert.doesNotThrow(() => validateRender(LAKE, 'lake'));
});

test('세 전달 에셋 키가 클라이언트 런타임 폴더에 실제로 있고(키=파일명), 지역 데이터가 쓰는 월드 키는 전부 존재한다', () => {
  const root = join(__dirname, '..', '..', 'save-a-turby', 'src', 'assets');
  const world = join(root, 'world', 'lake');
  const files = [join(world, 'props', 'wave-drum-idle.png'), join(world, 'props', 'wave-drum-active.png'), join(world, 'fx', 'wave-path.png')];
  for (const f of files) assert.ok(existsSync(f), f);
  const used = new Set<string>([...(LAKE.storyPoints ?? []).map((p) => p.assetKey), ...(LAKE.render?.overlays ?? []).map((o) => o.assetKey)]);
  for (const k of WAVE_ASSETS) assert.ok(used.has(k), `${k}를 지역 데이터가 사용`);
  const characters = ['nubi', 'bopuli', 'muldeuli', 'pokshini', 'geumbiti', 'ganeuri', 'mujigae'].map((c) => `turby-${c}`);
  const gateKeys = LAKE.layout!.gates.flatMap((g) => [g.closedAssetKey, g.openAssetKey]).filter(Boolean) as string[];
  for (const k of ['current-flow', 'reed-gate-closed', 'reed-gate-open']) assert.ok([...used, ...gateKeys].includes(k), `${k}를 지역 데이터가 사용`);
  for (const f of [join(root, 'world', 'lake', 'fx', 'current-flow.png'), join(root, 'world', 'lake', 'maze', 'reed-gate-closed.png'), join(root, 'world', 'lake', 'maze', 'reed-gate-open.png')]) assert.ok(existsSync(f), f);
  const known = (k: string) => k === 'placeholder-point' || characters.includes(k) || WAVE_ASSETS.includes(k) || k === 'current-flow';
  for (const k of used) assert.ok(known(k), `알 수 없는 월드 키: ${k}`);
});
