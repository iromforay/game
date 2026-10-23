// 10-23 C4-3: 4장 냉장고 속 전투 — 저장고 앞 길목(얼어붙은 박음이·골무막이 → 승리하면 저장고 문만 열림, 체크포인트 유지),
// 서리 미싱(바늘 예고·고정·가느리 해제·밑실→윗실 → 정지) → 승리 장면 → 얼음 극세사 1개 → 인벤토리에서 누비에게 장착 → 이어진 감각 → CH04_COMPLETE·5장 개방.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFridge } from './fixtures';
import { NEEDLES_TO_GUARD, WALL_TO_CONFESSION, type Pt } from '../helpers/fridge-route';

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

const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
type BUnit = { id: string; side: string; col: number; row: number; hp: number; stunned: boolean; phase: string | null };
type BState = { units: BUnit[]; round: number; outcome: string | null };
const battle = async (g: Game) => (await g.state()).battle as unknown as BState;
type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; goalShown: string | null; interact: { x: number; y: number } };
const story = async (g: Game) => (await g.state()).map.story as StoryState;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
type Inv = { state: string; selected: string | null; cells: { code: string; x: number; y: number; w: number; h: number }[] };
const inv = async (g: Game) => (await g.state()).inventory as Inv;

const eventsOf = (device: string) => backend.db.rows('player_story_event', { player_id: backend.playerByDevice(device)!.id }).map((r) => r.event_id as string);
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;
const progressOf = (device: string) => backend.db.rows('player_story_progress', { player_id: backend.playerByDevice(device)!.id })[0] as { checkpoint: string; nubi_growth_stage: number; story_nubi_turby_instance_id: bigint };
const slot = (device: string, key: string) => backend.db.rows('turby_equipment', { turby_instance_id: progressOf(device).story_nubi_turby_instance_id, slot_key: key }).length;
const fiberQty = (device: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'ice_microfiber' })[0] as { id: number };
  return (backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id }) as { quantity: number }[]).map((r) => r.quantity);
};

async function enterFridge(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('4장 — 냉장고 속', { exact: true });
  await g.until('냉장고 지도', MAP_READY, 30_000);
}
// 지점까지 걸어가 안내 버튼 → (대화) → 파티 선택 → 전투 화면
async function enterBattle(g: Game, id: string, route: Pt[]) {
  for (const p of route) await g.walkDirect('Map', p, 'keys', 'false', 30);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
}
async function winAndSettle(g: Game) {
  const b = await g.playBattle(300_000);
  assert.equal(b.outcome, 'win');
  await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
}

test('4장 C4-3 ①(1280×720): 저장고 앞 길목 — 지문 → 전투(얼음 칸·골무막이 실밥) → 승리 → 저장고 문 열림, 체크포인트·아이템 그대로', async () => {
  const device = 'e2e-fridge-guard-1280';
  await backend.start(seedFridge(device, 'rescued'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'fridge-guard-1280', async () => {
    await enterFridge(g);
    backend.displace(device, { x: 2560, y: 1540 }); // 바늘 통로 동쪽 앵커(통로는 fridge-explore가 본다)
    await g.reload();
    await g.until('냉장고 지도', MAP_READY, 30_000);
    const items = backend.db.rows('player_item', { player_id: backend.playerByDevice(device)!.id }).length;
    await enterBattle(g, 'fridge_guard', NEEDLES_TO_GUARD);
    let b = await battle(g);
    assert.deepEqual(['frozen_doll_a', 'frozen_doll_b', 'thimble_guard', 'black_stitch'].map((id) => !!b.units.find((u) => u.id === id)), [true, true, true, true]);
    await g.capture('fridge_guard_start');
    await winAndSettle(g);
    b = await battle(g);
    assert.equal(b.outcome, 'win');
    await g.capture('fridge_guard_result');
    assert.equal(count(device, 'fridge_frozen_guard_won'), 1);
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage], ['CH04_GANEURI_RESCUED', 3], 'Codex 의견 P-01: 전투 승리만으로는 저장고 완료가 아니다');
    assert.equal(backend.db.rows('player_item', { player_id: backend.playerByDevice(device)!.id }).length, items, '아이템 없음');
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('냉장고 지도', `(${MAP_READY}) && !s.scenes.includes('StoryDialogue')`, 30_000);
    const s = await story(g);
    assert.equal(s.gates.gate_storage_door, true, '저장고 문이 열렸다');
    assert.deepEqual([s.points, s.goalShown], [['fridge_storage_wall'], '열린 저장고 안으로 들어가 보자.']);
  }, backend, device);
  await g.close();
});

test('4장 C4-3 ②(1280×720): 서리 미싱 — 도입 → 전투(바늘 예고·고정·가느리 해제·밑실→윗실) → 정지 → 승리 장면 → 얼음 극세사 → 누비에게 장착 → 이어진 감각 → CH04_COMPLETE·5장 개방', async () => {
  const device = 'e2e-fridge-boss-1280';
  await backend.start(seedFridge(device, 'confessed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'fridge-boss-1280', async () => {
    await enterFridge(g);
    backend.displace(device, { x: 2050, y: 495 }); // 고백 지점(저장고 중심 앞)
    await g.reload();
    await g.until('냉장고 지도', MAP_READY, 30_000);
    assert.deepEqual(fiberQty(device), []);
    await enterBattle(g, 'fridge_boss_entrance', [WALL_TO_CONFESSION[WALL_TO_CONFESSION.length - 1], { x: 1900, y: 480 }, { x: 1800, y: 470 }]);
    let b = await battle(g);
    assert.equal(b.units.find((u) => u.id === 'frost_machine')!.phase, 'bound');
    assert.ok(b.units.find((u) => u.id === 'ganeuri'), '가느리가 함께 있다');
    await g.capture('fridge_boss_start');
    // 첫 적 차례 뒤 바늘 예고가 보인다
    await g.playBattle(120_000, "s.battle && s.battle.round >= 2");
    assert.ok(((await g.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap.needleMarks)) as string[] | undefined)?.length, '바늘 예고 칸'); // eslint-disable-line
    await g.capture('fridge_boss_needle');
    await winAndSettle(g);
    b = await battle(g);
    assert.equal(b.units.find((u) => u.id === 'frost_machine')!.phase, 'exposed', '정지(파괴 아님)');
    assert.deepEqual([count(device, 'fridge_boss_defeated'), count(device, 'fridge_microfiber_granted'), progressOf(device).checkpoint], [1, 1, 'CH04_BOSS_DEFEATED']);
    assert.deepEqual(fiberQty(device), [1]);
    // 승리 장면(정지 직전 기록 · 두 날 흠집)
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('승리 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY, 30_000);
    assert.equal(count(device, 'fridge_boss_aftermath_seen'), 1);
    assert.equal((await story(g)).goalShown, '얼음 극세사를 누비에게 감아 주자.');

    // 인벤토리 → 누비에게 장착 → 이어진 감각
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = (await inv(g)).cells.find((c) => c.code === 'ice_microfiber');
    assert.ok(cell, '얼음 극세사 칸');
    await g.click(cell.x + cell.w / 2, cell.y + cell.h / 2);
    await g.until('얼음 극세사 선택', "s.inventory.selected === 'ice_microfiber'");
    assert.ok((await texts(g)).includes('누비에게 장착'), '장착 버튼');
    await g.capture('fiber_equip_action');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, slot(device, 'story_4'), count(device, 'fridge_microfiber_equipped'), count(device, 'desert_unlocked')], ['CH04_COMPLETE', 4, 1, 1, 1]);
    assert.equal(await backend.equipConcurrently(device, 'ice_microfiber', 5), 0, '동시 장착 요청은 새로 기록하지 않는다');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('냉장고 지도', MAP_READY, 30_000);
    assert.equal(count(device, 'fridge_chapter_complete_seen'), 1);
    assert.equal((await story(g)).goalShown, '뜨거운 바람이 불어오는 보일러 쪽으로 가자.');
    // 새로고침: 장면 반복 없음
    await g.reload();
    await g.until('냉장고 지도', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '장 완료 장면이 반복됨');
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, fiberQty(device)], ['CH04_COMPLETE', 4, [1]]);
  }, backend, device);
  await g.close();
});
