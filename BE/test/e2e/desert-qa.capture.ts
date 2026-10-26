// 10-26 C5-5 5장 화면 검수용 캡처. 기능 시험이 아니라 화면 검수(C5-6)에 넘길 장면을 찍는다(4장 fridge-qa.capture.ts와 같은 방식).
// 정식 E2E 묶음(*.e2e.ts, groups·shards manifest)에 넣지 않는다. 실행(BE 폴더에서):
//   E2E_CAPTURE_DIR=<캡처 폴더> node --no-warnings --test --test-concurrency=1 -r ts-node/register/transpile-only test/e2e/desert-qa.capture.ts
// 진행 상태는 테스트 격리 DB 시드(seedDesert)와 서버 위치 옮기기(displace)·사건 기록(grantEvents)으로 준비한다.
// 4장 C4-6 검수에서 배운 것: 연출 캡처는 그림이 다 떠오른 뒤(waitFx), 연속 연출은 앞 그림이 걷힌 뒤(waitFxGone) 찍는다. 640 전투는 라벨이 몰리는 장면을 넣는다.
import { test, before, after } from 'node:test';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedDesert } from './fixtures';
import type { Pt } from '../helpers/desert-route';

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
const JOINED = 'CH05_CLUES_JOINED';

async function enterDesert(g: Game, expectIntro = false) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  if ((await g.state()).stageSelect.mode === 'compact') await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('5장 — 보일러 옆 사막', { exact: true });
  if (!expectIntro) await g.until('사막 지도', MAP_READY, 30_000);
}
// 서버 위치를 옮기고 다시 접속(카메라가 그 자리를 비춘다). 사건을 기록했으면 지역 화면 데이터도 이때 새로 받는다
async function moveTo(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('사막 지도', MAP_READY, 30_000);
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
// 연출 그림이 다 떠오를 때까지(알파 0.8 이상) 기다린다
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
const myTurn = 'b.snap.currentPlayerId === b.myId';

test('C5 캡처 ①(1280×720): 도입(대화 배경) → 초입의 동료 셋 → 단서 길 → 능선 앞 표식', async () => {
  const device = 'qa-desert-intro-1280';
  await backend.start(seedDesert(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-desert-intro-1280', async () => {
    await enterDesert(g, true);
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.page.waitForTimeout(600);
    await g.capture('d01_entry_dialogue');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('사막 지도', MAP_READY, 30_000);
    await settleCamera(g);
    await g.capture('f01_entrance_companions');
    await moveTo(g, device, { x: 1150, y: 1885 });
    await g.capture('f02_clues_point');
    backend.grantEvents(device, ['desert_clues_seen'], JOINED);
    await moveTo(g, device, { x: 1500, y: 1760 });
    await g.capture('f03_scorched_point');
  }, backend, device);
  await g.close();
});

test('C5 캡처 ②(1280×720): 뜨거운 모래·아지랑이 → 틈 셋(닫힘·동료가 이은 뒤) → 절단면(외곽광)·가위 그림자 → 금빛 마감실 입구', async () => {
  const device = 'qa-desert-ridge-1280';
  await backend.start(seedDesert(device, 'won'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-desert-ridge-1280', async () => {
    await enterDesert(g);
    await moveTo(g, device, { x: 2150, y: 1680 });
    await g.page.waitForTimeout(600); // 가장자리 열기가 그려질 때까지
    await g.until('아지랑이가 떠오름', "s.map.mirages.some((x) => x.alpha > 0.7)", 6000);
    await g.capture('f04_hot_sand_mirage');
    await moveTo(g, device, { x: 2150, y: 1590 });
    await g.capture('f05_gap1_closed_muldeuli');
    backend.grantEvents(device, ['desert_ridge_pad']);
    await moveTo(g, device, { x: 2150, y: 1560 });
    await g.capture('f06_gap1_pad_open');
    await moveTo(g, device, { x: 2650, y: 1170 });
    await g.capture('f07_gap2_closed_pokshini');
    backend.grantEvents(device, ['desert_ridge_scent']);
    await moveTo(g, device, { x: 2650, y: 1140 });
    await g.capture('f08_gap2_scent_open');
    backend.grantEvents(device, ['desert_ridge_thread']);
    await moveTo(g, device, { x: 2950, y: 820 });
    await g.capture('f09_gap3_thread_open');
    await moveTo(g, device, { x: 2950, y: 600 });
    await g.capture('f10_cut_face');
    await talk(g, 'desert_cut_face', [{ x: 2950, y: 520 }]);
    await g.advanceDialogue(glimpseShown('scissors-glimpse'));
    await waitFx(g, 'scissors-glimpse');
    await g.capture('d02_scissors_glimpse');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await moveTo(g, device, { x: 2450, y: 470 });
    await g.capture('f11_boss_entrance');
  }, backend, device);
  await g.close();
});

test('C5 캡처 ③(1280×720): 능선 앞 전투 시작 → 불씨·젖은 칸·곧 끊어질 칸 → 열기 환영 → 끊긴 칸', async () => {
  const device = 'qa-desert-scorched-1280';
  await backend.start(seedDesert(device, 'joined'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-desert-scorched-1280', async () => {
    await enterDesert(g);
    await moveTo(g, device, { x: 1500, y: 1760 });
    await enterBattle(g, 'desert_scorched', [{ x: 1640, y: 1690 }]);
    await g.capture('b01_scorched_start');
    await g.playBattle(300_000, snapHas(`(b.snap.embers ?? []).length > 0 && (b.snap.wet ?? []).length > 0 && ${myTurn}`));
    await g.capture('b02_ember_wet_warn');
    // 자동 진행은 매듭부터 쳐서 칸이 끊기기 전에 이긴다 — 매듭이 남은 이 차례를 그대로 넘겨 끊김을 먼저 일으킨다
    await g.until('매듭 남음', snapHas(`b.snap.units.some((u) => u.knotOf && !u.stunned && !u.fled) && ${myTurn} && !b.busy`));
    await g.clickLabel('턴 종료', { exact: true });
    await g.until('끊긴 칸', snapHas(`(b.snap.cut ?? []).length > 0 && ${myTurn}`), 60_000);
    await g.capture('b04_cut_cell');
    await g.playBattle(300_000, snapHas(`b.snap.units.some((u) => u.mirageOf && !u.stunned && !u.fled) && ${myTurn}`));
    await g.capture('b03_heat_mirage');
  }, backend, device);
  await g.close();
});

test('C5 캡처 ④(1280×720): 황금 재단인형 시작 → 줄 예고 → 연결점 다시 꿰매짐 → 안쪽 연결 열림 → 풀려 무너짐 → 가위 → 마감실·다섯 유물 → 갈라진 바닥', async () => {
  const device = 'qa-desert-boss-1280';
  await backend.start(seedDesert(device, 'crossed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-desert-boss-1280', async () => {
    await enterDesert(g);
    await moveTo(g, device, { x: 2600, y: 470 });
    await enterBattle(g, 'desert_boss_entrance', [{ x: 2380, y: 470 }]);
    await g.capture('b05_boss_start');
    await g.playBattle(300_000, snapHas(`(b.snap.cutWarns ?? []).length > 0 && ${myTurn}`));
    await g.capture('b06_line_warn');
    await g.playBattle(300_000, snapHas(`b.snap.units.some((u) => u.regen && u.reviving) && ${myTurn}`));
    await g.capture('b07_point_regen');
    await g.playBattle(300_000, snapHas(`b.snap.units.filter((u) => u.regen && u.stunned && !u.reviving).length === 3 && ${myTurn}`));
    await g.capture('b08_inner_link_open');
    await g.playBattle(300_000, snapHas("b.snap.units.some((u) => u.unitId === 'golden_doll' && u.phase === 'exposed')"));
    await g.capture('b09_boss_unraveled');
    await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('승리 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(glimpseShown('scissors-reveal'));
    await waitFx(g, 'scissors-reveal');
    await g.capture('d03_scissors_reveal');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('사막 지도', MAP_READY, 30_000);
    await settleCamera(g);
    await g.capture('f12_floor_cut');
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = ((await g.state()).inventory.cells as { code: string; x: number; y: number; w: number; h: number }[]).find((c) => c.code === 'golden_finish_thread')!;
    await g.clickAt(cell.x + cell.w / 2, cell.y + cell.h / 2, "s.inventory.selected === 'golden_finish_thread'");
    await g.capture('i01_thread_detail');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    await g.advanceDialogue(glimpseShown('five-relics'));
    await waitFx(g, 'five-relics');
    await g.capture('d04_five_relics');
  }, backend, device);
  await g.close();
});

test('C5 캡처 ⑤(640×360): 뜨거운 모래·틈 → 절단면 → 금빛 마감실 입구', async () => {
  const device = 'qa-desert-map-640';
  await backend.start(seedDesert(device, 'won'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-desert-map-640', async () => {
    await enterDesert(g);
    await moveTo(g, device, { x: 2150, y: 1590 });
    await g.capture('m01_hot_sand_gap');
    backend.grantEvents(device, ['desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread']);
    await moveTo(g, device, { x: 2950, y: 600 });
    await g.capture('m02_cut_face');
    backend.grantEvents(device, ['desert_ridge_crossed'], 'CH05_RIDGE_CROSSED');
    await moveTo(g, device, { x: 2450, y: 470 });
    await g.capture('m03_boss_entrance');
  }, backend, device);
  await g.close();
});

test('C5 캡처 ⑥(640×360): 능선 앞 전투·황금 재단인형 전투(라벨이 몰리는 장면)', async () => {
  const device = 'qa-desert-battle-640';
  await backend.start(seedDesert(device, 'joined'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-desert-battle-640', async () => {
    await enterDesert(g);
    await moveTo(g, device, { x: 1500, y: 1760 });
    await enterBattle(g, 'desert_scorched', [{ x: 1640, y: 1690 }], 'joystick');
    await g.playBattle(300_000, snapHas(`(b.snap.cutWarns ?? []).length > 0 && ${myTurn}`));
    await g.capture('m04_scorched_battle');
  }, backend, device);
  await g.close();
  const device2 = 'qa-desert-boss-640';
  await backend.start(seedDesert(device2, 'crossed'), { 'story.stageAccessV2': true });
  const g2 = await Game.open(browser, `${vite.url}/?device=${device2}`, device2, SMALL);
  await withDiagnosis(g2, 'qa-desert-boss-640', async () => {
    await enterDesert(g2);
    await moveTo(g2, device2, { x: 2600, y: 470 });
    await enterBattle(g2, 'desert_boss_entrance', [{ x: 2380, y: 470 }], 'joystick');
    await g2.playBattle(300_000, snapHas(`(b.snap.cutWarns ?? []).length > 0 && ${myTurn}`));
    await g2.capture('m05_boss_battle');
  }, backend, device2);
  await g2.close();
});
