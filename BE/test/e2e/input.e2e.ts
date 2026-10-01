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

test('입력 ③: 같은 프레임 클릭 20회 반복 — 인벤토리 탭을 다시 그릴 때마다 한 번씩 눌러 20번 모두 반영(누락 0)', async () => {
  const device = 'e2e-input-20';
  await backend.start(seedKnotReady(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'input-inventory-20', async () => {
    await g.waitScene('Village');
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    const tabs: [string, string][] = [['스토리', 'story'], ['장비', 'equipment'], ['전체', 'all'], ['소비', 'consumable']];
    const pos = new Map<string, { x: number; y: number }>();
    for (const [label] of tabs) pos.set(label, (await g.page.evaluate(`window.__dev.find(${JSON.stringify(label)}, true)`)) as { x: number; y: number });
    let missed = 0;
    for (let i = 0; i < 20; i++) {
      const [label, key] = tabs[i % tabs.length];
      const p = pos.get(label)!;
      await g.page.evaluate(`${sleepLoop}; window.__game.scale.emit('resize', window.__game.scale.gameSize, window.__game.scale.baseSize, window.__game.scale.displaySize, 0, 0)`);
      await g.click(p.x, p.y);
      await g.page.evaluate(wakeLoop);
      const ok = await g.page.waitForFunction((k) => (window as any).__dev.state().inventory?.tab === k, key, { timeout: 2000, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!ok) missed++;
    }
    assert.equal(missed, 0, `20회 중 누락 ${missed}회`);
  }, backend, device);
  await g.close();
});

test('입력 ④: 신규 해제 응답이 느릴 때 — 같은 아이템을 두 번 눌러도 요청 한 번, 응답 전 탭 이동이 바로 반영되고 늦은 응답이 화면을 되돌리지 않음, 응답 직후 클릭 한 번도 반영', async () => {
  const device = 'e2e-input-seen';
  await backend.start(seedKnotReady(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  const SEEN = /\/inventory\/items\/first_knot\/seen$/;
  await withDiagnosis(g, 'input-inventory-seen', async () => {
    await g.waitScene('Village');
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    await g.page.route('**/inventory/items/first_knot/seen', async (route) => {
      await new Promise((r) => setTimeout(r, 700)); // 느린 네트워크 조건
      await route.continue();
    });
    const knot = (await g.page.evaluate("window.__dev.find('첫', true)")) as { x: number; y: number };
    const done = g.page.waitForResponse((r) => SEEN.test(new URL(r.url()).pathname));
    await g.clickAt(knot.x, knot.y, "s.inventory.selected === 'first_knot'");
    await g.click(knot.x, knot.y); // 같은 아이템 다시(응답 전)
    // 응답 전: 탭 이동 한 번 → 바로 반영
    await g.clickLabel('장비', { exact: true, expect: "s.inventory.tab === 'equipment' && s.inventory.selected === null" });
    await done;
    // 늦게 온 응답이 화면을 스토리 탭·선택 상태로 되돌리지 않는다. 응답 직후의 클릭 한 번도 반영된다
    await g.clickLabel('전체', { exact: true, expect: "s.inventory.tab === 'all'" });
    assert.equal((await g.state()).inventory.selected, null);
    assert.equal(g.net.filter((n) => SEEN.test(n.what)).length, 1, '같은 아이템을 두 번 눌러도 신규 해제 요청은 한 번');
    await g.page.unroute('**/inventory/items/first_knot/seen');
    // 즉시 응답 조건: 다른 신규 아이템을 열고 응답이 오자마자 탭 클릭 한 번
    const fast = g.page.waitForResponse((r) => /\/inventory\/items\/knit_needle\/seen$/.test(new URL(r.url()).pathname));
    await g.clickLabel('뜨', { exact: true, expect: "s.inventory.selected === 'knit_needle'" });
    await fast;
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
  }, backend, device);
  await g.close();
});

test('입력 ⑤: 창을 닫았다 다시 연 뒤 도착한 예전 응답이 새 창을 덮지 않는다(닫기·열기 한 번씩)', async () => {
  const device = 'e2e-input-stale';
  await backend.start(seedKnotReady(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'input-inventory-stale', async () => {
    await g.waitScene('Village');
    let first = true;
    await g.page.route('**/player/me/inventory', async (route) => {
      if (first) {
        first = false;
        await new Promise((r) => setTimeout(r, 1200)); // 첫 조회만 느리게
      }
      await route.continue();
    });
    await g.clickLabel('인벤토리', { exact: true, expect: "s.inventory && s.inventory.state === 'loading'" });
    await g.clickLabel('닫기', { exact: true, expect: '!s.inventory' });
    const slow = g.page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/player/me/inventory'));
    await g.clickLabel('인벤토리', { exact: true, expect: "s.inventory && s.inventory.state === 'ready'" });
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    await slow; // 첫(느린) 응답이 이제 도착 — 새 창의 탭·상태를 건드리지 않아야 한다
    await g.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const inv = (await g.state()).inventory;
    assert.deepEqual([inv.visible, inv.state, inv.tab], [true, 'ready', 'story']);
    await g.page.unroute('**/player/me/inventory');
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
