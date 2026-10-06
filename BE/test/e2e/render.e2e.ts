// 10-06 v2: 최종 숲 렌더링 구조(에셋 비의존). 최종 PNG가 없으므로 시험 페이지에서만 임시 캔버스 텍스처를 같은 키로 주입해 연결 경로를 확인한다
// (제품 코드·에셋 폴더에는 아무것도 넣지 않는다). 주입한 색 캔버스는 미술이 아니라 "키가 있으면 그 텍스처를 쓴다"는 연결 증거다.
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
// 시험 페이지에만: 같은 키의 임시 색 캔버스 텍스처를 만든다
const inject = (g: Game, keys: [string, number, number, string][]) =>
  g.page.evaluate((list) => {
    const tm = (window as any).__game.textures; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const [key, w, h, color] of list as [string, number, number, string][]) {
      if (tm.exists(key)) continue;
      const t = tm.createCanvas(key, w, h);
      t.context.fillStyle = color;
      t.context.fillRect(0, 0, w, h);
      t.refresh();
    }
  }, keys);

test('렌더링 ①: 최종 에셋이 없으면(greybox:false여도) 회색상자·임시 도형이 유지되고 tileSprite를 쓰지 않으며, 대상이 보인다', async () => {
  const device = 'e2e-render-fallback';
  await backend.start(seedForest(device, 'rescued'));
  backend.patchStage('forest', (d) => (d.greybox = false)); // 최종 배경 키는 있지만 텍스처가 없는 상황(미납품)
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'render-fallback', async () => {
    await enterForest(g);
    const r = await renderOf(g);
    assert.equal(r.background, 'greybox', '배경 텍스처가 없어 임시 회색상자');
    assert.equal(r.tileSprites, 0, '반복 타일을 쓰지 않는다');
    assert.deepEqual(r.overlays, []);
    // 먼지바람 문: 닫힘 그림이 없으므로 임시 사각형
    assert.deepEqual(r.gates.map((x) => [x.id, x.art, x.placeholder]), [['gate_hidden_path', null, true]]);
    const st = (await g.state()).map.story as { points: string[]; objects: string[] };
    assert.ok(st.points.length > 0 && st.objects.length === 10, '이야기 지점과 수집물이 서버 화면 그대로 있다');
    await g.capture('15_render_fallback_placeholder_kept');
  }, backend, device);
  await g.close();
});

test('렌더링 ②: 같은 키의 텍스처가 있으면 대형 배경 한 장(tileSprite 0)·문 닫힘 그림, 숨은 길이 열리면 오버레이와 문 그림·충돌이 함께 바뀐다', async () => {
  const device = 'e2e-render-final';
  await backend.start(seedForest(device, 'compass'));
  backend.patchStage('forest', (d) => (d.greybox = false));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'render-final', async () => {
    await g.waitScene('Village');
    await g.until('마을 준비', 's.village && s.village.ready');
    // 시험 페이지에만 임시 텍스처 주입(미술 아님)
    await inject(g, [['forest-base', 3200, 2400, '#5a7f4a'], ['dust-wind-closed', 320, 360, '#c9b6e8'], ['hidden-path-reveal', 960, 560, '#f3e6b0'], ['hidden-yarn-path', 768, 256, '#ffd6e0'], ['root-gate-closed', 480, 520, '#7a5a3a'], ['root-gate-open', 480, 520, '#bfa26a']]);
    await enterForest(g);
    let r = await renderOf(g);
    assert.equal(r.background, 'final');
    assert.equal(r.tileSprites, 0, '최종 분기에서는 tileSprite를 쓰지 않는다');
    assert.deepEqual(r.overlays, [], '개방 전: 숨은 길 오버레이 없음');
    assert.deepEqual(r.gates.map((x) => [x.id, x.open, x.art, x.placeholder]), [['gate_hidden_path', false, 'dust-wind-closed', false]]);
    const size = (await g.page.evaluate(() => { const m = (window as any).__game.scene.getScene('Map'); const bg = m.children.list.find((c: any) => c.type === 'Image' && c.texture.key === 'forest-base'); return { w: bg.displayWidth, h: bg.displayHeight, depth: bg.depth, bounds: [m.cameras.main.getBounds().width, m.cameras.main.getBounds().height] }; })) as { w: number; h: number; depth: number; bounds: number[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([size.w, size.h, size.depth, size.bounds], [3200, 2400, -30, [3200, 2400]], '배경은 지도 크기 한 장, 카메라 경계 = 지도 크기');
    await g.capture('16_render_final_branch_injected_textures_before_open');
    // 서버에 숨은 길 개방 이벤트를 기록 → 화면 데이터를 다시 받으면 오버레이·문·충돌이 함께 바뀐다
    backend.grantEvent(device, 'forest_hidden_path_opened');
    await g.page.evaluate(() => (window as any).__game.scene.getScene('Map').refreshStageView());
    await g.until('개방 반영', "s.map.render.overlays.length === 2 && s.map.story.gates.gate_hidden_path === true");
    r = await renderOf(g);
    assert.deepEqual(r.overlays, ['hidden-path-reveal', 'hidden-yarn-path']);
    assert.deepEqual(r.gates.map((x) => [x.id, x.open, x.art]), [['gate_hidden_path', true, null], ['gate_root', false, 'root-gate-closed']], '먼지바람은 사라지고 실뿌리 문이 닫힘 그림으로 나타난다');
    assert.equal(r.tileSprites, 0);
    await g.capture('17_render_final_branch_injected_textures_after_open');
  }, backend, device);
  await g.close();
});
