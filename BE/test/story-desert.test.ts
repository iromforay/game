// 10-26 C5-1: 5장 보일러 옆 사막 입구·단서 길·능선(동료 셋의 틈)·절단면 — 체크포인트 전이, 서버 권위, 멱등, 재접속, 대화·지역 데이터 정합
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
const DESERT = content.stage('desert') as StageStoryData;
type Seg = { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { dialogueId: string; kind: string; speaker?: string; speakerLabel?: string; text?: string; portrait?: string | null; cameraCue?: string | null; encounterKey?: string }[] };
const CH05 = JSON.parse(readFileSync(join(content.dir, 'dialogue/ch05.json'), 'utf8')) as { segments: Seg[] };
const pointOf = (id: string) => DESERT.points.find((p) => p.id === id)!;
const CH03_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked', 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_boss_aftermath_seen', 'lake_chapter_complete_seen', 'underfloor_entry_seen', 'underfloor_boss_defeated', 'underfloor_boss_aftermath_seen', 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'underfloor_chapter_complete_seen'];
const CH04_DONE = [...CH03_DONE, 'fridge_entry_seen', 'fridge_ganeuri_freed', 'fridge_frozen_guard_won', 'fridge_storage_seen', 'fridge_confession_seen', 'fridge_boss_defeated', 'fridge_microfiber_granted', 'fridge_boss_aftermath_seen', 'fridge_microfiber_equipped', 'desert_unlocked', 'fridge_chapter_complete_seen'];
const JOINED = [...CH04_DONE, 'desert_entry_seen', 'desert_clues_seen'];
const RIDGE = ['desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread'];

function setup(checkpoint: string = 'CH04_COMPLETE', events: string[] = CH04_DONE, growth = 4) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-desert', nickname: '하늘', session_token: 'token-desert-aaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음'], [5, 'desert', 'geumbiti', '5장 — 사막']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: P1, checkpoint, nubi_growth_stage: growth, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  const C = collisionOf(DESERT, 3200, 2400, 'desert');
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
    goDesert: () => (pos = { stageCode: 'desert', x: DESERT.spawnPoint!.x, y: DESERT.spawnPoint!.y }),
    standAt: (id: string, dx = 0) => (pos = { stageCode: 'desert', x: pointOf(id).x + dx, y: pointOf(id).y }),
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
  const sig = (id: string) => [e(id).allowedAt, e(id).to ?? null, e(id).serverOnly ?? false, e(id).requires];
  assert.deepEqual(sig('desert_entry_seen'), [['CH04_COMPLETE'], 'CH05_STARTED', false, ['desert_unlocked']]);
  // 정본 CH05_CLUES_JOINED: 단서를 거의 완성했지만 정체를 말하지 않은 장면을 저장한다
  assert.deepEqual(sig('desert_clues_seen'), [['CH05_STARTED'], 'CH05_CLUES_JOINED', false, ['desert_entry_seen']]);
  // 4장 P-01 방식: 전투 승리는 체크포인트를 바꾸지 않는다
  assert.deepEqual(sig('desert_scorched_won'), [['CH05_CLUES_JOINED'], null, true, ['desert_clues_seen']]);
  assert.deepEqual(sig('desert_ridge_pad'), [['CH05_CLUES_JOINED'], null, false, ['desert_scorched_won']]);
  assert.deepEqual(sig('desert_ridge_scent'), [['CH05_CLUES_JOINED'], null, false, ['desert_ridge_pad']]);
  assert.deepEqual(sig('desert_ridge_thread'), [['CH05_CLUES_JOINED'], null, false, ['desert_ridge_scent']]);
  assert.deepEqual(sig('desert_ridge_crossed'), [['CH05_CLUES_JOINED'], 'CH05_RIDGE_CROSSED', false, ['desert_ridge_thread']]);
  for (const d of STORY_EVENTS.filter((x) => x.id.startsWith('desert_') && x.id !== 'desert_unlocked')) {
    assert.equal(d.chapter, 5, d.id);
    assert.deepEqual([d.grant, d.consume, d.equipRelic, d.grantStoryNubi], [undefined, undefined, undefined, undefined], `${d.id}: 아이템·통화·성장 없음`);
  }
  assert.deepEqual(
    STORY_TRIGGERS.filter((t) => t.stageCode === 'desert').map((t) => t.id),
    ['desert_entry', 'desert_clues', 'desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread', 'desert_cut_face'],
  );
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'desert' && x.evidence.kind === 'point')) assert.ok(pointOf((t.evidence as { pointId: string }).pointId), `${t.id}의 지점이 지역 데이터에 있다`);
  const idx = (c: string) => (CHECKPOINTS as readonly string[]).indexOf(c);
  assert.ok(idx('CH04_COMPLETE') < idx('CH05_STARTED') && idx('CH05_STARTED') < idx('CH05_CLUES_JOINED') && idx('CH05_CLUES_JOINED') < idx('CH05_RIDGE_CROSSED'));
});

test('대화 데이터: 구간 11개의 시작 체크포인트·완료 이벤트가 전이표와 같고, 동료·가위는 정본 라벨, 연출 cue는 계약대로', () => {
  assert.deepEqual(
    CH05.segments.map((s) => [s.segmentId, s.resumeFrom, s.completesWith]),
    [
      ['ch05.entry', 'CH04_COMPLETE', 'desert_entry_seen'],
      ['ch05.clues', 'CH05_STARTED', 'desert_clues_seen'],
      ['ch05.scorched', 'CH05_CLUES_JOINED', null],
      ['ch05.ridge_pad', 'CH05_CLUES_JOINED', 'desert_ridge_pad'],
      ['ch05.ridge_scent', 'CH05_CLUES_JOINED', 'desert_ridge_scent'],
      ['ch05.ridge_thread', 'CH05_CLUES_JOINED', 'desert_ridge_thread'],
      ['ch05.cut_face', 'CH05_CLUES_JOINED', 'desert_ridge_crossed'],
      ['ch05.boss_intro', 'CH05_RIDGE_CROSSED', null],
      ['ch05.boss_victory', 'CH05_BOSS_DEFEATED', 'desert_boss_aftermath_seen'],
      ['ch05.scissors', 'CH05_BOSS_DEFEATED', 'desert_scissors_seen'],
      ['ch05.chapter_complete', 'CH05_COMPLETE', 'desert_chapter_complete_seen'],
    ],
  );
  const battles = CH05.segments.flatMap((x) => x.entries.filter((e) => e.kind === 'storyBattle').map((e) => [x.segmentId, e.encounterKey]));
  assert.deepEqual(battles, [['ch05.scorched', 'desert_scorched_ambush'], ['ch05.boss_intro', 'desert_boss_golden_doll']], '전투 연결은 C5-3');
  const lines = CH05.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line');
  const label: Record<string, string> = { muldeuli: '물들이', old_pokshini: '오래된 폭신이', ganeuri: '가느리', scissors: '가위' };
  for (const [speaker, text] of Object.entries(label)) {
    const own = lines.filter((x) => x.speaker === speaker);
    assert.ok(own.length > 0 && own.every((x) => x.speakerLabel === text && x.portrait === null), `${text} 대사`);
  }
  assert.equal(lines.filter((x) => x.speaker === 'scissors').length, 4, '가위 대사 4줄(정본)');
  assert.deepEqual(CH05.segments.flatMap((x) => x.entries).map((e) => e.cameraCue).filter(Boolean), ['scissors-glimpse', 'scissors-reveal', 'five-relics']);
  // 표기용 백틱은 화면 문구에 남지 않는다(`서걱.`·`집의 중심`)
  for (const e of CH05.segments.flatMap((x) => x.entries)) assert.ok(!e.text?.includes('`'), `${e.dialogueId}: 백틱`);
  const ids = new Set(CH05.segments.map((s) => s.segmentId));
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'desert' && typeof x.play === 'object')) assert.ok(ids.has((t.play as { segmentId: string }).segmentId), `${t.id} 재생 구간`);
  for (const s of CH05.segments.slice(0, 7)) if (s.completesWith) assert.ok(EVENT_BY_ID.get(s.completesWith), `${s.segmentId} 완료 이벤트`);
});

// ---------- 진행 ----------

test('입장 → 도입 재생 → 완료 요청으로 CH05_STARTED(보상 없음). 재접속은 도입을 반복하지 않는다', async () => {
  const s = setup();
  const before = s.items();
  assert.equal(resumeOf({ checkpoint: 'CH04_COMPLETE', events: new Set(CH04_DONE), objectives: new Map(), growthStage: 4 }).segmentId, 'ch05.entry');
  s.goDesert();
  const enter = await s.service.onStageEntered(P1, 'desert');
  assert.deepEqual(enter!.play, { segmentId: 'ch05.entry', endAfter: 'ch05.entry' });
  assert.equal(s.checkpoint(), 'CH04_COMPLETE', '도입을 끝내기 전에는 전이하지 않는다');
  const r = await s.service.completeEvent(P1, 'desert_entry_seen');
  assert.deepEqual([r.alreadyCompleted, r.grants, r.consumed, r.story.checkpoint, r.story.storyNubi!.growthStage], [false, [], [], 'CH05_STARTED', 4]);
  assert.equal(s.items(), before);
  const again = await s.connect().onStageEntered(P1, 'desert');
  assert.deepEqual([again!.play, again!.story.checkpoint], [null, 'CH05_STARTED']);
  await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'desert_entry_seen')));
  assert.equal(s.events().filter((e) => e === 'desert_entry_seen').length, 1, '동시 중복 요청도 한 번만 기록');
});

test('4장을 마치지 않은 계정은 5장 이벤트를 시작할 수 없다', async () => {
  const s = setup('CH04_BOSS_DEFEATED', CH04_DONE.filter((e) => !['fridge_microfiber_equipped', 'desert_unlocked', 'fridge_chapter_complete_seen'].includes(e)));
  s.goDesert();
  assert.notEqual(await codeOf(s.service.completeEvent(P1, 'desert_entry_seen')), 'NO_ERROR');
  assert.equal(s.checkpoint(), 'CH04_BOSS_DEFEATED');
});

test('단서 길: 도입 전 거부 → 장면을 끝까지 보면 CH05_CLUES_JOINED → 능선 앞 전투 승리 전에는 물들이 지점이 닫혀 있다', async () => {
  const s = setup();
  s.goDesert();
  s.standAt('desert_clues');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'desert_clues')), 'NO_ERROR', '도입 전 단서 길 거부');
  await s.service.completeEvent(P1, 'desert_entry_seen');
  s.standAt('desert_clues', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'desert_clues')), 'STORY_EVIDENCE_INVALID', '먼 곳에서 — 위치 증거 거부');
  s.standAt('desert_clues');
  assert.deepEqual((await s.service.trigger(P1, 'desert_clues')).play, { segmentId: 'ch05.clues', endAfter: 'ch05.clues' });
  assert.equal(s.checkpoint(), 'CH05_STARTED', '장면을 끝까지 보기 전에는 전이하지 않는다');
  assert.equal((await s.service.completeEvent(P1, 'desert_clues_seen')).story.checkpoint, 'CH05_CLUES_JOINED');
  assert.equal((await s.service.trigger(P1, 'desert_clues')).play, null, '본 뒤에는 닫힌다');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'desert_scorched_won')), 'STORY_EVENT_SERVER_ONLY');
  s.standAt('desert_ridge_pad');
  assert.notEqual(await codeOf(s.service.trigger(P1, 'desert_ridge_pad')), 'NO_ERROR', '전투 승리 전 물들이 지점 거부');
});

test('능선: 전투 승리(서버 기록) 뒤 물들이 → 폭신이 → 가느리 순서로만 틈이 이어지고, 체크포인트는 그대로 → 절단면에서 CH05_RIDGE_CROSSED(멱등)', async () => {
  const s = setup('CH05_CLUES_JOINED', JOINED);
  s.seed('desert_scorched_won'); // C5-3 전투 정산이 기록할 사건(이 단계에서는 시드)
  s.goDesert();
  const before = s.items();
  const play = (k: string) => ({ segmentId: `ch05.${k}`, endAfter: `ch05.${k}` });
  // 순서 건너뛰기 거부(앞 틈이 닫혀 있어 다음 지점에 설 수 없지만, 서 있다고 해도 선행 사건이 없다)
  s.standAt('desert_ridge_scent');
  assert.notEqual(await codeOf(s.service.completeEvent(P1, 'desert_ridge_scent')), 'NO_ERROR', '물들이 전 폭신이 거부');
  for (const [i, id] of RIDGE.entries()) {
    s.standAt(id);
    assert.deepEqual((await s.service.trigger(P1, id)).play, play(id.replace('desert_', '')), `${id} 장면`);
    const rs = await Promise.all([1, 2].map(() => s.connect().completeEvent(P1, id)));
    assert.ok(rs.every((r) => r.story.checkpoint === 'CH05_CLUES_JOINED'), `${id}: 체크포인트 유지`);
    assert.equal(s.events().filter((e) => e === id).length, 1, `${id} 한 번만`);
    assert.equal((await s.service.trigger(P1, id)).play, null, `${id} 지점은 닫힌다`);
    assert.equal(resumeOf({ checkpoint: 'CH05_CLUES_JOINED', events: new Set([...JOINED, 'desert_scorched_won', ...RIDGE.slice(0, i + 1)]), objectives: new Map(), growthStage: 4 }).segmentId, null, '재접속해도 자동 재생 없음 — 지도의 다음 지점이 이어 간다');
  }
  s.standAt('desert_cut_face');
  assert.deepEqual((await s.service.trigger(P1, 'desert_cut_face')).play, play('cut_face'));
  assert.equal((await s.service.completeEvent(P1, 'desert_ridge_crossed')).story.checkpoint, 'CH05_RIDGE_CROSSED');
  assert.equal(s.items(), before, '보상 없음');
});

test('지역 화면 데이터: 뜨거운 모래(kind heat)·아지랑이가 표시용으로 내려가고, 틈은 사건대로 열리며, 목표 문구가 진행에 따라 바뀐다', async () => {
  const s = setup('CH05_CLUES_JOINED', [...JOINED, 'desert_scorched_won', 'desert_ridge_pad']);
  s.goDesert();
  const view = await s.service.stageData(P1, 'desert');
  assert.deepEqual(view.layout!.frost!.map((z) => [z.id, z.slowFactor, z.kind]), [['hot_sand', 0.7, 'heat']]);
  assert.deepEqual(view.layout!.mirages!.map((m) => [m.id, m.periodMs, m.showMs, m.offsetMs]), [['mirage_a', 4000, 1600, 0], ['mirage_b', 4000, 1600, 2000]]);
  assert.equal(view.layout!.needles, undefined);
  assert.deepEqual(view.gates.map((g) => [g.id, g.open]), [['gate_ridge_gap_1', true], ['gate_ridge_gap_2', false], ['gate_ridge_gap_3', false]]);
  assert.deepEqual(view.goal, { id: 'ridge_scent', text: '다음 틈 앞에서 오래된 폭신이에게 길을 부탁하자.' });
  assert.deepEqual(view.render.overlays.map((o) => o.id), [], '초입의 동료 셋은 단서 길 장면 뒤 각자 틈 앞으로 간다');
  const start = await setup('CH05_STARTED', [...CH04_DONE, 'desert_entry_seen']).service.stageData(P1, 'desert');
  assert.deepEqual(start.render.overlays.map((o) => o.id), ['overlay_companion_muldeuli', 'overlay_companion_pokshini', 'overlay_companion_ganeuri']);
  assert.deepEqual(start.goal, { id: 'follow_gold', text: '금빛 실이 가리키는 쪽으로 동료들과 걸어가자.' });
});

// ---------- MD 대본 대조 ----------

test('ch05 대화(5장 전체): 장면 문서와 서술·대사가 같은 순서·화자·문구이고, 빠진 줄은 제외 목록·부분 줄뿐이다', () => {
  const ROOT = resolve(__dirname, '../..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DOCS = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXCLUDED, PARTIAL, sentences } = require(join(ROOT, 'BE/story-data/save-a-turby/tools/build-ch05.js')) as { EXCLUDED: Record<number, string>; PARTIAL: Record<number, { keep: number[] }>; sentences: (s: string) => string[] };
  const raw = readFileSync(join(DOCS, 'docs/scene/5장.md'), 'utf8').split(/\r?\n/);
  const from = raw.findIndex((l) => l.trim() === '## 뜨거운 침묵');
  assert.ok(from >= 0);
  const md: { who: string | null; text: string }[] = [];
  let speaker: string | null = null;
  for (let i = from + 1; i < raw.length; i++) {
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
    } else md.push({ who: null, text: l.replace(/^- /, '').replace(/`/g, '') });
  }
  const json = CH05.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line' || e.kind === 'narration');
  assert.equal(json.length, md.length, `항목 수: JSON ${json.length} / MD ${md.length}`);
  json.forEach((e, i) => {
    assert.equal(e.text, md[i].text, `${e.dialogueId}: 문구`);
    if (e.kind === 'line') assert.equal(e.speakerLabel, md[i].who, `${e.dialogueId}: 화자 표기`);
    else assert.equal(md[i].who, null, `${e.dialogueId}: 서술`);
  });
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 0);
});
