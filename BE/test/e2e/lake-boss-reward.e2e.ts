// 10-14 C2-5B: 물먹은 박음이 승리 정산 → 물빛 염색실 1회 지급 → 정본 승리 장면 → 인벤토리 유물·잠금.
// ① 1280×720: 승리 → 동시 정산 요청 → 아이템 1개·사건·체크포인트 → 승리 장면 완료 → 인벤토리(유물·잠금·버튼 0)
// ② 640×360: 정산 뒤 장면 중간 새로고침 → 장면 처음부터 → 보스 미반복 → 인벤토리 유물·잠금
// 상태(CH02_NUBI_CRISIS_SEEN)는 테스트 격리 DB에 직접 준비한다.
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
const ROUTE = [{ x: 900, y: 1500 }, { x: 1265, y: 1350 }, { x: 1440, y: 1350 }, { x: 1440, y: 1100 }, { x: 1560, y: 1000 }, { x: 1900, y: 1000 }, { x: 2020, y: 1000 }, { x: 2040, y: 800 }, { x: 2400, y: 790 }, { x: 2370, y: 740 }, { x: 2370, y: 590 }, { x: 2370, y: 540 }, { x: 2600, y: 440 }, { x: 2830, y: 420 }];
const GOAL_AFTER = '물빛 염색실을 누비에게 가져가자.';
const FIRST_LINE = '마지막 재봉실을 끊자';

type MapState = { story: { points: string[]; goalShown: string | null } };
type Dlg = { waiting: boolean; typing: boolean; line: string; fx: { relicShown: number; relicBounds: { x: number; y: number; w: number; h: number } | null } | null };
type Inv = { state: string; tab: string; selected: string | null; detailIcon: { key: string; size: number } | null; cells: { code: string; x: number; y: number; w: number; h: number }[] };
const map = async (g: Game) => (await g.state()).map as MapState;
const dlg = async (g: Game) => (await g.state()).dialogue as Dlg | undefined;
const inv = async (g: Game) => (await g.state()).inventory as Inv;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;

const eventsOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string);
};
const progressOf = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string; nubi_growth_stage: number; story_nubi_turby_instance_id: bigint };
};
const dyeRows = (device: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number };
  return backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id }) as { quantity: number; is_new: boolean }[];
};
const story2 = (device: string) => backend.db.rows('turby_equipment', { turby_instance_id: progressOf(device).story_nubi_turby_instance_id, slot_key: 'story_2' });
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;

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
async function enterBoss(g: Game, how: 'keys' | 'joystick') {
  for (const p of ROUTE) await g.walkDirect('Map', p, how, 'false', 30);
  await g.until('보스 입장 안내', "s.map.story.prompt === 'lake_boss_entrance' && !!s.map.story.promptText", 20_000);
  const at = ((await g.state()).map as { story: { interact: { x: number; y: number } } }).story.interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('보스 전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
}
// 보스를 이기고 결과 확정 뒤 결과 버튼으로 승리 장면에 들어간다
async function winAndEnterScene(g: Game) {
  const b = await g.playBattle(240_000);
  assert.equal(b.outcome, 'win');
  await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
  await g.clickResult("s.scenes.includes('StoryDialogue')");
}
async function nextLine(g: Game) {
  const before = (await dlg(g))!.line;
  for (let i = 0; i < 3; i++) {
    await g.click(640, 440);
    const moved = await g.page.waitForFunction((l) => { const d = (window as any).__dev.state().dialogue; return !d || d.line !== l; }, before, { timeout: 1500, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (moved) return;
  }
  throw new Error('대사가 넘어가지 않음');
}
async function openDyeDetail(g: Game) {
  await g.clickLabel('인벤토리', { exact: true });
  await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
  await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
  const cell = (await inv(g)).cells.find((c) => c.code === 'water_dye_yarn');
  assert.ok(cell, '물빛 염색실 칸');
  const seen = g.page.waitForResponse((r) => r.url().includes('/inventory/items/water_dye_yarn/seen') && r.status() === 200);
  await g.click(cell.x + cell.w / 2, cell.y + cell.h / 2);
  await seen;
  await g.until('물빛 염색실 선택', "s.inventory.selected === 'water_dye_yarn'");
}
async function assertDyeDetail(g: Game) {
  const t = await texts(g);
  for (const needle of ['물빛 염색실', '분류: 이야기 유물', '수량: 1']) assert.ok(t.some((x) => x.includes(needle)), `상세 문구 ${needle}`);
  assert.ok(t.some((x) => x.includes('이야기 동료 전용')), '잠금 표시');
  for (const label of ['판매', '판매하기', '버리기', '분해', '사용', '사용하기', '누비에게 장착']) assert.equal(t.includes(label), false, `활성 버튼 없음: ${label}`);
  const icon = (await inv(g)).detailIcon!;
  assert.deepEqual([icon.key, icon.size], ['water-dye-yarn', 80], '80×80 아이콘');
}

test('2장 C2-5B ①(1280×720): 보스 승리 → 동시 정산 요청 → 아이템 1개·사건·체크포인트 → 승리 장면 완료 → 인벤토리 유물·잠금', async () => {
  const device = 'e2e-reward-1280';
  await backend.start(seedLake(device, 'boss'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-reward-1280', async () => {
    await enterLake(g);
    assert.equal(dyeRows(device).length, 0);
    await enterBoss(g, 'keys');
    await winAndEnterScene(g);
    // 정산은 장면 전에 끝났다: 사건 둘·아이템 1·체크포인트 — 서버 정본
    assert.equal(count(device, 'lake_boss_defeated'), 1);
    assert.equal(count(device, 'lake_dye_thread_granted'), 1);
    assert.equal(progressOf(device).checkpoint, 'CH02_BOSS_DEFEATED');
    assert.deepEqual(dyeRows(device).map((r) => r.quantity), [1]);
    assert.equal(count(device, 'lake_boss_aftermath_seen'), 0, '장면을 끝까지 보기 전');
    // 동시 정산 요청: 새로 기록되는 것은 없다
    assert.equal(await backend.settleConcurrently(device, 'lake_boss_defeated', 5), 0);
    assert.deepEqual([count(device, 'lake_boss_defeated'), dyeRows(device).length, dyeRows(device)[0].quantity], [1, 1, 1]);
    assert.equal(progressOf(device).nubi_growth_stage, 1, '성장 단계 유지');
    assert.equal(story2(device).length, 0, 'story_2 미장착');

    // 승리 장면: 정본 첫 서술에서 시작, 염색실이 떠오르는 연출 1회
    await g.until('승리 장면 첫 서술', 's.dialogue && s.dialogue.waiting', 20_000);
    assert.ok((await dlg(g))!.line.startsWith(FIRST_LINE), `첫 서술: ${(await dlg(g))!.line}`);
    await g.until('염색실 연출', 's.dialogue.fx && s.dialogue.fx.relicShown === 1 && s.dialogue.fx.relicBounds', 10_000);
    const rb = (await dlg(g))!.fx!.relicBounds!;
    assert.ok(rb.y + rb.h <= 464, `효과가 이름표·대화창 위: ${JSON.stringify(rb)}`);
    assert.ok(rb.x + rb.w <= 1010 || rb.y >= 110, '건너뛰기 버튼과 겹치지 않음');
    await g.until('글자 표시 완료', 's.dialogue && s.dialogue.typing === false', 10_000);
    await g.capture('boss_victory_relic');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(count(device, 'lake_boss_aftermath_seen'), 1);
    assert.equal(progressOf(device).checkpoint, 'CH02_BOSS_DEFEATED');
    assert.deepEqual(dyeRows(device).map((r) => r.quantity), [1]);
    const m = await map(g);
    assert.deepEqual(m.story.points, [], '보스 입장 지점 제거');
    assert.equal(m.story.goalShown, GOAL_AFTER);

    // 인벤토리: 이야기 유물·수량 1·잠금, 판매·버리기·분해·사용·장착 버튼 0, 열람하면 신규 해제
    assert.equal(dyeRows(device)[0].is_new, true);
    await openDyeDetail(g);
    assert.equal(dyeRows(device)[0].is_new, false);
    await assertDyeDetail(g);
    await g.capture('water_dye_yarn_inventory');

    // 새로고침: 장면·보스 미반복
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
    assert.equal((await g.state()).scenes.includes('Battle'), false);
    assert.equal((await map(g)).story.goalShown, GOAL_AFTER);
  }, backend, device);
  await g.close();
});

test('2장 C2-5B ②(640×360): 정산 뒤 장면 중간 새로고침 → 장면 처음부터 → 보스 미반복 → 인벤토리 유물·잠금', async () => {
  const device = 'e2e-reward-640';
  await backend.start(seedLake(device, 'boss'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-reward-640', async () => {
    await enterLake(g);
    await enterBoss(g, 'joystick');
    await winAndEnterScene(g);
    await g.until('승리 장면 첫 서술', 's.dialogue && s.dialogue.waiting', 20_000);
    await nextLine(g);
    assert.equal(count(device, 'lake_boss_aftermath_seen'), 0);

    // 장면 중간 새로고침: 보스전·보상 반복 없음, 승리 장면 처음부터
    await g.reload();
    await g.until('복원된 승리 장면', "s.scenes.includes('StoryDialogue') && s.dialogue && s.dialogue.waiting", 30_000);
    assert.ok((await dlg(g))!.line.startsWith(FIRST_LINE), `처음부터: ${(await dlg(g))!.line}`);
    assert.equal((await g.state()).scenes.includes('Battle'), false, '보스전 미반복');
    assert.equal(count(device, 'lake_boss_defeated'), 1);
    assert.deepEqual(dyeRows(device).map((r) => r.quantity), [1]);
    assert.equal(progressOf(device).checkpoint, 'CH02_BOSS_DEFEATED');
    assert.equal(count(device, 'lake_boss_aftermath_seen'), 0);
    await g.until('염색실 연출', 's.dialogue.fx && s.dialogue.fx.relicShown === 1 && s.dialogue.fx.relicBounds', 10_000);
    const rb = (await dlg(g))!.fx!.relicBounds!;
    assert.ok(rb.y + rb.h <= 464 && (rb.x + rb.w <= 1010 || rb.y >= 110));
    // 대화 화면에는 지도의 인벤토리 버튼이 겹쳐 보이지 않는다
    assert.equal((await texts(g)).includes('인벤토리'), false);

    // 끝 서술(타다닥— 철컥.)까지 → 장면 완료
    for (let i = 0; i < 6 && !(await dlg(g))!.line.startsWith('타다닥'); i++) await nextLine(g);
    assert.ok((await dlg(g))!.line.startsWith('타다닥'), '정본 마지막 서술');
    await g.until('글자 표시 완료', 's.dialogue && s.dialogue.typing === false', 10_000);
    await g.capture('aftermath_dialogue');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(count(device, 'lake_boss_aftermath_seen'), 1);
    assert.equal((await map(g)).story.goalShown, GOAL_AFTER);

    await openDyeDetail(g);
    await assertDyeDetail(g);
    assert.deepEqual(dyeRows(device).map((r) => [r.quantity, r.is_new]), [[1, false]]);

    // 완료 뒤 새로고침: 장면·전투 미반복, 아이템 1개 유지
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
    assert.deepEqual([count(device, 'lake_boss_defeated'), count(device, 'lake_boss_aftermath_seen'), dyeRows(device)[0].quantity], [1, 1, 1]);
  }, backend, device);
  await g.close();
});
