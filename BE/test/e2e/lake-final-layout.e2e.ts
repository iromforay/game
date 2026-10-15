// 10-14 C2-7B: 최종 호수 배경에 맞춘 좌표·충돌 정합화 — 실제 이동으로 처음부터 끝까지 도달하고, 구 좌표 저장값은 안전 앵커로 복구된다.
// ① 1280×720: 입구 → 정착지 → 물결북·구조 3곳 → 안전 물길(문 닫힘·열림) → 누비 위기 → 보스 입구, 일반/디버그 캡처
// ② 640×360: 미로·안전 물길 안에서 옛 좌표 저장값으로 재접속 → 안전 앵커 복구 → 다음 목표 도달
// 전투·장면·보상은 다시 검증하지 않는다: 필요한 진행 상태는 승인된 테스트 시드(Backend.grantEvents)로 앞당긴다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedLake } from './fixtures';
import { C_TO_SAFE_ROUTE, JUNCTION_TO, JUNCTION_TO_SAFE_ROUTE, ROUTE_TO_JUNCTION, ROUTE_TO_POINT, THROUGH_GATE, THROUGH_SAFE_GATE, TO_BOSS, TO_GATE_FRONT, type Pt } from '../helpers/lake-route';

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
const BEFORE_C = ['lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened'];
const RESCUED_ALL = ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued'];

type MapState = { avatar: Pt; deepReturns: number; lastCorrection: string | null; story: { points: string[]; prompt: string | null; promptText: string | null; gates: Record<string, boolean>; goalShown: string | null } };
const map = async (g: Game) => (await g.state()).map as MapState;
const via = async (g: Game, pts: Pt[], how: 'keys' | 'joystick', stop = 'false') => {
  for (const p of pts) await g.walkDirect('Map', p, how, stop, 30);
};
const near = (a: Pt, b: Pt, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;
const reversed = (list: Pt[], from: Pt): Pt[] => [...list].reverse().slice(1).concat([from]);

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
// 벽·깊은 물에 끼이거나 서버가 되돌리지 않았는가
async function assertNoStuck(g: Game, where: string) {
  const m = await map(g);
  assert.equal(m.deepReturns, 0, `${where}: 깊은 물 복귀 없음`);
  assert.ok(m.lastCorrection === null || m.lastCorrection === 'current', `${where}: 서버 보정 ${m.lastCorrection}`);
}
async function promptAt(g: Game, id: string) {
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
}
const withDebug = async (g: Game, name: string) => {
  await g.page.evaluate(() => (window as any).__dev.collisionDebug(true)); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.capture(`collision_${name}`);
  await g.page.evaluate(() => (window as any).__dev.collisionDebug(false)); // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('2장 C2-7B ①(1280×720): 입구 → 정착지 → 구조 3곳 → 안전 물길 → 누비 위기 → 보스 입구를 실제 이동으로 끼임 없이 도달', async () => {
  const device = 'e2e-layout-1280';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-layout-1280', async () => {
    await enterLake(g);
    // 입구: 스폰은 길 위(서버 값)
    let m = await map(g);
    assert.ok(near(m.avatar, { x: 350, y: 1981 }, 12), `스폰 ${JSON.stringify(m.avatar)}`);
    await g.capture('entrance');
    await withDebug(g, 'entrance');

    // 정착지: 물들이·물결북 지점에 닿는다
    await via(g, ROUTE_TO_POINT.lake_mulduri, 'joystick');
    // 시드는 물결북 반응 뒤 상태라 물들이 지점은 닫혀 있다 — 지점 좌표 가까이 걸어갔는지로 확인한다
    assert.ok(near((await map(g)).avatar, { x: 867, y: 1109 }, 80), `정착지 물들이 자리 ${JSON.stringify((await map(g)).avatar)}`);
    await assertNoStuck(g, '정착지');
    await g.capture('settlement');
    await withDebug(g, 'settlement');

    // 물풀문(열림) → 갈림길 → 구조 b·a·c 지점마다 구조 안내가 뜬다
    await via(g, [...TO_GATE_FRONT, ...THROUGH_GATE], 'joystick');
    m = await map(g);
    assert.equal(m.story.gates.gate_reed_maze, true);
    await assertNoStuck(g, '물풀문 통과');
    let from: Pt = ROUTE_TO_JUNCTION[ROUTE_TO_JUNCTION.length - 1];
    for (const k of ['b', 'a', 'c'] as const) {
      await via(g, JUNCTION_TO[k], 'joystick');
      await promptAt(g, `lake_rescue_${k}`);
      await assertNoStuck(g, `구조 ${k}`);
      if (k === 'a') {
        await g.capture('maze_rescue');
        await withDebug(g, 'maze');
      }
      from = JUNCTION_TO[k][JUNCTION_TO[k].length - 1];
      if (k !== 'c') await via(g, reversed(JUNCTION_TO[k], ROUTE_TO_JUNCTION[ROUTE_TO_JUNCTION.length - 1]), 'joystick');
    }
    assert.ok(near((await map(g)).avatar, from, 80));

    // 세 구조 끝(시드) → 재접속 → 안전 물길 지점
    backend.grantEvents(device, RESCUED_ALL);
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    m = await map(g);
    assert.ok(m.story.points.includes('lake_safe_route'), '안전 물길 지점이 열린다');
    assert.ok(near(m.avatar, from, 120), `재접속 위치 ${JSON.stringify(m.avatar)}`);
    await via(g, C_TO_SAFE_ROUTE, 'joystick');
    await promptAt(g, 'lake_safe_route');
    await assertNoStuck(g, '안전 물길 지점');
    await g.capture('safe_route');
    await withDebug(g, 'safe_route');
  }, backend, device);
  await g.close();
});

// ①은 한 시험이 5분을 넘지 않도록 안전 물길 지점에서 둘로 나눴다. ①-2는 세 구조가 끝난 시드에서 안전 물길 지점으로 옮겨 시작한다
test('2장 C2-7B ①-2(1280×720): 닫힌 안전 물길 문 → 개방 → 누비 위기 → 보스 입구를 실제 이동으로 끼임 없이 도달', async () => {
  const device = 'e2e-layout-1280b';
  await backend.start(seedLake(device, 'maze', ['a', 'b', 'c']), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-layout-1280b', async () => {
    backend.grantEvents(device, RESCUED_ALL);
    await enterLake(g);
    backend.displace(device, C_TO_SAFE_ROUTE[C_TO_SAFE_ROUTE.length - 1]);
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    await promptAt(g, 'lake_safe_route');
    // 안전 물길 문은 열리기 전에는 통과할 수 없다(문에 막혀 닿지 못하는 것이 정상이라 4초만 밀어 본다)
    await g.page.evaluate(() => { (window as any).__stopAt = Date.now() + 4000; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.walkDirect('Map', { x: 2330, y: 500 }, 'joystick', 'Date.now() > window.__stopAt', 30);
    let m = await map(g);
    assert.ok(m.avatar.x < 2270, `닫힌 안전 물길 문 앞에서 멈춘다(x ${m.avatar.x})`);

    // 안전 물길 개방(시드) → 재접속 → 누비 위기 지점 → 위기 장면 끝(시드) → 보스 입구
    backend.grantEvents(device, ['lake_safe_route_opened'], 'CH02_MAZE_CLEARED');
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal((await map(g)).story.gates.gate_lake_safe_route, true);
    await via(g, THROUGH_SAFE_GATE, 'joystick');
    await promptAt(g, 'lake_nubi_crisis');
    await assertNoStuck(g, '누비 위기');
    backend.grantEvents(device, ['lake_nubi_crisis_seen'], 'CH02_NUBI_CRISIS_SEEN');
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    await via(g, TO_BOSS, 'joystick');
    await promptAt(g, 'lake_boss_entrance');
    await assertNoStuck(g, '보스 입구');
    await g.capture('dye_spring');
    await withDebug(g, 'dye_spring');
  }, backend, device);
  await g.close();
});

test('2장 C2-7B ②(640×360): 미로·안전 물길 안에서 옛 좌표 저장값으로 재접속하면 안전 앵커로 복구되고 다음 목표에 도달한다', async () => {
  const device = 'e2e-layout-640';
  await backend.start(seedLake(device, 'cleared'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-layout-640', async () => {
    await enterLake(g);
    await via(g, ROUTE_TO_JUNCTION, 'joystick');
    await assertNoStuck(g, '미로 입구');
    await g.capture('maze');
    // 미로 안: 옛 기능 맵의 좌표(문 앞 안뜰 (1265,1350))에 저장된 상태로 재접속 → 서버가 안전 앵커로 복구
    backend.displace(device, { x: 1265, y: 1350 });
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    let m = await map(g);
    assert.ok(near(m.avatar, { x: 1440, y: 1039 }, 70), `미로 안전 앵커(anchor_maze_entry) 복구 ${JSON.stringify(m.avatar)}`);
    // 복구 위치에서 안전 물길 지점까지 걸어간다
    await via(g, [{ x: 1556, y: 1012 }, ...JUNCTION_TO_SAFE_ROUTE], 'joystick');
    await assertNoStuck(g, '안전 물길');
    // 안전 물길 안: 옛 좌표(안전 물길 문 아래 (2370,700))에 저장된 상태 → 안전 앵커 복구 → 누비 위기 지점
    backend.displace(device, { x: 2370, y: 700 });
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    m = await map(g);
    // 이 플레이어가 마지막으로 밟은 앵커(안전 물길 안 마른 발판 2)가 우선이고, 거기서 위기 지점으로 걸어간다
    assert.ok(near(m.avatar, { x: 1846, y: 638 }, 70) || near(m.avatar, { x: 2380, y: 511 }, 70), `안전 앵커 복구 ${JSON.stringify(m.avatar)}`);
    await via(g, [...JUNCTION_TO_SAFE_ROUTE.filter((q) => q.x >= 1840), ...THROUGH_SAFE_GATE], 'joystick');
    await promptAt(g, 'lake_nubi_crisis');
    await assertNoStuck(g, '누비 위기');
    await via(g, TO_BOSS, 'joystick');
    // 위기 장면을 아직 보지 않았으므로 보스 입구 지점은 열려 있지 않지만, 입구까지 걸어갈 수 있다
    m = await map(g);
    assert.ok(near(m.avatar, { x: 2828, y: 404 }, 60), `염색 샘 도달 ${JSON.stringify(m.avatar)}`);
    await g.capture('dye_spring');
  }, backend, device);
  await g.close();
});
