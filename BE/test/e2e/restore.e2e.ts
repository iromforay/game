// 10-02 v5 §7: 야생 조우의 벽 가로막힘, 잘못된 위치의 스토리 전투 요청, 새로고침 뒤 Map 화면 복원, 유예 만료 뒤 마을 복귀.
// 실제 Nest 앱(FakeDb) + 실제 게임 클라이언트 + 실제 Chrome. 이동은 실제 키·조이스틱 입력.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import type { FakeDb } from '../helpers/fake-prisma';
import { E2E, SPAWN as GEO_SPAWN, HIDDEN_INSIDE, WIND_GATE, ROOT_GATE, WIND_FRONT, ROOT_FRONT, KNOT } from '../helpers/forest-geo';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedForest } from './fixtures';

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
const SPAWN = GEO_SPAWN;
const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story && s.map.story.greybox === false';
type MapState = { avatar: { x: number; y: number }; positioned: boolean; corrections: number; unreachableWilds: number; room: string | null; goal: boolean; hudMode: string; story: { objects: string[]; gates: Record<string, boolean>; objective: { collected: number } | null; interact: { x: number; y: number } } };
const mapOf = async (g: Game) => (await g.state()).map as MapState;
const dust = (n: number) => `forest_dust_${String(n).padStart(2, '0')}`;

async function enterForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 지도·서버 위치 배치', READY);
}
async function serverCatchesUp(g: Game, device: string) {
  const until = Date.now() + 5000;
  for (;;) {
    const a = (await mapOf(g)).avatar;
    const s = backend.serverPosition(device)!;
    if (Math.hypot(a.x - s.x, a.y - s.y) <= 2) return s;
    if (Date.now() > until) throw new Error(`기다리던 상태가 오지 않음: 서버 위치 ${JSON.stringify(s)} ≠ 화면 ${JSON.stringify(a)}`);
    await g.page.waitForFunction(() => true, null, { polling: 100 });
  }
}
// 야생 3번: 시작 지점 바로 위, 그 아래에 시험이 덧붙인 얇은 울타리(최종 지도에는 울타리가 없다)
const withWild3 = (seed: (db: FakeDb) => void) => (db: FakeDb) => {
  seed(db);
  db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 3, character_code: 'bopuli', x: E2E.fenceWild.x, y: E2E.fenceWild.y });
};

test('복원 ①: 울타리 너머의 야생에 다가가도 전투가 시작되지 않고(서버 거부, 다시 묻는 간격 있음), 울타리를 돌아 다가가면 전투가 시작된다', async () => {
  const device = 'e2e-wild-wall';
  await backend.start(withWild3(seedForest(device, 'rescued')));
  backend.patchStage('forest', (d) => d.layout!.blockers.push(E2E.fence));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-wild-wall', async () => {
    await enterForest(g);
    // 울타리 쪽으로 계속 밀어 붙는다(클라이언트 충돌로 울타리 아래에서 멈춤 — 야생까지 60px 안)
    await g.page.keyboard.down('ArrowUp');
    try {
      await g.until('울타리에 닿음', `s.map.avatar.y <= ${E2E.fence.y + E2E.fence.height + 20}`);
      await g.until('서버가 조우를 거부', 's.map.unreachableWilds >= 1');
      const t0 = Date.now();
      await g.until('다시 확인(간격을 두고)', 's.map.unreachableWilds >= 2');
      assert.ok(Date.now() - t0 >= 1000, `거부된 야생을 매 프레임 묻지 않는다(다시 묻기까지 ${Date.now() - t0}ms)`);
    } finally {
      await g.page.keyboard.up('ArrowUp');
    }
    const st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect') && !st.scenes.includes('Battle'), '전투가 시작되지 않음');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === 3)!.state, 'free', '야생 상태도 그대로');
    assert.ok(g.net.filter((n) => n.kind === 'socket' && n.what.includes('battle:start')).length <= 4, '요청이 쌓이지 않는다');
    await g.capture('01_wild_behind_fence_no_encounter');

    // 울타리를 돌아 위쪽에서 다가가면 정상 조우
    await g.walkDirect('Map', { x: SPAWN.x + 130, y: SPAWN.y }, 'keys');
    await g.walkDirect('Map', { x: SPAWN.x + 130, y: SPAWN.y - 100 }, 'keys');
    await g.walkDirect('Map', { x: SPAWN.x + 30, y: SPAWN.y - 100 }, 'keys', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    await g.until('전투 시작', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === 3)!.state, 'engaged');
    await g.capture('02_wild_reached_around_fence_encounter');
  }, backend, device);
  await g.close();
});

test('복원 ②: 지점에서 멀리 떨어진 곳에서 스토리 전투를 직접 요청하면 거부된다(전투 없음, 화면 그대로)', async () => {
  const device = 'e2e-story-far';
  await backend.start(seedForest(device, 'cut'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-story-far', async () => {
    await enterForest(g);
    const res = (await g.page.evaluate(() => (window as any).__dev.rawRequest('battle:story:start', { encounterKey: 'forest_stitchling_ambush' }))) as { ok: boolean; code: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([res.ok, res.code], [false, 'STORY_EVIDENCE_INVALID']);
    const st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect') && !st.scenes.includes('Battle'));
    assert.deepEqual((await mapOf(g)).avatar, SPAWN);
    await g.capture('03_story_battle_request_rejected_far_from_point');
  }, backend, device);
  await g.close();
});

test('복원 ③: 숲을 걷다 새로고침 → 같은 탐험 세션의 Map·같은 자리·실가루 5/10 그대로, 복원 뒤 이동과 수집이 이어진다', async () => {
  const device = 'e2e-restore-map';
  await backend.start(seedForest(device, 'rescued', [1, 3, 7, 8, 9].map(dust)));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-map', async () => {
    await enterForest(g);
    await g.walkTo('Map', E2E.trunkNorth, 'keys');
    const before = await serverCatchesUp(g, device);
    const room = backend.session(device)!.code;
    assert.notDeepEqual(before, SPAWN);
    await g.until('목표 5/10', "s.map.goal === true && window.__dev.texts().includes('빛나는 실가루 모으기 5/10')");
    await g.capture('04_map_position_before_reload');

    await g.reload();
    await g.until('Map 복원', READY);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, backend.serverPosition(device), backend.session(device)!.code], [before, before, room], '같은 자리·같은 세션(새 탐험 세션이 만들어지지 않음)');
    assert.deepEqual([m.story.objective?.collected, m.story.objects.length], [5, 5]);
    await g.until('목표 5/10 복원', "s.map.goal === true && window.__dev.texts().includes('빛나는 실가루 모으기 5/10')");
    assert.ok(!(await g.state()).scenes.includes('Village'), '마을을 거치지 않는다');
    await g.capture('05_map_restored_same_position');
    await g.capture('06_dust_5_of_10_restored');

    // 복원 뒤: 걸어가서 하나 더 줍는다(6/10)
    await g.walkTo('Map', { x: 1397, y: 1050 }, 'keys', `s.map.story.prompt === '${dust(2)}'`);
    await g.until('안내 버튼', `s.map.story.prompt === '${dust(2)}'`);
    m = await mapOf(g);
    await g.clickAt(m.story.interact.x, m.story.interact.y, `!s.map.story.objects.includes('${dust(2)}')`);
    await g.until('6/10', 's.map.story.objective.collected === 6');
    assert.equal(m.corrections, 0, '복원 뒤 정상 이동에는 서버 보정이 없다');
  }, backend, device);
  await g.close();
});

test('복원 ④: 닫힌 숨은 길 문 앞에서 새로고침 → 문 앞 그대로, 문은 여전히 닫혀 있고 지나갈 수 없다', async () => {
  const device = 'e2e-restore-gate';
  await backend.start(seedForest(device, 'compass'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-gate', async () => {
    await enterForest(g);
    await g.walkTo('Map', WIND_FRONT, 'keys');
    const front = await serverCatchesUp(g, device);
    await g.reload();
    await g.until('Map 복원', READY);
    const m = await mapOf(g);
    assert.deepEqual([m.avatar, m.story.gates], [front, { gate_hidden_path: false }]);
    await g.capture('07_closed_gate_restored');
    await g.page.keyboard.down('ArrowRight');
    try {
      await g.until('문에 닿음', `s.map.avatar.x >= ${WIND_GATE.x - 30}`);
      const crossed = await g.page.waitForFunction((x) => (window as any).__game.scene.getScene('Map').avatar.x > x, WIND_GATE.x + WIND_GATE.width, { timeout: 1200, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(crossed, false, '복원 뒤에도 닫힌 문은 지나갈 수 없다');
    } finally {
      await g.page.keyboard.up('ArrowRight');
    }
    assert.ok((await serverCatchesUp(g, device)).x < WIND_GATE.x);
  }, backend, device);
  await g.close();
});

test('복원 ⑤: 640×360 — 새로고침 뒤 Map이 복원되고 조이스틱으로 계속 걸을 수 있다(서버가 승인)', async () => {
  const device = 'e2e-restore-small';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'restore-small', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1488, y: 1880 }, 'joystick');
    const before = await serverCatchesUp(g, device);
    await g.reload();
    await g.until('Map 복원', READY);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, m.hudMode], [before, 'compact']);
    await g.walkTo('Map', { x: before.x, y: before.y + 100 }, 'joystick');
    const after = await serverCatchesUp(g, device);
    assert.ok(after.y > before.y + 60, `복원 뒤 조이스틱 이동이 서버에 반영: ${JSON.stringify(after)}`);
    m = await mapOf(g);
    assert.equal(m.corrections, 0);
    await g.capture('08_map_restored_small_joystick');
  }, backend, device);
  await g.close();
});

test('복원 ⑥: 유예 시간이 지나 탐험 세션이 닫힌 뒤 다시 접속하면 마을에서 시작한다(오래된 위치로 복원하지 않음), 새로 들어간 숲은 시작 지점', async () => {
  const device = 'e2e-restore-expired';
  await backend.start(seedForest(device, 'rescued'), { 'room.reconnectGraceMs': 300 });
  let g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-expired-1', async () => {
    await enterForest(g);
    await g.walkTo('Map', E2E.trunkNorth, 'keys');
    await serverCatchesUp(g, device);
  }, backend, device);
  await g.close(); // 연결이 끊긴다 → 유예 시작
  const until = Date.now() + 10_000;
  while (backend.session(device)) {
    if (Date.now() > until) throw new Error('기다리던 상태가 오지 않음: 유예 만료로 탐험 세션이 닫힘');
    await new Promise((r) => setTimeout(r, 50));
  }
  g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-expired-2', async () => {
    await g.until('마을에서 시작', "s.scenes.includes('Village') && s.village && s.village.ready && !s.scenes.includes('Map')");
    assert.equal(backend.session(device), null, '닫힌 세션이 되살아나지 않는다');
    await enterForest(g);
    assert.deepEqual((await mapOf(g)).avatar, SPAWN, '새 탐험 세션은 시작 지점');
  }, backend, device);
  await g.close();
});
