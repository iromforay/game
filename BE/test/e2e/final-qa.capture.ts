// 10-26 F-6 종장 화면 검수용 캡처. 기능 시험이 아니라 화면 검수(F-6)에 넘길 장면을 찍는다(5장 desert-qa.capture.ts와 같은 방식).
// 정식 E2E 묶음(*.e2e.ts, groups·shards manifest)에 넣지 않는다. 실행(BE 폴더에서):
//   E2E_CAPTURE_DIR=<캡처 폴더> node --no-warnings --test --test-concurrency=1 -r ts-node/register/transpile-only test/e2e/final-qa.capture.ts
// 진행 상태는 테스트 격리 DB 시드(seedFinal)와 서버 위치 옮기기(displace)로 준비한다. 연출 캡처는 그림이 다 떠오른 뒤(waitFx) 찍는다.
import { test, before, after } from 'node:test';
import type { Browser } from 'playwright-core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFinal } from './fixtures';

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

type Pt = { x: number; y: number };
const HOME = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/home_core.json'), 'utf8')) as { points: (Pt & { id: string })[] };
const pointOf = (id: string) => HOME.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const ON_MAP = "s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')";

async function enterHome(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('종장 — 집의 중심', { exact: true });
  await g.until('집의 중심 지도', MAP_READY, 30_000);
}
// 서버 위치를 옮기고 다시 접속(카메라가 그 자리를 비춘다)
async function moveTo(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('집의 중심 지도', MAP_READY, 30_000);
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
async function talk(g: Game, id: string) {
  await g.walkDirect('Map', pointOf(id), 'keys', `s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await g.state()).map.story.interact as Pt;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
}
const fx = (cond: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && (${cond}); })()`;
const glimpseShown = (key: string) => fx(`sc.fxState.glimpseShown.includes('${key}')`);
// 연출 그림이 다 떠오를 때까지(알파 0.8 이상)
async function waitFx(g: Game, key: string) {
  await g.page.waitForFunction((k) => (window as any).__game.scene.getScenes(true).some((s: any) => s.children.list.some((o: any) => o.texture && o.texture.key === k && o.alpha >= 0.8)), key, { timeout: 8000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
}
// 화면에 이 글자가 보일 때까지 대화를 넘긴다
const textShown = (t: string) => `(() => window.__game.scene.getScenes(true).some((s) => s.children.list.some((o) => (o.text ?? '').includes(${JSON.stringify(t)}) && o.visible)) || window.__game.scene.getScenes(true).some((s) => s.layer && s.layer.list && s.layer.list.some((o) => (o.text ?? '').includes(${JSON.stringify(t)}))))()`;
// 일시 안내(토스트 — 깊이 1000 상자)가 모두 사라질 때까지(작은 화면 하단 이름표 판정은 지나가는 안내를 빼고 본다)
const toastsGone = (g: Game) => g.page.waitForFunction(() => !(window as any).__game.scene.getScene('Battle').children.list.some((o: any) => o.type === 'Container' && o.depth === 1000 && o.active && o.alpha > 0.05), null, { timeout: 15_000, polling: 100 }); // eslint-disable-line @typescript-eslint/no-explicit-any
const stageIs = (n: number) => `(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && !!b.snap.stage && b.snap.stage.index === ${n} && b.snap.currentPlayerId === b.myId; })()`;
const snapHas = (expr: string) => `(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && (${expr}); })()`;

test('종장 캡처 ①(1280×720): 금빛 길 입구 → 도착 장면 → 중앙(동료 넷·검은 틈) → 다섯 기억의 결속·그날의 기억', async () => {
  const device = 'qa-final-map-1280';
  await backend.start(seedFinal(device), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-final-map-1280', async () => {
    await enterHome(g);
    await settleCamera(g);
    await g.capture('f01_golden_path');
    await talk(g, 'final_arrival');
    await g.capture('d01_arrival_dialogue');
    await g.advanceDialogue(glimpseShown('five-relics'));
    await waitFx(g, 'five-relics');
    await g.capture('d02_five_relics_glow');
    await g.advanceDialogue(ON_MAP);
    await moveTo(g, device, { x: 1600, y: 1230 }); // F-6 QA-F03: 결속 지점에서 검은 틈이 바로 위에 보인다
    await g.capture('f02_core_companions_gap');
    await moveTo(g, device, { x: 900, y: 1250 });
    await g.capture('f03_lake_thread_muldeuli');
    await moveTo(g, device, { x: 700, y: 560 });
    await g.capture('f04_forest_thread_bopuli');
    await moveTo(g, device, pointOf('final_arrival'));
    await talk(g, 'final_core');
    await g.advanceDialogue(glimpseShown('five-bind'));
    await waitFx(g, 'five-bind');
    await g.capture('d03_five_bind');
    await g.advanceDialogue(glimpseShown('origin-fall'));
    await waitFx(g, 'origin-fall');
    await g.capture('d04_origin_fall');
    await g.advanceDialogue(ON_MAP);
  }, backend, device);
  await g.close();
});

test('종장 캡처 ②(1280×720): 가위 등장 → 최종 전투 1·2·3단계 → 묶인 가위 → 매듭 연출 → 태초의 실타래 누비 이름표 → 다섯 실이 풀리다·실의 길 → 현실 세계(엄마의 손·털실) → 제목 카드 → 이어진 중앙', async () => {
  const device = 'qa-final-boss-1280';
  await backend.start(seedFinal(device, 'revealed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'qa-final-boss-1280', async () => {
    await enterHome(g);
    await moveTo(g, device, pointOf('final_core'));
    await talk(g, 'final_scissors');
    await g.advanceDialogue(glimpseShown('scissors-final-reveal'));
    await waitFx(g, 'scissors-final-reveal');
    await g.capture('d05_scissors_final_reveal');
    await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
    await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
    await g.capture('b01_stage1_cut_path');
    await g.playBattle(300_000, snapHas("(b.snap.sealed ?? []).length >= 2 && b.snap.currentPlayerId === b.myId"));
    await g.capture('b02_stage1_two_sealed');
    await g.playBattle(300_000, stageIs(1));
    await g.capture('b03_stage2_phantoms');
    await g.playBattle(300_000, snapHas("b.snap.units.filter((u) => u.releases && u.stunned).length >= 2 && b.snap.currentPlayerId === b.myId"));
    await g.capture('b04_stage2_two_threads');
    await g.playBattle(300_000, stageIs(2));
    await g.capture('b05_stage3_blades_knot');
    // 다섯 기억의 매듭을 묶는 일격이 곧 승리다 — 결과창 전 멈춤(1.4초) 동안 묶인 가위를 찍는다
    const finish = g.playBattle(300_000);
    await g.page.waitForFunction(() => { const b = (window as any).__game.scene.getScene('Battle'); return !!b && !b.resultShown && b.children.list.some((o: any) => o.list?.some((s: any) => s.texture?.key === 'scissors-bound')); }, null, { timeout: 300_000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.capture('b06_scissors_bound');
    await finish;
    await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
    await g.capture('b07_result');
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('매듭 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(glimpseShown('five-knot-bind'));
    await waitFx(g, 'five-knot-bind');
    await g.capture('d06_five_knot_bind');
    await g.advanceDialogue(textShown('태초의 실타래 누비'));
    await g.capture('d07_origin_name_label');
    await g.advanceDialogue(glimpseShown('five-unravel'));
    await waitFx(g, 'five-unravel');
    await g.capture('d08_five_unravel');
    await g.advanceDialogue(glimpseShown('thread-path'));
    await waitFx(g, 'thread-path');
    await g.capture('d09_thread_path');
    await g.advanceDialogue(glimpseShown('mother-hand'));
    await waitFx(g, 'mother-hand');
    await g.capture('d10_real_world_mother_hand');
    await g.advanceDialogue(glimpseShown('real-yarn-table-scene'));
    await g.page.waitForFunction(() => (window as any).__game.scene.getScenes(true).some((s: any) => s.children.list.some((o: any) => o.texture && ['real-yarn-table-scene', 'real-yarn-knot'].includes(o.texture.key) && o.alpha >= 0.8)), null, { timeout: 8000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any -- 장면 전체 그림(없으면 원형 연출)
    await g.capture('d11_real_yarn_knot');
    await g.advanceDialogue(fx('!!sc.fxState.endingReady'));
    await g.capture('e01_title_card');
    await g.clickAt(640, 360, ON_MAP);
    await g.until('집의 중심 지도', MAP_READY, 30_000);
    await moveTo(g, device, { x: 1600, y: 1230 });
    await g.capture('f05_core_joined');
  }, backend, device);
  await g.close();
});

test('종장 캡처 ③(640×360): 중앙 지도 · 최종 전투 2단계(환영·검정실 라벨) · 3단계', async () => {
  const device = 'qa-final-640';
  await backend.start(seedFinal(device, 'revealed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'qa-final-640', async () => {
    await enterHome(g);
    await moveTo(g, device, { x: 1600, y: 1330 });
    await g.capture('m01_core');
    await moveTo(g, device, pointOf('final_core'));
    await talk(g, 'final_scissors');
    await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
    await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
    await g.capture('m02_stage1');
    await g.playBattle(300_000, stageIs(1));
    await toastsGone(g);
    await g.capture('m03_stage2');
    await g.playBattle(300_000, stageIs(2));
    await toastsGone(g);
    await g.capture('m04_stage3');
  }, backend, device);
  await g.close();
});
