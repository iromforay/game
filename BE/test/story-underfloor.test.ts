// 10-16 C3-1: 3장 마루바닥 밑 입구·폭신이·조사 3곳·매복 지점·기억 조각 — 체크포인트 전이, 서버 권위, 멱등, 재접속, 대화·지역 데이터 정합
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { collisionOf, lockedZonesFor, reachVerdict, solidsFor } from '../src/turby/rooms/stage-collision';
import { resumeOf } from '../src/turby/story/story-rules';
import { CHECKPOINTS, EVENT_BY_ID, STORY_TRIGGERS, STORY_EVENTS, EVENT_AGGREGATES } from '../src/turby/story/story-data';

const P1 = 1n;
const content = new StoryContentService();
const UG = content.stage('underground') as StageStoryData;
type Seg = { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { dialogueId: string; kind: string; speaker?: string; speakerLabel?: string; text?: string; portrait?: string | null }[] };
const CH03 = JSON.parse(readFileSync(join(content.dir, 'dialogue/ch03.json'), 'utf8')) as { segments: Seg[] };
const pointOf = (id: string) => UG.points.find((p) => p.id === id)!;
const CH01_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const CH02_DONE = [...CH01_DONE, 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_boss_aftermath_seen', 'lake_chapter_complete_seen'];

function setup(checkpoint: string = 'CH02_COMPLETE', events: string[] = CH02_DONE, growth = 2) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-ug', nickname: '하늘', session_token: 'token-ug-aaaaaaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 3, stage_code: 'underground', clear_character_code: 'pokshini', title: '3장 — 지하', map_width: 3200, map_height: 2400 });
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: P1, checkpoint, nubi_growth_stage: growth, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  const C = collisionOf(UG, 3200, 2400, 'underground');
  const done = () => new Set(db.rows('player_story_event', { player_id: P1 }).map((r) => r.event_id as string));
  const rooms = {
    roomOf: () => (pos ? { stageCode: pos.stageCode } : undefined),
    memberPosition: () => (pos ? { x: pos.x, y: pos.y, inMap: true, connected: true } : null),
    reachOf: (_room: unknown, _id: string, target: { x: number; y: number }) => (pos ? reachVerdict(solidsFor(C, done()), lockedZonesFor(C, done()), pos, target) : 'blocked'),
    noteStoryEvents: () => undefined,
  };
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d) };
  const connect = () => new StoryService(db.client(), rooms as never, settings as never, content, new StageAccessService(db.client(), settings as never));
  return {
    db,
    service: connect(),
    connect,
    events: () => [...done()].sort(),
    checkpoint: () => (db.rows('player_story_progress', { player_id: P1 })[0] as { checkpoint: string }).checkpoint,
    items: () => db.rows('player_item', { player_id: P1 }).length,
    goUnderground: () => (pos = { stageCode: 'underground', x: UG.spawnPoint!.x, y: UG.spawnPoint!.y }),
    standAt: (id: string, dx = 0) => (pos = { stageCode: 'underground', x: pointOf(id).x + dx, y: pointOf(id).y }),
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

test('이벤트·지점 정의: 이름·체크포인트 전이·서버 전용 여부가 계약대로이고 보상이 없다', () => {
  const e = (id: string) => EVENT_BY_ID.get(id)!;
  assert.deepEqual([e('underfloor_entry_seen').allowedAt, e('underfloor_entry_seen').to, e('underfloor_entry_seen').serverOnly ?? false], [['CH02_COMPLETE'], 'CH03_STARTED', false]);
  assert.deepEqual([e('underfloor_elder_met').allowedAt, e('underfloor_elder_met').to, e('underfloor_elder_met').serverOnly ?? false], [['CH03_STARTED'], 'CH03_ELDER_MET', false]);
  assert.deepEqual([e('underfloor_memory_fragment_seen').allowedAt, e('underfloor_memory_fragment_seen').to, e('underfloor_memory_fragment_seen').serverOnly ?? false], [['CH03_MEMORY_TRAIL_FOUND'], 'CH03_MEMORY_FRAGMENT_SEEN', false]);
  for (const k of ['glove', 'blanket', 'doll']) assert.deepEqual([e(`underfloor_${k}_inspected`).serverOnly, e(`underfloor_${k}_inspected`).to ?? null], [true, null]);
  assert.deepEqual([e('underfloor_ambush_won').serverOnly, e('underfloor_ambush_won').to, e('underfloor_ambush_won').alsoComplete], [true, 'CH03_MEMORY_TRAIL_FOUND', ['underfloor_memory_trail_found']]);
  assert.deepEqual(EVENT_AGGREGATES.find((a) => a.id === 'underfloor_items_inspected')!.parts, ['glove', 'blanket', 'doll'].map((k) => `underfloor_${k}_inspected`));
  for (const d of STORY_EVENTS.filter((x) => x.id.startsWith('underfloor_') && x.id !== 'underfloor_unlocked')) {
    assert.equal(d.chapter, 3, d.id);
    assert.deepEqual([d.grant, d.consume, d.equipRelic, d.grantStoryNubi], [undefined, undefined, undefined, undefined], `${d.id}: 아이템·통화·성장 없음(C3-1)`);
  }
  assert.deepEqual(
    STORY_TRIGGERS.filter((t) => t.stageCode === 'underground').map((t) => t.id),
    ['underfloor_entry', 'underfloor_elder', 'underfloor_glove', 'underfloor_blanket', 'underfloor_doll', 'underfloor_ambush', 'underfloor_fragment'],
  );
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'underground' && x.evidence.kind === 'point')) assert.ok(pointOf((t.evidence as { pointId: string }).pointId), `${t.id}의 지점이 지역 데이터에 있다`);
  const idx = (c: string) => (CHECKPOINTS as readonly string[]).indexOf(c);
  assert.ok(idx('CH03_STARTED') < idx('CH03_ELDER_MET') && idx('CH03_ELDER_MET') < idx('CH03_MEMORY_TRAIL_FOUND') && idx('CH03_MEMORY_TRAIL_FOUND') < idx('CH03_MEMORY_FRAGMENT_SEEN'));
});

test('대화 데이터: 구간 7개의 시작 체크포인트·완료 이벤트와 재생 범위가 서버 전이표·트리거와 같고, 화자는 정본 라벨이다', () => {
  assert.deepEqual(
    CH03.segments.map((s) => [s.segmentId, s.resumeFrom, s.completesWith]),
    [
      ['ch03.entry', 'CH02_COMPLETE', 'underfloor_entry_seen'],
      ['ch03.elder', 'CH03_STARTED', 'underfloor_elder_met'],
      ['ch03.memory_glove', 'CH03_ELDER_MET', null],
      ['ch03.memory_blanket', 'CH03_ELDER_MET', null],
      ['ch03.memory_doll', 'CH03_ELDER_MET', null],
      ['ch03.machine_sound', 'CH03_ELDER_MET', null],
      ['ch03.fragment', 'CH03_MEMORY_TRAIL_FOUND', 'underfloor_memory_fragment_seen'],
    ],
  );
  const ids = new Set(CH03.segments.map((s) => s.segmentId));
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'underground' && typeof x.play === 'object')) assert.ok(ids.has((t.play as { segmentId: string }).segmentId), `${t.id} 재생 구간`);
  for (const s of CH03.segments) if (s.completesWith) assert.ok(EVENT_BY_ID.get(s.completesWith), `${s.segmentId} 완료 이벤트`);
  const elder = CH03.segments[1].entries.filter((x) => x.kind === 'line' && x.speaker === 'old_pokshini');
  assert.ok(elder.length >= 3 && elder.every((x) => x.speakerLabel === '오래된 폭신이' && x.portrait === null));
  assert.equal(CH03.segments[0].entries.filter((x) => x.kind === 'line').some((x) => x.speakerLabel === '{playerName}'), true);
  assert.equal(CH03.segments[0].entries[0].text, '낯익은 어둠');
  assert.equal(CH03.segments[6].entries[0].text, '내 것이 아닌 기억');
});

// ---------- 진행 ----------

test('입장 → 도입 재생 → 완료 요청으로 CH03_STARTED(보상 없음). 재접속은 도입을 반복하지 않는다', async () => {
  const s = setup();
  const before = s.items();
  assert.equal(resumeOf({ checkpoint: 'CH02_COMPLETE', events: new Set(CH02_DONE), objectives: new Map(), growthStage: 2 }).segmentId, 'ch03.entry');
  s.goUnderground();
  const enter = await s.service.onStageEntered(P1, 'underground');
  assert.deepEqual(enter!.play, { segmentId: 'ch03.entry', endAfter: 'ch03.entry' });
  assert.equal(s.checkpoint(), 'CH02_COMPLETE', '도입을 끝내기 전에는 전이하지 않는다');
  assert.deepEqual((await s.connect().onStageEntered(P1, 'underground'))!.play, { segmentId: 'ch03.entry', endAfter: 'ch03.entry' }, '도입 도중 새로고침: 같은 도입');
  const r = await s.service.completeEvent(P1, 'underfloor_entry_seen');
  assert.deepEqual([r.alreadyCompleted, r.grants, r.consumed, r.story.checkpoint], [false, [], [], 'CH03_STARTED']);
  assert.equal(s.items(), before);
  assert.equal(r.story.storyNubi!.growthStage, 2, '성장 단계 변화 없음');
  const again = await s.connect().onStageEntered(P1, 'underground');
  assert.deepEqual([again!.play, again!.story.checkpoint], [null, 'CH03_STARTED']);
  const rs = await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'underfloor_entry_seen')));
  assert.equal(rs.length, 3);
  assert.equal(s.events().filter((e) => e === 'underfloor_entry_seen').length, 1, '동시 중복 요청도 한 번만 기록');
});

test('2장을 마치지 않은 계정은 3장 이벤트를 시작할 수 없다', async () => {
  const s = setup('CH02_BOSS_DEFEATED', CH01_DONE.concat(['lake_entry_seen']));
  s.goUnderground();
  assert.notEqual(await codeOf(s.service.completeEvent(P1, 'underfloor_entry_seen')), 'NO_ERROR');
  assert.equal(s.checkpoint(), 'CH02_BOSS_DEFEATED');
});

test('순서: 도입 전 폭신이 거부 → 폭신이 장면 완료로 CH03_ELDER_MET → 조사 3곳(순서 없음) → 집계 → 매복 지점의 기계음 장면', async () => {
  const s = setup('CH02_COMPLETE');
  s.goUnderground();
  s.standAt('underfloor_elder');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'underfloor_elder')), 'NO_ERROR', '도입 전 폭신이 거부');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'underfloor_glove_inspected')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'underfloor_ambush_won')), 'STORY_EVENT_SERVER_ONLY');
  await s.service.completeEvent(P1, 'underfloor_entry_seen');

  s.standAt('underfloor_elder', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'underfloor_elder')), 'STORY_EVIDENCE_INVALID', '먼 곳에서 폭신이 — 위치 증거 거부');
  s.standAt('underfloor_elder');
  const t1 = await s.service.trigger(P1, 'underfloor_elder');
  assert.deepEqual(t1.play, { segmentId: 'ch03.elder', endAfter: 'ch03.elder' });
  assert.equal(s.checkpoint(), 'CH03_STARTED', '장면을 끝까지 보기 전에는 전이하지 않는다');
  const t2 = await s.service.trigger(P1, 'underfloor_elder');
  assert.equal(t2.play!.segmentId, 'ch03.elder', '끊기면 같은 지점에서 처음부터');

  s.standAt('underfloor_glove');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'underfloor_glove')), 'NO_ERROR', '폭신이를 만나기 전 조사 거부');
  s.standAt('underfloor_elder');
  const met = await s.service.completeEvent(P1, 'underfloor_elder_met');
  assert.equal(met.story.checkpoint, 'CH03_ELDER_MET');
  assert.equal((await s.service.trigger(P1, 'underfloor_elder')).play, null, '만남 뒤 폭신이 지점은 닫힌다');

  s.standAt('underfloor_ambush');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'underfloor_ambush')), 'NO_ERROR', '매복 지점은 조사 전에는 열리지 않는다');

  const before = s.items();
  for (const k of ['blanket', 'doll', 'glove']) {
    s.standAt(`underfloor_${k}`);
    const r = await s.service.trigger(P1, `underfloor_${k}`);
    assert.deepEqual(r.play, { segmentId: `ch03.memory_${k}`, endAfter: `ch03.memory_${k}` });
    assert.equal(s.events().includes(`underfloor_${k}_inspected`), true);
    assert.equal(s.events().includes('underfloor_items_inspected'), k === 'glove', '세 곳을 모두 살핀 순간 집계 사건');
    assert.equal((await s.service.trigger(P1, `underfloor_${k}`)).play, null, '같은 지점 재조사는 아무 효과 없음(멱등)');
  }
  assert.equal(s.events().filter((e) => e === 'underfloor_items_inspected').length, 1);
  assert.equal(s.items(), before, '보상 없음');
  assert.equal(s.checkpoint(), 'CH03_ELDER_MET');

  s.standAt('underfloor_ambush');
  const a = await s.service.trigger(P1, 'underfloor_ambush');
  assert.deepEqual(a.play, { segmentId: 'ch03.machine_sound', endAfter: 'ch03.machine_sound' });
  assert.equal(s.checkpoint(), 'CH03_ELDER_MET', '전투 승리 전에는 실패 자국 길이 열리지 않는다');
  assert.equal(s.events().includes('underfloor_memory_trail_found'), false);
  s.standAt('underfloor_fragment');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'underfloor_fragment')), 'NO_ERROR', '문 너머 기억 조각은 닫혀 있다');
});

test('기억 조각: 실패 자국 길이 열린 뒤에만, 장면을 끝까지 본 완료 요청으로 CH03_MEMORY_FRAGMENT_SEEN(멱등)', async () => {
  const OPENED = ['underfloor_entry_seen', 'underfloor_elder_met', 'underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected', 'underfloor_items_inspected', 'underfloor_ambush_won', 'underfloor_memory_trail_found'];
  const s = setup('CH03_MEMORY_TRAIL_FOUND', CH02_DONE.concat(OPENED));
  s.goUnderground();
  s.standAt('underfloor_fragment', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'underfloor_fragment')), 'STORY_EVIDENCE_INVALID', '원거리');
  s.standAt('underfloor_fragment');
  const t = await s.service.trigger(P1, 'underfloor_fragment');
  assert.deepEqual(t.play, { segmentId: 'ch03.fragment', endAfter: 'ch03.fragment' });
  assert.equal(s.checkpoint(), 'CH03_MEMORY_TRAIL_FOUND', '중간에 끊기면 미변경');
  const before = s.items();
  const rs = await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'underfloor_memory_fragment_seen')));
  assert.ok(rs.every((r) => r.story.checkpoint === 'CH03_MEMORY_FRAGMENT_SEEN'));
  assert.equal(s.events().filter((e) => e === 'underfloor_memory_fragment_seen').length, 1);
  assert.equal(s.items(), before);
  assert.equal((await s.service.trigger(P1, 'underfloor_fragment')).play, null, '본 뒤에는 닫힌다');
});

// ---------- MD 대본 대조 ----------

test('ch03 대화(C3-1 구간): 장면 문서와 서술·대사가 같은 순서·화자·문구이고, 빠진 줄은 제외 목록뿐이다', () => {
  const ROOT = resolve(__dirname, '../..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DOCS = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXCLUDED, PARTIAL, sentences } = require(join(ROOT, 'BE/story-data/save-a-turby/tools/build-ch03.js')) as { EXCLUDED: Record<number, string>; PARTIAL: Record<number, { keep: number[] }>; sentences: (s: string) => string[] };
  const raw = readFileSync(join(DOCS, 'docs/scene/3장.md'), 'utf8').split(/\r?\n/);
  const from = raw.findIndex((l) => l.trim() === '## 낯익은 어둠');
  const to = raw.findIndex((l) => l.trim() === '## 기억 실패굴이'); // 3장 후반(보스·돌아온 중심)은 C3-3에서 대조 범위에 넣는다
  assert.ok(from >= 0 && to > from);
  const md: { who: string | null; text: string }[] = [];
  let speaker: string | null = null;
  for (let i = from + 1; i < to; i++) {
    const l = raw[i].trim();
    if (!l || l.startsWith('#') || l.startsWith('>') || EXCLUDED[i + 1]) continue;
    const label = /^\*\*(.+)\*\*$/.exec(l);
    if (label) {
      speaker = label[1];
      continue;
    }
    if (PARTIAL[i + 1]) {
      const parts = sentences(l);
      for (const k of PARTIAL[i + 1].keep) md.push({ who: null, text: parts[k] });
    } else if (l.startsWith('“')) {
      md.push({ who: speaker, text: l.replace(/^“/, '').replace(/”$/, '') });
      speaker = null;
    } else md.push({ who: null, text: l.replace(/^- /, '').replace(/^`([^`]+)`$/, '$1') });
  }
  const json = CH03.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line' || e.kind === 'narration');
  assert.equal(json.length, md.length, `항목 수: JSON ${json.length} / MD ${md.length}`);
  json.forEach((e, i) => {
    assert.equal(e.text, md[i].text, `${e.dialogueId}: 문구`);
    if (e.kind === 'line') assert.equal(e.speakerLabel, md[i].who, `${e.dialogueId}: 화자 표기`);
    else assert.equal(md[i].who, null, `${e.dialogueId}: 서술`);
  });
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 0);
});
