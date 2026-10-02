// 10-02 v1 §5·§7: main 통합 회귀 — 허브 게임 목록에 터비 구하기와 광고게임이 함께 있고, 광고게임 두 개가 허브에서 실제로 열린다.
// 허브의 계정·커비·멀티 서버 주소는 쓰지 않는 로컬 포트로 막는다(운영 서버에 요청하지 않음).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, ROOT, freePort, launchBrowser, startVite } from './harness';

let backend: Backend;
let hub: { url: string; close: () => Promise<void> };
let browser: Browser;

before(async () => {
  backend = new Backend(await freePort());
  const dead = `http://127.0.0.1:${await freePort()}`; // 아무도 듣지 않는 포트
  hub = await startVite(join(ROOT, 'hub'), { VITE_TURBY_SERVER_URL: `http://127.0.0.1:${backend.port}`, VITE_ACCOUNT_SERVER_URL: dead, VITE_KIRBY_SERVER_URL: dead, VITE_MULTIPLAYER_SERVER_URL: dead });
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await hub?.close();
  await backend?.stop();
});

test('허브 통합: 게임 목록에 터비 구하기와 광고게임이 함께 표시 → 광고게임 목록 → 숫자 용사 탑 실행 → 숫자 게이트 러너 실행(캔버스)', async () => {
  await backend.start();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const dir = process.env.E2E_CAPTURE_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  const shot = async (name: string) => { if (dir) await page.screenshot({ path: join(dir, name) }); };

  // 1) 허브 게임 목록
  await page.goto(`${hub.url}/?device=e2e-hub-ad`);
  await page.getByRole('button', { name: /터비 구하기/ }).first().waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /광고게임/ }).waitFor();
  await shot('1280x800_01_hub_game_list.png');

  // 2) 광고게임 목록: 두 게임 모두 시작 가능
  await page.getByRole('button', { name: /광고게임/ }).click();
  const cards = page.locator('.ad-game-card');
  assert.equal(await cards.count(), 2);
  assert.deepEqual(await page.locator('.ad-game-title').allTextContents(), ['숫자 게이트 러너', '숫자 용사 탑']);
  assert.equal(await page.locator('.ad-game-card:disabled').count(), 0, '둘 다 시작 가능');
  await shot('1280x800_02_ad_game_catalog.png');

  // 3) 숫자 용사 탑: 집안 지도 → 놀이방 → 스테이지 목록
  await cards.nth(1).click();
  await page.locator('.house-map-screen').waitFor({ timeout: 30_000 });
  await page.locator('.chapter-marker.playroom').click();
  await page.locator('.stage-select-card').first().waitFor();
  assert.ok((await page.locator('.stage-select-card').count()) >= 10, '스테이지 10개 이상');
  await shot('1280x800_03_number_hero_tower_stages.png');
  await page.getByRole('button', { name: '집안 세계지도' }).click();
  await page.getByRole('button', { name: '광고게임 목록' }).click();

  // 4) 숫자 게이트 러너: 지도 → 놀이방 → 첫 스테이지 → Phaser 캔버스
  await page.locator('.ad-game-card').nth(0).click();
  await page.locator('.runner-world-screen').waitFor({ timeout: 30_000 });
  await page.locator('.runner-chapter.playroom').click();
  await page.locator('.runner-stage-grid button').first().click();
  const canvas = page.locator('.runner-game-screen .game-canvas-container canvas');
  await canvas.waitFor({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  assert.ok(box.width > 100 && box.height > 100, '캔버스가 그려짐');
  // 화면이 실제로 그려질 때까지(빈 캔버스가 아닐 때까지)
  await page.waitForFunction(() => {
    const c = document.querySelector('.runner-game-screen canvas') as HTMLCanvasElement | null;
    return !!c && c.width > 0 && c.height > 0;
  }, null, { timeout: 10_000, polling: 100 });
  await shot('1280x800_04_number_gate_runner_play.png');
  assert.equal(await page.locator('canvas').count(), 1, '게임 인스턴스 1개');
  assert.deepEqual(pageErrors, [], '페이지 오류 없음');
  await ctx.close();
});
