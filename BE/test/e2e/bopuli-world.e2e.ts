// 10-06 v7 §2: 기존 turby-bopuli 이미지를 월드 표시 크기(160×160)로 보풀이 공터에 놓았을 때의 판정 자료(캡처).
// 먼지실 오버레이 최종 PNG는 아직 없으므로 시험 페이지에서만 단색 반투명 캔버스를 같은 키로 주입해 "연결 범위와 크기"만 본다 — 제품 에셋에는 추가하지 않는다.
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

const SMALL = { width: 640, height: 360 };
const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const BOPULI = { x: 1240, y: 1000 };

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
// 보풀이에서 아래로 떨어진 자리(상호작용 버튼이 뜨지 않는 거리)에 서서 새로고침해 그 자리에서 시작한다
async function standNearBopuli(g: Game, device: string) {
  backend.displace(device, { x: BOPULI.x, y: BOPULI.y + 150 });
  await g.reload();
  await g.until('Map 복원', READY);
}
const bopuliImage = (g: Game) =>
  g.page.evaluate(() => {
    const m = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const img = m.children.list.find((c: any) => c.type === 'Image' && c.texture.key === 'turby-bopuli' && c.depth > -5); // eslint-disable-line @typescript-eslint/no-explicit-any
    const src = m.textures.get('turby-bopuli').getSourceImage();
    return img ? { w: Math.round(img.displayWidth), h: Math.round(img.displayHeight), x: img.x, y: img.y, originY: img.originY, src: [src.width, src.height] } : null;
  }) as Promise<{ w: number; h: number; x: number; y: number; originY: number; src: number[] } | null>;

test('보풀이 월드 표시 ①: 구조 뒤 정상 보풀이를 공터에 160×160으로 단독 표시(1280×720)', async () => {
  const device = 'e2e-bopuli-normal';
  await backend.start(seedForest(device, 'rescued'));
  backend.patchStage('forest', (d) => (d.greybox = true)); // 회색상자 그대로
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'bopuli-normal-1280', async () => {
    await enterForest(g);
    await standNearBopuli(g, device);
    const b = await bopuliImage(g);
    assert.deepEqual(b && [b.w, b.h, b.x, b.y, b.originY, b.src], [160, 160, BOPULI.x, BOPULI.y, 0.9, [512, 512]], '160×160 표시, 원본 512×512');
    await g.capture('01_bopuli_normal_1280x720');
  }, backend, device);
  await g.close();
});

test('보풀이 월드 표시 ②: 구조 전, 먼지실 오버레이(단색 반투명 fixture)가 보풀이 위에 같은 위치·256×256으로 덮인다(1280×720)', async () => {
  const device = 'e2e-bopuli-tangled';
  await backend.start(seedForest(device, 'cut'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'bopuli-tangled-1280', async () => {
    await enterForest(g);
    await standNearBopuli(g, device); // 새로고침으로 페이지가 다시 열린 뒤에 fixture를 주입한다(텍스처는 페이지 메모리에만 있다)
    // 시험 페이지에만: 연결 범위와 크기를 보기 위한 단색 반투명 캔버스(미술 아님)
    await g.page.evaluate(() => {
      const t = (window as any).__game.textures.createCanvas('bopuli-tangled-overlay', 256, 256); // eslint-disable-line @typescript-eslint/no-explicit-any
      t.context.fillStyle = 'rgba(40, 20, 60, 0.55)';
      t.context.fillRect(0, 0, 256, 256);
      t.refresh();
      return (window as any).__game.scene.getScene('Map').refreshStageView(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    await g.until('오버레이 연결', "s.map.render.overlays.includes('bopuli-tangled-overlay')");
    const overlays = (await g.page.evaluate(() => (window as any).__dev.state().map.render.overlays)) as string[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(overlays, ['turby-bopuli', 'bopuli-tangled-overlay'], '구조 전: 보풀이 위에 먼지실 오버레이');
    const o = (await g.page.evaluate(() => {
      const m = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const img = m.children.list.find((c: any) => c.type === 'Image' && c.texture.key === 'bopuli-tangled-overlay'); // eslint-disable-line @typescript-eslint/no-explicit-any
      return { w: Math.round(img.displayWidth), h: Math.round(img.displayHeight), x: img.x, y: img.y, originY: img.originY };
    })) as { w: number; h: number; x: number; y: number; originY: number };
    assert.deepEqual([o.w, o.h, o.x, o.y, o.originY], [256, 256, BOPULI.x, BOPULI.y, 0.9]);
    await g.capture('02_bopuli_with_tangled_overlay_fixture_1280x720');
  }, backend, device);
  await g.close();
});

test('보풀이 월드 표시 ③: 640×360에서 정상 보풀이', async () => {
  const device = 'e2e-bopuli-small';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'bopuli-normal-640', async () => {
    await enterForest(g);
    await standNearBopuli(g, device);
    assert.equal((await bopuliImage(g))?.w, 160);
    await g.capture('03_bopuli_normal_640x360');
  }, backend, device);
  await g.close();
});
