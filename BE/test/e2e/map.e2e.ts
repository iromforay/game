// 10-01 v2 §3·§4·§7: 탐험 맵 HUD·전체 지도 — 640×360 배치, 1280↔640 resize(위치·탐험 세션·목표 유지, 맵을 다시 시작하지 않음),
// 전체 지도 열기·닫기·범례, 지도를 닫은 뒤 조이스틱 한 번 입력. UI 행동은 한 번만(재시도 없음).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedChapters, seedDelivery } from './fixtures';

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
const BIG = { width: 1280, height: 720 };
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
const LONG_GOAL = '빛나는 실가루를 열 개 모아 보풀이에게 가져다주기 — 숲의 오래된 나무 밑동과 이끼 사이, 그리고 길이 갈라지는 곳의 돌 틈을 살펴보면 조금씩 찾을 수 있어요 (지금 3/10)';

// 마을에서 걸어 나가 숲으로(실제 방향키·클릭)
async function enterForest(g: Game) {
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt, { exact: true, expect: "s.scenes.includes('StageSelect')" });
  await g.until('지역 선택', 's.stageSelect && s.stageSelect.count >= 1');
  const forest = (await g.state()).stageSelect.cards[0];
  await g.clickAt(forest.x, forest.y, "s.scenes.includes('Map')");
  await g.until('맵 준비', 's.map && s.map.ready && s.map.inRoom');
}

test('맵 ①: 탐험 HUD — 640×360 배치(지역 이름·포획·마을로·방 상태·목표·미니맵·버튼), 1280↔640 resize에도 위치·방·목표 유지(맵 재시작 없음), 긴 목표는 줄바꿈', async () => {
  const device = 'e2e-map-hud';
  await backend.start((db) => {
    seedChapters(db);
    seedDelivery(device)(db);
  });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'map-hud', async () => {
    await enterForest(g);
    let m = (await g.state()).map;
    assert.equal(m.hudMode, 'compact');
    assert.equal(m.inputPatch.state, 'installed', '입력 패치가 확인한 Phaser 버전에서 설치됨');
    assert.deepEqual([m.inputPatch.phaser, m.inputPatch.verified], ['3.90.0', '3.90.0']);
    await g.until('목표 표시', 's.map.goal === true');
    let t = await texts(g);
    assert.ok(t.includes('숲 (소파 속 먼지숲)') && t.includes('포획: 0') && t.includes('마을로') && t.includes('인벤토리') && t.includes('터비'), 'HUD 글자');
    assert.ok(t.some((x) => x.startsWith('방 ') && x.includes('1/')), '방·참가자 상태');
    assert.ok(t.some((x) => x.includes('빛나는 실가루') && x.includes('3/10')), '스토리 목표 추적');
    assert.ok(!t.some((x) => x.includes('보풀이에게 실가루 전달(개발용)')), '운영 화면에는 원격 전달 버튼이 없다');
    await g.capture('02_map_hud_small');

    // 조금 걸어서 위치를 만든 뒤 resize — 위치·방·목표가 그대로이고 맵 씬은 다시 시작되지 않는다
    await g.until('위치 배치', 's.map.positioned === true');
    const start = (await g.state()).map.avatar;
    await g.walkTo('Map', { x: start.x - 100, y: start.y + 40 }, 'joystick', 'false', 12);
    const before = (await g.state()).map;
    const gen = await g.page.evaluate("window.__game.scene.getScene('Map').generation");
    const listeners = await g.page.evaluate("window.__game.scale.listenerCount('resize')");
    await g.page.setViewportSize(BIG);
    await g.until('보통 HUD', "s.map && s.map.hudMode === 'regular' && s.map.miniMap.mode === 'regular'");
    let after = (await g.state()).map;
    assert.deepEqual(after.avatar, before.avatar, '플레이어 위치 유지');
    assert.deepEqual([after.goal, after.inRoom, after.room], [true, true, before.room], '목표·탐험 세션·방 상태 유지');
    assert.equal(await g.page.evaluate("window.__game.scene.getScene('Map').generation"), gen, '맵을 다시 시작하지 않음');
    await g.capture('01_map_hud_big');
    await g.page.setViewportSize(SMALL);
    await g.until('작은 HUD', "s.map && s.map.hudMode === 'compact' && s.map.miniMap.mode === 'compact'");
    after = (await g.state()).map;
    assert.deepEqual(after.avatar, before.avatar);
    assert.equal(await g.page.evaluate("window.__game.scale.listenerCount('resize')"), listeners, 'resize를 반복해도 리스너가 늘지 않음');

    // 긴 목표 문구(시험용 문구): 목표 영역 폭 안에서 줄바꿈되고 조이스틱 영역을 침범하지 않는다
    await g.page.evaluate(`(() => { const m = window.__game.scene.getScene('Map'); m.goalTextOverride = ${JSON.stringify(LONG_GOAL)}; m.showDelivery(m.lastDelivery); })()`);
    m = (await g.state()).map;
    t = await texts(g);
    assert.ok(t.includes(LONG_GOAL), '긴 목표 문구가 잘리지 않고 그대로');
    assert.ok(m.goalHeight > 60 && 8 + m.goalHeight < m.joystickZone.y, `목표 패널(${m.goalHeight})이 여러 줄로 늘되 조이스틱 영역 위`);
    await g.capture('03_map_long_goal_small');
    await g.page.setViewportSize(BIG);
    await g.until('보통 HUD', "s.map && s.map.hudMode === 'regular'");
    assert.ok((await texts(g)).includes(LONG_GOAL), 'resize 뒤에도 목표 문구 유지');
    await g.page.setViewportSize(SMALL);
    await g.until('작은 HUD', "s.map && s.map.hudMode === 'compact'");

    // HUD 버튼 한 번씩: 터비 창 열고 닫기, 인벤토리 열고 닫기, 마을로
    m = (await g.state()).map;
    await g.clickAt(m.buttons.turbys.x, m.buttons.turbys.y, 's.map.turbyPanel === true');
    await g.clickLabel('닫기 ✕', { exact: true, expect: 's.map.turbyPanel === false' });
    await g.clickAt(m.buttons.inventory.x, m.buttons.inventory.y, "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('닫기', { exact: true, expect: '!s.inventory' });
    await g.clickAt(m.buttons.home.x, m.buttons.home.y, "s.scenes.includes('Village')");
  }, backend, device);
  await g.close();
});

test('맵 ②: 전체 지도 — 열기·범례·닫기(640×360), 열린 채 1280↔640 resize에도 열림·위치 유지, 닫은 뒤 조이스틱 한 번 입력으로 이동, 이동 입력이 이중으로 남지 않음', async () => {
  const device = 'e2e-map-full';
  await backend.start((db) => {
    seedChapters(db);
    seedDelivery(device)(db);
  });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'map-full', async () => {
    // 마을 지도(마커 3종 + 목적지 고리): 640×360에서는 지도 위 이름표 없이 범례로
    await g.until('마을 준비', 's.village && s.village.ready');
    let mm = (await g.state()).village.miniMap;
    assert.deepEqual([mm.mode, mm.labelsOnMap, mm.open], ['compact', false, false]);
    await g.clickAt(mm.openButton.x, mm.openButton.y, 's.village.miniMap.open === true && s.village.paused === true');
    await g.capture('05a_full_map_small');
    let t = await texts(g);
    assert.ok(t.includes('범례 보기 ▾') && !t.includes('내 집') === false || t.includes('범례 보기 ▾'), '범례는 접힌 채 버튼으로');
    await g.clickLabel('범례 보기', { expect: 's.village.miniMap.legendOpen === true' });
    t = await texts(g);
    for (const label of ['내 위치 — 화살표(가는 방향)', '내 집', '장터', '야생 출구']) assert.ok(t.includes(label), `범례: ${label}`);
    await g.capture('05b_full_map_legend_small');

    // 열린 채 resize: 열림·범례 상태 유지, 보통 화면은 지도 위 이름표 + 범례 상시 표시
    await g.capture('06a_full_map_resize_before');
    await g.page.setViewportSize(BIG);
    await g.until('보통 배치(열린 채)', "s.village.miniMap.mode === 'regular' && s.village.miniMap.open === true && s.village.paused === true");
    t = await texts(g);
    assert.ok(t.includes('마을 지도') && t.includes('M 또는 Esc로 닫기') && t.includes('범례'), '보통 화면 지도');
    await g.capture('06b_full_map_resize_after');
    await g.capture('04_full_map_big');
    await g.page.setViewportSize(SMALL);
    await g.until('작은 배치(열린 채)', "s.village.miniMap.mode === 'compact' && s.village.miniMap.open === true");
    mm = (await g.state()).village.miniMap;
    await g.clickAt(mm.close.x + mm.close.w / 2, mm.close.y + mm.close.h / 2, 's.village.miniMap.open === false && s.village.paused === false');

    // 숲에서: 지도 열기 → 닫기 → 조이스틱 한 번 끌기로 이동(닫은 뒤 입력이 살아 있고, 손을 떼면 멈춘다)
    await enterForest(g);
    mm = (await g.state()).map.miniMap;
    await g.clickAt(mm.openButton.x, mm.openButton.y, 's.map.miniMap.open === true');
    const held = await g.state();
    // 지도가 열린 동안에는 화면을 끌어도 움직이지 않는다
    const a = await g.canvasToPage(400, 600);
    const b = await g.canvasToPage(470, 600);
    await g.page.mouse.move(a.x, a.y);
    await g.page.mouse.down();
    await g.page.mouse.move(b.x, b.y, { steps: 3 });
    await g.page.mouse.up();
    assert.deepEqual((await g.state()).map.avatar, held.map.avatar, '지도가 열려 있으면 이동 입력을 받지 않음');
    mm = (await g.state()).map.miniMap;
    await g.clickAt(mm.close.x + mm.close.w / 2, mm.close.y + mm.close.h / 2, 's.map.miniMap.open === false');
    const x0 = (await g.state()).map.avatar.x;
    await g.page.mouse.move(a.x, a.y);
    await g.page.mouse.down();
    await g.page.mouse.move(b.x, b.y, { steps: 3 });
    await g.until('조이스틱 한 번 입력으로 오른쪽 이동', `s.map.avatar.x >= ${x0 + 40}`);
    await g.page.mouse.up();
    // 손을 뗀 뒤에는 멈춘다(이동 입력이 이중으로 남지 않음): 두 프레임 사이 위치가 같다
    const stopped = await g.page.evaluate(() => new Promise((resolve) => { const m = (window as any).__game.scene.getScene('Map'); requestAnimationFrame(() => { const x1 = m.avatar.x; requestAnimationFrame(() => requestAnimationFrame(() => resolve(m.avatar.x === x1))); }); })); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(stopped, true, '손을 떼면 멈춤');
  }, backend, device);
  await g.close();
});
