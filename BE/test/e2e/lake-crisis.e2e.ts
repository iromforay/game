// 10-13 C2-4: 누비 이름 망각 위기 — 위기 지점 → 색 빠짐 → 이름 망각 대사 → 완료(CH02_NUBI_CRISIS_SEEN), 중간 새로고침은 처음부터,
// 완료 뒤 새로고침은 장면 미반복, 640×360에서 효과가 대화창·이름표·HUD를 가리지 않는다. 상태(CH02_MAZE_CLEARED)는 테스트 격리 DB에 직접 준비한다.
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
const GOAL_BEFORE = '누비의 상태를 살피며 염색 샘으로 가자.';
const GOAL_AFTER = '누비를 지키기 위해 염색 샘으로 가자.';
const NAME = '하늘'; // seedForest 계정 닉네임
// 정착지 → 입구 문 → 홀 → 안전 물길 문(열림) → 위기 지점
const ROUTE = [{ x: 900, y: 1500 }, { x: 1265, y: 1350 }, { x: 1440, y: 1350 }, { x: 1440, y: 1100 }, { x: 1560, y: 1000 }, { x: 1900, y: 1000 }, { x: 2020, y: 1000 }, { x: 2040, y: 800 }, { x: 2400, y: 790 }, { x: 2370, y: 740 }, { x: 2370, y: 590 }, { x: 2370, y: 540 }];

type MapState = { avatar: { x: number; y: number }; story: { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; goalShown: string | null; interact: { x: number; y: number } } };
type Dlg = { waiting: boolean; line: string; fx: { drainPlayed: number; saturation: number; bounds: { x: number; y: number; w: number; h: number } | null } | null };
const map = async (g: Game) => (await g.state()).map as MapState;
const dlg = async (g: Game) => (await g.state()).dialogue as Dlg | undefined;
const eventsOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string);
};
const checkpointOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint;
};

async function enterLake(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('2장 — 호수', { exact: true });
  await g.until('호수 지도', MAP_READY, 30_000);
  assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
}
async function walkToCrisis(g: Game, how: 'keys' | 'joystick') {
  for (const p of ROUTE) await g.walkDirect('Map', p, how, 'false', 30);
  await g.until('위기 지점 안내', "s.map.story.prompt === 'lake_nubi_crisis' && !!s.map.story.promptText", 20_000);
}
async function startScene(g: Game) {
  const at = (await map(g)).story.interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
  await g.until('첫 서술', 's.dialogue && s.dialogue.waiting', 20_000);
}
// 다음 줄로 한 번 넘긴다(글자가 나오는 중이면 먼저 전부 표시)
async function nextLine(g: Game) {
  const before = (await dlg(g))!.line;
  for (let i = 0; i < 3; i++) {
    await g.click(640, 440);
    const moved = await g.page.waitForFunction((l) => { const d = (window as any).__dev.state().dialogue; return !d || d.line !== l; }, before, { timeout: 1500, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (moved) return;
  }
  throw new Error('대사가 넘어가지 않음');
}
async function playUntil(g: Game, pred: (line: string) => boolean, max = 20) {
  for (let i = 0; i < max; i++) {
    const d = await dlg(g);
    if (d && d.waiting && pred(d.line)) return;
    await nextLine(g);
  }
  throw new Error('원하는 대사에 도달하지 못함');
}

test('2장 C2-4 ①(1280×720): 위기 지점 → 색 빠짐 → 이름 망각 대사 → 완료 → 새로고침(장면 미반복·다음 목표)', async () => {
  const device = 'e2e-crisis-1280';
  await backend.start(seedLake(device, 'cleared'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-crisis-1280', async () => {
    await enterLake(g);
    let m = await map(g);
    assert.deepEqual(m.story.points, ['lake_nubi_crisis']);
    assert.equal(m.story.goalShown, GOAL_BEFORE);
    assert.equal(m.story.gates.gate_lake_safe_route, true, '열린 내부 문 복원');
    await walkToCrisis(g, 'keys');
    await startScene(g);
    // 색 빠짐: 대화 시작 직전에 오버레이 1회, 월드 채도 하락
    await g.until('색 빠짐 연출', 's.dialogue && s.dialogue.fx && s.dialogue.fx.drainPlayed === 1', 10_000);
    await g.capture('nubi_color_drain');
    await g.until('채도 하락', 's.dialogue.fx.saturation < 0.6', 5_000);
    assert.equal((await dlg(g))!.fx!.drainPlayed, 1);
    assert.equal(checkpointOf(device), 'CH02_MAZE_CLEARED', '장면 중에는 체크포인트 그대로');
    assert.ok(!eventsOf(device).includes('lake_nubi_crisis_seen'));
    // 이름 망각 대사(누비의 "네 이름이…… 생각나지 않아.")
    await playUntil(g, (l) => l.startsWith('네 이름이'));
    await g.until('글자 표시 완료', 's.dialogue && s.dialogue.typing === false', 10_000); // 타이핑이 끝난 전체 문장을 캡처한다
    await g.capture('name_forgotten_dialogue');
    // 끝까지 → 완료 요청(마지막 대사가 누락되지 않는다)
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(checkpointOf(device), 'CH02_NUBI_CRISIS_SEEN');
    assert.equal(eventsOf(device).filter((e) => e === 'lake_nubi_crisis_seen').length, 1);
    m = await map(g);
    assert.deepEqual(m.story.points, ['lake_boss_entrance'], '위기 지점은 사라지고 다음 지점(보스 입장)만 남는다');
    assert.equal(m.story.goalShown, GOAL_AFTER);

    // 완료 뒤 새로고침: 장면 미반복, 다음 목표만
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
    m = await map(g);
    assert.deepEqual(m.story.points, ['lake_boss_entrance']);
    assert.equal(m.story.goalShown, GOAL_AFTER);
    assert.equal(m.story.gates.gate_lake_safe_route, true);
  }, backend, device);
  await g.close();
});

test('2장 C2-4 ②: 장면 중간 새로고침 → 사건·체크포인트 미완료 → 처음부터 다시 → 완료', async () => {
  const device = 'e2e-crisis-reload';
  await backend.start(seedLake(device, 'cleared'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-crisis-reload', async () => {
    await enterLake(g);
    await walkToCrisis(g, 'keys');
    await startScene(g);
    await playUntil(g, (l) => l.startsWith('저기'));
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal(checkpointOf(device), 'CH02_MAZE_CLEARED');
    assert.ok(!eventsOf(device).includes('lake_nubi_crisis_seen'));
    assert.deepEqual((await map(g)).story.points, ['lake_nubi_crisis'], '같은 위기 지점에서 이어 본다');
    // 처음부터 다시: 첫 서술에서 시작하고 색 빠짐 연출이 다시 1회 재생된다
    await g.until('위기 지점 안내', "s.map.story.prompt === 'lake_nubi_crisis' && !!s.map.story.promptText", 20_000);
    await startScene(g);
    await g.until('색 빠짐 연출', 's.dialogue && s.dialogue.fx && s.dialogue.fx.drainPlayed === 1', 10_000);
    assert.ok((await dlg(g))!.line.startsWith('염색 샘에 가까워질수록'), `처음부터: ${(await dlg(g))!.line}`);
    // 빠르게 넘겨도 끝까지 완료 요청이 간다
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(checkpointOf(device), 'CH02_NUBI_CRISIS_SEEN');
    assert.equal(eventsOf(device).filter((e) => e === 'lake_nubi_crisis_seen').length, 1);
  }, backend, device);
  await g.close();
});

test('2장 C2-4 ③(640×360): 색 빠짐 효과가 대화창·이름표·HUD를 가리지 않고, {playerName}이 저장된 이름으로 읽힌다', async () => {
  const device = 'e2e-crisis-640';
  await backend.start(seedLake(device, 'cleared'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-crisis-640', async () => {
    await enterLake(g);
    await walkToCrisis(g, 'joystick');
    await startScene(g);
    await g.until('색 빠짐 연출', 's.dialogue && s.dialogue.fx && s.dialogue.fx.drainPlayed === 1 && s.dialogue.fx.bounds', 10_000);
    const b = (await dlg(g))!.fx!.bounds!;
    // 캔버스(1280×720) 좌표: 대화창 y≥488(이름표 y≥464), 건너뛰기 버튼 우상단(x≥1010,y<110) — 효과 영역과 겹치지 않는다
    assert.ok(b.y + b.h <= 464, `효과가 이름표·대화창 위에 있다: ${JSON.stringify(b)}`);
    assert.ok(b.x + b.w <= 1010 || b.y >= 110, '건너뛰기 버튼과 겹치지 않는다');
    assert.ok(b.x >= 0 && b.x + b.w <= 1280 && b.y >= 0);
    // 이름을 기억하는 대사: 저장된 이름으로 치환돼 읽힌다(토큰이 남지 않는다)
    await playUntil(g, (l) => l.includes('기억났어'));
    const line = (await dlg(g))!.line;
    assert.ok(line.startsWith(`${NAME}.`), `치환된 대사: ${line}`);
    assert.ok(!line.includes('{playerName}'));
    await g.until('채도 일부 안정화', 's.dialogue.fx.saturation > 0.5 && s.dialogue.fx.saturation < 0.9', 5_000);
    await g.until('글자 표시 완료', 's.dialogue && s.dialogue.typing === false', 10_000);
    await g.capture('name_remembered');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(checkpointOf(device), 'CH02_NUBI_CRISIS_SEEN');
  }, backend, device);
  await g.close();
});
