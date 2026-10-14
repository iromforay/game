// 10-14 C2-6: 물빛 염색실 장착 → 색 회복 장면 → 성장 2·story_2·CH02_COMPLETE·3장 개방.
// ① 1280×720: 유물 상세 → 장착 → 동시 장착 요청(멱등) → 색 회복 장면 → 인벤토리(성장 2·슬롯) → 지역 선택(3장 개방)
// ② 640×360: 장면 중간 새로고침 → 상태 유지·장면 처음부터 → 완료 → 호수 재입장·장면 미반복
// 상태(CH02_BOSS_DEFEATED, 승리 장면 완료)는 테스트 격리 DB에 직접 준비한다.
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
const GOAL_NEXT = '마루바닥 밑에서 들려오는 울림을 따라가자.';
const FIRST_LINE = '물빛 염색실은 물들이에게는';

type MapState = { story: { points: string[]; goalShown: string | null } };
type Dlg = { waiting: boolean; typing: boolean; line: string; fx: { restorePlayed: number; saturation: number; bounds: { x: number; y: number; w: number; h: number } | null } | null };
type Inv = { state: string; selected: string | null; nubiGrowth: number | null; nubiSlotKeys: string[]; cells: { code: string; x: number; y: number; w: number; h: number }[] };
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
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;
const slot2 = (device: string) => backend.db.rows('turby_equipment', { turby_instance_id: progressOf(device).story_nubi_turby_instance_id, slot_key: 'story_2' }).length;
const dyeQty = (device: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number };
  return (backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id }) as { quantity: number }[]).map((r) => r.quantity);
};
const state = (device: string) => ({ cp: progressOf(device).checkpoint, growth: progressOf(device).nubi_growth_stage, slot2: slot2(device), equipped: count(device, 'lake_dye_thread_equipped'), unlocked: count(device, 'underfloor_unlocked') });
const DONE = { cp: 'CH02_COMPLETE', growth: 2, slot2: 1, equipped: 1, unlocked: 1 };

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
  await g.click(cell.x + cell.w / 2, cell.y + cell.h / 2);
  await g.until('물빛 염색실 선택', "s.inventory.selected === 'water_dye_yarn'");
}

test('2장 C2-6 ①(1280×720): 유물 상세 → 장착 → 동시 장착 요청 → 색 회복 장면 → 성장 2·슬롯·CH02_COMPLETE·3장 개방', async () => {
  const device = 'e2e-complete-1280';
  await backend.start(seedLake(device, 'defeated'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-complete-1280', async () => {
    await enterLake(g);
    assert.deepEqual(state(device), { cp: 'CH02_BOSS_DEFEATED', growth: 1, slot2: 0, equipped: 0, unlocked: 0 });
    await openDyeDetail(g);
    // 장착 버튼과 설명·잠금 영역이 함께 보인다(교차 없음은 캡처로)
    const t = await texts(g);
    assert.ok(t.includes('누비에게 장착'), '장착 버튼');
    assert.ok(t.some((x) => x.includes('이야기 동료 전용')), '잠금 표시');
    assert.deepEqual((await inv(g)).nubiSlotKeys, ['story_1']);
    await g.capture('equip_action');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    // 장착은 장면 전에 서버에서 끝났다
    assert.deepEqual(state(device), DONE);
    assert.deepEqual(dyeQty(device), [1], '물빛 염색실 보유 유지');
    assert.equal(count(device, 'lake_chapter_complete_seen'), 0);
    assert.equal(await backend.equipConcurrently(device, 'water_dye_yarn', 5), 0, '동시 장착 요청은 새로 기록하지 않는다');
    assert.deepEqual(state(device), DONE);

    // 색 회복 장면: 정본 첫 서술 + 회복 오버레이 1회, 채도 상승
    await g.until('첫 서술', 's.dialogue && s.dialogue.waiting', 20_000);
    assert.ok((await dlg(g))!.line.startsWith(FIRST_LINE), `첫 서술: ${(await dlg(g))!.line}`);
    await g.until('색 회복 연출', 's.dialogue.fx && s.dialogue.fx.restorePlayed === 1 && s.dialogue.fx.bounds', 10_000);
    const b = (await dlg(g))!.fx!.bounds!;
    assert.ok(b.y + b.h <= 464, `효과가 이름표·대화창 위: ${JSON.stringify(b)}`);
    assert.ok(b.x + b.w <= 1010 || b.y >= 110, '건너뛰기 버튼과 겹치지 않음');
    await g.until('글자 표시 완료', 's.dialogue && s.dialogue.typing === false', 10_000);
    await g.capture('nubi_color_restore');
    await g.until('채도 회복', 's.dialogue.fx.saturation > 0.9', 8_000);
    // {playerName} 치환: "내 이름은?" 뒤 누비 대사
    for (let i = 0; i < 6 && !(await dlg(g))!.line.includes('이번에는 바로'); i++) await nextLine(g);
    const line = (await dlg(g))!.line;
    assert.ok(line.startsWith('하늘.'), `치환된 대사: ${line}`);
    assert.ok(!line.includes('{playerName}'));
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(count(device, 'lake_chapter_complete_seen'), 1);
    assert.deepEqual(state(device), DONE);
    assert.equal((await map(g)).story.goalShown, GOAL_NEXT);

    // 인벤토리: 성장 2·story_2 장착됨·잠금 유지, 장착 버튼 없음
    await openDyeDetail(g);
    const after = await texts(g);
    assert.ok(after.some((x) => x.includes('성장 단계 2')), '성장 단계 2');
    assert.ok(after.some((x) => x.includes('물빛 염색실 슬롯')) && after.includes('장착됨'), 'story_2 장착됨');
    assert.equal(after.includes('누비에게 장착'), false);
    assert.deepEqual((await inv(g)).nubiSlotKeys, ['story_1', 'story_2']);
    await g.capture('story2_equipped');

    // 지역 선택: 3장 개방(콘텐츠 준비 중 문구), 입장 대신 안내
    await g.clickLabel('닫기', { exact: true }).catch(() => undefined);
    await g.clickLabel('마을로', { exact: true });
    await g.waitScene('Village');
    await g.until('마을 준비', 's.village && s.village.ready');
    const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
    await g.clickLabel(exit.prompt);
    await g.waitScene('StageSelect');
    await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 3');
    const cards = ((await g.state()) as unknown as { stageSelect: { cards: { code: string; enterable: boolean }[] } }).stageSelect.cards;
    assert.deepEqual(cards.filter((c) => c.code === 'underground').map((c) => c.enterable), [true], '3장 입장 권한 개방');
    assert.ok((await texts(g)).some((x) => x.includes('3장 — 마루바닥 밑')));
    await g.clickLabel('3장 — 마루바닥 밑', { exact: true });
    await g.until('준비 문구', "true", 5_000);
    assert.ok((await texts(g)).some((x) => x.includes('이야기를 준비하고 있어요')));
    assert.equal((await g.state()).scenes.includes('Map'), false);
  }, backend, device);
  await g.close();
});

test('2장 C2-6 ②(640×360): 장면 중간 새로고침 → 상태 유지·장면 처음부터 → 완료 → 호수 재입장·장면 미반복', async () => {
  const device = 'e2e-complete-640';
  await backend.start(seedLake(device, 'defeated'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-complete-640', async () => {
    await enterLake(g);
    await openDyeDetail(g);
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    await g.until('첫 서술', 's.dialogue && s.dialogue.waiting', 20_000);
    await nextLine(g);
    assert.equal(count(device, 'lake_chapter_complete_seen'), 0);

    // 장면 중간 새로고침: 장착·성장·개방은 유지, 장면은 처음부터(트랜잭션 반복 없음)
    await g.reload();
    await g.until('복원된 장면', "s.scenes.includes('StoryDialogue') && s.dialogue && s.dialogue.waiting", 30_000);
    assert.ok((await dlg(g))!.line.startsWith(FIRST_LINE), `처음부터: ${(await dlg(g))!.line}`);
    assert.deepEqual(state(device), DONE);
    assert.equal(count(device, 'lake_chapter_complete_seen'), 0);
    await g.until('색 회복 연출', 's.dialogue.fx && s.dialogue.fx.restorePlayed === 1 && s.dialogue.fx.bounds', 10_000);
    const b = (await dlg(g))!.fx!.bounds!;
    assert.ok(b.y + b.h <= 464 && (b.x + b.w <= 1010 || b.y >= 110));
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 복귀', MAP_READY, 30_000);
    assert.equal(count(device, 'lake_chapter_complete_seen'), 1);
    assert.deepEqual(state(device), DONE);

    // 완료 뒤 새로고침·호수 재입장: 장면·보스·위기·구조 미반복, 다음 목표 표시
    await g.reload();
    await g.until('호수 지도', MAP_READY, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false);
    assert.equal((await g.state()).scenes.includes('Battle'), false);
    const m = await map(g);
    assert.deepEqual(m.story.points, []);
    assert.equal(m.story.goalShown, GOAL_NEXT);
    assert.deepEqual(state(device), DONE);
    await g.capture('chapter02_complete');
  }, backend, device);
  await g.close();
});
