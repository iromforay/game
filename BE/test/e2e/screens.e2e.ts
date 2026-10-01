// 10-01 v1 §4: 남은 화면 E2E — 지역 선택·상점·장비·마을 HUD 흐름·오프닝 이름 입력·각 화면 resize.
// 모든 UI 행동은 실제 입력 한 번(재시도 없음). 한 번의 클릭으로 요청이 두 번 나가지 않는지도 센다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedChapters, seedExplorer, seedShop } from './fixtures';

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

const seedAll = (device: string) => (db: Backend['db']) => {
  seedExplorer(device)(db);
  seedChapters(db);
  seedShop(db);
};
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
const requests = (g: Game, what: string) => g.net.filter((n) => n.kind === 'http' && n.what === what).length;
const villageReady = (g: Game) => g.until('마을 준비', 's.village && s.village.ready');
const SMALL = { width: 640, height: 360 };
const BIG = { width: 1280, height: 720 };
// 가장 긴 지역 이름이 잘리지 않고(글자 전부) 이름 자리 높이 안에 들어갔는지
const longNameFits = (g: Game) =>
  g.page.evaluate("(() => { const s = window.__game.scene.getScene('StageSelect'); const t = s.children.list.find((o) => o.text === '사막 (보일러/라디에이터 옆)'); return !!t && t.height <= s.L.inner.nameH + 1; })()") as Promise<boolean>;

// 마을에서 걸어가 안내 버튼으로 들어간다(실제 방향키 입력 + 실제 클릭)
async function enterFromVillage(g: Game, type: 'home' | 'market' | 'exit', scene: string) {
  await villageReady(g);
  const it = (await g.page.evaluate((t) => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === t), type)) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: it.zone.x + it.zone.w / 2, y: it.zone.y + it.zone.h / 2 }, 'keys', `s.village && s.village.prompt === '${type}'`);
  await g.until('안내 버튼', `s.village && s.village.prompt === '${type}'`);
  await g.clickLabel(it.prompt, { exact: true, expect: `s.scenes.includes('${scene}')` });
}

test('화면 ①: 지역 선택 — 입장 가능·이전 장 잠금 표시, 640×360 카드 페이지 이동, 잠긴 카드는 이유만 보여 주고 입장하지 않음, resize 유지', async () => {
  const device = 'e2e-stage';
  await backend.start(seedAll(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, BIG);
  await withDiagnosis(g, 'screens-stage-select', async () => {
    await enterFromVillage(g, 'exit', 'StageSelect');
    await g.until('지역 5곳', 's.stageSelect && s.stageSelect.count === 5');
    let s = (await g.state()).stageSelect;
    assert.deepEqual([s.mode, s.pages, s.cards.length], ['regular', 1, 5], '보통 화면은 5장이 한 화면');
    assert.deepEqual(s.cards.map((c: { code: string; enterable: boolean }) => [c.code, c.enterable]), [['forest', true], ['lake', false], ['underground', false], ['ice', false], ['desert', false]]);
    let t = await texts(g);
    assert.ok(t.some((x) => x.includes('· 입장')), '들어갈 수 있는 지역은 "… · 입장" 글자로도 표시');
    assert.equal(t.filter((x) => x === '잠김').length, 4, '잠긴 지역은 "잠김" 글자로 표시(색만이 아님)');
    assert.ok(await longNameFits(g), '긴 지역 이름이 잘리지 않고 이름 자리 안');
    await g.capture('01a_stage_select_enterable_and_locked');

    // 잠긴 카드 한 번 클릭: 이유 안내(토스트)만, 입장하지 않음
    const before = t.length;
    const lake = s.cards[1];
    await g.click(lake.x, lake.y);
    await g.until('잠금 이유 안내', `window.__dev.texts().length > ${before}`);
    assert.ok(!(await g.state()).scenes.includes('Map'));

    // 640×360으로: 같은 화면을 작은 배치로(3장씩 2쪽), 페이지 이동
    await g.page.setViewportSize(SMALL);
    await g.until('작은 화면 배치', "s.stageSelect && s.stageSelect.mode === 'compact' && s.stageSelect.pages === 2 && s.stageSelect.cards.length === 3");
    await g.capture('02a_stage_cards_page1');
    await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1 && s.stageSelect.cards.length === 2' });
    assert.ok(await longNameFits(g), '640×360에서도 긴 지역 이름이 잘리지 않음');
    await g.capture('02b_stage_cards_page2');
    s = (await g.state()).stageSelect;
    assert.deepEqual(s.cards.map((c: { code: string }) => c.code), ['ice', 'desert']);
    // 2쪽을 보던 채로 다시 키우면 보통 배치(한 화면), 줄이면 다시 2쪽
    await g.page.setViewportSize(BIG);
    await g.until('보통 배치로', "s.stageSelect && s.stageSelect.mode === 'regular' && s.stageSelect.cards.length === 5");
    await g.page.setViewportSize(SMALL);
    await g.until('작은 배치로', "s.stageSelect && s.stageSelect.mode === 'compact' && s.stageSelect.pages === 2");
    await g.until('첫 쪽', 's.stageSelect.page === 0');
    // 입장 가능한 숲 카드 한 번 클릭 → 맵
    const forest = (await g.state()).stageSelect.cards[0];
    await g.clickAt(forest.x, forest.y, "s.scenes.includes('Map')");
  }, backend, device);
  await g.close();
});

test('화면 ②: 오프닝 전 지역 선택은 모든 지역이 오프닝 잠금(이유 표시)', async () => {
  const device = 'e2e-stage-opening';
  await backend.start(seedChapters);
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, BIG);
  await withDiagnosis(g, 'screens-stage-opening-locked', async () => {
    await g.waitScene('Opening');
    await g.page.evaluate("window.__game.scene.getScene('Opening').scene.start('StageSelect')");
    await g.until('지역 선택', 's.stageSelect && s.stageSelect.count === 5');
    const s = (await g.state()).stageSelect;
    assert.ok(s.cards.every((c: { enterable: boolean; lockedReason: string }) => !c.enterable && c.lockedReason === 'OPENING_REQUIRED'));
    assert.ok((await texts(g)).filter((x) => x.includes('먼저 누비와 이야기를 마쳐 주세요')).length >= 5, '오프닝 잠금 이유가 카드마다 보임');
    await g.capture('01b_stage_select_opening_locked');
    await g.page.setViewportSize(SMALL);
    await g.until('작은 화면 배치', "s.stageSelect && s.stageSelect.mode === 'compact'");
    assert.ok((await texts(g)).filter((x) => x.includes('먼저 누비와 이야기를 마쳐 주세요')).length >= 3);
    await g.capture('01c_stage_select_opening_locked');
  }, backend, device);
  await g.close();
});

test('화면 ③: 상점 — 목록·페이지, 구매 한 번에 요청 한 번(잔액·보유 갱신), 잔액 부족 표시, 느린 응답 중 중복 클릭·다른 상품·resize에도 요청 한 번', async () => {
  const device = 'e2e-market';
  await backend.start(seedAll(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, BIG);
  const BUY = 'POST /player/me/shop/purchase';
  await withDiagnosis(g, 'screens-market', async () => {
    await enterFromVillage(g, 'market', 'Market');
    await g.until('상품 목록', 's.market && s.market.count === 7');
    let m = (await g.state()).market;
    assert.deepEqual([m.mode, m.pages, m.cards.length, m.tare], ['regular', 2, 6, '타레 100']);
    assert.ok((await texts(g)).some((x) => x === '150 타레 · 부족'), '잔액 부족은 글자로도 표시');
    await g.capture('03a_market_list');

    // 구매 한 번(즉시 응답): 요청 1번, 잔액 100 → 70, 보유 1 → 2
    const needle = m.cards.find((c: { code: string }) => c.code === 'knit_needle');
    await g.clickAt(needle.x, needle.y, "s.market.pending === null && s.market.tare === '타레 70'");
    assert.equal(requests(g, BUY), 1, '한 번의 클릭 → 구매 요청 한 번');
    assert.ok((await texts(g)).includes('보유 2'));
    await g.capture('03b_market_after_purchase');

    // 잔액 부족 상품을 눌러도 요청은 나가지 않고 안내만
    const scarf = m.cards.find((c: { code: string }) => c.code === 'yarn_scarf');
    await g.click(scarf.x, scarf.y);
    await g.until('잔액 부족 안내', "window.__dev.texts().includes('타레가 부족합니다.')");
    assert.equal(requests(g, BUY), 1);
    await g.capture('03c_market_insufficient');

    // 느린 응답: 응답 전에 같은 자리·다른 상품을 다시 눌러도, 그 사이 창 크기가 바뀌어도 요청은 한 번이고 결과는 한 번만 반영
    await g.page.route('**/player/me/shop/purchase', async (route) => {
      await new Promise((r) => setTimeout(r, 900)); // 느린 네트워크 조건(기다림이 아니라 시험 조건)
      await route.continue();
    });
    const glove = m.cards.find((c: { code: string }) => c.code === 'wool_glove');
    await g.clickAt(glove.x, glove.y, 's.market.pending !== null');
    await g.click(glove.x, glove.y); // 같은 자리 다시(구매 중 표시로 바뀜)
    await g.click(needle.x, needle.y); // 다른 상품(구매 중에는 잠김)
    await g.page.setViewportSize(SMALL); // 구매 중 resize → 응답 뒤에 새 배율로 다시 그린다
    await g.until('응답 뒤 작은 배치·잔액 반영', "s.market && s.market.pending === null && s.market.mode === 'compact' && s.market.tare === '타레 30'", 15_000);
    assert.equal(requests(g, BUY), 2, '느린 응답 동안의 추가 클릭은 요청을 만들지 않음');
    await g.page.unroute('**/player/me/shop/purchase');
    const p = backend.playerByDevice(device)!;
    assert.equal((backend.db.rows('player', { id: p.id })[0] as { tare_balance: number }).tare_balance, 30);
    assert.equal(backend.db.rows('shop_purchase', { player_id: p.id }).length, 2);

    // 640×360: 4개씩 2쪽, 페이지 이동, 다시 1280으로 키워도 페이지 유지
    m = (await g.state()).market;
    assert.deepEqual([m.pages, m.cards.length], [2, 4]);
    await g.capture('03d_market_small');
    await g.clickLabel('▶', { exact: true, expect: 's.market.page === 1 && s.market.cards.length === 3' });
    await g.page.setViewportSize(BIG);
    await g.until('보통 배치(2쪽 유지)', "s.market && s.market.mode === 'regular' && s.market.page === 1 && s.market.cards.length === 1");
    await g.clickLabel('마을로 돌아가기', { exact: true, expect: "s.scenes.includes('Village')" });
  }, backend, device);
  await g.close();
});

test('화면 ④: 장비 — 일반 장비 장착·해제(요청 한 번씩), 누비 이야기 슬롯은 해제 불가 표시, 기지 이동·resize 유지', async () => {
  const device = 'e2e-equip';
  await backend.start(seedAll(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, BIG);
  const cellButton = (index: number, which: 'equip' | 'move') =>
    g.page.evaluate(([i, w]) => { const h = (window as any).__game.scene.getScene('Home'); const c = h.L.sections[0].cells[i]; const b = h.L.cell[w]; return { x: c.x + b.x + b.w / 2, y: c.y + b.y + b.h / 2 }; }, [index, which] as const) as Promise<{ x: number; y: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const count = (re: RegExp) => g.net.filter((n) => re.test(n.what)).length;
  await withDiagnosis(g, 'screens-equip', async () => {
    await enterFromVillage(g, 'home', 'Home');
    await g.until('기지', 's.home');
    assert.deepEqual((await g.state()).home.pages, [0, 0]);
    await g.capture('04a_home');

    // 누비(첫 칸)의 장비 창: 일반 슬롯 3줄 + 이야기 슬롯 줄(해제 버튼 없이 "해제 불가"와 이유)
    const nubi = await cellButton(0, 'equip');
    await g.clickAt(nubi.x, nubi.y, 's.home.equip && s.home.equip.open');
    let t = await texts(g);
    assert.ok(t.some((x) => x.startsWith('이야기 슬롯 · 장착됨: 첫 매듭')), '이야기 슬롯은 이름표로 구분');
    assert.ok(t.includes('해제 불가') && t.some((x) => x.includes('이야기 유물은 팔거나 버리거나 해제할 수 없어요')), '해제 불가 이유 표시');
    assert.equal(await g.page.evaluate("window.__dev.find('해제', true)"), null, '이야기 슬롯만 장착된 상태에서는 해제 버튼이 없음');
    await g.capture('04b_equip_before');

    // 일반 장비 장착: 뜨개바늘 칩 한 번 → 장착 요청 한 번, 슬롯 반영(이야기 슬롯과 공존)
    const chip = (await g.page.evaluate("(() => { const h = window.__game.scene.getScene('Home'); const L = h.equipPanel.layout; const r = L.rows[0]; const chip = Math.min(L.row.chip, r.h - (10 + L.font.row * 1.25) - 8); return { x: r.x + L.row.nameX + chip / 2, y: r.y + r.h - chip / 2 - 6 }; })()")) as { x: number; y: number };
    await g.clickAt(chip.x, chip.y, "!s.home.equip.busy && s.home.equip.equipment.join() === 'story_1,weapon'");
    assert.equal(count(/\/turby\/\d+\/equip$/), 1, '한 번의 클릭 → 장착 요청 한 번');
    t = await texts(g);
    assert.ok(t.some((x) => x.startsWith('무기 · 장착 중: 뜨개바늘')));
    await g.capture('04c_equip_after');

    // 장비 창을 연 채 640×360 ↔ 1280×720: 열린 창·장착 상태 유지, 새 배율 배치
    await g.page.setViewportSize(SMALL);
    await g.until('작은 배치·창 유지', "s.home && s.home.mode === 'compact' && s.home.equip.open && s.home.equip.mode === 'compact' && s.home.equip.equipment.length === 2");
    await g.capture('05_nubi_story_slot_locked');
    // 해제(일반 슬롯): 한 번 → 해제 요청 한 번, 이야기 슬롯은 그대로
    await g.clickLabel('해제', { exact: true, expect: "!s.home.equip.busy && s.home.equip.equipment.join() === 'story_1'" });
    assert.equal(count(/\/turby\/\d+\/unequip$/), 1, '한 번의 클릭 → 해제 요청 한 번');
    await g.page.setViewportSize(BIG);
    await g.until('보통 배치·창 유지', "s.home && s.home.mode === 'regular' && s.home.equip.open && s.home.equip.mode === 'regular'");
    await g.capture('05b_nubi_story_slot_locked');
    await g.clickLabel('닫기', { exact: true, expect: 's.home.equip.open === false' });

    // 기지(640×360): 가방 13마리는 페이지로, 선반으로 옮기기 한 번 → 요청 한 번
    await g.page.setViewportSize(SMALL);
    await g.until('작은 배치', "s.home && s.home.mode === 'compact'");
    const move = await cellButton(1, 'move');
    await g.clickAt(move.x, move.y, "!s.home.busy && window.__dev.texts().some((x) => x.startsWith('선반 (기지 보관 — 전시) · 1마리'))");
    assert.equal(count(/\/turby\/\d+\/shelf$/), 1, '한 번의 클릭 → 이동 요청 한 번');
    await g.capture('04d_home_small');
  }, backend, device);
  await g.close();
});

test('화면 ⑤: 마을 HUD 흐름 — 인벤토리 → 상점 → 기지(장비) → 지역 선택을 실제 이동·클릭으로, HUD는 640×360 ↔ 1280×720에서 다시 배치', async () => {
  const device = 'e2e-hud';
  await backend.start(seedAll(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'screens-village-hud', async () => {
    await villageReady(g);
    assert.equal((await g.state()).village.hudMode, 'compact');
    await g.capture('06a_village_hud');
    // 인벤토리 열고 닫기(HUD 버튼 한 번씩)
    await g.clickLabel('인벤토리', { exact: true, expect: "s.inventory && s.inventory.state === 'ready'" });
    await g.clickLabel('닫기', { exact: true, expect: '!s.inventory && s.village.locked === false' });
    // 창 크기 변경: HUD만 다시 그려지고(걷던 위치 유지) 인벤토리 버튼은 계속 한 번에 눌린다
    await g.page.setViewportSize(BIG);
    await g.until('보통 HUD', "s.village && s.village.hudMode === 'regular'");
    await g.capture('06b_village_hud');
    await g.clickLabel('인벤토리', { exact: true, expect: "s.inventory && s.inventory.state === 'ready'" });
    await g.clickLabel('닫기', { exact: true, expect: '!s.inventory' });
    await g.page.setViewportSize(SMALL);
    await g.until('작은 HUD', "s.village && s.village.hudMode === 'compact'");

    await enterFromVillage(g, 'market', 'Market');
    await g.until('상점', 's.market && s.market.count > 0');
    await g.clickLabel('마을로 돌아가기', { exact: true, expect: "s.scenes.includes('Village')" });
    await enterFromVillage(g, 'home', 'Home');
    await g.until('기지', 's.home');
    await g.clickLabel('마을로 나가기', { exact: true, expect: "s.scenes.includes('Village')" });
    await enterFromVillage(g, 'exit', 'StageSelect');
    await g.until('지역 선택', 's.stageSelect && s.stageSelect.count === 5');
  }, backend, device);
  await g.close();
});

test('화면 ⑥: 오프닝 이름 입력 — 잘못된 이름은 오류 문구(요청 없음), 올바른 이름은 요청 한 번, 입력창·오류·버튼이 화면 위쪽 절반 안, resize에도 입력창이 따라감', async () => {
  const device = 'e2e-name';
  await backend.start();
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  const NAME = 'POST /player/me/profile/name';
  const input = () => g.page.locator('input[aria-label="이름"]');
  const boxes = async () => ({ b: (await input().boundingBox())!, c: (await g.page.locator('canvas').boundingBox())! });
  await withDiagnosis(g, 'screens-name-input', async () => {
    await g.waitScene('Opening');
    await g.advanceDialogue('s.dialogue && s.dialogue.nameInput');
    let { b, c } = await boxes();
    assert.ok(b.y + b.height <= c.y + c.height / 2 + 1, '입력창이 화면 위쪽 절반 안(가상 키보드가 아래를 가려도 보임)');
    assert.ok(b.height >= 39, `입력창 터치 높이(${b.height})`);
    await g.capture('07a_name_input');

    // 잘못된 이름: 오류 문구만, 저장 요청 없음
    await input().click();
    await g.page.keyboard.type('!!');
    await g.clickLabel('정했어요', { exact: true, expect: "window.__dev.texts().includes('한글, 영문, 숫자와 단어 사이 공백 한 칸만 쓸 수 있어요.')" });
    assert.equal(requests(g, NAME), 0);
    await g.capture('07b_name_input_error');

    // 창 크기 변경: 입력창이 캔버스 위 같은 자리로 따라가고 입력한 글자는 그대로
    await g.page.setViewportSize(BIG);
    await g.until('큰 화면', 's.displayWidth === 1280');
    ({ b, c } = await boxes());
    assert.ok(b.y >= c.y && b.y + b.height <= c.y + c.height / 2 + 1 && b.x >= c.x && b.x + b.width <= c.x + c.width, '입력창이 캔버스 위쪽 절반 안');
    assert.equal(await input().inputValue(), '!!');
    await g.capture('07c_name_input_error');

    // 올바른 이름: 저장 요청 한 번 → 대화 이어짐
    await input().fill('');
    await g.page.keyboard.type('하늘');
    await g.clickLabel('정했어요', { exact: true, expect: 's.dialogue && !s.dialogue.nameInput' });
    assert.equal(requests(g, NAME), 1, '한 번의 클릭 → 이름 저장 요청 한 번');
    assert.equal((backend.db.rows('player', { id: backend.playerByDevice(device)!.id })[0] as { nickname: string }).nickname, '하늘');
  }, backend, device);
  await g.close();
});

test('화면 ⑦: 인벤토리 상세 — 첫 매듭·실가루·일반 장비·빈 상태, 640×360은 누비 영역을 전환 버튼으로(문구 유지), 1280 ↔ 640 resize 전후 같은 화면', async () => {
  const device = 'e2e-inv-detail';
  await backend.start((db) => {
    seedAll(device)(db);
    const p = db.rows('player', { device_uuid: `dev-device-${device}-account` })[0] as { id: bigint };
    const def = (code: string) => db.rows('item_definition', { code })[0] as { id: number; description: string | null };
    def('first_knot').description = '누비의 몸에서 처음 풀려 나온 매듭. 따뜻한 온기가 남아 있다.';
    // 긴 설명(시험용): 정해진 줄 수를 넘으면 "더 보기"로 펼치고, 펼쳐서 넘치면 누비 영역은 전환 버튼 뒤로 간다
    def('glowing_yarn_dust').description = '은은하게 빛나는 실가루. 보풀이가 찾고 있다. 숲의 오래된 나무 밑동과 이끼 사이에서 조금씩 모을 수 있고, 손으로 쥐면 따뜻한 온기가 남는다. 많이 모을수록 실의 떨림이 또렷해져서 숨은 길을 찾는 데 도움이 된다. 보풀이는 이것으로 무언가를 만들어 주겠다고 했다.';
    db.seed('player_item', { player_id: p.id, item_definition_id: def('glowing_yarn_dust').id, quantity: 3, is_new: false, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date(Date.now() - 30_000) });
  });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, BIG);
  const select = (letter: string, code: string) => g.clickLabel(letter, { exact: true, expect: `s.inventory.selected === '${code}'` });
  await withDiagnosis(g, 'screens-inventory-detail', async () => {
    await villageReady(g);
    await g.clickLabel('인벤토리', { exact: true, expect: "s.inventory && s.inventory.state === 'ready'" });
    await g.capture('08a_inventory_empty_detail');
    assert.ok((await texts(g)).includes('아이템을 눌러 자세히 보기'));

    // 1280×720: 첫 매듭(장착됨) — 이름·배지 → 설명 → 수량·분류 → 잠금 이유(이름표) → 누비 영역(이름표)이 한 화면에
    await select('첫', 'first_knot');
    let t = await texts(g);
    assert.ok(t.includes('잠금 이유') && t.includes('누비 · 고정 동료'), '잠금 이유와 누비 영역은 이름표로 구분');
    assert.ok(t.some((x) => x.includes('이야기 유물은 팔거나 버리거나 해제할 수 없어요')), '누비 안내 문구 유지');
    assert.equal((await g.state()).inventory.nubiCollapsed, false);
    await g.capture('08b_inventory_first_knot');
    await g.capture('09a_resize_before');

    // 640×360으로(resize 뒤 같은 화면): 선택·탭 유지, 첫 매듭 상세는 누비 영역까지 한 화면에(문구 그대로, 영역은 이름표로 구분)
    await g.page.setViewportSize(SMALL);
    await g.until('작은 배치', "s.displayWidth === 640 && s.inventory.mode === 'compact' && s.inventory.selected === 'first_knot'");
    await g.capture('09b_resize_after');
    t = await texts(g);
    assert.ok(t.includes('잠금 이유') && t.includes('누비 · 고정 동료') && t.some((x) => x.includes('따뜻한 온기가 남아 있다')), '설명·잠금 이유·누비 영역이 그대로 보임');
    assert.ok(t.some((x) => x.includes('누비는 이야기의 고정 동료예요. 이야기 유물은 팔거나 버리거나 해제할 수 없어요.')), '누비 안내 문구가 줄지 않고 그대로');
    assert.equal((await g.state()).inventory.nubiCollapsed, false);
    await g.capture('08c_inventory_first_knot');

    // 실가루(임무 아이템, 긴 설명): 스토리 탭에서 — 설명은 3줄까지 보이고 "더 보기"로 펼친다
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    await select('빛', 'glowing_yarn_dust');
    t = await texts(g);
    assert.ok(t.some((x) => x.startsWith('수량: 3')) && t.includes('잠금 이유') && t.includes('더 보기 ▾'));
    await g.capture('08e_inventory_dust');
    await g.clickLabel('더 보기', { expect: 's.inventory.descOpen === true' });
    t = await texts(g);
    assert.ok(t.some((x) => x.endsWith('무언가를 만들어 주겠다고 했다.')), '펼치면 설명 전체가 보인다(자르지 않음)');
    // 펼쳐서 넘치면 누비 영역은 전환 버튼으로 — 눌러서 보면 슬롯·안내 문구가 그대로 있다
    assert.equal((await g.state()).inventory.nubiCollapsed, true, '넘칠 때만 누비 영역을 전환 버튼 뒤로');
    await g.capture('08d_inventory_dust_expanded');
    await g.clickLabel('누비 · 고정 동료 보기', { expect: "s.inventory.detailView === 'nubi'" });
    t = await texts(g);
    assert.ok(t.some((x) => x.includes('누비는 이야기의 고정 동료예요. 이야기 유물은 팔거나 버리거나 해제할 수 없어요.')) && t.some((x) => x.includes('첫 매듭 슬롯')));
    await g.capture('08d2_inventory_nubi_section');
    await g.clickLabel('아이템 정보 보기', { expect: "s.inventory.detailView === 'item'" });
    await g.clickLabel('접기', { expect: 's.inventory.descOpen === false' });

    // 일반 장비 상세
    await g.clickLabel('장비', { exact: true, expect: "s.inventory.tab === 'equipment'" });
    await select('뜨', 'knit_needle');
    t = await texts(g);
    assert.ok(!t.includes('잠금 이유') && !t.includes('누비 · 고정 동료'), '일반 장비에는 잠금 이유·누비 영역 없음');
    await g.capture('08f_inventory_needle');
    await g.page.setViewportSize(BIG);
    await g.until('보통 배치', "s.inventory.mode === 'regular' && s.inventory.selected === 'knit_needle' && s.inventory.tab === 'equipment'");
    await g.capture('08g_inventory_needle');
    await g.clickLabel('전체', { exact: true, expect: "s.inventory.tab === 'all'" });
    await select('빛', 'glowing_yarn_dust');
    await g.capture('08h_inventory_dust');
  }, backend, device);
  await g.close();
});
