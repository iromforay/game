// 10-26 C5-1: 5장 보일러 옆 사막 탐험 — 4장을 마친 계정이 입장해 도입(동료 셋 합류) → 새로고침(반복 없음) → 단서 길(CH05_CLUES_JOINED),
// 그리고 640×360에서 능선 앞 전투 승리(시드) 뒤 뜨거운 모래 → 동료 셋이 차례로 틈을 잇는다 → 절단면(가위 그림자) → CH05_RIDGE_CROSSED → 새로고침 복원.
// 능선 앞 전투·황금 재단인형·가위 장면·장착은 C5-3(여기서는 전투 승리를 시드로 둔다).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedDesert } from './fixtures';
import { SPAWN_TO_CLUES, SCORCHED_TO_PAD, PAD_TO_SCENT, SCENT_TO_THREAD, THREAD_TO_CUT, type Pt } from '../helpers/desert-route';

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

const DESERT = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/desert.json'), 'utf8')) as {
  points: { id: string; x: number; y: number }[];
  frostZones: { x: number; y: number; width: number; height: number }[];
};
const pointOf = (id: string) => DESERT.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const GOAL_FOLLOW = '금빛 실이 가리키는 쪽으로 동료들과 걸어가자.';
const GOAL_SCORCHED = '끊어진 실을 나르는 그을린 박음이들을 막자.';
const GOAL_PAD = '능선의 틈 앞에서 물들이에게 길을 부탁하자.';
const GOAL_LAST = '금빛 마감실이 잠든 자리로 가자.';

type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; interact: { x: number; y: number }; goalShown: string | null };
type MapState = { avatar: Pt; inFrost: boolean; slowZone: string | null; mirages: { id: string; alpha: number }[]; notices: string[]; hudMode: string };
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
const glimpseShown = (key: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && sc.fxState.glimpseShown.includes('${key}'); })()`;

async function enterDesert(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  // 작은 화면은 한 쪽에 카드 3장 — 5장은 둘째 쪽
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  if ((await g.state()).stageSelect.mode === 'compact') await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('5장 — 보일러 옆 사막', { exact: true });
}
async function reachMap(g: Game, expectIntro: boolean) {
  await g.until('사막 지도 또는 이야기 장면', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
  if ((await g.state()).scenes.includes('StoryDialogue')) {
    assert.equal(expectIntro, true, '이미 본 장면이 다시 재생됨');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  }
  await g.until('사막 지도', MAP_READY);
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

test('5장 C5-1 ①(1280×720): 사막 입장 → 도입(동료 셋) → 새로고침(반복 없음) → 단서 길 → CH05_CLUES_JOINED → 새로고침 복원', async () => {
  const device = 'e2e-desert-1280';
  await backend.start(seedDesert(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'desert-c5-1', async () => {
    const before = dbOf(device);
    assert.deepEqual([before.checkpoint, before.growth], ['CH04_COMPLETE', 4]);
    await enterDesert(g);
    // 1) 도입: 끝까지 보면 CH05_STARTED, 초입에 동료 셋이 서 있다
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('사막 지도', MAP_READY);
    let db = dbOf(device);
    assert.equal(db.checkpoint, 'CH05_STARTED');
    assert.equal(once(db.events, 'desert_entry_seen'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '보상·성장 변화 없음');
    let s = await story(g);
    assert.equal(s.goalShown, GOAL_FOLLOW);
    assert.deepEqual(s.points, ['desert_clues'], '도입 뒤 단서 길만 표시됨');
    assert.deepEqual(s.gates, { gate_ridge_gap_1: false, gate_ridge_gap_2: false, gate_ridge_gap_3: false }, '능선의 틈은 모두 닫혀 있다');
    await g.capture('desert_01_after_intro');

    // 2) 새로고침: 도입이 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    assert.equal(dbOf(device).checkpoint, 'CH05_STARTED');

    // 3) 단서 길: 장면을 끝까지 보면 CH05_CLUES_JOINED, 목표가 능선 앞 전투로 바뀐다
    await interact(g, 'desert_clues', SPAWN_TO_CLUES, 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH05_CLUES_JOINED');
    assert.equal(once(db.events, 'desert_clues_seen'), 1);
    s = await story(g);
    assert.equal(s.goalShown, GOAL_SCORCHED);
    assert.ok(!s.points.includes('desert_ridge_pad'), '전투 승리 전 물들이 지점은 닫혀 있다');
    await g.capture('desert_02_after_clues');

    // 4) 새로고침: 복원, 단서 길 장면은 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    assert.deepEqual([dbOf(device).checkpoint, (await story(g)).goalShown], ['CH05_CLUES_JOINED', GOAL_SCORCHED]);
  }, backend, device);
  await g.close();
});

test('5장 C5-1 ②(640×360): 능선 앞 승리(시드) → 뜨거운 모래·아지랑이 → 물들이·폭신이·가느리가 틈을 차례로 잇는다 → 절단면(가위 그림자) → CH05_RIDGE_CROSSED → 새로고침 복원', async () => {
  const device = 'e2e-desert-640';
  await backend.start(seedDesert(device, 'won'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'desert-c5-1-small', async () => {
    assert.equal(dbOf(device).checkpoint, 'CH05_CLUES_JOINED');
    await enterDesert(g);
    await reachMap(g, false);
    let s = await story(g);
    assert.equal(s.goalShown, GOAL_PAD);
    assert.deepEqual(s.points, ['desert_ridge_pad']);
    assert.equal((await map(g)).hudMode, 'compact');
    // 능선 앞에서 시작(단서 길은 ①이 본다)
    backend.displace(device, pointOf('desert_scorched'));
    await g.reload();
    await reachMap(g, false);

    // 뜨거운 모래: 들어서면 0.7배 + 가장자리 열기 + 첫 안내. 아지랑이 가짜 길이 주기를 돈다
    for (const q of SCORCHED_TO_PAD.slice(0, -4)) await g.walkDirect('Map', q, 'joystick');
    await g.walkDirect('Map', { x: 2150, y: 1650 }, 'joystick');
    let m = await map(g);
    assert.deepEqual([m.inFrost, m.slowZone], [true, 'heat'], '뜨거운 모래 안');
    assert.ok(m.notices.some((n) => n.includes('뜨거운 모래')), `열기 안내: ${m.notices.join(' / ')}`);
    assert.deepEqual(m.mirages.map((x) => x.id), ['mirage_a', 'mirage_b']);
    await g.until('아지랑이가 떠오름', "s.map.mirages.some((x) => x.alpha > 0.5)", 6000);
    await g.capture('desert_s01_hot_sand');

    // 동료 셋: 틈 앞 지점에서 장면을 끝까지 보면 그 틈이 이어진다(체크포인트 유지)
    const legs: [string, Pt[], string][] = [
      ['desert_ridge_pad', SCORCHED_TO_PAD.slice(-4), 'gate_ridge_gap_1'],
      ['desert_ridge_scent', PAD_TO_SCENT, 'gate_ridge_gap_2'],
      ['desert_ridge_thread', SCENT_TO_THREAD, 'gate_ridge_gap_3'],
    ];
    for (const [id, route, gate] of legs) {
      await interact(g, id, route, 'joystick');
      s = await story(g);
      assert.equal(s.gates[gate], true, `${id} → ${gate} 열림`);
      assert.equal(dbOf(device).checkpoint, 'CH05_CLUES_JOINED', `${id}: 체크포인트 유지`);
    }
    await g.capture('desert_s02_gaps_open');

    // 절단면: 가위 그림자(플레이어에게만) → CH05_RIDGE_CROSSED, 목표는 금빛 마감실로
    await interact(g, 'desert_cut_face', THREAD_TO_CUT, 'joystick', glimpseShown('scissors-glimpse'));
    const db = dbOf(device);
    assert.equal(db.checkpoint, 'CH05_RIDGE_CROSSED');
    assert.deepEqual(['desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread', 'desert_ridge_crossed'].map((e) => once(db.events, e)), [1, 1, 1, 1]);
    assert.equal((await story(g)).goalShown, GOAL_LAST);

    // 새로고침: 복원, 장면 반복 없음, 틈은 모두 열려 있다
    await g.reload();
    await reachMap(g, false);
    s = await story(g);
    assert.deepEqual([dbOf(device).checkpoint, s.goalShown, s.gates], ['CH05_RIDGE_CROSSED', GOAL_LAST, { gate_ridge_gap_1: true, gate_ridge_gap_2: true, gate_ridge_gap_3: true }]);
  }, backend, device);
  await g.close();
});
