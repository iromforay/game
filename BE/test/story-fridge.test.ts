// 10-23 C4-1: 4장 냉장고 속 입구·가느리·저장고 앞 길목·완성된 도안·누비의 고백 — 체크포인트 전이, 서버 권위, 멱등, 재접속, 대화·지역 데이터 정합
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
import { CHECKPOINTS, EVENT_BY_ID, STORY_TRIGGERS, STORY_EVENTS } from '../src/turby/story/story-data';

const P1 = 1n;
const content = new StoryContentService();
const ICE = content.stage('ice') as StageStoryData;
type Seg = { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { dialogueId: string; kind: string; speaker?: string; speakerLabel?: string; text?: string; portrait?: string | null; cameraCue?: string | null }[] };
const CH04 = JSON.parse(readFileSync(join(content.dir, 'dialogue/ch04.json'), 'utf8')) as { segments: Seg[] };
const pointOf = (id: string) => ICE.points.find((p) => p.id === id)!;
const CH01_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const CH02_DONE = [...CH01_DONE, 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_boss_aftermath_seen', 'lake_chapter_complete_seen'];
const CH03_DONE = [...CH02_DONE, 'underfloor_entry_seen', 'underfloor_boss_defeated', 'underfloor_boss_aftermath_seen', 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'underfloor_chapter_complete_seen'];
const RESCUED = [...CH03_DONE, 'fridge_entry_seen', 'fridge_ganeuri_freed'];

function setup(checkpoint: string = 'CH03_COMPLETE', events: string[] = CH03_DONE, growth = 3) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-ice', nickname: '하늘', session_token: 'token-ice-aaaaaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: P1, checkpoint, nubi_growth_stage: growth, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  const C = collisionOf(ICE, 3200, 2400, 'ice');
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
    seed: (e: string) => db.seed('player_story_event', { player_id: P1, event_id: e }),
    checkpoint: () => (db.rows('player_story_progress', { player_id: P1 })[0] as { checkpoint: string }).checkpoint,
    items: () => db.rows('player_item', { player_id: P1 }).length,
    goFridge: () => (pos = { stageCode: 'ice', x: ICE.spawnPoint!.x, y: ICE.spawnPoint!.y }),
    standAt: (id: string, dx = 0) => (pos = { stageCode: 'ice', x: pointOf(id).x + dx, y: pointOf(id).y }),
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
  const sig = (id: string) => [e(id).allowedAt, e(id).to ?? null, e(id).serverOnly ?? false];
  assert.deepEqual(sig('fridge_entry_seen'), [['CH03_COMPLETE'], 'CH04_STARTED', false]);
  assert.deepEqual(sig('fridge_ganeuri_freed'), [['CH04_STARTED'], 'CH04_GANEURI_RESCUED', false]);
  // 10-23 Codex 의견 P-01: 전투 승리는 체크포인트를 바꾸지 않고, 도안 벽을 본 시점이 저장고 완료
  assert.deepEqual(sig('fridge_frozen_guard_won'), [['CH04_GANEURI_RESCUED'], null, true]);
  assert.deepEqual(sig('fridge_storage_seen'), [['CH04_GANEURI_RESCUED'], 'CH04_STORAGE_CLEARED', false]);
  assert.deepEqual(sig('fridge_confession_seen'), [['CH04_STORAGE_CLEARED'], 'CH04_CONFESSION_SEEN', false]);
  // 보상·장착은 보스 정산(grant)과 장착 사건(equipRelic) 둘뿐이다(10-23 C4-3). 나머지 4장 사건에는 아이템·통화·성장이 없다
  const REWARD = ['fridge_boss_defeated', 'fridge_microfiber_equipped'];
  for (const d of STORY_EVENTS.filter((x) => x.id.startsWith('fridge_') && x.id !== 'fridge_unlocked' && !REWARD.includes(x.id))) {
    assert.equal(d.chapter, 4, d.id);
    assert.deepEqual([d.grant, d.consume, d.equipRelic, d.grantStoryNubi], [undefined, undefined, undefined, undefined], `${d.id}: 아이템·통화·성장 없음`);
  }
  assert.deepEqual(e('fridge_boss_defeated').grant, [{ itemCode: 'ice_microfiber', quantity: 1 }]);
  assert.deepEqual(e('fridge_microfiber_equipped').equipRelic, { itemCode: 'ice_microfiber', slotKey: 'story_4', growthStage: 4 });
  assert.deepEqual(e('fridge_microfiber_equipped').alsoComplete, ['desert_unlocked']);
  assert.deepEqual(
    STORY_TRIGGERS.filter((t) => t.stageCode === 'ice').map((t) => t.id),
    ['fridge_entry', 'fridge_ganeuri', 'fridge_guard', 'fridge_storage_wall', 'fridge_confession', 'fridge_boss_entrance'],
  );
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'ice' && x.evidence.kind === 'point')) assert.ok(pointOf((t.evidence as { pointId: string }).pointId), `${t.id}의 지점이 지역 데이터에 있다`);
  const idx = (c: string) => (CHECKPOINTS as readonly string[]).indexOf(c);
  assert.ok(idx('CH03_COMPLETE') < idx('CH04_STARTED') && idx('CH04_STARTED') < idx('CH04_GANEURI_RESCUED') && idx('CH04_GANEURI_RESCUED') < idx('CH04_STORAGE_CLEARED') && idx('CH04_STORAGE_CLEARED') < idx('CH04_CONFESSION_SEEN'));
});

test('대화 데이터: 구간 8개의 시작 체크포인트·완료 이벤트와 재생 범위가 전이표·트리거와 같고, 목소리는 voice-frost 지문, 가느리·서리 미싱은 정본 라벨이다', () => {
  assert.deepEqual(
    CH04.segments.map((s) => [s.segmentId, s.resumeFrom, s.completesWith]),
    [
      ['ch04.entry', 'CH03_COMPLETE', 'fridge_entry_seen'],
      ['ch04.ganeuri', 'CH04_STARTED', 'fridge_ganeuri_freed'],
      ['ch04.guard', 'CH04_GANEURI_RESCUED', null],
      ['ch04.storage', 'CH04_GANEURI_RESCUED', 'fridge_storage_seen'],
      ['ch04.confession', 'CH04_STORAGE_CLEARED', 'fridge_confession_seen'],
      ['ch04.boss_intro', 'CH04_CONFESSION_SEEN', null],
      ['ch04.boss_victory', 'CH04_BOSS_DEFEATED', 'fridge_boss_aftermath_seen'],
      ['ch04.chapter_complete', 'CH04_COMPLETE', 'fridge_chapter_complete_seen'],
    ],
  );
  // 전투 항목은 서버 스토리 전투 키와 같고 해당 트리거가 같은 키를 연다
  const battles = CH04.segments.flatMap((x) => x.entries.filter((e) => e.kind === 'storyBattle').map((e) => [x.segmentId, (e as { encounterKey?: string }).encounterKey]));
  assert.deepEqual(battles, [['ch04.guard', 'fridge_frozen_guard'], ['ch04.boss_intro', 'fridge_boss_frost_machine']]);
  for (const [, key] of battles) assert.ok(STORY_TRIGGERS.some((t) => t.encounterKey === key), `${key} 트리거`);
  const machine = CH04.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line' && e.speaker === 'frost_machine');
  assert.ok(machine.length === 3 && machine.every((x) => x.speakerLabel === '서리 미싱' && x.portrait === null));
  assert.deepEqual(CH04.segments.flatMap((x) => x.entries).map((e) => e.cameraCue).filter((c) => c && c !== 'voice-frost'), ['storage-pattern', 'frost-machine-scar', 'sense-restore', 'warm-gold'], '금빛은 장 마무리에만');
  const ids = new Set(CH04.segments.map((s) => s.segmentId));
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'ice' && typeof x.play === 'object')) assert.ok(ids.has((t.play as { segmentId: string }).segmentId), `${t.id} 재생 구간`);
  for (const s of CH04.segments) if (s.completesWith) assert.ok(EVENT_BY_ID.get(s.completesWith), `${s.segmentId} 완료 이벤트`);
  // 누비만 듣는 목소리 두 줄: 화자 없는 지문 + voice-frost
  const voices = CH04.segments.flatMap((s) => s.entries.filter((e) => e.cameraCue === 'voice-frost'));
  assert.deepEqual(voices.map((e) => [e.kind, e.text]), [['narration', '돌아와.'], ['narration', '네가 돌아오면 길이 열린다.']]);
  const g = CH04.segments.flatMap((x) => x.entries).filter((x) => x.kind === 'line' && x.speaker === 'ganeuri');
  assert.ok(g.length === 6 && g.every((x) => x.speakerLabel === '가느리' && x.portrait === null), `가느리 대사 ${g.length}`);
  assert.equal(CH04.segments[3].entries[0].cameraCue, 'storage-pattern', '도안 벽 클로즈업');
  // 고백의 약속 대사(사용자 확정 10-22: 장면 대본대로)
  assert.equal(CH04.segments[4].entries.find((e) => e.speakerLabel === '{playerName}' && e.text!.startsWith('어떤 기억이'))!.text, '어떤 기억이 돌아와도 지금 여기 있는 널 혼자 두지 않을게.');
});

// ---------- 진행 ----------

test('입장 → 도입 재생 → 완료 요청으로 CH04_STARTED(보상 없음). 재접속은 도입을 반복하지 않는다', async () => {
  const s = setup();
  const before = s.items();
  assert.equal(resumeOf({ checkpoint: 'CH03_COMPLETE', events: new Set(CH03_DONE), objectives: new Map(), growthStage: 3 }).segmentId, 'ch04.entry');
  s.goFridge();
  const enter = await s.service.onStageEntered(P1, 'ice');
  assert.deepEqual(enter!.play, { segmentId: 'ch04.entry', endAfter: 'ch04.entry' });
  assert.equal(s.checkpoint(), 'CH03_COMPLETE', '도입을 끝내기 전에는 전이하지 않는다');
  const r = await s.service.completeEvent(P1, 'fridge_entry_seen');
  assert.deepEqual([r.alreadyCompleted, r.grants, r.consumed, r.story.checkpoint, r.story.storyNubi!.growthStage], [false, [], [], 'CH04_STARTED', 3]);
  assert.equal(s.items(), before);
  const again = await s.connect().onStageEntered(P1, 'ice');
  assert.deepEqual([again!.play, again!.story.checkpoint], [null, 'CH04_STARTED']);
  await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'fridge_entry_seen')));
  assert.equal(s.events().filter((e) => e === 'fridge_entry_seen').length, 1, '동시 중복 요청도 한 번만 기록');
});

test('3장을 마치지 않은 계정은 4장 이벤트를 시작할 수 없다', async () => {
  const s = setup('CH03_BOSS_DEFEATED', CH02_DONE.concat(['underfloor_entry_seen', 'underfloor_boss_defeated']));
  s.goFridge();
  assert.notEqual(await codeOf(s.service.completeEvent(P1, 'fridge_entry_seen')), 'NO_ERROR');
  assert.equal(s.checkpoint(), 'CH03_BOSS_DEFEATED');
});

test('순서: 도입 전 가느리 거부 → 가느리 장면 완료로 CH04_GANEURI_RESCUED → 길목 지문(전투 전) → 저장고 문 닫힘 동안 도안 벽 거부', async () => {
  const s = setup();
  s.goFridge();
  s.standAt('fridge_ganeuri');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'fridge_ganeuri')), 'NO_ERROR', '도입 전 가느리 거부');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'fridge_frozen_guard_won')), 'STORY_EVENT_SERVER_ONLY');
  await s.service.completeEvent(P1, 'fridge_entry_seen');

  s.standAt('fridge_ganeuri', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'fridge_ganeuri')), 'STORY_EVIDENCE_INVALID', '먼 곳에서 가느리 — 위치 증거 거부');
  s.standAt('fridge_ganeuri');
  assert.deepEqual((await s.service.trigger(P1, 'fridge_ganeuri')).play, { segmentId: 'ch04.ganeuri', endAfter: 'ch04.ganeuri' });
  assert.equal(s.checkpoint(), 'CH04_STARTED', '장면을 끝까지 보기 전에는 전이하지 않는다');
  const freed = await s.service.completeEvent(P1, 'fridge_ganeuri_freed');
  assert.equal(freed.story.checkpoint, 'CH04_GANEURI_RESCUED');
  assert.equal((await s.service.trigger(P1, 'fridge_ganeuri')).play, null, '구조 뒤 가느리 지점은 닫힌다');

  s.standAt('fridge_guard');
  assert.deepEqual((await s.service.trigger(P1, 'fridge_guard')).play, { segmentId: 'ch04.guard', endAfter: 'ch04.guard' });
  assert.equal(s.checkpoint(), 'CH04_GANEURI_RESCUED', '전투 승리 전에는 문이 열리지 않는다');
  s.standAt('fridge_storage_wall');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'fridge_storage_wall')), 'NO_ERROR', '문 너머 도안 벽은 닫혀 있다');
});

test('저장고: 길목 승리(서버 기록) 뒤 문이 열리고 체크포인트는 그대로, 도안 벽을 끝까지 보면 CH04_STORAGE_CLEARED → 고백 → CH04_CONFESSION_SEEN(멱등)', async () => {
  const s = setup('CH04_GANEURI_RESCUED', RESCUED);
  s.seed('fridge_frozen_guard_won'); // C4-3 전투 정산이 기록할 사건(이 단계에서는 시드)
  s.goFridge();
  s.standAt('fridge_guard');
  assert.equal((await s.service.trigger(P1, 'fridge_guard')).play, null, '승리 뒤 길목은 닫힌다');
  assert.equal(s.checkpoint(), 'CH04_GANEURI_RESCUED', 'P-01: 전투 승리만으로는 저장고 완료가 아니다');
  assert.equal(resumeOf({ checkpoint: 'CH04_GANEURI_RESCUED', events: new Set([...RESCUED, 'fridge_frozen_guard_won']), objectives: new Map(), growthStage: 3 }).segmentId, null, '재접속해도 장면이 자동으로 뜨지 않는다 — 지도의 도안 벽 지점이 이어 간다');

  s.standAt('fridge_confession');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'fridge_confession')), 'NO_ERROR', '도안 벽 전 고백 거부');
  s.standAt('fridge_storage_wall');
  assert.deepEqual((await s.service.trigger(P1, 'fridge_storage_wall')).play, { segmentId: 'ch04.storage', endAfter: 'ch04.storage' });
  const st = await s.service.completeEvent(P1, 'fridge_storage_seen');
  assert.equal(st.story.checkpoint, 'CH04_STORAGE_CLEARED');

  const before = s.items();
  s.standAt('fridge_confession');
  assert.deepEqual((await s.service.trigger(P1, 'fridge_confession')).play, { segmentId: 'ch04.confession', endAfter: 'ch04.confession' });
  const rs = await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'fridge_confession_seen')));
  assert.ok(rs.every((r) => r.story.checkpoint === 'CH04_CONFESSION_SEEN'));
  assert.equal(s.events().filter((e) => e === 'fridge_confession_seen').length, 1);
  assert.equal(s.items(), before, '보상 없음');
  assert.equal((await s.service.trigger(P1, 'fridge_confession')).play, null, '본 뒤에는 닫힌다');
});

test('지역 화면 데이터: 서리 구역·바늘 칸이 표시용으로 내려가고(판정 수치 포함), 목표 문구가 진행에 따라 바뀐다', async () => {
  const s = setup('CH04_GANEURI_RESCUED', RESCUED);
  s.goFridge();
  const view = await s.service.stageData(P1, 'ice');
  assert.deepEqual(view.layout!.frost!.map((z) => [z.id, z.slowFactor]), [['frost_zone', 0.7]]);
  assert.deepEqual(view.layout!.needles!.map((n) => [n.id, n.periodMs, n.warnMs, n.strikeMs, n.offsetMs]), [['needle_1', 3000, 1000, 500, 0], ['needle_2', 3000, 1000, 500, 2400], ['needle_3', 3000, 1000, 500, 1800]]);
  assert.deepEqual(view.goal, { id: 'cross_needles', text: '바늘이 지나간 칸을 따라 통로를 건너 저장고로 가자.' });
  assert.deepEqual(view.render.overlays.map((o) => o.id).sort(), ['overlay_ganeuri_guide', 'overlay_storage_pattern'], '풀려난 가느리가 바늘 통로 입구에서 기다린다');
});

// ---------- MD 대본 대조 ----------

test('ch04 대화(4장 전체): 장면 문서와 서술·대사가 같은 순서·화자·문구이고, 빠진 줄은 제외 목록·부분 줄뿐이다', () => {
  const ROOT = resolve(__dirname, '../..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DOCS = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXCLUDED, PARTIAL, sentences } = require(join(ROOT, 'BE/story-data/save-a-turby/tools/build-ch04.js')) as { EXCLUDED: Record<number, string>; PARTIAL: Record<number, { keep: number[] }>; sentences: (s: string) => string[] };
  const raw = readFileSync(join(DOCS, 'docs/scene/4장.md'), 'utf8').split(/\r?\n/);
  const from = raw.findIndex((l) => l.trim() === '## 소리 없는 냉기');
  const to = raw.length; // 4장 전체(소리 없는 냉기 ~ 이어진 감각)
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
  const json = CH04.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line' || e.kind === 'narration');
  assert.equal(json.length, md.length, `항목 수: JSON ${json.length} / MD ${md.length}`);
  json.forEach((e, i) => {
    assert.equal(e.text, md[i].text, `${e.dialogueId}: 문구`);
    if (e.kind === 'line') assert.equal(e.speakerLabel, md[i].who, `${e.dialogueId}: 화자 표기`);
    else assert.equal(md[i].who, null, `${e.dialogueId}: 서술`);
  });
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 0);
});
