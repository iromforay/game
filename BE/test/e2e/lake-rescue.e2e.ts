// 10-13 C2-3: 물풀 미로 구조 — 젖은 실밥이 전투 → 덫 제거·구조 → 1/3, 부분 진행 새로고침, 세 구조 → 정본 장면 → 안전 물길 → CH02_MAZE_CLEARED,
// 640×360 HUD, 두 플레이어 독립. 물결북 반응 뒤 상태(CH02_SETTLEMENT_MET)와 일부 구조 상태는 테스트 격리 DB에 직접 준비한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedLake } from './fixtures';

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

const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const BATTLE_SCENES = "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')";
const RESCUE_PROMPT = '붙잡힌 물들이 구하기';
// 정착지 → 입구 문 → 미로 홀 (굽은 길이라 경유지를 지난다). 구조 지점별 접근 경유지
const TO_HALL = [{ x: 900, y: 1500 }, { x: 1265, y: 1350 }, { x: 1440, y: 1350 }, { x: 1440, y: 1100 }];
const ROUTE_TO: Record<string, { x: number; y: number }[]> = {
  a: [{ x: 1560, y: 1000 }, { x: 1900, y: 1000 }, { x: 1990, y: 1020 }],
  b: [{ x: 1560, y: 900 }, { x: 1600, y: 830 }],
  c: [{ x: 1560, y: 1000 }, { x: 1900, y: 1000 }, { x: 2020, y: 1000 }, { x: 2040, y: 800 }, { x: 2400, y: 790 }, { x: 2440, y: 880 }],
};
const SAFE_ROUTE = { x: 2465, y: 760 };

type MapState = {
  avatar: { x: number; y: number };
  currentPushes: number;
  deepReturns: number;
  trapSnares: number;
  hudMode: string;
  joystickZone: { x: number; y: number; w: number; h: number };
  goalHeight: number;
  render: { overlays: string[]; overlayPlans: { id: string; assetKey: string; x: number; y: number; width: number; height: number }[] };
  story: { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; goalShown: string | null; interact: { x: number; y: number }; interactRect: { x: number; y: number; w: number; h: number } };
};
const map = async (g: Game) => (await g.state()).map as MapState;
const eventsOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string);
};
const checkpointOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint;
};
const rescued = (k: string) => `lake_trapped_mulduri_${k}_rescued`;

async function enterLake(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('2장 — 호수', { exact: true });
  await g.until('호수 지도', MAP_READY, 30_000);
}
async function via(g: Game, pts: { x: number; y: number }[], how: 'keys' | 'joystick') {
  for (const p of pts) await g.walkDirect('Map', p, how, 'false', 30);
}
async function goTo(g: Game, k: string, how: 'keys' | 'joystick') {
  await via(g, [...TO_HALL, ...ROUTE_TO[k]], how);
  await g.until(`${k} 구조 안내 버튼`, `s.map.story.prompt === 'lake_rescue_${k}' && !!s.map.story.promptText`, 20_000);
}
// 구조 버튼 → (대화 화면) → 파티 선택 → 전투 → 결과 → 지도. 전투 중 화면은 onBattle로 캡처한다
async function fightRescue(g: Game, onBattle?: () => Promise<void>) {
  const at = (await map(g)).story.interact;
  await g.clickAt(at.x, at.y, BATTLE_SCENES);
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle");
  await onBattle?.();
  const b = await g.playBattle(240_000);
  assert.equal(b.outcome, 'win');
  await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
  await g.clickResult("s.scenes.includes('StoryDialogue') || (s.scenes.includes('Map') && !s.scenes.includes('Battle'))");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY, 30_000);
}

test('2장 C2-3 ①(1280×720): 구조 A 전투 → 덫 제거 → 물들이 구조 → 1/3 → 새로고침(A 유지, B/C 미완료)', async () => {
  const device = 'e2e-rescue-1280';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-rescue-1280', async () => {
    await enterLake(g);
    let m = await map(g);
    assert.deepEqual([...m.story.points].sort(), ['lake_rescue_a', 'lake_rescue_b', 'lake_rescue_c']);
    assert.equal(m.story.goalShown, '붙잡힌 물들이를 구하자. 0/3');
    await goTo(g, 'a', 'keys');
    m = await map(g);
    assert.equal(m.story.promptText, RESCUE_PROMPT);
    // 구조 전: 덫·수호 적 그림이 서버 화면 데이터로 내려와 있다
    for (const id of ['overlay_trap_a', 'overlay_guard_a1']) assert.ok(m.render.overlayPlans.some((o) => o.id === id), id);
    const trap = m.render.overlayPlans.find((o) => o.id === 'overlay_trap_a')!;
    assert.ok(trap.width >= 92 && trap.width <= 128 && trap.height >= 62 && trap.height <= 86);
    await g.capture('rescue_before');
    await fightRescue(g, async () => {
      await g.capture('wet_stitchling_battle');
    });
    m = await map(g);
    assert.ok(eventsOf(device).includes(rescued('a')), '구조 사건 기록');
    assert.equal(eventsOf(device).filter((e) => e === rescued('a')).length, 1);
    assert.equal(checkpointOf(device), 'CH02_SETTLEMENT_MET');
    assert.deepEqual([...m.story.points].sort(), ['lake_rescue_b', 'lake_rescue_c'], '구조한 지점은 목표 마커에서 사라진다');
    assert.equal(m.story.goalShown, '붙잡힌 물들이를 구하자. 1/3');
    for (const id of ['overlay_trap_a', 'overlay_guard_a1']) assert.equal(m.render.overlayPlans.some((o) => o.id === id), false, `${id}가 남음`);
    await g.capture('rescue_after_1of3');

    // 새로고침: A 유지, B/C 미완료, 같은 전투가 다시 시작되지 않는다
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    m = await map(g);
    assert.deepEqual([...m.story.points].sort(), ['lake_rescue_b', 'lake_rescue_c']);
    assert.equal(m.story.goalShown, '붙잡힌 물들이를 구하자. 1/3');
    assert.equal((await g.state()).scenes.includes('Battle'), false);
  }, backend, device);
  await g.close();
});

test('2장 C2-3 ②(1280×720): 세 구조 → 정본 장면(끊기면 처음부터) → 내부 안전 물길 개방 → CH02_MAZE_CLEARED → 재접속 유지', async () => {
  const device = 'e2e-rescue-clear';
  await backend.start(seedLake(device, 'maze', ['a', 'b']), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-rescue-clear', async () => {
    await enterLake(g);
    let m = await map(g);
    assert.deepEqual(m.story.points, ['lake_rescue_c']);
    assert.equal(m.story.goalShown, '붙잡힌 물들이를 구하자. 2/3');
    await goTo(g, 'c', 'keys');
    await fightRescue(g);
    assert.ok(eventsOf(device).includes('lake_trapped_turbies_rescued'));
    assert.equal(eventsOf(device).filter((e) => e === 'lake_trapped_turbies_rescued').length, 1);
    assert.equal(checkpointOf(device), 'CH02_SETTLEMENT_MET', '장면 전에는 체크포인트 그대로');
    assert.ok(!eventsOf(device).includes('lake_safe_route_opened'));
    m = await map(g);
    assert.deepEqual(m.story.points, ['lake_safe_route'], '안전 물길 지점이 열린다');
    assert.equal(m.story.goalShown, '열린 물길의 기계음을 확인하자.');
    assert.equal(m.story.gates.gate_lake_safe_route, false);

    // 장면: 중간에 새로고침하면 처음부터 다시 볼 수 있고, 아무것도 완료 처리되지 않았다
    await via(g, [{ x: 2440, y: 850 }, SAFE_ROUTE], 'keys');
    await g.until('안전 물길 안내', "s.map.story.prompt === 'lake_safe_route' && !!s.map.story.promptText", 20_000);
    const at = (await map(g)).story.interact;
    await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
    await g.until('장면 시작', "s.dialogue && s.dialogue.waiting", 20_000);
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal(checkpointOf(device), 'CH02_SETTLEMENT_MET');
    assert.ok(!eventsOf(device).includes('lake_safe_route_opened'));
    m = await map(g);
    assert.deepEqual(m.story.points, ['lake_safe_route'], '장면 미완료: 같은 지점에서 이어 본다');
    // 다시 시작해 끝까지 본다 → 안전 물길 개방 + CH02_MAZE_CLEARED
    await g.until('안전 물길 안내', "s.map.story.prompt === 'lake_safe_route' && !!s.map.story.promptText", 20_000);
    const at2 = (await map(g)).story.interact;
    await g.clickAt(at2.x, at2.y, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 준비', MAP_READY, 30_000);
    await g.until('개방', "s.map.story.gates.gate_lake_safe_route === true", 20_000);
    assert.equal(checkpointOf(device), 'CH02_MAZE_CLEARED');
    assert.equal(eventsOf(device).filter((e) => e === 'lake_safe_route_opened').length, 1);
    m = await map(g);
    assert.equal(m.story.goalShown, '누비의 상태를 살피며 염색 샘으로 가자.');
    assert.deepEqual(m.story.points, ['lake_nubi_crisis'], '다음 지점: 누비 위기 지점(C2-4)');
    await g.capture('safe_route_open');

    // 재접속: 열린 안전 물길·구조 상태 유지, 다음 목표
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    m = await map(g);
    assert.equal(m.story.gates.gate_lake_safe_route, true);
    assert.deepEqual(m.story.points, ['lake_nubi_crisis']);
    assert.equal(m.story.goalShown, '누비의 상태를 살피며 염색 샘으로 가자.');
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '완료한 장면은 반복되지 않는다');
  }, backend, device);
  await g.close();
});

test('2장 C2-3 ③(640×360 조이스틱): 구조 버튼·목표 패널·조이스틱 영역이 겹치지 않고 전투 HUD가 작은 배치로 동작한다', async () => {
  const device = 'e2e-rescue-640';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-rescue-640', async () => {
    await enterLake(g);
    await goTo(g, 'b', 'joystick');
    const m = await map(g);
    const r = m.story.interactRect;
    assert.equal(m.hudMode, 'compact');
    assert.ok(r.y + r.h <= m.joystickZone.y, '구조 버튼은 조이스틱 영역 위');
    assert.ok(r.y >= m.goalHeight, '구조 버튼이 목표 패널과 겹치지 않는다');
    assert.ok(r.h * 0.5 >= 40 && r.w * 0.5 >= 200, `실제 화면 크기 ${r.w * 0.5}×${r.h * 0.5}`);
    assert.equal(m.story.promptText, RESCUE_PROMPT);
    await g.capture('rescue_interaction');
    await fightRescue(g, async () => {
      await g.until('전투 HUD 작은 배치', "s.battle && s.battle.hudMode === 'compact'");
    });
    assert.ok(eventsOf(device).includes(rescued('b')));
    assert.equal((await map(g)).story.goalShown, '붙잡힌 물들이를 구하자. 1/3');
  }, backend, device);
  await g.close();
});

test('2장 C2-3 ④: 두 플레이어의 전투와 구조 진행이 독립이고 각자 체크포인트를 가진다', async () => {
  const a = 'e2e-rescue-pa';
  const b = 'e2e-rescue-pb';
  await backend.start((db) => {
    seedLake(a, 'maze')(db);
    seedLake(b, 'maze', ['a', 'b', 'c'])(db);
  }, { 'story.stageAccessV2': true });
  const ga = await Game.open(browser, `${vite.url}/?device=${a}`, a);
  const gb = await Game.open(browser, `${vite.url}/?device=${b}`, b);
  try {
    await Promise.all([enterLake(ga), enterLake(gb)]);
    // A 플레이어는 A 지점 전투를 하고, B 플레이어(세 구조 완료)는 안전 물길 장면을 본다 — 동시에
    await Promise.all([
      (async () => {
        await goTo(ga, 'a', 'keys');
        await fightRescue(ga);
      })(),
      (async () => {
        await via(gb, [...TO_HALL, ...ROUTE_TO.c, { x: 2440, y: 850 }, SAFE_ROUTE], 'keys');
        await gb.until('안전 물길 안내', "s.map.story.prompt === 'lake_safe_route' && !!s.map.story.promptText", 20_000);
        const at = (await map(gb)).story.interact;
        await gb.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
        await gb.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
        await gb.until('개방', "s.map.story.gates.gate_lake_safe_route === true", 20_000);
      })(),
    ]);
    assert.deepEqual([checkpointOf(a), checkpointOf(b)], ['CH02_SETTLEMENT_MET', 'CH02_MAZE_CLEARED']);
    assert.ok(eventsOf(a).includes(rescued('a')));
    assert.ok(!eventsOf(a).includes('lake_trapped_turbies_rescued') && !eventsOf(a).includes('lake_safe_route_opened'));
    assert.deepEqual([...(await map(ga)).story.points].sort(), ['lake_rescue_b', 'lake_rescue_c']);
    assert.deepEqual((await map(gb)).story.points, ['lake_nubi_crisis']);
  } finally {
    await ga.close();
    await gb.close();
  }
});
