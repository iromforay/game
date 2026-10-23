// 10-23 C4-5 4장 화면 검수용 캡처. 기능 시험이 아니라 화면 검수(C4-6)에 넘길 장면을 찍는다(3장 underfloor-qa.capture.ts와 같은 방식).
// 정식 E2E 묶음(*.e2e.ts, groups·shards manifest)에 넣지 않는다. 실행(BE 폴더에서):
//   E2E_CAPTURE_DIR=<캡처 폴더> node --no-warnings --test --test-concurrency=1 -r ts-node/register/transpile-only test/e2e/fridge-qa.capture.ts
// 진행 상태는 테스트 격리 DB 시드(seedFridge)와 서버 위치 옮기기(displace)·사건 기록(grantEvents)으로 준비한다.
// 3장 C3-6 검수에서 배운 것: 임무 대상(조사·고백 지점)이 보이는 장면, 640 화면, 대화 배경·연출 장면을 처음부터 넣는다.
import { test, before, after } from 'node:test';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFridge } from './fixtures';
import type { Pt } from '../helpers/fridge-route';

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

async function enterFridge(g: Game, expectIntro = false) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  if ((await g.state()).stageSelect.mode === 'compact') await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('4장 — 냉장고 속', { exact: true });
  if (!expectIntro) await g.until('냉장고 지도', MAP_READY, 30_000);
}
// 서버 위치를 옮기고 다시 접속(카메라가 그 자리를 비춘다)
async function moveTo(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('냉장고 지도', MAP_READY, 30_000);
  await settleCamera(g);
}
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
async function talk(g: Game, id: string, route: Pt[]) {
  for (const p of route) await g.walkDirect('Map', p, 'joystick', `s.map.story.prompt === '${id}'`, 20);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await g.state()).map.story.interact as { x: number; y: number };
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
}
const fx = (cond: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && (${cond}); })()`;
const glimpseShown = (key: string) => fx(`sc.fxState.glimpseShown.includes('${key}')`);
const voiceShown = (n: number) => fx(`sc.fxState.voiceShown >= ${n}`);
// 원형 연출·가장자리 서리가 다 떠오를 때까지(알파 0.8 이상) 기다린다
async function waitFx(g: Game, key: string) {
  await g.page.waitForFunction((k) => (window as any).__game.scene.getScenes(true).some((s: any) => s.children.list.some((o: any) => o.texture && o.texture.key === k && o.alpha >= 0.8)), key, { timeout: 8000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function enterBattle(g: Game, id: string, route: Pt[], how: 'keys' | 'joystick' = 'keys') {
  for (const p of route) await g.walkDirect('Map', p, how, 'false', 30);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await g.state()).map.story.interact as { x: number; y: number };
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
}
const snapHas = (expr: string) => `(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && (${expr}); })()`;

test('C4 캡처 ①(1280×720): 도입 목소리 → 입구 → 서리 구역 → 박힌 가느리', async () => {
  const device = 'qa-fridge-intro-1280';
  await backend.start(seedFridge(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-fridge-intro-1280', async () => {
    await enterFridge(g, true);
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(voiceShown(1));
    await waitFx(g, 'voice-frost');
    await g.capture('f01_voice');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY, 30_000);
    await settleCamera(g);
    await g.capture('f02_entrance');
    await moveTo(g, device, { x: 1000, y: 1900 });
    await g.page.waitForTimeout(600); // 서리 가장자리가 그려질 때까지
    await g.capture('f03_frost_zone');
    await moveTo(g, device, { x: 1520, y: 1680 });
    await g.capture('f04_ganeuri_pinned');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ②(1280×720): 바늘 통로(풀려난 가느리·예고·내려찍기) → 저장고 앞 길목(문 닫힘)', async () => {
  const device = 'qa-fridge-needle-1280';
  await backend.start(seedFridge(device, 'rescued'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-fridge-needle-1280', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 1760, y: 1560 });
    await g.until('needle_1 예고', "s.map.needles.find((n) => n.id === 'needle_1').phase === 'warn'", 5000);
    await g.capture('f05_needle_warn');
    await g.until('needle_1 내려찍기', "s.map.needles.find((n) => n.id === 'needle_1').phase === 'strike'", 5000);
    await g.capture('f06_needle_strike');
    await moveTo(g, device, { x: 2650, y: 1250 });
    await g.capture('f07_guard_point');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ③(1280×720): 열린 저장고·도안 벽 → 도안 클로즈업·두 번째 목소리 → 고백 지점(외곽광) → 서리 미싱 입구', async () => {
  const device = 'qa-fridge-storage-1280';
  await backend.start(seedFridge(device, 'opened'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-fridge-storage-1280', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 2700, y: 880 });
    await g.capture('f08_door_open');
    await moveTo(g, device, { x: 2600, y: 520 });
    await g.capture('f09_storage_wall');
    await talk(g, 'fridge_storage_wall', [{ x: 2600, y: 400 }]);
    await g.advanceDialogue(glimpseShown('storage-pattern'));
    await waitFx(g, 'storage-pattern');
    await g.capture('f10_storage_pattern');
    await g.advanceDialogue(voiceShown(1));
    await waitFx(g, 'voice-frost');
    await g.capture('f11_second_voice');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY, 30_000);
    await moveTo(g, device, { x: 2200, y: 520 });
    await g.capture('f12_confession_point');
    backend.grantEvents(device, ['fridge_confession_seen'], 'CH04_CONFESSION_SEEN');
    await moveTo(g, device, { x: 1950, y: 490 });
    await g.capture('f13_boss_entrance');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ④(1280×720): 저장고 앞 전투 시작 → 얼음 칸 → 파편', async () => {
  const device = 'qa-fridge-guard-1280';
  await backend.start(seedFridge(device, 'rescued'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-fridge-guard-1280', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 2700, y: 1180 });
    await enterBattle(g, 'fridge_guard', [{ x: 2700, y: 1080 }]);
    await g.capture('b01_guard_start');
    await g.playBattle(300_000, snapHas('(b.snap.ice ?? []).length > 0'));
    await g.capture('b02_guard_ice');
    await g.playBattle(300_000, snapHas("b.snap.units.some((u) => u.shardOf && !u.stunned)"));
    await g.capture('b03_guard_shatter');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ⑤(1280×720): 서리 미싱 시작 → 바늘 예고 → 정지 → 장착·이어진 감각·금빛', async () => {
  const device = 'qa-fridge-boss-1280';
  await backend.start(seedFridge(device, 'confessed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-fridge-boss-1280', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 1950, y: 490 });
    await enterBattle(g, 'fridge_boss_entrance', [{ x: 1800, y: 470 }]);
    await g.capture('b04_boss_start');
    await g.playBattle(300_000, snapHas('(b.snap.needleMarks ?? []).length > 0 && b.snap.currentPlayerId === b.myId'));
    await g.capture('b05_boss_needle');
    await g.playBattle(300_000, snapHas("b.snap.units.some((u) => u.unitId === 'frost_machine' && u.phase === 'exposed')"));
    await g.capture('b06_boss_stopped');
    await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('승리 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(glimpseShown('frost-machine-scar'));
    await g.capture('d01_machine_scar');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY, 30_000);
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = ((await g.state()).inventory.cells as { code: string; x: number; y: number; w: number; h: number }[]).find((c) => c.code === 'ice_microfiber')!;
    await g.clickAt(cell.x + cell.w / 2, cell.y + cell.h / 2, "s.inventory.selected === 'ice_microfiber'");
    await g.capture('i01_fiber_detail');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    await g.advanceDialogue(glimpseShown('sense-restore'));
    await g.capture('d02_sense_restore');
    await g.advanceDialogue(glimpseShown('warm-gold'));
    await g.capture('d03_warm_gold');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ⑥(640×360): 바늘 통로 → 저장고 도안 벽 → 고백 지점', async () => {
  const device = 'qa-fridge-map-640';
  await backend.start(seedFridge(device, 'opened'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-fridge-map-640', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 1760, y: 1560 });
    await g.until('needle_1 예고', "s.map.needles.find((n) => n.id === 'needle_1').phase === 'warn'", 5000);
    await g.capture('m01_needle');
    await moveTo(g, device, { x: 2600, y: 520 });
    await g.capture('m02_storage_wall');
    backend.grantEvents(device, ['fridge_storage_seen'], 'CH04_STORAGE_CLEARED');
    await moveTo(g, device, { x: 2200, y: 520 });
    await g.capture('m03_confession_point');
  }, backend, device);
  await g.close();
});

test('C4 캡처 ⑦(640×360): 저장고 앞 전투·서리 미싱 전투', async () => {
  const device = 'qa-fridge-battle-640';
  await backend.start(seedFridge(device, 'rescued'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-fridge-battle-640', async () => {
    await enterFridge(g);
    await moveTo(g, device, { x: 2700, y: 1180 });
    await enterBattle(g, 'fridge_guard', [{ x: 2700, y: 1080 }], 'joystick');
    await g.capture('m04_guard_battle');
    await g.playBattle(300_000);
  }, backend, device);
  await g.close();
  const device2 = 'qa-fridge-boss-640';
  await backend.start(seedFridge(device2, 'confessed'), { 'story.stageAccessV2': true });
  const g2 = await Game.open(browser, `${vite.url}/?device=${device2}`, device2, SMALL);
  await withDiagnosis(g2, 'qa-fridge-boss-640', async () => {
    await enterFridge(g2);
    await moveTo(g2, device2, { x: 1950, y: 490 });
    await enterBattle(g2, 'fridge_boss_entrance', [{ x: 1800, y: 470 }], 'joystick');
    await g2.playBattle(300_000, snapHas('(b.snap.needleMarks ?? []).length > 0 && b.snap.currentPlayerId === b.myId'));
    await g2.capture('m05_boss_battle');
  }, backend, device2);
  await g2.close();
});
