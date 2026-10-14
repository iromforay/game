// 10-14 C2-7A: 최종 호수 배경(lake-base) 연결 — 네 구역 일반 화면·충돌 디버그 화면 캡처와 정합성 확인(기능 좌표는 바꾸지 않는다).
// ① 1280×720: 입구→정착지→미로→염색 샘 카메라 이동 + 같은 실행에서 충돌 오버레이 토글 캡처
// ② 640×360: 네 구역 일반 화면, HUD·배경 경계 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedLake } from './fixtures';

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
const ZONES = { entrance: { x: 380, y: 2040 }, settlement: { x: 820, y: 1220 }, maze: { x: 1760, y: 1380 }, dye_spring: { x: 2700, y: 600 } } as const;
const FORBIDDEN = ['깊은 물', '물풀 벽', '회색상자', '임시 배치'];

type Render = { background: string; tileSprites: number; greyboxNotices: number; collisionDebug: boolean; camera: { x: number; y: number; w: number; h: number } };
const render = async (g: Game) => (await g.state()).map.render as Render;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
const look = async (g: Game, at: { x: number; y: number }) => {
  await g.page.evaluate(({ x, y }) => (window as any).__dev.lookAt(x, y), at); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.page.waitForFunction(({ x, y }) => { const c = (window as any).__game.scene.getScene('Map').cameras.main.worldView; return Math.abs(c.centerX - x) < 2 || c.x <= 0 || c.right >= 3200 || c.y <= 0 || c.bottom >= 2400; }, at, { timeout: 5000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
};

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
async function assertProductionRender(g: Game) {
  const r = await render(g);
  assert.equal(r.background, 'final', '최종 배경 모드');
  assert.equal(r.tileSprites, 0, '반복 타일 없음');
  assert.equal(r.greyboxNotices, 0);
  assert.equal(r.collisionDebug, false, '일반 화면에는 충돌 오버레이 없음');
  const t = await texts(g);
  for (const bad of FORBIDDEN) assert.equal(t.some((x) => x.includes(bad)), false, `개발 글자 노출: ${bad}`);
  const bg = await g.page.evaluate(() => { const m = (window as any).__game.scene.getScene('Map'); const i = m.bgImage; return { key: i.texture.key, x: i.x, y: i.y, w: i.displayWidth, h: i.displayHeight, depth: i.depth, angle: i.angle, type: i.type }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(bg, { key: 'lake-base', x: 0, y: 0, w: 3200, h: 2400, depth: -30, angle: 0, type: 'Image' });
}

test('2장 C2-7A ①(1280×720): 네 구역 일반 화면 → 충돌 오버레이 토글 캡처 → 오버레이 끄면 일반 화면 복귀', async () => {
  const device = 'e2e-final-1280';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-final-1280', async () => {
    await enterLake(g);
    await assertProductionRender(g);
    for (const [name, at] of Object.entries(ZONES)) {
      await look(g, at);
      await g.capture(name);
    }
    // 개발 모드 디버그: 같은 화면에서 토글(별도 실행 없음)
    await g.page.evaluate(() => (window as any).__dev.collisionDebug(true)); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await render(g)).collisionDebug, true);
    for (const [name, at] of Object.entries(ZONES)) {
      await look(g, at);
      await g.capture(`collision_${name}`);
    }
    await g.page.evaluate(() => (window as any).__dev.collisionDebug(false)); // eslint-disable-line @typescript-eslint/no-explicit-any
    await assertProductionRender(g);
  }, backend, device);
  await g.close();
});

test('2장 C2-7A ②(640×360): 네 구역 일반 화면, HUD와 배경 경계(카메라가 월드 밖을 보여 주지 않음)', async () => {
  const device = 'e2e-final-640';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-final-640', async () => {
    await enterLake(g);
    await assertProductionRender(g);
    for (const [name, at] of Object.entries(ZONES)) {
      await look(g, at);
      const cam = (await render(g)).camera;
      assert.ok(cam.x >= 0 && cam.y >= 0 && cam.x + cam.w <= 3200 && cam.y + cam.h <= 2400, `카메라가 배경 안: ${name} ${JSON.stringify(cam)}`);
      const t = await texts(g);
      for (const hud of ['마을로', '인벤토리', '터비']) assert.ok(t.includes(hud), `HUD ${hud}`);
      if (name === 'maze' || name === 'dye_spring') await g.capture(name);
    }
  }, backend, device);
  await g.close();
});
