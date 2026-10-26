// 10-26 F-1: 종장 집의 중심 — 저장점·장 번호 규칙, 도착(CHFINAL_STARTED)·다섯 기억의 결속(CHFINAL_IDENTITY_REVEALED), 서버 권위·멱등, 대화·지역 데이터 정합
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
import { canProgressChapter, chapterCodeOf, chapterCompleteCheckpoint, chapterOf, resumeOf } from '../src/turby/story/story-rules';
import { chapterCompleted } from '../src/turby/story/stage-access';
import { CHECKPOINTS, EVENT_BY_ID, STAGE_UNLOCK_EVENTS, STORY_EVENTS, STORY_TRIGGERS } from '../src/turby/story/story-data';

const P1 = 1n;
const content = new StoryContentService();
const HOME = content.stage('home_core') as StageStoryData;
type Seg = { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { dialogueId: string; kind: string; speaker?: string; speakerLabel?: string; text?: string; portrait?: string | null; cameraCue?: string | null; soundCue?: string | null; encounterKey?: string }[] };
const FINAL = JSON.parse(readFileSync(join(content.dir, 'dialogue/final.json'), 'utf8')) as { segments: Seg[] };
const pointOf = (id: string) => HOME.points.find((p) => p.id === id)!;
const CH05_DONE = [
  'opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_first_knot_equipped', 'lake_unlocked', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'fridge_microfiber_equipped', 'desert_unlocked',
  'desert_entry_seen', 'desert_clues_seen', 'desert_ridge_crossed', 'desert_boss_defeated', 'desert_finish_thread_granted', 'desert_boss_aftermath_seen', 'desert_scissors_seen', 'desert_finish_thread_equipped', 'final_unlocked', 'desert_chapter_complete_seen',
];

function setup(checkpoint: string = 'CH05_COMPLETE', events: string[] = CH05_DONE) {
  const db = new FakeDb();
  db.seed('player', { id: P1, device_uuid: 'dev-test-final', nickname: '하늘', session_token: 'token-final-aaaa' });
  const nubi = db.seed('turby_character', { code: 'nubi', name: '누비' });
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음'], [5, 'desert', 'geumbiti', '5장 — 사막'], [6, 'home_core', 'nubi', '종장 — 집의 중심']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  const inst = db.seed('turby_instance', { owner_player_id: P1, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: P1, checkpoint, nubi_growth_stage: 5, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: P1, event_id: e });
  let pos: { stageCode: string; x: number; y: number } | null = null;
  const C = collisionOf(HOME, 3200, 2400, 'home_core');
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
    service: connect(),
    connect,
    events: () => [...done()].sort(),
    checkpoint: () => (db.rows('player_story_progress', { player_id: P1 })[0] as { checkpoint: string }).checkpoint,
    items: () => db.rows('player_item', { player_id: P1 }).length,
    goHome: () => (pos = { stageCode: 'home_core', x: HOME.spawnPoint!.x, y: HOME.spawnPoint!.y }),
    standAt: (id: string, dx = 0) => (pos = { stageCode: 'home_core', x: pointOf(id).x + dx, y: pointOf(id).y }),
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

// ---------- 저장점·장 번호 ----------

test('저장점: 정본 CHFINAL_*·ENDING_COMPLETE가 5장 뒤 순서대로 있고, 장 번호(6)·장 코드(final)·장 완료(ENDING_COMPLETE) 규칙이 맞다', () => {
  assert.deepEqual(CHECKPOINTS.slice(CHECKPOINTS.indexOf('CH05_COMPLETE')), ['CH05_COMPLETE', 'CHFINAL_STARTED', 'CHFINAL_IDENTITY_REVEALED', 'CHFINAL_SCISSORS_DEFEATED', 'CHFINAL_COST_ACCEPTED', 'ENDING_COMPLETE']);
  assert.deepEqual(['CHFINAL_STARTED', 'CHFINAL_COST_ACCEPTED', 'ENDING_COMPLETE'].map((c) => chapterOf(c as never)), [6, 6, 6]);
  assert.deepEqual([chapterCodeOf('CH05_COMPLETE'), chapterCodeOf('CHFINAL_STARTED'), chapterCodeOf('ENDING_COMPLETE')], ['final', 'final', 'final'], '5장 완료는 종장 입구, 엔딩 뒤에도 종장');
  assert.deepEqual([chapterCompleteCheckpoint(5), chapterCompleteCheckpoint(6)], ['CH05_COMPLETE', 'ENDING_COMPLETE']);
  assert.deepEqual([canProgressChapter(6, 'CH05_SCISSORS_REVEALED'), canProgressChapter(6, 'CH05_COMPLETE'), canProgressChapter(6, 'CHFINAL_STARTED')], [false, true, true]);
  assert.deepEqual([chapterCompleted(6, 'CHFINAL_COST_ACCEPTED'), chapterCompleted(6, 'ENDING_COMPLETE'), chapterCompleted(5, 'CHFINAL_STARTED')], [false, true, true]);
  assert.equal(STAGE_UNLOCK_EVENTS.home_core, 'final_unlocked');
});

test('이벤트·트리거 정의: 도착·결속은 지점 증거, 전이·선행이 계약대로이고 보상·성장이 없다', () => {
  const e = (id: string) => EVENT_BY_ID.get(id)!;
  const sig = (id: string) => [e(id).chapter, e(id).allowedAt, e(id).to ?? null, e(id).serverOnly ?? false, e(id).requires, e(id).evidence];
  assert.deepEqual(sig('final_entry_seen'), [6, ['CH05_COMPLETE'], 'CHFINAL_STARTED', false, ['final_unlocked', 'desert_chapter_complete_seen'], { kind: 'point', stageCode: 'home_core', pointId: 'final_arrival' }]);
  assert.deepEqual(sig('final_identity_revealed'), [6, ['CHFINAL_STARTED'], 'CHFINAL_IDENTITY_REVEALED', false, ['final_entry_seen'], { kind: 'point', stageCode: 'home_core', pointId: 'final_core' }]);
  for (const d of STORY_EVENTS.filter((x) => x.chapter === 6)) assert.deepEqual([d.grant, d.consume, d.equipRelic, d.grantStoryNubi], [undefined, undefined, undefined, undefined], `${d.id}: 아이템·성장 없음`);
  assert.deepEqual(STORY_TRIGGERS.filter((t) => t.stageCode === 'home_core').map((t) => [t.id, t.activeAt, t.unless, t.play]), [
    ['final_arrival', ['CH05_COMPLETE'], ['final_entry_seen'], { segmentId: 'final.arrival', endAfter: 'final.arrival' }],
    ['final_core', ['CHFINAL_STARTED'], ['final_identity_revealed'], { segmentId: 'final.bind', endAfter: 'final.bind' }],
    ['final_scissors', ['CHFINAL_IDENTITY_REVEALED'], ['final_boss_defeated'], { segmentId: 'final.last_thread', endAfter: 'final.knot' }],
  ]);
  // 10-26 F-3a: 가위 최종전 — 승리 정산은 서버 전용, 승리 장면을 끝까지 보면 final_boss_aftermath_seen(체크포인트 유지)
  assert.deepEqual(sig('final_boss_defeated'), [6, ['CHFINAL_IDENTITY_REVEALED'], 'CHFINAL_SCISSORS_DEFEATED', true, ['final_identity_revealed'], { kind: 'none' }]);
  assert.deepEqual(sig('final_boss_aftermath_seen'), [6, ['CHFINAL_SCISSORS_DEFEATED'], null, false, ['final_boss_defeated'], { kind: 'none' }]);
  assert.equal(STORY_TRIGGERS.find((t) => t.id === 'final_scissors')!.encounterKey, 'final_boss_scissors');
  for (const t of STORY_TRIGGERS.filter((x) => x.stageCode === 'home_core')) assert.ok(pointOf((t.evidence as { pointId: string }).pointId), `${t.id}의 지점이 지역 데이터에 있다`);
});

// ---------- 흐름 ----------

test('도착: 5장 마지막 장면 전 거부 → 금빛 길 끝 지점에서 장면을 끝까지 보면 CHFINAL_STARTED(보상 없음·멱등), 재접속 자동 재생 없음', async () => {
  const early = setup('CH05_COMPLETE', CH05_DONE.filter((e) => e !== 'desert_chapter_complete_seen'));
  early.goHome();
  early.standAt('final_arrival');
  assert.notEqual(await codeOf(early.service.trigger(P1, 'final_arrival')), 'NO_ERROR', "5장 '마지막 마감' 장면 전에는 닫혀 있다");

  const s = setup();
  const before = s.items();
  s.goHome();
  assert.equal((await s.service.onStageEntered(P1, 'home_core'))?.play ?? null, null, '지역 진입만으로는 재생하지 않는다(도착 지점이 연다)');
  s.standAt('final_arrival', 600);
  assert.equal(await codeOf(s.service.trigger(P1, 'final_arrival')), 'STORY_EVIDENCE_INVALID', '먼 곳 — 위치 증거 거부');
  s.standAt('final_arrival');
  assert.deepEqual((await s.service.trigger(P1, 'final_arrival')).play, { segmentId: 'final.arrival', endAfter: 'final.arrival' });
  assert.equal(s.checkpoint(), 'CH05_COMPLETE', '끝까지 보기 전에는 전이하지 않는다');
  const rs = await Promise.all([1, 2, 3].map(() => s.connect().completeEvent(P1, 'final_entry_seen')));
  assert.ok(rs.every((r) => r.story.checkpoint === 'CHFINAL_STARTED'));
  assert.equal(s.events().filter((e) => e === 'final_entry_seen').length, 1, '동시 요청도 한 번만');
  assert.equal(s.items(), before, '보상 없음');
  assert.equal((await s.service.trigger(P1, 'final_arrival')).play, null, '본 뒤에는 닫힌다');
  assert.equal(resumeOf({ checkpoint: 'CHFINAL_STARTED', events: new Set([...CH05_DONE, 'final_entry_seen']), objectives: new Map(), growthStage: 5 }).segmentId, null);
});

test('다섯 기억의 결속: 도착 전 거부 → 중앙의 빈자리에서 끝까지 보면 CHFINAL_IDENTITY_REVEALED(멱등), 이후 지점은 닫힌다', async () => {
  const s = setup();
  s.goHome();
  s.standAt('final_core');
  assert.notEqual(await codeOf(s.service.completeEvent(P1, 'final_identity_revealed')), 'NO_ERROR', '도착 전 결속 거부');
  s.standAt('final_arrival');
  await s.service.completeEvent(P1, 'final_entry_seen');
  s.standAt('final_core');
  assert.deepEqual((await s.service.trigger(P1, 'final_core')).play, { segmentId: 'final.bind', endAfter: 'final.bind' });
  assert.equal((await s.service.completeEvent(P1, 'final_identity_revealed')).story.checkpoint, 'CHFINAL_IDENTITY_REVEALED');
  assert.equal((await s.connect().completeEvent(P1, 'final_identity_revealed')).alreadyCompleted, true);
  assert.equal((await s.service.trigger(P1, 'final_core')).play, null);
});

test('가위(F-3a): 결속 전에는 검은 틈이 닫혀 있고, 결속 뒤 지점에서 최종 전투 범위(가위 등장 → 매듭 장면)가 열린다. 승리 정산은 클라이언트가 요청할 수 없고, 재접속은 매듭 장면부터', async () => {
  const before = setup('CHFINAL_STARTED', [...CH05_DONE, 'final_entry_seen']);
  before.goHome();
  before.standAt('final_scissors');
  assert.notEqual(await codeOf(before.service.trigger(P1, 'final_scissors')), 'NO_ERROR', '결속 전 거부');
  const s = setup('CHFINAL_IDENTITY_REVEALED', [...CH05_DONE, 'final_entry_seen', 'final_identity_revealed']);
  s.goHome();
  s.standAt('final_scissors');
  const t = await s.service.trigger(P1, 'final_scissors');
  assert.deepEqual(t.play, { segmentId: 'final.last_thread', endAfter: 'final.knot' });
  assert.equal(await codeOf(s.service.completeEvent(P1, 'final_boss_defeated')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.service.completeEvent(P1, 'final_boss_aftermath_seen')), 'STORY_EVENT_NOT_ALLOWED', '승리 전 거부');
  const won = [...CH05_DONE, 'final_entry_seen', 'final_identity_revealed', 'final_boss_defeated'];
  assert.equal(resumeOf({ checkpoint: 'CHFINAL_SCISSORS_DEFEATED', events: new Set(won), objectives: new Map(), growthStage: 5 }).segmentId, 'final.knot');
  assert.equal(resumeOf({ checkpoint: 'CHFINAL_SCISSORS_DEFEATED', events: new Set([...won, 'final_boss_aftermath_seen']), objectives: new Map(), growthStage: 5 }).segmentId, null);
  const after = setup('CHFINAL_SCISSORS_DEFEATED', won);
  assert.equal((await after.service.completeEvent(P1, 'final_boss_aftermath_seen')).story.checkpoint, 'CHFINAL_SCISSORS_DEFEATED');
});

test('종장 대화·지역: 5장을 마치기 전에는 대화 잠김, 마친 뒤 열림. 지역 화면은 목표가 진행에 따라 바뀌고 동료 넷·검은 틈 오버레이가 내려간다', async () => {
  const locked = setup('CH05_SCISSORS_REVEALED', CH05_DONE.filter((e) => !['desert_finish_thread_equipped', 'final_unlocked', 'desert_chapter_complete_seen'].includes(e)));
  assert.equal(await codeOf(locked.service.dialogue(P1, 'final')), 'CHAPTER_LOCKED');
  assert.equal(await codeOf(locked.service.stageData(P1, 'home_core')), 'STAGE_LOCKED');
  const s = setup();
  assert.equal(((await s.service.dialogue(P1, 'final')) as { chapterCode: string }).chapterCode, 'final');
  s.goHome();
  const view = await s.service.stageData(P1, 'home_core');
  assert.deepEqual(view.goal, { id: 'to_core', text: '금빛 길을 따라 다섯 실이 모이는 곳으로 가자.' });
  assert.deepEqual(view.render.overlays.map((o) => o.id), ['overlay_companion_muldeuli', 'overlay_companion_pokshini', 'overlay_companion_ganeuri', 'overlay_companion_bopuli', 'overlay_core_gap']);
  const after = await setup('CHFINAL_IDENTITY_REVEALED', [...CH05_DONE, 'final_entry_seen', 'final_identity_revealed']).service.stageData(P1, 'home_core');
  assert.deepEqual(after.goal, { id: 'face_scissors', text: '검은 틈 앞에 서자.' });
});

// ---------- 데이터 정합 ----------

// 몸 반지름(16)만큼 넓힌 충돌 사각형을 피해 8px 격자로 시작 지점에서 닿는 칸(5장 desert-layout 시험과 같은 방식)
function reachable(half: number, from: { x: number; y: number }) {
  const CELL = 8;
  const GW = 3200 / CELL;
  const GH = 2400 / CELL;
  const blocked = new Uint8Array(GW * GH);
  for (const r of solidsFor(collisionOf(HOME, 3200, 2400, 'home_core'), new Set())) {
    for (let y = Math.max(0, Math.floor((r.y - half) / CELL)); y <= Math.min(GH - 1, Math.floor((r.y + r.height + half) / CELL)); y++)
      for (let x = Math.max(0, Math.floor((r.x - half) / CELL)); x <= Math.min(GW - 1, Math.floor((r.x + r.width + half) / CELL)); x++) {
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        if (cx > r.x - half && cx < r.x + r.width + half && cy > r.y - half && cy < r.y + r.height + half) blocked[y * GW + x] = 1;
      }
  }
  const seen = new Uint8Array(GW * GH);
  const stack = [Math.floor(from.y / CELL) * GW + Math.floor(from.x / CELL)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % GW;
    const y = (i - x) / GW;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const j = ny * GW + nx;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || seen[j] || blocked[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return (p: { x: number; y: number }) => seen[Math.floor(p.y / CELL) * GW + Math.floor(p.x / CELL)] === 1;
}

test('지역 데이터: 시작 지점에서 이야기 지점·동료 자리가 모두 닿고(문 없음), 골격과 같은 좌표다', () => {
  const skel = JSON.parse(readFileSync(resolve(__dirname, '../scripts/data/home-core-skeleton.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
  const at = reachable(16, HOME.spawnPoint!);
  for (const p of skel.points.filter((x) => x.id !== 'spawn')) assert.ok(at(p), `${p.id}에 닿는다`);
  for (const p of HOME.points) assert.deepEqual([p.x, p.y], [skel.points.find((q) => q.id === p.id)!.x, skel.points.find((q) => q.id === p.id)!.y], `${p.id} 좌표`);
  assert.deepEqual(HOME.points.map((p) => p.id), ['final_arrival', 'final_core', 'final_scissors']);
  assert.deepEqual(HOME.layout!.gates, []);
});

test('대화 데이터: 구간 7개의 시작 저장점·완료 사건, 화자 키·초상화, 연출 cue·전투 키가 계약대로', () => {
  assert.deepEqual(FINAL.segments.map((s) => [s.segmentId, s.resumeFrom, s.completesWith]), [
    ['final.arrival', 'CH05_COMPLETE', 'final_entry_seen'],
    ['final.bind', 'CHFINAL_STARTED', 'final_identity_revealed'],
    ['final.last_thread', 'CHFINAL_IDENTITY_REVEALED', null],
    ['final.knot', 'CHFINAL_SCISSORS_DEFEATED', 'final_boss_aftermath_seen'],
    ['final.cost', 'CHFINAL_SCISSORS_DEFEATED', 'final_cost_accepted'],
    ['final.unravel', 'CHFINAL_COST_ACCEPTED', null],
    ['final.real_world', 'CHFINAL_COST_ACCEPTED', 'ending_yarn_reunion_seen'],
  ]);
  const flat = FINAL.segments.flatMap((s) => s.entries);
  const speakers = [...new Set(flat.filter((e) => e.kind === 'line').map((e) => `${e.speakerLabel}=${e.speaker}/${e.portrait}`))].sort();
  assert.deepEqual(speakers, ['가느리=ganeuri/null', '가위=scissors/null', '누비=nubi/nubi', '단수링=dansuring/dansuring', '물들이=muldeuli/null', '보풀이=bopuli/bopuli', '엄마=mother/null', '오래된 폭신이=old_pokshini/null', '{playerName}=player/player'].sort());
  assert.deepEqual(flat.filter((e) => e.cameraCue).map((e) => e.cameraCue), ['five-relics', 'five-bind', 'origin-fall']);
  assert.deepEqual(flat.filter((e) => e.kind === 'storyBattle').map((e) => e.encounterKey), ['final_boss_scissors']);
});

test('final 대화(종장 전체): 장면 문서와 서술·대사가 같은 순서·화자·문구이고, 빠진 줄은 제외 목록뿐이다', () => {
  const ROOT = resolve(__dirname, '../..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DOCS = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXCLUDED } = require(join(ROOT, 'BE/story-data/save-a-turby/tools/build-final.js')) as { EXCLUDED: Record<number, string> };
  const raw = readFileSync(join(DOCS, 'docs/scene/종장.md'), 'utf8').split(/\r?\n/);
  const from = raw.findIndex((l) => l.trim() === '## 집의 중심');
  const to = raw.findIndex((l) => l.trim() === '## 시스템 처리');
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
    if (l.startsWith('“')) {
      md.push({ who: speaker, text: l.replace(/^“/, '').replace(/”$/, '') });
      speaker = null;
    } else md.push({ who: null, text: l.replace(/^- /, '').replace(/`/g, '') });
  }
  const json = FINAL.segments.flatMap((x) => x.entries).filter((e) => e.kind === 'line' || e.kind === 'narration');
  assert.equal(json.length, md.length, `항목 수: JSON ${json.length} / MD ${md.length}`);
  json.forEach((e, i) => {
    assert.equal(e.text, md[i].text, `${e.dialogueId}: 문구`);
    if (e.kind === 'line') assert.equal(e.speakerLabel, md[i].who, `${e.dialogueId}: 화자 표기`);
    else assert.equal(md[i].who, null, `${e.dialogueId}: 서술`);
  });
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 0);
});
