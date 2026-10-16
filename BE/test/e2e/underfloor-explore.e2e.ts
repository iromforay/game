// 10-16 C3-1: 3장 마루바닥 밑 탐험 — 2장을 마친 계정이 입장해 도입 → 오래된 폭신이 → 물건 더미 조사 3곳(기억 비침) → 매복 지점의 기계음 장면까지,
// 그리고 640×360에서 폭신이 → 새로고침(CH03_ELDER_MET 복원). 1280×720과 640×360 필수 UI. 전투와 정산은 C3-3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedUnderfloor } from './fixtures';
import { SPAWN_TO_ELDER, ELDER_TO_GLOVE, GLOVE_TO_BLANKET, BLANKET_TO_DOLL, DOLL_TO_AMBUSH, type Pt } from '../helpers/underfloor-route';

let backend: Backend;
let vite: { url: string; close: () => Promise<void> };
let browser: Browser;
before(async () => {
  backend = new Backend(await freePort());
  vite = await startVite(join(ROOT, 'save-a-turby'), { VITE_TURBY_SERVER_URL: `http://127.0.0.1:${backend.port}` });
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await vite?.close();
  await backend?.stop();
});

const UG = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/underground.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
const pointOf = (id: string) => UG.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const GOAL_FOLLOW = '오래된 흔적을 따라 물건 더미 쪽으로 가자.';
const GOAL_INSPECT_0 = '오래된 물건을 살펴보자. 0/3';
const GOAL_INSPECT_1 = '오래된 물건을 살펴보자. 1/3';
const GOAL_INSPECT_2 = '오래된 물건을 살펴보자. 2/3';
const GOAL_SOUND = '기계음이 나는 쪽을 확인하자.';

type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; busy: boolean; interact: { x: number; y: number }; interactRect: { x: number; y: number; w: number; h: number }; goalShown: string | null };
const story = async (g: Game) => (await g.state()).map.story as StoryState;

function dbOf(device: string) {
  const p = backend.playerByDevice(device)!;
  return {
    checkpoint: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint,
    growth: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { nubi_growth_stage: number }).nubi_growth_stage,
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string),
    items: backend.db.rows('player_item', { player_id: p.id }).map((r) => `${r.item_definition_id}:${r.quantity}`).sort(),
  };
}
const once = (events: string[], id: string) => events.filter((e) => e === id).length;

// C3-2: 일반 화면은 최종 배경·최종 표식만 쓴다(회색상자·임시 글자·충돌 오버레이 없음)
type RenderState = { background: string; tileSprites: number; greyboxNotices: number; collisionDebug: boolean; overlays: string[]; pointArts: { id: string; assetKey: string | null }[] };
const render = async (g: Game) => (await g.state()).map.render as RenderState;
async function assertFinalRender(g: Game) {
  const r = await render(g);
  assert.equal(r.background, 'final', '최종 배경 모드');
  assert.equal(r.tileSprites, 0, '반복 타일 없음');
  assert.equal(r.greyboxNotices, 0);
  assert.equal(r.collisionDebug, false, '일반 화면에는 충돌 오버레이 없음');
  const key = await g.page.evaluate(() => (window as any).__game.scene.getScene('Map').bgImage.texture.key); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(key, 'underfloor-base');
}

async function enterUnderfloor(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('3장 — 마루바닥 밑', { exact: true });
}
async function reachMap(g: Game, expectIntro: boolean) {
  await g.until('마루 밑 지도 또는 이야기 장면', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
  if ((await g.state()).scenes.includes('StoryDialogue')) {
    assert.equal(expectIntro, true, '이미 본 장면이 다시 재생됨');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  }
  await g.until('마루 밑 지도', MAP_READY);
  if (!expectIntro) {
    await g.page.waitForTimeout(800); // 늦게 뜨는 장면이 없는지 한 번 더 본다
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '이미 본 도입이 반복됨');
  }
}
async function interact(g: Game, id: string, route: Pt[], how: 'keys' | 'joystick') {
  const near = `s.map && s.map.story && s.map.story.prompt === '${id}'`;
  for (const q of route) await g.walkDirect('Map', q, how, near, 30);
  await g.walkDirect('Map', pointOf(id), how, near);
  await g.until(`${id} 안내 버튼`, `${near} && !!s.map.story.promptText`);
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
  await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY);
}

test('3장 C3-1 ①: 마루 밑 입장 → 도입 → 새로고침(반복 없음) → 오래된 폭신이 → 조사 3곳 → 목표 갱신 → 기계음 장면(전투 전)', async () => {
  const device = 'e2e-underfloor-1280';
  await backend.start(seedUnderfloor(device), { 'story.stageAccessV2': true }); // 신 판정(이벤트 기반 개방)
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'underfloor-c3-1', async () => {
    const before = dbOf(device);
    assert.equal(before.checkpoint, 'CH02_COMPLETE');
    await enterUnderfloor(g);
    // 1) 도입 대화(낯익은 어둠) — 끝까지 보면 CH03_STARTED
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.capture('underfloor_01_intro');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('마루 밑 지도', MAP_READY);
    let db = dbOf(device);
    assert.equal(db.checkpoint, 'CH03_STARTED');
    assert.equal(once(db.events, 'underfloor_entry_seen'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '보상·성장 변화 없음');
    let s = await story(g);
    assert.equal(s.goalShown, GOAL_FOLLOW, `목표 패널: ${s.goalShown}`);
    assert.deepEqual(s.points, ['underfloor_elder'], '도입 뒤 오래된 폭신이만 표시됨');
    assert.equal(s.gates.gate_dust_yarn, false, '먼지 실타래 문은 닫혀 있다');
    await g.capture('underfloor_02_after_intro');

    // 2) 새로고침: 도입이 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    assert.equal((await story(g)).goalShown, GOAL_FOLLOW);
    assert.equal(dbOf(device).checkpoint, 'CH03_STARTED');

    // 3) 오래된 폭신이 → 장면을 끝까지 보면 CH03_ELDER_MET, 조사 지점 3곳이 열린다
    await interact(g, 'underfloor_elder', SPAWN_TO_ELDER, 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH03_ELDER_MET');
    assert.equal(once(db.events, 'underfloor_elder_met'), 1);
    s = await story(g);
    assert.equal(s.goalShown, GOAL_INSPECT_0);
    assert.deepEqual([...s.points].sort(), ['underfloor_blanket', 'underfloor_doll', 'underfloor_glove'], '조사 3곳');
    await g.capture('underfloor_03_after_elder');
    await assertFinalRender(g);
    const arts = (await render(g)).pointArts;
    assert.deepEqual(['underfloor_glove', 'underfloor_blanket', 'underfloor_doll'].map((id) => arts.find((p) => p.id === id)?.assetKey), ['inspect-glove', 'inspect-blanket', 'inspect-doll'], '조사 소품 그림');
    assert.equal((await render(g)).overlays.includes('memory-trail'), false, '실패 자국은 길이 열리기 전에는 없다');

    // 4) 조사 3곳(순서 있게 걷지만 규칙상 순서 없음) — 각자 기억 비침, 마지막에 기계음 지점
    await interact(g, 'underfloor_glove', ELDER_TO_GLOVE, 'keys');
    assert.equal((await story(g)).goalShown, GOAL_INSPECT_1);
    await interact(g, 'underfloor_blanket', GLOVE_TO_BLANKET, 'keys');
    assert.equal((await story(g)).goalShown, GOAL_INSPECT_2);
    await interact(g, 'underfloor_doll', BLANKET_TO_DOLL, 'keys');
    db = dbOf(device);
    for (const k of ['glove', 'blanket', 'doll']) assert.equal(once(db.events, `underfloor_${k}_inspected`), 1);
    assert.equal(once(db.events, 'underfloor_items_inspected'), 1, '집계 사건 한 번');
    assert.equal(db.checkpoint, 'CH03_ELDER_MET');
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '조사에도 보상 없음');
    s = await story(g);
    assert.equal(s.goalShown, GOAL_SOUND);
    assert.deepEqual(s.points, ['underfloor_ambush'], '조사 뒤 매복 지점만 표시됨');
    await g.capture('underfloor_04_items_done');

    // 5) 기계음 장면 — C3-1은 장면까지(전투와 정산은 C3-3). 체크포인트·문은 그대로
    await interact(g, 'underfloor_ambush', DOLL_TO_AMBUSH, 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH03_ELDER_MET');
    assert.equal(db.events.includes('underfloor_memory_trail_found'), false);
    assert.equal((await story(g)).gates.gate_dust_yarn, false, '전투 승리 전에는 먼지 실타래 문이 닫혀 있다');
    await g.capture('underfloor_05_machine_sound_seen');
    assert.deepEqual(db.events.filter((e) => e.startsWith('underfloor_')).sort(), ['underfloor_blanket_inspected', 'underfloor_doll_inspected', 'underfloor_elder_met', 'underfloor_entry_seen', 'underfloor_glove_inspected', 'underfloor_items_inspected', 'underfloor_unlocked']);
  }, backend, device);
  await g.close();
});

test('3장 C3-1 ②: 640×360 — 폭신이 만남이 같은 흐름으로 동작하고, 안내 버튼은 조이스틱 영역 위이며, 새로고침하면 CH03_ELDER_MET이 복원된다', async () => {
  const device = 'e2e-underfloor-640';
  await backend.start(seedUnderfloor(device, 'started'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'underfloor-c3-1-small', async () => {
    assert.equal(dbOf(device).checkpoint, 'CH03_STARTED');
    await enterUnderfloor(g);
    await reachMap(g, false); // 도입을 이미 본 계정: 장면 없이 지도
    // 안내 버튼·목표 패널 배치(기존 반응형 규칙): 폭신이 앞에서 확인
    for (const q of SPAWN_TO_ELDER) await g.walkDirect('Map', q, 'joystick', "s.map.story.prompt === 'underfloor_elder'", 30);
    await g.walkDirect('Map', pointOf('underfloor_elder'), 'joystick', "s.map.story.prompt === 'underfloor_elder'");
    await g.until('폭신이 안내', "s.map.story.prompt === 'underfloor_elder' && !!s.map.story.promptText");
    const s = await story(g);
    const m = (await g.state()).map as { hudMode: string; joystickZone: { x: number; y: number; w: number; h: number } };
    assert.equal(m.hudMode, 'compact');
    assert.ok(s.interactRect.y + s.interactRect.h <= m.joystickZone.y, '안내 버튼은 조이스틱 영역 위');
    assert.ok(s.interactRect.h * 0.5 >= 40 && s.interactRect.w * 0.5 >= 200, '실제 화면에서 누를 수 있는 크기');
    assert.equal(s.goalShown, GOAL_FOLLOW);
    await g.capture('underfloor_s01_elder_prompt');
    await g.clickAt(s.interact.x, s.interact.y, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 준비', MAP_READY);
    assert.equal(dbOf(device).checkpoint, 'CH03_ELDER_MET');
    assert.equal((await story(g)).goalShown, GOAL_INSPECT_0);

    // 새로고침: CH03_ELDER_MET에서 복원, 장면 반복 없음
    await g.reload();
    await reachMap(g, false);
    const after = await story(g);
    assert.equal(dbOf(device).checkpoint, 'CH03_ELDER_MET');
    assert.equal(after.goalShown, GOAL_INSPECT_0);
    assert.deepEqual([...after.points].sort(), ['underfloor_blanket', 'underfloor_doll', 'underfloor_glove']);
    await g.capture('underfloor_s02_restored');
  }, backend, device);
  await g.close();
});

test('3장 C3-2: 실패 자국 길이 열린 상태 — 먼지 실타래 문 열림·실패 자국 오버레이가 최종 그림으로 표시되고 새로고침 뒤에도 같다', async () => {
  const device = 'e2e-underfloor-trail';
  await backend.start(seedUnderfloor(device, 'trail'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'underfloor-c3-2-trail', async () => {
    assert.equal(dbOf(device).checkpoint, 'CH03_MEMORY_TRAIL_FOUND');
    await enterUnderfloor(g);
    await reachMap(g, false);
    await assertFinalRender(g);
    let s = await story(g);
    assert.equal(s.gates.gate_dust_yarn, true, '매복 승리 뒤 먼지 실타래 문이 열려 있다');
    assert.deepEqual(s.points, ['underfloor_fragment']);
    assert.equal(s.goalShown, '굴러간 실패 자국을 따라가자.');
    assert.equal((await render(g)).overlays.includes('memory-trail'), true, '실패 자국 오버레이');
    const look = (x: number, y: number) => g.page.evaluate(({ x, y }) => (window as any).__dev.lookAt(x, y), { x, y }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await look(2000, 1060);
    await g.capture('underfloor_t01_gate_open');
    await look(2200, 800);
    await g.capture('underfloor_t02_memory_trail');
    await g.reload();
    await reachMap(g, false);
    s = await story(g);
    assert.equal(s.gates.gate_dust_yarn, true, '새로고침 뒤에도 열린 문');
    assert.equal((await render(g)).overlays.includes('memory-trail'), true);
  }, backend, device);
  await g.close();
});
