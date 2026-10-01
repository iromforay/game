// 10-01 v1 §1: 한 번의 입력이 빠지지 않는다 — 화면을 다시 그린 "같은 프레임" 안에 들어온 실제 클릭도 새 버튼에 닿아야 한다.
// 재현 방법: 게임 루프를 멈춰 다음 프레임이 오지 않게 한 상태에서 화면을 다시 그리게 하고(새 입력 대상이 대기 목록에만 있음),
// 실제 마우스로 한 번 누른 뒤 루프를 다시 돌린다. 재시도는 하지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedExplorer, seedKnotReady } from './fixtures';

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

const sleepLoop = "window.__game.loop.sleep()";
const wakeLoop = "window.__game.loop.wake()";

test('입력 ①: 인벤토리를 다시 그린 같은 프레임의 탭 클릭 한 번이 반영된다', async () => {
  const device = 'e2e-input-inv';
  await backend.start(seedKnotReady(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'input-inventory-same-frame', async () => {
    await g.waitScene('Village');
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    const tab = (await g.page.evaluate("window.__dev.find('스토리', true)")) as { x: number; y: number };
    // 루프를 멈추고 다시 그리기(resize 알림 → 창이 전부 새로 만들어짐) → 한 번 클릭 → 루프 재개
    await g.page.evaluate(`${sleepLoop}; window.__game.scale.emit('resize', window.__game.scale.gameSize, window.__game.scale.baseSize, window.__game.scale.displaySize, 0, 0)`);
    await g.click(tab.x, tab.y);
    await g.page.evaluate(wakeLoop);
    await g.until('한 번의 클릭으로 스토리 탭', "s.inventory.tab === 'story'", 3000);
  }, backend, device);
  await g.close();
});

test('입력 ②: PartySelect 페이지를 넘긴 같은 프레임의 카드 클릭 한 번이 선택된다', async () => {
  const device = 'e2e-input-party';
  await backend.start(seedExplorer(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, { width: 640, height: 360 });
  await withDiagnosis(g, 'input-party-same-frame', async () => {
    await g.waitScene('Village');
    await g.page.evaluate("window.__game.scene.getScene('Village').scene.start('StageSelect')");
    await g.waitScene('StageSelect');
    await g.clickLabel('1장 — 숲', { exact: true });
    await g.waitScene('Map');
    await g.until('맵 준비', "(() => { const m = window.__game.scene.getScene('Map'); return m && m.ready; })()");
    await g.walkTo('Map', { x: 1400, y: 1800 }, 'joystick', "s.scenes.includes('PartySelect')", 8);
    await g.until('파티 선택', 's.party && s.party.pages > 1 && s.party.selected.length === 1');
    const next = (await g.page.evaluate("window.__dev.find('▶', true)")) as { x: number; y: number };
    const card = (await g.page.evaluate("(() => { const c = window.__game.scene.getScene('PartySelect').layout.cards[2]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; })()")) as { x: number; y: number };
    await g.page.evaluate(sleepLoop);
    await g.click(next.x, next.y); // 페이지 전환(카드가 전부 새로 만들어짐)
    await g.click(card.x, card.y); // 다음 프레임이 오기 전의 카드 클릭
    await g.page.evaluate(wakeLoop);
    await g.until('페이지 전환과 카드 선택이 모두 반영', 's.party.page === 1 && s.party.selected.length === 2', 3000);
  }, backend, device);
  await g.close();
});
