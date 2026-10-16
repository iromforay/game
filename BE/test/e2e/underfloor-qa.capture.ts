// 10-16 C3-6 검수용 캡처 18장(to_codex/2026-10-16/v7_C3-6_화면검수지시.md §2). 기능 시험이 아니라 Codex 화면 검수에 넘길 장면을 찍는다.
// 정식 E2E 묶음(*.e2e.ts, groups·shards manifest)에 넣지 않는다. 실행(BE 폴더에서):
//   E2E_CAPTURE_DIR=<캡처 폴더> node --no-warnings --test --test-concurrency=1 -r ts-node/register/transpile-only test/e2e/underfloor-qa.capture.ts
// 진행 상태는 테스트 격리 DB 시드(seedUnderfloor)와 서버 위치 옮기기(displace)·사건 기록(grantEvents)으로 준비한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedUnderfloor } from './fixtures';
import { SPAWN_TO_AMBUSH, SPAWN_TO_BOSS, type Pt } from '../helpers/underfloor-route';

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
const ELDER_MET = ['underfloor_elder_met'];
const ITEMS = ['underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected', 'underfloor_items_inspected'];
const TRAIL = ['underfloor_ambush_won', 'underfloor_memory_trail_found'];

async function enterUnderfloor(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('3장 — 마루바닥 밑', { exact: true });
  await g.until('마루 밑 지도', MAP_READY, 30_000);
}
// 서버 위치를 옮기고 다시 접속(카메라가 그 자리를 비춘다)
async function moveTo(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('마루 밑 지도', MAP_READY, 30_000);
  await settleCamera(g);
}
// 카메라가 플레이어를 부드럽게 따라가므로 스크롤이 멈춘 뒤 찍는다(연속 5회 같은 값)
async function settleCamera(g: Game) {
  await g.page.evaluate(() => { (window as any).__camStable = { x: NaN, y: NaN, n: 0 }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.page.waitForFunction(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = w.__game.scene.getScene('Map').cameras.main;
    const st = w.__camStable;
    st.n = Math.abs(c.scrollX - st.x) < 0.5 && Math.abs(c.scrollY - st.y) < 0.5 ? st.n + 1 : 0;
    st.x = c.scrollX;
    st.y = c.scrollY;
    return st.n >= 5;
  }, null, { timeout: 8000, polling: 50 });
}
// 지점까지 걸어가 안내 버튼을 눌러 대화를 연다
async function talk(g: Game, id: string, route: Pt[]) {
  for (const p of route) await g.walkDirect('Map', p, 'joystick', `s.map.story.prompt === '${id}'`, 20);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await g.state()).map.story.interact as { x: number; y: number };
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
}
const glimpseShown = (key: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && sc.fxState.glimpseShown.includes('${key}'); })()`;
// 원형 기억 연출이 다 떠오를 때까지(알파 0.9 이상) 기다린다
async function waitFx(g: Game, key: string) {
  await g.page.waitForFunction((k) => (window as any).__game.scene.getScenes(true).some((s: any) => s.children.list.some((o: any) => o.texture && o.texture.key === k && o.alpha >= 0.9)), key, { timeout: 8000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function enterBattle(g: Game, id: string, route: Pt[]) {
  for (const p of route) await g.walkDirect('Map', p, 'keys', 'false', 30);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await g.state()).map.story.interact as { x: number; y: number };
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
}

test('C3-6 캡처 ①(1280×720): 지도 — 입구·홀·장갑 기억 비침·매복 더미·닫힌 문·열린 문과 실패 자국·기억 조각·보스 공간', async () => {
  const device = 'qa-map-1280';
  await backend.start(seedUnderfloor(device, 'started'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-map-1280', async () => {
    await enterUnderfloor(g);
    await settleCamera(g);
    await g.capture('c01_entrance');
    await moveTo(g, device, { x: 1560, y: 1480 });
    await g.capture('c02_hall_elder');
    // 폭신이를 만난 상태 → 장갑을 살펴본다(기억 비침)
    backend.grantEvents(device, ELDER_MET, 'CH03_ELDER_MET');
    await moveTo(g, device, { x: 1240, y: 1340 });
    await talk(g, 'underfloor_glove', [{ x: 1270, y: 1300 }, { x: 1300, y: 1270 }]);
    await g.until('장갑 기억 비침', glimpseShown('memory-glove'), 10_000);
    await waitFx(g, 'memory-glove');
    await g.capture('c03_memory_glove');
    // 조사 3곳을 마친 상태 → 매복 더미, 닫힌 문
    backend.grantEvents(device, ITEMS);
    await moveTo(g, device, { x: 1600, y: 1600 });
    await g.capture('c04_ambush_pile');
    await moveTo(g, device, { x: 2000, y: 1180 });
    assert.equal((await g.state()).map.story.gates.gate_dust_yarn, false, '문 닫힘');
    await g.capture('c05_gate_closed');
    // 매복 승리 뒤 → 열린 문·실패 자국, 기억 조각 장면
    backend.grantEvents(device, TRAIL, 'CH03_MEMORY_TRAIL_FOUND');
    await moveTo(g, device, { x: 2000, y: 1000 });
    assert.equal((await g.state()).map.story.gates.gate_dust_yarn, true, '문 열림');
    await g.capture('c06_gate_open_trail');
    await moveTo(g, device, { x: 2100, y: 830 });
    await talk(g, 'underfloor_fragment', [{ x: 2160, y: 790 }, { x: 2200, y: 760 }]);
    await g.advanceDialogue(glimpseShown('memory-fragment'));
    await waitFx(g, 'memory-fragment');
    await g.capture('c07_fragment');
    // 기억 조각을 본 뒤 → 넓은 빈 공간 입구(입구 표식·바닥 오버레이)
    backend.grantEvents(device, ['underfloor_memory_fragment_seen'], 'CH03_MEMORY_FRAGMENT_SEEN');
    await moveTo(g, device, { x: 2470, y: 700 });
    await g.capture('c08_boss_arena');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ②(1280×720): 매복 전투 시작·재봉선 노출', async () => {
  const device = 'qa-ambush-1280';
  await backend.start(seedUnderfloor(device, 'items'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-ambush-1280', async () => {
    await enterUnderfloor(g);
    await enterBattle(g, 'underfloor_ambush', SPAWN_TO_AMBUSH);
    await g.capture('c09_ambush_start');
    await g.playBattle(300_000, "window.__dev.texts().some((t) => t.includes('재봉선 노출'))");
    await g.capture('c10_doll_exposed');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ③(1280×720): 보스 시작(다음 실)·약점 노출', async () => {
  const device = 'qa-boss-1280';
  await backend.start(seedUnderfloor(device, 'fragment'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-boss-1280', async () => {
    await enterUnderfloor(g);
    await enterBattle(g, 'underfloor_boss_entrance', SPAWN_TO_BOSS);
    await g.capture('c11_boss_start');
    await g.playBattle(300_000, "s.battle && s.battle.units.some((u) => u.id === 'memory_spool' && u.phase === 'exposed')");
    await g.capture('c12_boss_exposed');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ④(1280×720): 솜심 상세·장 마무리 은빛 실', async () => {
  const device = 'qa-core-1280';
  await backend.start(seedUnderfloor(device, 'aftermath'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-core-1280', async () => {
    await enterUnderfloor(g);
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = ((await g.state()).inventory.cells as { code: string; x: number; y: number; w: number; h: number }[]).find((c) => c.code === 'old_cotton_core')!;
    await g.clickAt(cell.x + cell.w / 2, cell.y + cell.h / 2, "s.inventory.selected === 'old_cotton_core'");
    await g.capture('c13_core_detail');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    await g.advanceDialogue(glimpseShown('silver-thread'));
    await waitFx(g, 'silver-thread');
    await g.capture('c14_silver_thread');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ⑤(640×360): 홀·매복 전투', async () => {
  const device = 'qa-ambush-640';
  await backend.start(seedUnderfloor(device, 'items'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-ambush-640', async () => {
    await enterUnderfloor(g);
    await moveTo(g, device, { x: 1560, y: 1480 });
    await g.capture('m01_hall');
    await enterBattle(g, 'underfloor_ambush', [{ x: 1600, y: 1500 }]);
    await g.capture('m02_ambush');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ⑥(640×360): 보스(다음 실)', async () => {
  const device = 'qa-boss-640';
  await backend.start(seedUnderfloor(device, 'fragment'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-boss-640', async () => {
    await enterUnderfloor(g);
    await moveTo(g, device, { x: 2470, y: 700 });
    await enterBattle(g, 'underfloor_boss_entrance', [{ x: 2580, y: 610 }]);
    await g.capture('m03_boss');
  }, backend, device);
  await g.close();
});

test('C3-6 캡처 ⑦(640×360): 기억 조각 장면', async () => {
  const device = 'qa-fragment-640';
  await backend.start(seedUnderfloor(device, 'trail'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-fragment-640', async () => {
    await enterUnderfloor(g);
    await moveTo(g, device, { x: 2100, y: 830 });
    await talk(g, 'underfloor_fragment', [{ x: 2160, y: 790 }, { x: 2200, y: 760 }]);
    await g.advanceDialogue(glimpseShown('memory-fragment'));
    await waitFx(g, 'memory-fragment');
    await g.capture('m04_fragment');
  }, backend, device);
  await g.close();
});
