// 10-26 F-1: 종장 집의 중심 탐험 — 5장을 마친 계정이 지역 선택 둘째 쪽에서 종장에 들어가 금빛 길을 걸어 도착 장면(CHFINAL_STARTED) →
// 새로고침(반복 없음) → 중앙의 빈자리에서 다섯 기억의 결속(CHFINAL_IDENTITY_REVEALED) → 목표가 검은 틈으로 바뀐다(640×360은 같은 흐름의 지역 화면 확인).
// 가위 전투·귀환의 대가·엔딩은 F-3. 1차 에셋 배경 연결 전이라 회색상자 지도다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFinal } from './fixtures';

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

type Pt = { x: number; y: number };
const HOME = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/home_core.json'), 'utf8')) as { points: (Pt & { id: string })[] };
const pointOf = (id: string) => HOME.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const GOAL_TO_CORE = '금빛 길을 따라 다섯 실이 모이는 곳으로 가자.';
const GOAL_BIND = '누비와 함께 중앙의 빈자리로 가자.';
const GOAL_SCISSORS = '검은 틈 앞에 서자.';

type StoryState = { points: string[]; prompt: string | null; promptText: string | null; interact: Pt; goalShown: string | null };
const story = async (g: Game) => (await g.state()).map.story as StoryState;
function dbOf(device: string) {
  const p = backend.playerByDevice(device)!;
  const prog = backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string; nubi_growth_stage: number };
  return {
    checkpoint: prog.checkpoint,
    growth: prog.nubi_growth_stage,
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string),
    items: backend.db.rows('player_item', { player_id: p.id }).map((r) => `${r.item_definition_id}:${r.quantity}`).sort(),
  };
}
const once = (events: string[], id: string) => events.filter((e) => e === id).length;

// 종장 카드는 여섯째(보통 화면 한 쪽 5장 · 작은 화면 3장) — 둘째 쪽
async function enterHome(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('종장 — 집의 중심', { exact: true });
  await g.until('집의 중심 지도', MAP_READY, 30_000);
}
async function interact(g: Game, id: string, how: 'keys' | 'joystick') {
  const near = `s.map && s.map.story && s.map.story.prompt === '${id}'`;
  await g.walkDirect('Map', pointOf(id), how, near);
  await g.until(`${id} 안내 버튼`, `${near} && !!s.map.story.promptText`);
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
  await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY);
}
async function noReplay(g: Game) {
  await g.reload();
  await g.until('집의 중심 지도', MAP_READY, 30_000);
  await g.page.waitForTimeout(800);
  assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '이미 본 장면이 반복됨');
}

test('종장 F-1 ①(1280×720): 지역 선택 → 집의 중심 → 도착(CHFINAL_STARTED) → 새로고침(반복 없음) → 다섯 기억의 결속(CHFINAL_IDENTITY_REVEALED) → 새로고침 복원', async () => {
  const device = 'e2e-final-1280';
  await backend.start(seedFinal(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'final-f1-1280', async () => {
    const before = dbOf(device);
    assert.deepEqual([before.checkpoint, before.growth], ['CH05_COMPLETE', 5]);
    await enterHome(g);
    await g.page.waitForTimeout(800);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '지역 진입만으로는 재생하지 않는다');
    let s = await story(g);
    assert.deepEqual([s.goalShown, s.points], [GOAL_TO_CORE, ['final_arrival']]);
    await g.capture('final_01_entry');

    // 1) 금빛 길 끝의 도착 지점: 끝까지 보면 CHFINAL_STARTED(보상·성장 변화 없음)
    await interact(g, 'final_arrival', 'keys');
    let db = dbOf(device);
    assert.equal(db.checkpoint, 'CHFINAL_STARTED');
    assert.equal(once(db.events, 'final_entry_seen'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '보상·성장 변화 없음');
    s = await story(g);
    assert.deepEqual([s.goalShown, s.points], [GOAL_BIND, ['final_core']]);
    await noReplay(g);

    // 2) 중앙의 빈자리: 다섯 기억의 결속을 끝까지 보면 CHFINAL_IDENTITY_REVEALED
    await interact(g, 'final_core', 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CHFINAL_IDENTITY_REVEALED');
    assert.equal(once(db.events, 'final_identity_revealed'), 1);
    assert.equal((await story(g)).goalShown, GOAL_SCISSORS);
    await g.capture('final_02_after_bind');
    await noReplay(g);
    assert.deepEqual([dbOf(device).checkpoint, (await story(g)).goalShown], ['CHFINAL_IDENTITY_REVEALED', GOAL_SCISSORS]);
  }, backend, device);
  await g.close();
});

test('종장 F-1 ②(640×360): 도착 뒤 계정 — 작은 화면에서 지역 선택 둘째 쪽으로 들어가 중앙의 빈자리까지 걸어 결속', async () => {
  const device = 'e2e-final-640';
  await backend.start(seedFinal(device, 'started'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'final-f1-640', async () => {
    await enterHome(g);
    assert.equal((await story(g)).goalShown, GOAL_BIND);
    await interact(g, 'final_core', 'joystick');
    assert.equal(dbOf(device).checkpoint, 'CHFINAL_IDENTITY_REVEALED');
    await g.capture('final_03_bind_640');
  }, backend, device);
  await g.close();
});
