// v5 §4·§7-6: 허브 임베드 화면 — 허브(Vite 개발 서버)에서 터비 구하기를 열어도 게임이 뜨고, 창 크기를 바꿔도 캔버스가 허브 영역 안에서 비율을 유지한다.
// 허브는 미리 빌드한 결과물을 연다(10-28, 병렬 시간 초과 대응). 계정·커비·멀티 등 다른 서버 주소는 빌드에서 .invalid로 막는다(운영 서버에 요청하지 않음). 터비 서버는 테스트 Nest 앱.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser, Page } from 'playwright-core';
import { Backend, freePort, launchBrowser, startHubBuild } from './harness';
import { seedKnotReady } from './fixtures';

let backend: Backend;
let hub: { url: string; close: () => Promise<void> };
let browser: Browser;

before(async () => {
  backend = new Backend(await freePort());
  hub = await startHubBuild(`http://127.0.0.1:${backend.port}`); // 미리 빌드한 허브(scripts/e2e-build-hub.mjs) — 다른 서버 주소는 빌드에서 .invalid로 막는다
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await hub?.close();
  await backend?.stop();
});

// 화면이 멈출 때까지(연속 두 장이 같을 때까지) — 페이드 같은 전환이 끝난 뒤를 기다린다(허브는 게임 객체를 노출하지 않음)
async function settled(page: Page) {
  let prev: Buffer | null = null;
  for (let i = 0; i < 40; i++) {
    const shot = await page.locator('.game-canvas-container canvas').screenshot();
    if (prev && prev.equals(shot)) return;
    prev = shot;
  }
}

async function canvasBox(page: Page) {
  const box = await page.locator('.game-canvas-container canvas').boundingBox();
  const area = await page.locator('.game-canvas-container').boundingBox();
  return { box: box!, area: area! };
}

test('허브 임베드: 대시보드 → 터비 구하기 → 게임 시작 → 마을 화면, 창을 줄이고 키워도 허브 영역 안에서 16:9 유지', async () => {
  const device = 'e2e-hub';
  await backend.start(seedKnotReady(device));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const story = page.waitForResponse((r) => r.url().includes('/player/me/story') && r.status() === 200, { timeout: 120_000 }); // 10-26: 허브 첫 빌드가 병렬 실행에서 느리다(그린 트래킹 3D 의존성 추가) — 첫 화면만 넉넉히
  await page.goto(`${hub.url}/?device=${device}`);
  await page.getByRole('button', { name: /터비 구하기/ }).first().click({ timeout: 90_000 });
  await page.getByRole('button', { name: '게임 시작' }).click();
  await page.locator('.game-canvas-container canvas').waitFor({ timeout: 30_000 });
  await story; // 게임이 서버 스토리 상태를 받아 첫 화면(기존 계정 → 마을)을 고른다
  await settled(page);
  let { box, area } = await canvasBox(page);
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.01, '16:9');
  assert.ok(box.x >= area.x - 1 && box.x + box.width <= area.x + area.width + 1 && box.y >= area.y - 1 && box.y + box.height <= area.y + area.height + 1, '허브 영역 안');
  const dir = process.env.E2E_CAPTURE_DIR;
  if (dir) await page.screenshot({ path: join(dir, `${1280}x${800}_06_hub_embed.png`) });

  // 줄였다가 다시 키워도 영역 안·비율 유지(허브의 자체 재계산과 충돌 없음)
  for (const vp of [{ width: 640, height: 400 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(vp);
    await page.waitForFunction((w) => {
      const c = document.querySelector('.game-canvas-container canvas')!.getBoundingClientRect();
      const a = document.querySelector('.game-canvas-container')!.getBoundingClientRect();
      return c.width <= w && c.right <= a.right + 1 && c.bottom <= a.bottom + 1 && Math.abs(c.width / c.height - 16 / 9) < 0.01 && (Math.abs(c.width - a.width) < 2 || Math.abs(c.height - a.height) < 2);
    }, vp.width, { timeout: 10_000, polling: 100 });
    ({ box, area } = await canvasBox(page));
    assert.ok(box.width <= vp.width);
  }
  await settled(page);
  if (dir) await page.screenshot({ path: join(dir, `${1280}x${800}_06b_hub_embed_after_resize.png`) });
  assert.equal(await page.locator('canvas').count(), 1, '게임 인스턴스 1개');
  await ctx.close();
});
