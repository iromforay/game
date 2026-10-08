// v5 §2 브라우저 E2E — 실제 게임 클라이언트(Vite 개발 서버) + 실제 터비 Nest 앱(FakeDb) + 실제 Chrome.
// 실행: npm run test:e2e (BE). 캡처가 필요하면 E2E_CAPTURE_DIR=<폴더>.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { readFileSync } from 'fs';
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

const checkpointOf = (device: string) => {
  const p = backend.playerByDevice(device);
  return p ? (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string } | undefined)?.checkpoint : undefined;
};

// 마을 출구까지 걸어가 안내 버튼을 눌러 지역 선택으로, 숲 카드를 눌러 탐험 맵으로
async function goForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', `(() => { const v = window.__game.scene.getScene('Village'); return v && v.ready; })()`);
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', `(() => { const v = window.__game.scene.getScene('Village'); return v && v.activeInteraction && v.activeInteraction.type === 'exit'; })()`);
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 맵(또는 맵이 바로 연 대화)', "s.scenes.includes('Map') || s.scenes.includes('StoryDialogue')");
}

// 숲 안의 지점까지 걸어가 안내 버튼을 한 번 누른다(좌표는 서버 지역 데이터)
const FOREST = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/forest.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
async function interactAt(g: Game, id: string, expect: string) {
  const p = FOREST.points.find((x) => x.id === id)!;
  await g.walkTo('Map', p, 'keys', `s.map && s.map.story && s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내 버튼`, `s.map && s.map.story && s.map.story.prompt === '${id}' && !!s.map.story.promptText`);
  const at = (await g.state()).map.story.interact as { x: number; y: number };
  await g.clickAt(at.x, at.y, expect);
}

test('1장 E2E ①: 신규 계정 오프닝 → 오프닝 전 이탈 차단 → 이름 → 숲 입구 장면 → 잘린 실 지점 → 공터 지점 → 스토리 PartySelect → 새로고침 복원 → 전투 → 대화 복귀', async () => {
  const device = 'e2e-ch01';
  await backend.start();
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(
    g,
    'ch01-opening-to-battle',
    async () => {
      // 1) 신규 계정은 오프닝으로
      await g.waitScene('Opening');
      assert.equal(checkpointOf(device) ?? 'OPENING_NOT_STARTED', 'OPENING_NOT_STARTED');

      // 2) 오프닝 전 마을 이탈 차단: 지역 선택 화면으로 억지로 가도 숲 카드는 잠겨 있어 맵에 들어가지 못하고, 새로고침하면 오프닝으로 돌아간다
      await g.page.evaluate("window.__game.scene.getScene('Opening').scene.start('StageSelect')");
      await g.waitScene('StageSelect');
      await g.clickLabel('1장 — 숲', { exact: true });
      await g.until('잠금 안내', `(() => { const t = window.__game.scene.getScene('StageSelect').children.list.find((o) => typeof o.text === 'string' && o.text.includes('누비와 이야기')); return !!t; })()`);
      assert.ok(!(await g.state()).scenes.includes('Map'), '오프닝 전에는 맵으로 들어가지 않음');
      await g.reload();
      await g.waitScene('Opening');

      // 3) 이름 입력과 오프닝 완료
      await g.advanceDialogue('s.dialogue && s.dialogue.nameInput');
      await g.page.locator('input[aria-label="이름"]').click();
      await g.page.keyboard.type('하늘');
      await g.clickLabel('정했어요');
      await g.advanceDialogue("s.scenes.includes('Village')");
      assert.equal(checkpointOf(device), 'OPENING_COMPLETE');
      const p = backend.playerByDevice(device)!;
      assert.equal(backend.db.rows('turby_instance', { owner_player_id: p.id }).length, 1, '이야기 누비 1마리');

      // 4) 숲 진입 → 첫 길의 걷는 장면(자동) → 숲 안의 지점: 잘린 실오라기 → 보풀이 공터(10-02 v3)
      await goForest(g);
      await g.waitScene('StoryDialogue');
      await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
      await g.until('지도에 잘린 실 지점', "s.map && s.map.story && s.map.story.points.join() === 'forest_cut_thread'");
      await interactAt(g, 'forest_cut_thread', "s.scenes.includes('StoryDialogue')");
      await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
      await g.until('다음 지점은 공터', "s.map && s.map.story && s.map.story.points.join() === 'forest_bopuli_ambush'");
      assert.equal(checkpointOf(device), 'CH01_STARTED', '지점 진입은 체크포인트를 바꾸지 않는다');
      await interactAt(g, 'forest_bopuli_ambush', "s.scenes.includes('StoryDialogue')");

      // 5) 공터 대화 → 스토리 PartySelect
      await g.advanceDialogue("s.scenes.includes('PartySelect')");
      await g.until('스토리 파티 선택', 's.party && s.party.story');

      // 6) 새로고침 → 같은 전투의 PartySelect로 복원
      await g.reload();
      await g.until('새로고침 뒤 복원', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
      await g.capture('07_refresh_restored_party_select');

      // (v5 §4) 파티 선택을 연 채 640×360으로: 새 배율의 카드로 다시 배치(스토리 전투 상태 유지)
      await g.page.setViewportSize({ width: 640, height: 360 });
      await g.until('PartySelect 작은 화면 재배치', 's.displayWidth === 640 && s.party && s.party.story && s.party.cardW >= 170');

      // 7) 전투 → 결과 → 대화 복귀 → 보풀이 단서까지
      if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
      await g.waitScene('Battle');
      await g.until('작은 화면 HUD', "s.battle && s.battle.hudMode === 'compact'");
      // 목표: 요약(▾) → 펼침(▴, 닫기 버튼) → 닫기 버튼으로 접힘
      await g.capture('04a_goal_summary_closed');
      await g.clickLabel('목표', { expect: 's.battle.goalOpen === true' });
      await g.capture('04b_goal_detail_open');
      await g.clickLabel('닫기 ✕', { exact: true, expect: 's.battle.goalOpen === false' });
      await g.capture('04c_goal_detail_closed');
      // (v5 §4) 전투 중 창 크기 변경: 보통 배치 ↔ 작은 배치로 다시 그리고 같은 전투를 이어 간다(목표 펼침 상태 유지)
      await g.clickLabel('목표', { expect: 's.battle.goalOpen === true' });
      await g.page.setViewportSize({ width: 1280, height: 720 });
      await g.until('전투 HUD 보통 배치', "s.battle && s.battle.hudMode === 'regular'");
      await g.page.setViewportSize({ width: 640, height: 360 });
      await g.until('전투 HUD 작은 배치로 복귀·목표 펼침 유지', "s.battle && s.battle.hudMode === 'compact' && s.battle.goalOpen === true");
      await g.clickLabel('닫기 ✕', { exact: true, expect: 's.battle.goalOpen === false' });
      const b = await g.playBattle();
      assert.equal(b.outcome, 'win');
      await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton');
      await g.capture('09_story_battle_result');
      await g.clickResult("s.scenes.includes('StoryDialogue')");
      await g.page.setViewportSize({ width: 1280, height: 720 }); // 장면 재개(대화 화면 wake)와 창 크기 변경이 겹쳐도 다음 입력이 한 번에 반영된다
      await g.advanceDialogue("!s.scenes.includes('StoryDialogue')");
      assert.equal(checkpointOf(device), 'CH01_BOPUL_RESCUED');
    },
    backend,
    device,
  );
  await g.close();
});

const itemRow = (device: string, code: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code })[0] as { id: number };
  return backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id })[0] as { is_new: boolean };
};

test('1장 E2E ②: 인벤토리 열기·탭 이동·개별 신규 해제 → 첫 매듭 장착과 장착 대화 → 재접속 유지 → 열린 창 1280→640 재배치 → 독립 실행 창 키우기', async () => {
  const device = 'e2e-knot';
  await backend.start(seedKnotReady(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(
    g,
    'ch01-inventory-knot',
    async () => {
      await g.waitScene('Village');
      // 8) 인벤토리 열기 → 스토리 탭 → 첫 매듭만 신규 해제
      await g.clickLabel('인벤토리', { exact: true });
      await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
      await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
      const seen = g.page.waitForResponse((r) => r.url().includes('/inventory/items/first_knot/seen') && r.status() === 200);
      await g.clickLabel('첫', { exact: true });
      await seen;
      await g.until('첫 매듭 선택', "s.inventory.selected === 'first_knot'");
      assert.equal(itemRow(device, 'first_knot').is_new, false, '연 아이템만 신규 해제');
      assert.equal(itemRow(device, 'knit_needle').is_new, true, '다른 아이템은 그대로');
      await g.clickLabel('장비', { exact: true, expect: "s.inventory.tab === 'equipment'" });
      await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
      await g.clickLabel('첫', { exact: true, expect: "s.inventory.selected === 'first_knot'" });

      // 9) 첫 매듭 장착 → 장착 대화
      await g.clickLabel('누비에게 장착', { exact: true });
      await g.waitScene('StoryDialogue');
      await g.advanceDialogue("!s.scenes.includes('StoryDialogue')");
      assert.equal(checkpointOf(device), 'CH01_FIRST_KNOT_EQUIPPED');

      // 재접속(새로고침): 장착 유지, 다시 장착 버튼 없음
      await g.reload();
      await g.waitScene('Village');
      await g.clickLabel('인벤토리', { exact: true });
      await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
      await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
      await g.clickLabel('첫', { exact: true, expect: "s.inventory.selected === 'first_knot'" });
      const texts = (await g.page.evaluate("window.__game.scene.getScene('Village').children.list.flatMap((o) => o.list ? o.list : [o]).filter((o) => typeof o.text === 'string' && o.visible !== false).map((o) => o.text)")) as string[];
      assert.ok(texts.includes('누비에게 장착됨'), '재접속 뒤에도 장착됨 상태 표시');
      assert.equal(await g.page.evaluate("!!window.__dev.find('누비에게 장착', true)"), false, '재접속 뒤 다시 장착 버튼 없음');
      await g.capture('08_first_knot_after_reconnect');

      // 10) 인벤토리를 연 채 1280×720 → 640×360: 닫지 않아도 작은 화면 배치로, 탭·선택 유지
      await g.page.setViewportSize({ width: 640, height: 360 });
      await g.until('작은 화면 재배치', "s.displayWidth === 640 && s.inventory && s.inventory.visible && s.inventory.mode === 'compact' && s.inventory.tab === 'story'");
      await g.capture('03_inventory_detail_hierarchy');
      assert.equal(await g.page.evaluate('document.querySelectorAll("canvas").length'), 1, '게임 인스턴스 1개');

      await g.clickLabel('닫기', { exact: true, expect: '!s.inventory' });
      await g.capture('05a_standalone_small');
      // 독립 실행: 작은 창 → 큰 창으로 키우면 캔버스도 커지고(종횡비 유지·화면 안), 창은 보통 배치로
      const listeners = await g.page.evaluate("window.__game.scale.listenerCount('resize')");
      await g.page.setViewportSize({ width: 1600, height: 900 });
      await g.until('큰 창으로 확대', 's.displayWidth === 1600');
      await g.page.setViewportSize({ width: 1280, height: 900 });
      await g.until('세로가 남는 창: 폭 기준', 's.displayWidth === 1280');
      const box = await g.page.locator('canvas').boundingBox();
      assert.ok(box && Math.abs(box.width / box.height - 16 / 9) < 0.01 && box.y >= 0 && box.y + box.height <= 900, '종횡비 유지·화면 안');
      await g.capture('05b_standalone_grown');
      assert.equal(await g.page.evaluate("window.__game.scale.listenerCount('resize')"), listeners, 'resize를 반복해도 리스너가 늘지 않음');
      assert.equal(await g.page.evaluate('document.querySelectorAll("canvas").length'), 1);
    },
    backend,
    device,
  );
  await g.close();
});

test('1장 E2E ③: 여러 터비 PartySelect 페이지 이동·선택 유지 → 일반 전투 포획 결과와 복귀 → 포획 실패 결과(640×360)', async () => {
  const device = 'e2e-explore';
  await backend.start(seedExplorer(device));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, { width: 640, height: 360 });
  await withDiagnosis(
    g,
    'ch01-party-paging-capture',
    async () => {
      const p = backend.playerByDevice(device)!;
      const ownedBefore = backend.db.rows('turby_instance', { owner_player_id: p.id }).length;
      await goForest(g);
      await g.waitScene('Map');
      await g.until('맵 준비', "(() => { const m = window.__game.scene.getScene('Map'); return m && m.ready; })()");
      assert.ok(!(await g.state()).scenes.includes('StoryDialogue'), '장착까지 끝난 계정은 숲 재진입 때 이야기 재생 없음');

      // 11) 약한 야생에게 걸어가 조우 → 여러 페이지 PartySelect
      await g.walkTo('Map', { x: 1470, y: 1300 }, 'joystick', "s.scenes.includes('PartySelect')", 8);
      await g.until('일반 파티 선택(여러 페이지)', 's.party && !s.party.story && s.party.pages > 1 && s.party.selected.length === 1');
      const card = async (i: number) => (await g.page.evaluate((k) => { const c = (window as any).__game.scene.getScene('PartySelect').layout.cards[k]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }, i)) as { x: number; y: number }; // eslint-disable-line @typescript-eslint/no-explicit-any
      await g.clickLabel('▶', { exact: true, expect: 's.party.page === 1' });
      const c2 = await card(2);
      await g.clickAt(c2.x, c2.y, 's.party.selected.length === 2');
      await g.capture('11a_party_page2_selected');
      await g.clickLabel('◀', { exact: true, expect: 's.party.page === 0' });
      await g.until('1쪽으로 돌아와도 선택 유지', 's.party.selected.length === 2');
      await g.capture('11b_party_back_to_page1_kept');

      // 12) 일반 전투 → 포획 성공 결과 → 맵 복귀
      await g.clickLabel('선택 완료', { exact: true, expect: "s.scenes.includes('Battle')" });
      const win = await g.playBattle();
      assert.equal(win.outcome, 'win');
      assert.equal(win.story, false);
      await g.until('보상 확정', 's.battle.settled === true');
      await g.capture('01_capture_success_result');
      await g.clickResult("s.scenes.includes('Map')");
      assert.equal(backend.db.rows('turby_instance', { owner_player_id: p.id, acquired_via: 'wild_capture' }).length, 1, '포획한 터비 지급');
      assert.equal(backend.db.rows('turby_instance', { owner_player_id: p.id }).length, ownedBefore + 1);

      // 강한 야생: 약한 터비 한 마리만 데려가 패배 → 포획 실패 결과
      await g.until('맵 준비', "(() => { const m = window.__game.scene.getScene('Map'); return m && m.ready; })()");
      // 강한 야생 3번은 입구 공터 서쪽 끝에 있다 — 전투 뒤에는 싸우던 자리(공터 위쪽 첫 길)에서 이어지고, 길을 따라 내려가 다가간다
      await g.walkTo('Map', { x: 1330, y: 2100 }, 'joystick', "s.scenes.includes('PartySelect')", 8);
      await g.until('파티 선택', 's.party && s.party.selected.length === 1');
      const c0 = await card(0);
      await g.clickAt(c0.x, c0.y, 's.party.selected.length === 0');
      const c1 = await card(1);
      await g.clickAt(c1.x, c1.y, 's.party.selected.length === 1');
      await g.clickLabel('선택 완료', { exact: true, expect: "s.scenes.includes('Battle')" });
      const lose = await g.playBattle();
      assert.equal(lose.outcome, 'lose');
      await g.until('결과 확정', 's.battle.settled === true');
      await g.capture('02_capture_failed_result');
      await g.clickResult("s.scenes.includes('Map')");
      assert.equal(backend.db.rows('turby_instance', { owner_player_id: p.id }).length, ownedBefore + 1, '패배하면 포획 없음');
    },
    backend,
    device,
  );
  await g.close();
});
