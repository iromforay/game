// 10-14 C2-7B·10-15 C2-7C: 최종 호수 배경에 맞춘 좌표·충돌 — 구역마다 시드로 시작 지점을 준비하고 그 구역만 실제로 걷는 짧은 시험 3개.
// ① 입구·정착지: 스폰, 물들이, 물결북, 닫힌 물풀문(짧게 밀어도 서버 좌표가 문을 넘지 않는다)
// ② 미로: 열린 물풀문 → 약한 물살 → 구조 3곳(화면 거리·HUD 교차) → 닫힌 안전 물길 문
// ③ 안전 물길·염색 샘: 옛 좌표 재접속 → 안전 앵커 복구 → 누비 위기 → 보스 입구
// 구역 사이를 걷는 연결성은 단위 시험(lake-layout.test.ts 도달성)이 맡는다. 전투·장면·보상은 다시 검증하지 않는다(승인된 테스트 시드: Backend.grantEvents·displace).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedLake } from './fixtures';
import { JUNCTION_TO, ROUTE_TO_JUNCTION, THROUGH_GATE, TO_BOSS, TO_GATE_FRONT, TO_PLAZA, type Pt } from '../helpers/lake-route';

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
const LARGE = { width: 1280, height: 720 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const RESCUED_ALL = ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued'];
const GATE_REED = { x: 1340, y: 976, width: 40, height: 108 };
const GATE_SAFE = { x: 2270, y: 452, width: 40, height: 100 };

type MapState = { avatar: Pt; deepReturns: number; currentPushes: number; lastCorrection: string | null; story: { points: string[]; prompt: string | null; promptText: string | null; gates: Record<string, boolean> } };
const map = async (g: Game) => (await g.state()).map as MapState;
const via = async (g: Game, pts: Pt[], stop = 'false') => {
  for (const p of pts) {
    if (await g.page.evaluate(`(() => { const s = window.__dev.state(); return !!(${stop}); })()`)) return;
    await g.walkDirect('Map', p, 'joystick', stop, 30);
  }
};
// 창 크기를 바꾸고 캔버스가 실제로 그 크기가 될 때까지 기다린다(캡처 파일 이름이 캔버스 크기에서 나온다)
async function resizeTo(g: Game, size: { width: number; height: number }) {
  await g.page.setViewportSize(size);
  await g.page.waitForFunction((w) => Math.round(document.querySelector('canvas')!.getBoundingClientRect().width) === w, size.width, { timeout: 10_000, polling: 50 });
}
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
// 서버에 저장된 위치를 옮기고 다시 접속한다(구역 시작 지점 준비 — 시드)
async function startAt(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('호수 지도', MAP_READY, 30_000);
}
async function assertNoStuck(g: Game, where: string) {
  const m = await map(g);
  assert.equal(m.deepReturns, 0, `${where}: 깊은 물 복귀 없음`);
  assert.ok(m.lastCorrection === null || m.lastCorrection === 'current', `${where}: 서버 보정 ${m.lastCorrection}`);
}
async function promptAt(g: Game, id: string) {
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
}
const promptIs = (id: string) => `s.map.story.prompt === '${id}'`;
const withDebug = async (g: Game, name: string) => {
  await g.page.evaluate(() => (window as any).__dev.collisionDebug(true)); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.capture(`collision-${name}`);
  await g.page.evaluate(() => (window as any).__dev.collisionDebug(false)); // eslint-disable-line @typescript-eslint/no-explicit-any
};
// 닫힌 문 쪽으로 3초만 밀어 본다(200회 반복 이동 대신) — 서버가 인정한 좌표가 문 사각형 앞에 머문다
async function pushIntoClosedGate(g: Game, gate: typeof GATE_REED) {
  const before = (await map(g)).avatar;
  await g.page.evaluate(() => { (window as any).__stopAt = Date.now() + 3000; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkDirect('Map', { x: gate.x + gate.width + 60, y: gate.y + gate.height / 2 }, 'joystick', 'Date.now() > window.__stopAt', 20);
  const after = (await map(g)).avatar;
  assert.ok(after.x <= gate.x - 8, `닫힌 문 앞에서 멈춘다(x ${before.x} → ${after.x}, 문 ${gate.x})`);
}
// 문 그림(닫힘 한 장·열림 조각)의 화면 경계 합집합 중심과 서버 문 사각형 중심의 차이
async function gateArtOffset(g: Game, gate: typeof GATE_REED, open: boolean) {
  return g.page.evaluate(({ gate, key }) => {
    const s = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const cx = gate.x + gate.width / 2;
    const cy = gate.y + gate.height / 2;
    const imgs = s.storyLayer.filter((o: any) => o.texture?.key === key && Math.hypot(o.x - cx, o.y - cy) < 160); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bs = imgs.map((o: any) => o.getBounds()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const x0 = Math.min(...bs.map((b: any) => b.x)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const y0 = Math.min(...bs.map((b: any) => b.y)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const x1 = Math.max(...bs.map((b: any) => b.right)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const y1 = Math.max(...bs.map((b: any) => b.bottom)); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { pieces: imgs.length, offset: Math.round(Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy)), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }, { gate, key: open ? 'reed-gate-open' : 'reed-gate-closed' });
}
// 구조 장면 화면 측정: 플레이어·물들이·적 그림 중심 거리, 안내 버튼·HUD와 캐릭터 그림의 교차
type SceneMeasure = { player: Pt; mulduri: Pt; guards: Pt[]; minDistance: number; hudOverlaps: string[] };
async function measureRescue(g: Game, pointId: string): Promise<SceneMeasure> {
  return g.page.evaluate((pid) => {
    const s = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const wv = s.cameras.main.worldView;
    const pt = s.stageView.points.find((p: any) => p.id === pid); // eslint-disable-line @typescript-eslint/no-explicit-any
    const screen = (o: any) => { const b = o.getBounds(); return { x: b.x - wv.x, y: b.y - wv.y, w: b.width, h: b.height }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const center = (r: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
    const flat = s.storyLayer.flatMap((o: any) => (o.list ? o.list : [o])); // eslint-disable-line @typescript-eslint/no-explicit-any
    const mul = flat.find((o: any) => o.texture?.key === 'turby-muldeuli' && o.parentContainer && o.parentContainer.x === pt.x && o.parentContainer.y === pt.y); // eslint-disable-line @typescript-eslint/no-explicit-any
    const guards = flat.filter((o: any) => o.texture?.key === 'wet-stitchling-idle' && o.visible && Math.hypot(o.x - pt.x, o.y - pt.y) < 200); // eslint-disable-line @typescript-eslint/no-explicit-any
    const sprites = [['player', screen(s.avatar)], ['mulduri', screen(mul)], ...guards.map((o: any, i: number) => [`guard${i}`, screen(o)])] as [string, { x: number; y: number; w: number; h: number }][]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const cs = sprites.map(([, r]) => center(r));
    let min = Infinity;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) min = Math.min(min, Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y));
    // HUD(화면 고정, 깊이 2000 이상, 보이는 것): 안내 버튼·목표 문구·지도·버튼
    const hud = s.children.list.filter((o: any) => o.visible && o.depth >= 2000 && o.scrollFactorX === 0 && o.getBounds); // eslint-disable-line @typescript-eslint/no-explicit-any
    const overlaps: string[] = [];
    for (const h of hud) {
      const b = h.getBounds();
      if (b.width === 0 || b.height === 0 || (h.type === 'Text' && !h.text)) continue;
      for (const [name, r] of sprites) if (b.x < r.x + r.w && r.x < b.right && b.y < r.y + r.h && r.y < b.bottom) overlaps.push(`${name}×${h.type}(${Math.round(b.x)},${Math.round(b.y)})`);
    }
    return { player: cs[0], mulduri: cs[1], guards: cs.slice(2), minDistance: Math.round(min), hudOverlaps: overlaps };
  }, pointId);
}

test('2장 C2-7C ① 입구·정착지(1280×720): 스폰 → 물들이 → 물결북, 닫힌 물풀문은 짧게 밀어도 넘지 못한다', async () => {
  const device = 'e2e-layout-entry';
  await backend.start(seedLake(device, 'entry'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-layout-entry', async () => {
    backend.grantEvents(device, ['lake_entry_seen'], 'CH02_STARTED'); // 도입 장면은 다시 보지 않는다(시드)
    await enterLake(g);
    const m = await map(g);
    assert.ok(near(m.avatar, { x: 350, y: 1981 }, 12), `스폰 ${JSON.stringify(m.avatar)}`);
    await withDebug(g, 'entrance');
    // 정착지: 물들이 안내가 뜰 때까지 걷는다
    await via(g, TO_PLAZA, promptIs('lake_mulduri'));
    await promptAt(g, 'lake_mulduri');
    await assertNoStuck(g, '정착지 물들이');
    // 물들이를 만난 상태(시드) → 물결북 안내까지(정착지 길을 되돌아 남쪽 물결북으로)
    backend.grantEvents(device, ['lake_mulduri_met']);
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    const back = TO_PLAZA.slice(TO_PLAZA.findIndex((q) => q.x === 660 && q.y === 1372)).reverse(); // 정착지 끝 → (660,1372)
    await via(g, [...back, { x: 700, y: 1330 }], promptIs('lake_wave_drum'));
    await promptAt(g, 'lake_wave_drum');
    await assertNoStuck(g, '물결북');
    // 닫힌 물풀문: 정착지 길을 따라 문 앞까지 → 3초 밀기
    const fromDrum = TO_PLAZA.slice(TO_PLAZA.findIndex((q) => q.x === 660 && q.y === 1324));
    await via(g, [...fromDrum, ...TO_GATE_FRONT]);
    assert.equal((await map(g)).story.gates.gate_reed_maze, false, '물풀문은 물결북 전에는 닫혀 있다');
    const art = await gateArtOffset(g, GATE_REED, false);
    assert.ok(art.pieces === 1 && art.offset <= 24, `닫힌 물풀문 그림 중심 차이 ${JSON.stringify(art)}`);
    await pushIntoClosedGate(g, GATE_REED);
    await g.capture('settlement-gate');
    await withDebug(g, 'settlement');
  }, backend, device);
  await g.close();
});

test('2장 C2-7C ② 미로(1280×720·640×360): 열린 물풀문 → 약한 물살 → 구조 3곳(화면 거리 48px·HUD 교차 0) → 닫힌 안전 물길 문', async () => {
  const device = 'e2e-layout-maze';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-layout-maze', async () => {
    await enterLake(g);
    await startAt(g, device, TO_GATE_FRONT[TO_GATE_FRONT.length - 1]); // 물풀문 앞에서 시작(시드)
    assert.equal((await map(g)).story.gates.gate_reed_maze, true, '물결북 뒤 물풀문 열림');
    const art = await gateArtOffset(g, GATE_REED, true);
    assert.ok(art.pieces === 2 && art.offset <= 24, `열린 물풀문 조각 중심 차이 ${JSON.stringify(art)}`);
    await via(g, THROUGH_GATE);
    const m = await map(g);
    assert.ok(m.currentPushes >= 1, `문 뒤 약한 물살에 밀렸다(${m.currentPushes})`);
    await assertNoStuck(g, '물풀문 통과');
    const junction = ROUTE_TO_JUNCTION[ROUTE_TO_JUNCTION.length - 1];
    const seen: Record<string, SceneMeasure> = {};
    for (const k of ['b', 'a', 'c'] as const) {
      await via(g, JUNCTION_TO[k], promptIs(`lake_rescue_${k}`)); // 안내가 뜨는 자리에서 멈춘다
      await promptAt(g, `lake_rescue_${k}`);
      await assertNoStuck(g, `구조 ${k}`);
      const me = (seen[k] = await measureRescue(g, `lake_rescue_${k}`));
      assert.ok(me.minDistance >= 48, `구조 ${k}: 플레이어·물들이·적 중심 최소 거리 ${me.minDistance} ${JSON.stringify(me)}`);
      assert.deepEqual(me.hudOverlaps, [], `구조 ${k}: HUD·안내 버튼과 캐릭터 교차`);
      await g.capture(`maze-rescue-${k}`);
      if (k === 'a') await withDebug(g, 'maze');
      if (k === 'c') {
        await resizeTo(g, SMALL);
        await g.capture('maze-rescue');
        await resizeTo(g, LARGE);
        break;
      }
      const at = (await map(g)).avatar;
      const done = JUNCTION_TO[k].findIndex((q) => Math.hypot(q.x - at.x, q.y - at.y) < 50);
      await via(g, reversed(JUNCTION_TO[k].slice(0, Math.max(done, 0) + 1), junction));
    }
    console.log(`[C2-7C] 구조 장면 측정 ${JSON.stringify(seen)}`);
    // 세 구조가 끝난 상태(시드)에서 안전 물길 지점으로 옮겨 닫힌 문을 민다
    backend.grantEvents(device, RESCUED_ALL);
    await startAt(g, device, { x: 2212, y: 492 });
    await promptAt(g, 'lake_safe_route');
    assert.equal((await map(g)).story.gates.gate_lake_safe_route, false);
    await pushIntoClosedGate(g, GATE_SAFE);
    await g.capture('safe-route-gate');
  }, backend, device);
  await g.close();
});

test('2장 C2-7C ③ 안전 물길·염색 샘(1280×720·640×360): 옛 좌표 재접속 → 안전 앵커 복구 → 누비 위기 → 보스 입구', async () => {
  const device = 'e2e-layout-spring';
  await backend.start(seedLake(device, 'cleared'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-layout-spring', async () => {
    await enterLake(g);
    // 옛 기능 맵 좌표(안전 물길 문 아래 (2370,700) — 지금은 길 밖)에 저장된 상태로 재접속 → 서버가 쓸 수 있는 안전 앵커로 복구
    await startAt(g, device, { x: 2370, y: 700 });
    let m = await map(g);
    assert.ok(near(m.avatar, { x: 2380, y: 511 }, 70) || near(m.avatar, { x: 1846, y: 638 }, 70), `안전 앵커 복구 ${JSON.stringify(m.avatar)}`);
    assert.equal(m.story.gates.gate_lake_safe_route, true);
    await withDebug(g, 'safe-route');
    await resizeTo(g, SMALL);
    await g.capture('safe-route');
    await resizeTo(g, LARGE);
    // 누비 위기 지점 → 위기 장면 끝(시드) → 보스 입구
    if (!near(m.avatar, { x: 2380, y: 511 }, 70)) await via(g, [{ x: 1884, y: 572 }, { x: 2028, y: 532 }, { x: 2172, y: 508 }, { x: 2276, y: 500 }, { x: 2372, y: 500 }], promptIs('lake_nubi_crisis'));
    await via(g, [{ x: 2370, y: 500 }], promptIs('lake_nubi_crisis'));
    await promptAt(g, 'lake_nubi_crisis');
    await assertNoStuck(g, '누비 위기');
    backend.grantEvents(device, ['lake_nubi_crisis_seen'], 'CH02_NUBI_CRISIS_SEEN');
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    await via(g, TO_BOSS, promptIs('lake_boss_entrance'));
    await promptAt(g, 'lake_boss_entrance');
    m = await map(g);
    await assertNoStuck(g, '보스 입구');
    await g.capture('dye-spring');
    await withDebug(g, 'dye-spring');
  }, backend, device);
  await g.close();
});
