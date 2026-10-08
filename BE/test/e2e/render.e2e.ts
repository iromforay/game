// 10-06 v2·v8: 최종 숲 렌더링 — 대형 배경 한 장 + 진행 상태별 월드 그림 + 수풀 잠금 오버레이. 최종 PNG가 연결돼 있으므로 실제 텍스처로 확인한다.
// 에셋이 없는 키는 임시 도형으로 폴백한다(시험 ①).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
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

const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
type Render = { background: string; overlays: string[]; gates: { id: string; open: boolean; art: string | null; placeholder: boolean }[]; tileSprites: number; imageObjects: number };
const renderOf = async (g: Game) => ((await g.state()).map as { render: Render }).render;

async function enterForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 지도', READY);
}

// 10-06 v8: 최종 에셋이 실제로 연결됐다 — 시험 페이지에 임시 텍스처를 넣지 않는다(실제 PNG가 런타임에 로드된다)
test('렌더링 ①: 에셋이 없는 키는 임시 도형으로 폴백하고(배경 키가 없으면 회색상자) tileSprite를 쓰지 않는다 — 대상이 보인다', async () => {
  const device = 'e2e-render-fallback';
  await backend.start(seedForest(device, 'rescued'));
  // 서버 데이터가 아직 납품되지 않은 에셋 키를 가리키는 상황을 시험 인스턴스의 지역 데이터에서 만든다
  backend.patchStage('forest', (d) => {
    d.render!.background = { assetKey: 'forest-base-missing' };
    for (const o of d.render!.overlays!) o.assetKey = `${o.assetKey}-missing`;
    for (const g of d.layout!.gates) { g.closedAssetKey = `${g.closedAssetKey}-missing`; g.openAssetKey = g.openAssetKey ? `${g.openAssetKey}-missing` : g.openAssetKey; }
  });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'render-fallback', async () => {
    await enterForest(g);
    const r = await renderOf(g);
    assert.equal(r.background, 'greybox', '배경 텍스처가 없어 임시 회색상자');
    assert.equal(r.tileSprites, 0, '반복 타일을 쓰지 않는다');
    assert.deepEqual(r.overlays, [], '월드 그림이 없으면 오버레이는 그리지 않는다(임시 도형만 남는다)');
    // 먼지바람 문: 닫힘 그림이 없으므로 임시 사각형
    assert.deepEqual(r.gates.map((x) => [x.id, x.art, x.placeholder]), [['gate_hidden_path', null, true]]);
    const st = (await g.state()).map.story as { points: string[]; objects: string[] };
    assert.ok(st.points.length > 0 && st.objects.length === 10, '이야기 지점과 수집물이 서버 화면 그대로 있다');
    await g.capture('15_render_fallback_placeholder_kept');
  }, backend, device);
  await g.close();
});

test('렌더링 ②: 최종 에셋 — 대형 배경 한 장(tileSprite 0)·먼지바람 문·수풀, 숨은 길이 열리면 오버레이와 문 그림·충돌이 함께 바뀌고 수풀이 걷힌다', async () => {
  const device = 'e2e-render-final';
  await backend.start(seedForest(device, 'compass'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'render-final', async () => {
    await enterForest(g);
    let r = await renderOf(g);
    assert.equal(r.background, 'final');
    assert.equal(r.tileSprites, 0, '최종 분기에서는 tileSprite를 쓰지 않는다');
    assert.deepEqual(r.overlays, ['hidden-area-thicket-locked', 'turby-bopuli'], '개방 전: 숨은 길은 수풀이 가린다(구조 뒤라 먼지실 오버레이는 없고 보풀이 NPC는 유지)');
    assert.deepEqual(r.gates.map((x) => [x.id, x.open, x.art, x.placeholder]), [['gate_hidden_path', false, 'dust-wind-closed', false]]);
    const size = (await g.page.evaluate(() => { const m = (window as any).__game.scene.getScene('Map'); const bg = m.children.list.find((c: any) => c.type === 'Image' && c.texture.key === 'forest-base'); return { w: bg.displayWidth, h: bg.displayHeight, depth: bg.depth, bounds: [m.cameras.main.getBounds().width, m.cameras.main.getBounds().height], src: [bg.texture.getSourceImage().width, bg.texture.getSourceImage().height] }; })) as { w: number; h: number; depth: number; bounds: number[]; src: number[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([size.w, size.h, size.depth, size.bounds, size.src], [3200, 2400, -30, [3200, 2400], [3200, 2400]], '배경은 지도 크기 한 장(원본 3200×2400), 카메라 경계 = 지도 크기');
    await g.capture('16_render_final_before_open');
    const snap = () => g.page.evaluate(() => { const m = (window as any).__game.scene.getScene('Map'); const c = m.cameras.main; return { avatar: { x: m.avatar.x, y: m.avatar.y }, cam: { x: c.scrollX, y: c.scrollY }, scene: m.scene.key, bg: m.children.list.filter((o: any) => o.type === 'Image' && o.texture.key === 'forest-base').length }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const before = await snap();
    assert.equal(r.overlays.includes('fog-veil'), false, '검은 안개 키는 렌더 계획에 없다');
    // 서버에 숨은 길 개방 이벤트를 기록 → 화면 데이터를 다시 받으면 오버레이·문·충돌이 함께 바뀐다
    backend.grantEvent(device, 'forest_hidden_path_opened');
    await g.page.evaluate(() => (window as any).__game.scene.getScene('Map').refreshStageView());
    await g.until('개방 반영', "s.map.render.overlays.length === 4 && s.map.story.gates.gate_hidden_path === true");
    r = await renderOf(g);
    assert.deepEqual(r.overlays, ['hidden-path-reveal-v2', 'hidden-yarn-path', 'giant-thread-knot-map', 'turby-bopuli'], '수풀이 걷히고 숨은 길 그림과 거대 매듭이 나타난다');
    assert.deepEqual(r.gates.map((x) => [x.id, x.open, x.art]), [['gate_hidden_path', true, null], ['gate_root', false, 'root-gate-closed']], '먼지바람은 사라지고 실뿌리 문이 닫힘 그림으로 나타난다');
    assert.equal(r.tileSprites, 0);
    assert.equal(r.overlays.includes('hidden-area-thicket-locked'), false);
    assert.deepEqual(await snap(), before, '전환 전후 씬 재시작 없이 플레이어·카메라 좌표와 배경 객체가 그대로다');
    await g.capture('17_render_final_after_open');
  }, backend, device);
  await g.close();
});

test('렌더링 ③: 보풀이는 구조 전 먼지실 오버레이, 구조 뒤 정상(NPC 유지), 거대 매듭은 격파 기록 직후 제거, 단수링은 첫 매듭 장착 뒤에만 — 같은 연결에서 바뀐다', async () => {
  const device = 'e2e-render-npcs';
  await backend.start(seedForest(device, 'cut'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'render-npcs', async () => {
    await enterForest(g);
    const refresh = () => g.page.evaluate(() => (window as any).__game.scene.getScene('Map').refreshStageView()); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual((await renderOf(g)).overlays, ['hidden-area-thicket-locked', 'turby-bopuli', 'bopuli-tangled-overlay'], '구조 전: 먼지실에 붙잡힌 보풀이');
    await g.capture('18_bopuli_tangled_before_rescue');
    backend.grantEvent(device, 'forest_bopul_rescued');
    await refresh();
    await g.until('구조 반영', "s.map.render.overlays.length === 2");
    assert.deepEqual((await renderOf(g)).overlays, ['hidden-area-thicket-locked', 'turby-bopuli'], '구조 뒤: 정상 보풀이');
    for (const e of ['forest_compass_granted', 'forest_hidden_path_opened']) backend.grantEvent(device, e);
    await refresh();
    await g.until('거대 매듭 표시', "s.map.render.overlays.includes('giant-thread-knot-map')");
    assert.ok(!(await renderOf(g)).overlays.includes('dansuring'));
    await g.capture('19_giant_knot_map_visible');
    backend.grantEvent(device, 'forest_giant_knot_defeated');
    await refresh();
    await g.until('거대 매듭 제거', "!s.map.render.overlays.includes('giant-thread-knot-map')");
    assert.ok((await renderOf(g)).overlays.includes('turby-bopuli'), '보풀이는 남는다');
    for (const e of ['forest_first_knot_awakened', 'forest_first_knot_equipped']) backend.grantEvent(device, e);
    await refresh();
    await g.until('단수링 표시', "s.map.render.overlays.includes('dansuring')");
    await g.capture('20_dansuring_after_first_knot_equipped');
  }, backend, device);
  await g.close();
});
