// 10-02 v4 §6.3: 서버 권위 위치와 충돌 — 변조 좌표 입장, 벽·닫힌 문 관통 시도, 서버 보정, 문 개방 뒤 통과, 전체 지도의 공개 범위.
// 실제 Nest 앱(FakeDb) + 실제 게임 클라이언트 + 실제 Chrome. "변조"는 개발 도우미로 같은 소켓에 임의 요청을 보내거나 화면의 캐릭터 위치를 바꿔 흉내 낸다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { readFileSync } from 'fs';
import type { Browser } from 'playwright-core';
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

const FOREST = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/forest.json'), 'utf8')) as { spawnPoint: { x: number; y: number }; points: { id: string; x: number; y: number }[] };
const SPAWN = FOREST.spawnPoint;
const GATE = WIND_GATE;
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
type MapState = {
  avatar: { x: number; y: number };
  positioned: boolean;
  corrections: number;
  lastCorrection: string | null;
  miniMap: { open: boolean; legendOpen: boolean; legend: string[]; art: { assetKey: string; fog: number } | null; terrain: { zones: number; paths: number; blockers: number; gatesClosed: number; gatesOpen: number } | null; openButton: { x: number; y: number }; legendToggle: { x: number; y: number; w: number; h: number } | null };
  story: { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; interact: { x: number; y: number } };
};
const mapOf = async (g: Game) => (await g.state()).map as MapState;

async function enterForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 지도·서버 위치 배치', 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story && s.map.story.greybox === false');
}
async function walkToTarget(g: Game, id: string, via: { x: number; y: number }[] = [], how: 'keys' | 'joystick' = 'keys') {
  for (const w of via) await g.walkTo('Map', w, how);
  await g.walkTo('Map', pointOf(id), how, `s.map && s.map.story && s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내 버튼`, `s.map && s.map.story && s.map.story.prompt === '${id}' && !!s.map.story.promptText`);
}
async function press(g: Game, expect: string) {
  const at = (await mapOf(g)).story.interact;
  await g.clickAt(at.x, at.y, expect);
}
// 화면의 캐릭터를 임의 좌표로 옮긴다(변조한 클라이언트가 그 좌표를 보고하는 상황). 서버가 거절해 되돌릴 때까지 기다린다
async function tamperJump(g: Game, to: { x: number; y: number }) {
  const before = (await mapOf(g)).corrections;
  await g.page.evaluate((p) => (window as any).__game.scene.getScene('Map').avatar.setPosition(p.x, p.y), to); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.until('서버 보정', `s.map.corrections > ${before}`);
  return mapOf(g);
}
// 서버 위치가 화면 위치를 따라올 때까지(이동 보고 주기 120ms)
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
const near = (a: { x: number; y: number }, b: { x: number; y: number }, d = 2) => Math.hypot(a.x - b.x, a.y - b.y) <= d;
async function openFullMap(g: Game) {
  const b = (await mapOf(g)).miniMap.openButton;
  await g.clickAt(b.x, b.y, 's.map.miniMap.open === true');
}
async function closeFullMap(g: Game) {
  await g.page.keyboard.press('Escape');
  await g.until('지도 닫힘', 's.map.miniMap.open === false');
}

test('위치 ①: 시작 지점 배치 → 좌표를 끼운 입장 요청 무시 → 큰 점프·벽 관통 시도는 서버가 되돌림(입력은 계속 동작) → 닫힌 문 → 나침판으로 문이 열린 뒤 통과 → 닫힌 실뿌리 문. 전체 지도는 공개된 구역만', async () => {
  const device = 'e2e-pos-compass';
  await backend.start(seedForest(device, 'compass'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'position-compass', async () => {
    await enterForest(g);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, backend.serverPosition(device), m.corrections], [SPAWN, SPAWN, 0], '첫 입장: 서버가 정한 시작 지점');
    await g.capture('01_first_entry_spawn_point');

    // 좌표를 끼운 입장 요청(옛 형식·변조): 응답은 서버 위치 그대로, 서버 상태도 그대로
    const hacked = (await g.page.evaluate((k) => (window as any).__dev.rawRequest('map:enter', { x: k.x, y: k.y, dir: 'down' }), { x: KNOT.x, y: KNOT.y })) as { self: { x: number; y: number }; corrected: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([hacked.self.x, hacked.self.y, hacked.corrected], [SPAWN.x, SPAWN.y, false]);
    assert.deepEqual(backend.serverPosition(device), SPAWN);

    // 숨은 구역 안으로 큰 점프: 서버가 거절하고 시작 지점으로 되돌린다
    m = await tamperJump(g, pointOf('forest_giant_knot'));
    assert.deepEqual([m.avatar, backend.serverPosition(device)], [SPAWN, SPAWN], '거절된 좌표는 서버에 저장되지 않는다');
    assert.equal(m.lastCorrection, 'speed');

    // 전체 지도(숨은 길을 열기 전): 길·벽·닫힌 문은 보이고, 문 안쪽 구역·안쪽 벽·안쪽 문은 없다
    await openFullMap(g);
    m = await mapOf(g);
    // 최종 지도: 배경 그림을 줄여 쓰고(임시 도형 없음), 아직 열리지 않은 숨은 길 구역은 안개로 가려져 있다
    assert.deepEqual([m.miniMap.terrain, m.miniMap.art], [null, { assetKey: 'forest-base', fog: 1 }]);
    assert.deepEqual(m.miniMap.legend, ['player', 'story', 'wild']);
    await g.capture('07_full_map_final_fog_before_open');
    await g.capture('08a_full_map_hidden_zone_before');
    await closeFullMap(g);

    // 닫힌 숨은 길 문: 화면에서도 막히고(클라이언트 충돌), 문 너머로 옮겨 보고해도 서버가 되돌린다
    await walkToTarget(g, 'forest_hidden_path');
    await g.walkTo('Map', WIND_FRONT, 'keys');
    await g.page.keyboard.down('ArrowRight');
    try {
      await g.until('문에 닿음', `s.map.avatar.x >= ${GATE.x - 30}`);
      const crossed = await g.page.waitForFunction((x) => (window as any).__game.scene.getScene('Map').avatar.x > x, GATE.x + GATE.width, { timeout: 1200, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(crossed, false, '닫힌 문을 지나갔다');
    } finally {
      await g.page.keyboard.up('ArrowRight');
    }
    const front = await serverCatchesUp(g, device);
    assert.ok(front.x < GATE.x, `서버 위치도 문 앞: ${JSON.stringify(front)}`);
    await g.capture('03_hidden_path_gate_closed');
    m = await tamperJump(g, { x: front.x + 80, y: front.y }); // 속도 한도 안의 짧은 점프로 문을 건너뛴다
    assert.equal(m.lastCorrection, 'tunnel', '선분이 닫힌 문을 관통');
    assert.ok(near(m.avatar, front) && near(backend.serverPosition(device)!, front), `마지막 승인 위치로 복귀: ${JSON.stringify(m.avatar)}`);
    await g.capture('02_wall_tunnel_attempt_server_corrected');
    // 같은 자리에서 다시 시도해도 흔들리지 않고 그 자리(보정은 시도한 만큼만)
    const again = await tamperJump(g, { x: front.x + 80, y: front.y });
    assert.ok(near(again.avatar, front));
    assert.equal(again.corrections, m.corrections + 1);
    // 보정 뒤에도 조작이 계속된다: 조이스틱으로 걸으면 서버 위치가 따라온다
    await g.walkTo('Map', { x: front.x - 120, y: front.y }, 'joystick');
    const moved = await serverCatchesUp(g, device);
    assert.ok(moved.x < front.x - 80, `보정 뒤 이동 승인: ${JSON.stringify(moved)}`);

    // 나침판을 꺼내 길을 연다 → 문이 열리고(서버 상태를 받은 뒤 클라이언트 충돌도 사라짐) 걸어서 지나간다
    await walkToTarget(g, 'forest_hidden_path');
    assert.equal((await mapOf(g)).story.promptText, '나침판 꺼내기');
    await press(g, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('문 열림', 's.map && s.map.story && s.map.story.gates.gate_hidden_path === true && s.map.story.gates.gate_root === false');
    await g.capture('04_hidden_path_gate_open_after_compass');
    const c0 = (await mapOf(g)).corrections;
    await walkToTarget(g, 'forest_giant_knot');
    const inside = await serverCatchesUp(g, device);
    assert.ok(inside.x > GATE.x + GATE.width + 100, `열린 문을 지나 안쪽: ${JSON.stringify(inside)}`);
    assert.equal((await mapOf(g)).corrections, c0, '정상 이동에는 보정이 없다');
    assert.equal((await mapOf(g)).story.promptText, '거대 매듭에 다가가기');

    // 닫힌 실뿌리 문(첫 매듭 장착 전)
    await g.walkTo('Map', ROOT_FRONT, 'keys');
    await g.page.keyboard.down('ArrowRight');
    try {
      await g.until('실뿌리 문에 닿음', `s.map.avatar.x >= ${ROOT_GATE.x - 30}`);
      const crossed = await g.page.waitForFunction((x) => (window as any).__game.scene.getScene('Map').avatar.x > x, ROOT_GATE.x + ROOT_GATE.width, { timeout: 1200, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(crossed, false, '닫힌 실뿌리 문을 지나갔다');
    } finally {
      await g.page.keyboard.up('ArrowRight');
    }
    await g.capture('05_root_gate_closed');
    const rootFront = await serverCatchesUp(g, device);
    m = await tamperJump(g, { x: rootFront.x + 80, y: rootFront.y });
    assert.ok(near(m.avatar, rootFront) && m.lastCorrection === 'tunnel');

    // 전체 지도(숨은 길을 연 뒤): 안쪽 구역·안쪽 벽·닫힌 실뿌리 문이 나타난다. 실뿌리 문 너머 구역은 아직 없다
    await openFullMap(g);
    m = await mapOf(g);
    assert.deepEqual([m.miniMap.terrain, m.miniMap.art], [null, { assetKey: 'forest-base', fog: 0 }], '숨은 길이 열리면 안개가 걷힌다');
    await g.capture('08b_full_map_hidden_zone_after');
    await closeFullMap(g);
  }, backend, device);
  await g.close();
});

test('위치 ②: 첫 매듭 장착 뒤 — 시작 지점에서 출발해 열린 숨은 길 문·실뿌리 문을 지나 단수링 지점까지 걸어간다(진행이 앞서도 순간 이동 없음)', async () => {
  const device = 'e2e-pos-equipped';
  await backend.start(seedForest(device, 'equipped'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'position-equipped', async () => {
    await enterForest(g);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, backend.serverPosition(device)], [SPAWN, SPAWN], '진행과 무관하게 시작 지점');
    assert.deepEqual([m.story.gates, m.story.points], [{ gate_hidden_path: true, gate_root: true }, ['forest_dansuring']]);
    await walkToTarget(g, 'forest_dansuring');
    m = await mapOf(g);
    assert.equal(m.story.promptText, '단수링 살펴보기');
    assert.equal(m.corrections, 0, '열린 문 두 개를 지나는 동안 서버 보정 없음');
    const s = await serverCatchesUp(g, device);
    assert.ok(s.x > ROOT_GATE.x - 30, `실뿌리 문 앞(열려 있어 단수링이 닿는 거리): ${JSON.stringify(s)}`);
    await g.capture('06_root_gate_open_after_first_knot');
    await openFullMap(g);
    assert.deepEqual([(await mapOf(g)).miniMap.terrain, (await mapOf(g)).miniMap.art], [null, { assetKey: 'forest-base', fog: 0 }]);
    await closeFullMap(g);
  }, backend, device);
  await g.close();
});

test('위치 ③: 640×360 — 전체 지도의 범례를 접었다 펼칠 수 있고, 조이스틱 이동도 서버가 승인하며, 멀리 있는 실가루는 주울 수 없다', async () => {
  const device = 'e2e-pos-small';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'position-small', async () => {
    await enterForest(g);
    assert.deepEqual((await mapOf(g)).avatar, SPAWN);
    await openFullMap(g);
    let m = await mapOf(g);
    assert.ok(m.miniMap.legendToggle, '작은 화면: 범례 접기/펼치기 버튼');
    assert.equal(m.miniMap.legendOpen, false);
    const t = m.miniMap.legendToggle!;
    await g.clickAt(t.x + t.w / 2, t.y + t.h / 2, 's.map.miniMap.legendOpen === true');
    m = await mapOf(g);
    assert.deepEqual(m.miniMap.legend, ['player', 'story', 'dust', 'wild']);
    await g.capture('09_full_map_legend_small');
    await g.clickAt(t.x + t.w / 2, t.y + t.h / 2, 's.map.miniMap.legendOpen === false');
    await closeFullMap(g);

    // 조이스틱으로 갈림길 쪽 길까지: 멀리 있는 실가루(04)는 안내 버튼이 없고, 직접 요청해도 서버가 거부한다.
    // ("가까운데 벽에 막힘"은 서버 단위 테스트가 따로 확인한다)
    await g.walkTo('Map', { x: 1488, y: 1880 }, 'joystick');
    const at = await serverCatchesUp(g, device);
    assert.ok(at.y < SPAWN.y - 80, `첫 길을 따라 올라감: ${JSON.stringify(at)}`);
    assert.equal((await mapOf(g)).corrections, 0, '조이스틱 이동은 모두 승인');
    assert.equal((await mapOf(g)).story.prompt, null, '멀리 있는 실가루는 누를 대상이 아니다');
    const p = backend.playerByDevice(device)!;
    const token = (backend.db.rows('player', { id: p.id })[0] as { session_token: string }).session_token;
    const direct = await fetch(`http://127.0.0.1:${backend.port}/player/me/story/objectives/forest_glowing_dust/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': token }, body: JSON.stringify({ objectId: 'forest_dust_04' }) });
    assert.deepEqual([direct.status, ((await direct.json()) as { code: string }).code], [422, 'STORY_EVIDENCE_INVALID'], '멀리서는 주울 수 없다');
    assert.equal(backend.db.rows('player_story_objective_progress', { player_id: p.id }).length, 0);
  }, backend, device);
  await g.close();
});
