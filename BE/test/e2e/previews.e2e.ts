// 10-02 v5 §6: 남겨 둔 개발 미리보기의 최소 동작 확인(smoke) — 지금 코드에서 뜨고 첫 화면까지 오류 없이 간다.
// 미리보기는 서버 없이 화면만 빠르게 보는 도구다(운영 번들에 들어가지 않는다). 기능 검증은 다른 E2E가 실제 서버로 한다.
//   opening-preview : 메모리 가짜 스토리 클라이언트로 실제 opening.json 재생(서버 실패 재시도 화면 등)
//   battle-preview  : BE의 실제 전투 엔진과 전투 정의 JSON을 브라우저에서 돌려 스토리 전투 화면 확인(거대 매듭 포함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { ROOT, freePort, launchBrowser, startVite } from './harness';

let vite: { url: string; close: () => Promise<void> };
let browser: Browser;

before(async () => {
  // 미리보기는 서버를 쓰지 않는다 — 아무도 듣지 않는 포트를 줘서 실제 서버에 닿지 않게 한다
  vite = await startVite(join(ROOT, 'save-a-turby'), { VITE_TURBY_SERVER_URL: `http://127.0.0.1:${await freePort()}` });
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await vite?.close();
});

async function smoke(path: string, expectScene: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  await page.goto(`${vite.url}${path}`);
  const scenes = await page
    .waitForFunction(() => {
      const g = (window as any).__game ?? (window as any).game; // eslint-disable-line @typescript-eslint/no-explicit-any
      const list = g?.scene?.getScenes(true).map((s: any) => s.scene.key) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
      return list.length ? list : null;
    }, null, { timeout: 20_000, polling: 100 })
    .then((h) => h.jsonValue() as Promise<string[]>);
  assert.ok(scenes.includes(expectScene), `${path}: 첫 화면 ${JSON.stringify(scenes)}`);
  assert.equal(await page.locator('canvas').count(), 1);
  // 화면에 무언가 그려질 때까지(빈 화면이 아님): 그 씬에 표시 객체가 있고, 컨테이너 안까지 포함해 글자가 하나 이상 있다
  await page.waitForFunction((key) => {
    const g = (window as any).__game ?? (window as any).game; // eslint-disable-line @typescript-eslint/no-explicit-any
    const hasText = (list: any[]): boolean => list.some((o) => (typeof o.text === 'string' && o.text.length > 0) || (Array.isArray(o.list) && hasText(o.list))); // eslint-disable-line @typescript-eslint/no-explicit-any
    return hasText(g.scene.getScene(key).children.list);
  }, expectScene, { timeout: 20_000, polling: 100 });
  assert.deepEqual(pageErrors, [], `${path}: 페이지 오류 없음`);
  await ctx.close();
}

test('미리보기 smoke: 오프닝 미리보기가 오프닝 화면을 띄운다', async () => {
  await smoke('/dev/opening-preview.html', 'Opening');
});

test('미리보기 smoke: 스토리 전투 미리보기(실밥이 매복·거대 매듭)가 파티 선택 화면을 띄운다', async () => {
  await smoke('/dev/battle-preview.html?key=forest_stitchling_ambush', 'PartySelect');
  await smoke('/dev/battle-preview.html?key=forest_giant_knot&party=1', 'PartySelect');
});

test('제거한 미리보기는 남아 있지 않다(전체 흐름·1장 흐름은 실제 서버를 쓰는 E2E가 대신한다)', () => {
  for (const f of ['dev/game-preview.html', 'dev/gamePreview.ts', 'dev/fakeBackend.ts', 'dev/ch01-preview.html', 'dev/ch01Preview.ts']) {
    assert.equal(existsSync(join(ROOT, 'save-a-turby', f)), false, f);
  }
});
