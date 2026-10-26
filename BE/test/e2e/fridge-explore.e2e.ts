// 10-23 C4-1: 4장 냉장고 속 탐험 — 3장을 마친 계정이 입장해 도입(누비만 듣는 목소리) → 성에 통로의 서리 구역 → 얼음에 박힌 가느리 → 바늘 통로(내려찍으면 안전 앵커로 복귀),
// 그리고 640×360에서 열린 저장고 → 완성된 도안 → 누비의 고백 → 새로고침 복원. 저장고 앞 전투·서리 미싱·장착은 C4-3(여기서는 전투 승리를 시드로 둔다). 회색상자 단계.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFridge } from './fixtures';
import { SPAWN_TO_GANEURI, GANEURI_TO_NEEDLES, GUARD_TO_WALL, WALL_TO_CONFESSION, type Pt } from '../helpers/fridge-route';

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

const ICE = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/ice.json'), 'utf8')) as {
  points: { id: string; x: number; y: number }[];
  frostZones: { x: number; y: number; width: number; height: number }[];
  needleFields: { id: string; x: number; y: number; width: number; height: number }[];
  safeAnchors: { id: string; x: number; y: number }[];
};
const pointOf = (id: string) => ICE.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const GOAL_CORRIDOR = '성에 낀 통로 끝으로 가 보자.';
const GOAL_NEEDLES = '바늘이 지나간 칸을 따라 통로를 건너 저장고로 가자.';
const GOAL_STORAGE = '열린 저장고 안으로 들어가 보자.';
const GOAL_CENTER = '저장고 중심으로 가자.';
const GOAL_MACHINE = '바늘 소리가 나는 저장고 중심으로 들어가자.';

type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; interact: { x: number; y: number }; interactRect: { x: number; y: number; w: number; h: number }; goalShown: string | null };
type MapState = { avatar: Pt; inFrost: boolean; needleReturns: number; lastNeedleId: string | null; needles: { id: string; phase: string | null }[]; notices: string[]; hudMode: string; joystickZone: { x: number; y: number; w: number; h: number } };
const story = async (g: Game) => (await g.state()).map.story as StoryState;
const map = async (g: Game) => (await g.state()).map as MapState;

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
const voiceShown = "(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && sc.fxState.voiceShown >= 1; })()";
const glimpseShown = (key: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && sc.fxState.glimpseShown.includes('${key}'); })()`;

async function enterFridge(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  // 작은 화면은 한 쪽에 카드 3장 — 4장은 둘째 쪽
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  if ((await g.state()).stageSelect.mode === 'compact') await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('4장 — 냉장고 속', { exact: true });
}
async function reachMap(g: Game, expectIntro: boolean) {
  await g.until('냉장고 지도 또는 이야기 장면', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
  if ((await g.state()).scenes.includes('StoryDialogue')) {
    assert.equal(expectIntro, true, '이미 본 장면이 다시 재생됨');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  }
  await g.until('냉장고 지도', MAP_READY);
  if (!expectIntro) {
    await g.page.waitForTimeout(800);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '이미 본 장면이 반복됨');
  }
}
async function interact(g: Game, id: string, route: Pt[], how: 'keys' | 'joystick', midDialogue?: string) {
  const near = `s.map && s.map.story && s.map.story.prompt === '${id}'`;
  for (const q of route) await g.walkDirect('Map', q, how, near, 30);
  await g.walkDirect('Map', pointOf(id), how, near);
  await g.until(`${id} 안내 버튼`, `${near} && !!s.map.story.promptText`);
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
  if (midDialogue) await g.advanceDialogue(midDialogue);
  await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY);
}

test('4장 C4-1 ①(1280×720): 냉장고 입장 → 도입(누비만 듣는 목소리) → 새로고침(반복 없음) → 서리 구역 → 가느리 구조 → 바늘 통로(내려찍으면 앵커로 복귀) → 새로고침 복원', async () => {
  const device = 'e2e-fridge-1280';
  await backend.start(seedFridge(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'fridge-c4-1', async () => {
    const before = dbOf(device);
    assert.deepEqual([before.checkpoint, before.growth], ['CH03_COMPLETE', 3]);
    await enterFridge(g);
    // 1) 도입: 목소리 줄에서 가장자리 서리 연출 → 끝까지 보면 CH04_STARTED
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(voiceShown);
    await g.capture('fridge_01_voice');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY);
    let db = dbOf(device);
    assert.equal(db.checkpoint, 'CH04_STARTED');
    assert.equal(once(db.events, 'fridge_entry_seen'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '보상·성장 변화 없음');
    let s = await story(g);
    assert.equal(s.goalShown, GOAL_CORRIDOR);
    assert.deepEqual(s.points, ['fridge_ganeuri'], '도입 뒤 가느리만 표시됨');
    assert.equal(s.gates.gate_storage_door, false, '저장고 문은 닫혀 있다');
    await g.capture('fridge_02_after_intro');

    // 2) 새로고침: 도입이 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    assert.equal(dbOf(device).checkpoint, 'CH04_STARTED');

    // 3) 성에 통로: 서리 구역 안에서는 가장자리 서리 + 첫 안내(안내 버튼은 늦추지 않는다)
    const frost = ICE.frostZones[0];
    await g.walkDirect('Map', { x: frost.x + 200, y: 1900 }, 'keys');
    let m = await map(g);
    assert.equal(m.inFrost, true, '서리 구역 안');
    assert.ok(m.notices.some((n) => n.includes('서리')), `서리 안내: ${m.notices.join(' / ')}`);
    await g.capture('fridge_03_frost');

    // 4) 가느리: 장면을 끝까지 보면 CH04_GANEURI_RESCUED, 풀려난 가느리가 바늘 통로 입구에서 기다린다
    await interact(g, 'fridge_ganeuri', SPAWN_TO_GANEURI.slice(8), 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH04_GANEURI_RESCUED');
    assert.equal(once(db.events, 'fridge_ganeuri_freed'), 1);
    s = await story(g);
    assert.equal(s.goalShown, GOAL_NEEDLES);
    assert.deepEqual(s.points, ['fridge_guard'], '구조 뒤 저장고 앞 길목만 표시됨');
    m = await map(g);
    assert.equal(m.inFrost, false);
    assert.deepEqual(m.needles.map((n) => n.id), ['needle_1', 'needle_2', 'needle_3'], '바늘 칸 세 개가 주기를 돈다');

    // 5) 바늘 통로: 서쪽 앵커를 밟고, 첫 칸이 예고를 시작하면 칸 가운데로 들어가 선다 → 내려찍는 순간 앵커로 돌아온다(피해·진행 손실 없음)
    for (const q of GANEURI_TO_NEEDLES) await g.walkDirect('Map', q, 'keys');
    const n1 = ICE.needleFields[0];
    await g.until('needle_1 쉼', "s.map.needles.find((n) => n.id === 'needle_1').phase === 'idle'", 5000);
    await g.until('needle_1 예고', "s.map.needles.find((n) => n.id === 'needle_1').phase === 'warn'", 5000);
    // 걷는 도중에 내려찍혀 돌아가면 그 자리에서 멈춘다(돌아간 뒤 다시 칸으로 걸어 들어가지 않게)
    await g.walkDirect('Map', { x: n1.x + n1.width / 2, y: 1560 }, 'keys', 's.map.needleReturns >= 1');
    if ((await map(g)).needleReturns === 0) await g.capture('fridge_04_needle_warn');
    await g.until('바늘 복귀', 's.map.needleReturns >= 1', 5000);
    m = await map(g);
    const west = ICE.safeAnchors.find((a) => a.id === 'anchor_needle_west')!;
    assert.equal(m.lastNeedleId, 'needle_1');
    assert.ok(Math.hypot(m.avatar.x - west.x, m.avatar.y - west.y) < 24, `서쪽 앵커로 돌아왔다 (${m.avatar.x}, ${m.avatar.y})`); // 복귀 직후 눌려 있던 키로 몇 px 더 움직일 수 있다 — 몸 지름 안이면 앵커
    assert.ok(m.notices.some((n) => n.includes('바늘')), '바늘 안내 한 번');
    db = dbOf(device);
    assert.deepEqual([db.checkpoint, db.growth, db.items], ['CH04_GANEURI_RESCUED', before.growth, before.items], '진행·보상 변화 없음');

    // 6) 새로고침: CH04_GANEURI_RESCUED 복원, 가느리 장면은 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    s = await story(g);
    assert.deepEqual([dbOf(device).checkpoint, s.goalShown, s.points], ['CH04_GANEURI_RESCUED', GOAL_NEEDLES, ['fridge_guard']]);
    assert.deepEqual(dbOf(device).events.filter((e) => e.startsWith('fridge_')).sort(), ['fridge_entry_seen', 'fridge_ganeuri_freed', 'fridge_unlocked']);
  }, backend, device);
  await g.close();
});

test('4장 C4-1 ②(640×360): 길목 승리(시드) 뒤 열린 저장고 → 완성된 도안(클로즈업·두 번째 목소리) → CH04_STORAGE_CLEARED → 고백 → CH04_CONFESSION_SEEN → 새로고침 복원', async () => {
  const device = 'e2e-fridge-640';
  await backend.start(seedFridge(device, 'opened'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'fridge-c4-1-small', async () => {
    assert.equal(dbOf(device).checkpoint, 'CH04_GANEURI_RESCUED');
    await enterFridge(g);
    await reachMap(g, false);
    let s = await story(g);
    assert.equal(s.gates.gate_storage_door, true, '길목 승리로 저장고 문이 열렸다');
    assert.equal(s.goalShown, GOAL_STORAGE);
    assert.deepEqual(s.points, ['fridge_storage_wall']);
    // 저장고 앞 길목에서 시작(바늘 통로는 ①이 본다)
    backend.displace(device, { x: 2700, y: 1080 });
    await g.reload();
    await reachMap(g, false);

    // 도안 벽: 안내 버튼은 조이스틱 영역 위, 장면 중 클로즈업·두 번째 목소리
    for (const q of GUARD_TO_WALL) await g.walkDirect('Map', q, 'joystick', "s.map.story.prompt === 'fridge_storage_wall'", 30);
    await g.until('도안 벽 안내', "s.map.story.prompt === 'fridge_storage_wall' && !!s.map.story.promptText");
    s = await story(g);
    const m = await map(g);
    assert.equal(m.hudMode, 'compact');
    assert.ok(s.interactRect.y + s.interactRect.h <= m.joystickZone.y, '안내 버튼은 조이스틱 영역 위');
    await g.capture('fridge_s01_wall_prompt');
    await g.clickAt(s.interact.x, s.interact.y, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue(glimpseShown('storage-pattern'));
    await g.advanceDialogue(voiceShown);
    await g.capture('fridge_s02_second_voice');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 준비', MAP_READY);
    assert.equal(dbOf(device).checkpoint, 'CH04_STORAGE_CLEARED');
    assert.equal((await story(g)).goalShown, GOAL_CENTER);

    // 고백
    await interact(g, 'fridge_confession', WALL_TO_CONFESSION, 'joystick');
    const db = dbOf(device);
    assert.equal(db.checkpoint, 'CH04_CONFESSION_SEEN');
    assert.deepEqual([once(db.events, 'fridge_storage_seen'), once(db.events, 'fridge_confession_seen')], [1, 1]);
    s = await story(g);
    assert.equal(s.goalShown, GOAL_MACHINE);
    assert.deepEqual(s.points, ['fridge_boss_entrance'], '고백 뒤 서리 미싱 입구가 열린다(C4-3)');
    await g.capture('fridge_s03_after_confession');

    // 새로고침: CH04_CONFESSION_SEEN 복원, 장면 반복 없음
    await g.reload();
    await reachMap(g, false);
    assert.deepEqual([dbOf(device).checkpoint, (await story(g)).goalShown], ['CH04_CONFESSION_SEEN', GOAL_MACHINE]);
  }, backend, device);
  await g.close();
});
