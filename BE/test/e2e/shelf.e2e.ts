// 10-01 v2 §1·§7: 선반 이동 — 같은 칸 동시 요청의 화면 결과와 재조회 일치, 이동 요청 중 다른 버튼 잠금. UI 행동은 한 번만.
// 서버는 실제 Nest 앱 + FakeDb다. FakeDb는 "같은 행을 잠근 트랜잭션은 차례로 실행된다"는 순서만 흉내 낸다(실제 InnoDB 잠금 아님).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedExplorer } from './fixtures';

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
const SHELF = /\/turby\/\d+\/shelf$/;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
const cellButton = (g: Game, index: number, which: 'equip' | 'move') =>
  g.page.evaluate(([i, w]) => { const h = (window as any).__game.scene.getScene('Home'); const c = h.L.sections[0].cells[i]; const b = h.L.cell[w]; return { x: c.x + b.x + b.w / 2, y: c.y + b.y + b.h / 2 }; }, [index, which] as const) as Promise<{ x: number; y: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function openHome(g: Game) {
  await g.until('마을 준비', 's.village && s.village.ready');
  const home = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'home'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: home.zone.x + home.zone.w / 2, y: home.zone.y + home.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'home'");
  await g.clickLabel(home.prompt, { exact: true, expect: "s.scenes.includes('Home')" });
  await g.until('기지', 's.home && s.home.bag === 13 && s.home.shelf === 0');
}
function slotCounts(device: string) {
  const p = backend.playerByDevice(device)!;
  const slots = backend.db.rows('player_base_slot', { player_id: p.id }) as { id: bigint; slot_index: number }[];
  return slots.map((s) => [s.slot_index, backend.db.rows('turby_instance', { base_slot_id: s.id }).length]);
}

test('선반 ①: 두 화면이 같은 빈 칸으로 동시에 옮기면 한쪽만 성공 — 거절된 화면은 이유를 보여 주고 서버 상태로 다시 맞춘다, 재조회해도 같은 결과', async () => {
  const device = 'e2e-shelf-race';
  await backend.start(seedExplorer(device));
  const a = await Game.open(browser, `${vite.url}/?device=${device}`, `${device}-a`, SMALL);
  const b = await Game.open(browser, `${vite.url}/?device=${device}`, `${device}-b`, SMALL);
  await withDiagnosis(a, 'shelf-race', async () => {
    await openHome(a);
    await openHome(b);
    // 두 화면 모두 선반이 비어 있어 "0번 칸"을 고른다. 서로 다른 터비(2번째·3번째 칸)를 동시에 한 번씩 누른다
    const pa = await cellButton(a, 1, 'move');
    const pb = await cellButton(b, 2, 'move');
    await Promise.all([a.click(pa.x, pa.y), b.click(pb.x, pb.y)]);
    await a.until('A 처리 끝', 's.home && !s.home.busy && s.home.shelf === 1');
    await b.until('B 처리 끝', 's.home && !s.home.busy && s.home.shelf === 1');
    const sa = (await a.state()).home;
    const sb = (await b.state()).home;
    assert.deepEqual([sa.shelf, sa.bag, sb.shelf, sb.bag], [1, 12, 1, 12], '두 화면 모두 서버 상태(선반 1·가방 12)');
    const notice = '그 칸에는 이미 다른 터비가 있어요. 선반을 다시 불러왔어요.';
    const shown = [(await texts(a)).includes(notice), (await texts(b)).includes(notice)];
    assert.equal(shown.filter(Boolean).length, 1, '한쪽만 거절 안내를 받는다');
    const codes = [...a.net, ...b.net].filter((n) => SHELF.test(n.what));
    assert.deepEqual(codes.map((n) => n.status).sort(), [200, 409], '요청은 화면마다 한 번, 하나는 409');
    assert.equal(codes.find((n) => n.status === 409)?.code, 'SHELF_SLOT_OCCUPIED');
    assert.deepEqual(slotCounts(device), [[0, 1]], 'DB: 0번 칸에 정확히 한 마리');
    await (shown[0] ? a : b).capture('08a_shelf_race_rejected_view');
    await (shown[0] ? b : a).capture('08b_shelf_race_winner_view');

    // 재조회(새로고침): 두 화면 모두 같은 상태
    await a.reload();
    await b.reload();
    await openHomeAgain(a);
    await openHomeAgain(b);
    assert.deepEqual([(await a.state()).home.shelf, (await b.state()).home.shelf], [1, 1]);
    assert.deepEqual(slotCounts(device), [[0, 1]]);
  }, backend, device);
  await a.close();
  await b.close();
});

async function openHomeAgain(g: Game) {
  await g.until('마을 준비', 's.village && s.village.ready');
  const home = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'home'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: home.zone.x + home.zone.w / 2, y: home.zone.y + home.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'home'");
  await g.clickLabel(home.prompt, { exact: true, expect: "s.scenes.includes('Home')" });
  await g.until('기지', 's.home && s.home.bag >= 0');
}

test('선반 ②: 이동 요청 중에는 다른 이동·장비·나가기 버튼이 잠긴다(요청 한 번), 이야기 누비도 선반에 둘 수 있다', async () => {
  const device = 'e2e-shelf-busy';
  await backend.start(seedExplorer(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'shelf-busy', async () => {
    await openHome(g);
    await g.page.route('**/turby/*/shelf', async (route) => {
      await new Promise((r) => setTimeout(r, 900)); // 느린 네트워크 조건
      await route.continue();
    });
    const first = await cellButton(g, 1, 'move');
    await g.clickAt(first.x, first.y, 's.home.busy === true');
    assert.ok((await texts(g)).includes('옮기는 중…'), '요청 중 상태 표시');
    // 요청 중: 다른 터비 이동·장비·나가기를 눌러도 아무 일도 일어나지 않는다
    const other = await cellButton(g, 2, 'move');
    const equip = await cellButton(g, 3, 'equip');
    await g.click(other.x, other.y);
    await g.click(equip.x, equip.y);
    await g.clickLabel('마을로 나가기', { exact: true });
    let s = await g.state();
    assert.ok(s.scenes.includes('Home') && !(s.home.equip && s.home.equip.open), '요청 중에는 화면이 바뀌지 않음');
    await g.until('응답 뒤 반영', 's.home && !s.home.busy && s.home.shelf === 1 && s.home.bag === 12', 15_000);
    assert.equal(g.net.filter((n) => SHELF.test(n.what)).length, 1, '잠긴 동안의 클릭은 요청을 만들지 않음');
    await g.page.unroute('**/turby/*/shelf');

    // 이야기 누비(첫 칸)도 선반으로 옮길 수 있다 — 확정 설계(선반에 있어도 스토리 전투에는 서버가 불러온다)
    const nubi = await cellButton(g, 0, 'move');
    await g.clickAt(nubi.x, nubi.y, 's.home && !s.home.busy && s.home.shelf === 2 && s.home.bag === 11');
    s = await g.state();
    const p = backend.playerByDevice(device)!;
    const nubiRow = backend.db.rows('turby_instance', { owner_player_id: p.id, is_story_companion: true })[0] as { base_slot_id: bigint | null };
    assert.notEqual(nubiRow.base_slot_id, null, '누비가 선반에 있다');
    assert.deepEqual(slotCounts(device).map(([, n]) => n), [1, 1], '칸마다 한 마리');
  }, backend, device);
  await g.close();
});
