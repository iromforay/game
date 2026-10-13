// 10-13 C2-2: 물풀 미로 이동 규칙 — 열린 물풀문, 약한 물살, 마른 발판, 깊은 물 복귀, 재접속 복원, 플레이어별 독립.
// 물결북 반응 뒤 상태(CH02_SETTLEMENT_MET)를 테스트 격리 DB에 직접 준비한다(운영 UI에 순간이동·사건 주입은 없다).
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
const DEEP_TEXT = '깊은 물은 위험해. 물풀이 잔잔한 길로 가자.';
const GOAL_MAZE = '붙잡힌 물들이를 구하자. 0/3';
// 정착지 → 물풀문 → 물풀 미로 안 길(굽은 길이라 지름길은 없다: 벽을 피해 경유)
const TO_GATE = [{ x: 900, y: 1500 }, { x: 1265, y: 1350 }, { x: 1440, y: 1350 }];
const THROUGH_GATE = [{ x: 1440, y: 1100 }, { x: 1560, y: 1000 }];
const DRY_1 = { x: 2020, y: 1000 };

type MapState = {
  avatar: { x: number; y: number };
  currentPushes: number;
  deepReturns: number;
  lastCorrection: string | null;
  pushing: boolean;
  notices: string[];
  render: { gates: { id: string; open: boolean; art: string | null; placeholder: boolean }[]; overlays: string[] };
  story: { goalShown: string | null; gates: Record<string, boolean> };
};
const map = async (g: Game) => (await g.state()).map as MapState;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;

async function enterMaze(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('2장 — 호수', { exact: true });
  await g.until('호수 지도(이미 본 장면은 반복되지 않는다)', MAP_READY, 30_000);
  assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
}
async function walkVia(g: Game, points: { x: number; y: number }[], how: 'keys' | 'joystick', stop = 'false') {
  for (const p of points) await g.walkDirect('Map', p, how, stop, 30);
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;

test('2장 C2-2 ①(1280×720 키보드): 열린 물풀문 → 약한 물살 → 마른 발판 → 새로고침(열린 문·안전 위치 복원)', async () => {
  const device = 'e2e-maze-1280';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-maze-1280', async () => {
    await enterMaze(g);
    let m = await map(g);
    assert.equal(m.story.goalShown, GOAL_MAZE, `목표: ${m.story.goalShown}`);
    assert.equal(m.story.gates.gate_reed_maze, true, '물결북 반응 뒤 물풀문 개방');
    await walkVia(g, TO_GATE, 'keys');
    m = await map(g);
    const gate = m.render.gates.find((x) => x.id === 'gate_reed_maze')!;
    assert.deepEqual([gate.open, gate.art, gate.placeholder], [true, 'reed-gate-open', false]);
    await g.walkDirect('Map', { x: 1440, y: 1270 }, 'keys', 'false', 20); // 문 위쪽 그림 끝이 목표 패널 아래에 오는 자리
    await g.capture('reed_gate_open');
    // 문 통과 → 미로 안
    await walkVia(g, THROUGH_GATE, 'keys');
    m = await map(g);
    assert.ok(m.avatar.y < 1150, `문 너머(y ${m.avatar.y})`);
    assert.equal(m.currentPushes, 0, '물살 밖에서는 밀리지 않는다');
    assert.ok(m.render.overlays.includes('current-flow'), '물살 방향 그림');
    await g.capture('current_before_push');
    // 약한 물살: 키를 계속 누른 채 들어가면 한 번 밀리고, 입력은 이어진다
    await g.walkDirect('Map', { x: 1900, y: 1000 }, 'keys', 's.map.currentPushes >= 1', 20);
    await g.until('물살 적용', 's.map.currentPushes >= 1');
    await g.capture('current_after_push');
    m = await map(g);
    assert.equal(m.lastCorrection, 'current');
    assert.equal(m.deepReturns, 0);
    // 마른 발판 도착
    await g.walkDirect('Map', DRY_1, 'keys', 'false', 30);
    m = await map(g);
    assert.ok(near(m.avatar, DRY_1, 60), `마른 발판 도착: ${JSON.stringify(m.avatar)}`);
    assert.equal(m.deepReturns, 0, '깊은 물에 닿지 않았다');
    const stamp = m.avatar;

    // 새로고침: 열린 문과 마지막 승인 위치(안전한 곳)
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    m = await map(g);
    assert.equal(m.story.gates.gate_reed_maze, true);
    assert.equal(m.render.gates.find((x) => x.id === 'gate_reed_maze')!.art, 'reed-gate-open');
    assert.ok(near(m.avatar, stamp, 80), `복원 위치 ${JSON.stringify(m.avatar)} / 이전 ${JSON.stringify(stamp)}`);
    assert.equal(m.story.goalShown, GOAL_MAZE);
  }, backend, device);
  await g.close();
});

test('2장 C2-2 ②(640×360 조이스틱): 방향 단서 → 물살 뒤에도 입력 유지 → 깊은 물 복귀(안내 한 번)', async () => {
  const device = 'e2e-maze-640';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-maze-640', async () => {
    await enterMaze(g);
    await walkVia(g, [...TO_GATE, ...THROUGH_GATE], 'joystick');
    let m = await map(g);
    assert.ok(m.render.overlays.includes('current-flow'));
    assert.equal(m.currentPushes, 0);
    await g.capture('current_clue');
    // 입력을 유지한 채 물살을 지난다 — 한 번 밀린 뒤에도 마른 발판까지 계속 간다
    await g.walkDirect('Map', DRY_1, 'joystick', 'false', 30);
    m = await map(g);
    assert.ok(m.currentPushes >= 1 && m.currentPushes <= 2, `물살 적용 ${m.currentPushes}회`);
    assert.ok(near(m.avatar, DRY_1, 60), `발판 도착 ${JSON.stringify(m.avatar)}`);
    // 깊은 물(남쪽 연못)로 걸어 들어간다 → 마지막 안전 지점으로 복귀
    await g.walkDirect('Map', { x: 2220, y: 1000 }, 'joystick', 's.map.deepReturns >= 1', 20);
    await g.until('깊은 물 복귀', 's.map.deepReturns >= 1');
    m = await map(g);
    assert.equal(m.lastCorrection, 'deep_water');
    assert.ok(near(m.avatar, DRY_1, 80), `안전 지점으로 복귀 ${JSON.stringify(m.avatar)}`);
    assert.ok((await texts(g)).some((t) => t.includes(DEEP_TEXT)), '복귀 안내 문구');
    await g.capture('deep_water_return');
    // 같은 안내는 다시 띄우지 않는다
    await g.page.waitForTimeout(500);
    await g.walkDirect('Map', { x: 2220, y: 1000 }, 'joystick', 's.map.deepReturns >= 2', 20);
    await g.until('두 번째 복귀', 's.map.deepReturns >= 2');
    m = await map(g);
    assert.equal(m.notices.filter((t) => t === DEEP_TEXT).length, 1, '깊은 물 안내는 한 탐험 세션에 한 번');
  }, backend, device);
  await g.close();
});

test('2장 C2-2 ③: 두 플레이어가 같은 물살·깊은 물에서 서로 독립적으로 판정된다', async () => {
  const a = 'e2e-maze-pa';
  const b = 'e2e-maze-pb';
  await backend.start((db) => {
    seedLake(a, 'maze')(db);
    seedLake(b, 'maze')(db);
  }, { 'story.stageAccessV2': true });
  const ga = await Game.open(browser, `${vite.url}/?device=${a}`, a);
  const gb = await Game.open(browser, `${vite.url}/?device=${b}`, b);
  try {
    await Promise.all([enterMaze(ga), enterMaze(gb)]);
    await Promise.all([walkVia(ga, [...TO_GATE, ...THROUGH_GATE], 'keys'), walkVia(gb, [...TO_GATE, ...THROUGH_GATE], 'keys')]);
    // 같은 물살을 동시에 지난다 — 각자 한 번씩 밀린다
    await Promise.all([ga.walkDirect('Map', DRY_1, 'keys', 'false', 30), gb.walkDirect('Map', DRY_1, 'keys', 'false', 30)]);
    const [ma, mb] = [await map(ga), await map(gb)];
    assert.ok(ma.currentPushes >= 1 && mb.currentPushes >= 1, `각자 적용: ${ma.currentPushes}/${mb.currentPushes}`);
    assert.ok(near(ma.avatar, DRY_1, 60) && near(mb.avatar, DRY_1, 60));
    // A만 깊은 물에 들어간다 — B의 위치·상태는 그대로
    const before = await map(gb);
    await ga.walkDirect('Map', { x: 2220, y: 1000 }, 'keys', 's.map.deepReturns >= 1', 20);
    await ga.until('A 깊은 물 복귀', 's.map.deepReturns >= 1');
    const after = await map(gb);
    assert.equal(after.deepReturns, 0);
    assert.deepEqual(after.avatar, before.avatar, 'B는 그대로 서 있다');
    assert.equal((await map(ga)).deepReturns, 1);
  } finally {
    await ga.close();
    await gb.close();
  }
});
