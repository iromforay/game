// 10-26 C5-3: 5장 보일러 옆 사막 전투 — 능선 앞(그을린 박음이·재단 실밥이, 물들이 도움 → 승리하면 물들이 지점만 열림, 체크포인트 유지),
// 황금 재단인형(줄 절단·동료 복구·금빛 연결점·누비가 푸는 안쪽 연결 → 승리 → 승리 장면 → 가위 → 금빛 마감실 장착 → 마지막 마감 → CH05_COMPLETE·종장 개방 기록),
// 640×360 보스전 도중 새로고침 복원. 2차 에셋(C5-4) 전에는 임시 도형으로 진행한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedDesert } from './fixtures';
import { CLUES_TO_SCORCHED, CUT_TO_BOSS, type Pt } from '../helpers/desert-route';

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
const snapOf = (g: Game) => g.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap) as Promise<{ units: { unitId: string; stunned: boolean; reviving?: boolean; regen?: boolean }[]; cutWarns?: string[]; cut?: string[]; round: number }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const glimpseShown = (key: string) => `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && sc.fxState.glimpseShown.includes('${key}'); })()`;

const eventsOf = (device: string) => backend.db.rows('player_story_event', { player_id: backend.playerByDevice(device)!.id }).map((r) => r.event_id as string);
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;
const progressOf = (device: string) => backend.db.rows('player_story_progress', { player_id: backend.playerByDevice(device)!.id })[0] as { checkpoint: string; nubi_growth_stage: number; story_nubi_turby_instance_id: bigint };
const slot = (device: string, key: string) => backend.db.rows('turby_equipment', { turby_instance_id: progressOf(device).story_nubi_turby_instance_id, slot_key: key }).length;
const threadQty = (device: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'golden_finish_thread' })[0] as { id: number };
  return (backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id }) as { quantity: number }[]).map((r) => r.quantity);
};

async function enterDesert(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  // 작은 화면은 한 쪽에 카드 3장 — 5장은 둘째 쪽
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  if ((await g.state()).stageSelect.mode === 'compact') await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('5장 — 보일러 옆 사막', { exact: true });
  await g.until('사막 지도', MAP_READY, 30_000);
}
// 지점까지 걸어가 안내 버튼 → (대화) → 파티 선택 → 전투 화면
async function enterBattle(g: Game, id: string, route: Pt[], how: 'keys' | 'joystick' = 'keys') {
  for (const p of route) await g.walkDirect('Map', p, how, 'false', 30);
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

test('5장 C5-3 ①(1280×720): 능선 앞 — 지문 → 전투(불씨·젖은 칸·곧 끊어질 칸) → 승리 → 물들이 지점 열림, 체크포인트·아이템 그대로', async () => {
  const device = 'e2e-desert-scorched-1280';
  await backend.start(seedDesert(device, 'joined'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'desert-scorched-1280', async () => {
    await enterDesert(g);
    backend.displace(device, { x: 1150, y: 1885 }); // 단서 길(①탐험이 본다)
    await g.reload();
    await g.until('사막 지도', MAP_READY, 30_000);
    const items = backend.db.rows('player_item', { player_id: backend.playerByDevice(device)!.id }).length;
    await enterBattle(g, 'desert_scorched', CLUES_TO_SCORCHED);
    let b = await battle(g);
    assert.deepEqual(['scorched_doll_a', 'scorched_doll_b', 'cutting_stitch_a', 'cutting_stitch_b', 'muldeuli'].map((id) => !!b.units.find((u) => u.id === id)), [true, true, true, true, true]);
    await g.capture('desert_scorched_start');
    // 첫 적 차례 뒤 불씨·곧 끊어질 칸. 누비 혼자여도 마른 박음이는 첫 일격을 버티고 열기 환영을 만들고(C5-6 QA-01),
    // 그 뒤 물들이가 환영을 드러낸 박음이 발밑을 적신다
    const snapOf = () => g.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap) as Promise<{ embers?: unknown[]; wet?: unknown[]; units: { mirageOf?: string }[] }>; // eslint-disable-line
    await g.playBattle(120_000, "(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && b.snap.units.some((u) => u.mirageOf); })()");
    assert.ok((await snapOf()).units.some((u) => u.mirageOf), '열기 환영');
    await g.playBattle(120_000, "(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && (b.snap.embers ?? []).length > 0 && (b.snap.wet ?? []).length > 0; })()");
    const mid = await snapOf();
    assert.ok((mid.embers?.length ?? 0) > 0 && (mid.wet?.length ?? 0) > 0, `불씨 ${mid.embers?.length ?? 0}·젖은 칸 ${mid.wet?.length ?? 0}`);
    await g.capture('desert_scorched_mid');
    await winAndSettle(g);
    b = await battle(g);
    assert.equal(b.outcome, 'win');
    assert.equal(count(device, 'desert_scorched_won'), 1);
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage], ['CH05_CLUES_JOINED', 4], '전투 승리만으로는 체크포인트가 바뀌지 않는다');
    assert.equal(backend.db.rows('player_item', { player_id: backend.playerByDevice(device)!.id }).length, items, '아이템 없음');
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('사막 지도', `(${MAP_READY}) && !s.scenes.includes('StoryDialogue')`, 30_000);
    // 지도는 돌아온 뒤 지역 화면 데이터를 다시 받는다(받기 전에는 전투 전 목록) — 갱신을 기다린다
    await g.until('물들이 지점 열림', "s.map.story.points.includes('desert_ridge_pad')", 10_000);
    const s = await story(g);
    assert.deepEqual([s.points, s.goalShown], [['desert_ridge_pad'], '능선의 틈 앞에서 물들이에게 길을 부탁하자.']);
  }, backend, device);
  await g.close();
});

test('5장 C5-3 ②(1280×720): 황금 재단인형 — 도입 → 전투(줄 절단·동료 복구·연결점·누비가 안쪽 연결을 푼다) → 승리 장면 → 가위 → 금빛 마감실 장착 → 마지막 마감 → CH05_COMPLETE', async () => {
  const device = 'e2e-desert-boss-1280';
  await backend.start(seedDesert(device, 'crossed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'desert-boss-1280', async () => {
    await enterDesert(g);
    backend.displace(device, { x: 2950, y: 470 }); // 절단면(능선은 탐험 E2E가 본다)
    await g.reload();
    await g.until('사막 지도', MAP_READY, 30_000);
    assert.deepEqual(threadQty(device), []);
    await enterBattle(g, 'desert_boss_entrance', CUT_TO_BOSS);
    let b = await battle(g);
    assert.equal(b.units.find((u) => u.id === 'golden_doll')!.phase, 'bound');
    assert.ok(['muldeuli', 'old_pokshini', 'ganeuri'].every((id) => b.units.find((u) => u.id === id)), '동료 셋이 함께 있다');
    await g.capture('desert_boss_start');
    await g.playBattle(120_000, 's.battle && s.battle.round >= 2');
    assert.ok(((await snapOf(g)).cutWarns ?? []).length > 0, '줄 절단 예고');
    await g.capture('desert_boss_line');
    await winAndSettle(g);
    b = await battle(g);
    assert.equal(b.units.find((u) => u.id === 'golden_doll')!.phase, 'exposed', '풀려 무너짐(파괴 아님)');
    assert.deepEqual([count(device, 'desert_boss_defeated'), count(device, 'desert_finish_thread_granted'), progressOf(device).checkpoint], [1, 1, 'CH05_BOSS_DEFEATED']);
    assert.deepEqual(threadQty(device), [1]);
    // 승리 장면 → 가위(한 재생 범위)
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('승리 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(glimpseShown('scissors-reveal'));
    await g.capture('desert_scissors_reveal');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('사막 지도', MAP_READY, 30_000);
    assert.deepEqual([count(device, 'desert_boss_aftermath_seen'), count(device, 'desert_scissors_seen'), progressOf(device).checkpoint], [1, 1, 'CH05_SCISSORS_REVEALED']);

    // 인벤토리 → 누비에게 장착 → 마지막 마감(다섯 유물)
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = (await inv(g)).cells.find((c) => c.code === 'golden_finish_thread');
    assert.ok(cell, '금빛 마감실 칸');
    await g.click(cell.x + cell.w / 2, cell.y + cell.h / 2);
    await g.until('금빛 마감실 선택', "s.inventory.selected === 'golden_finish_thread'");
    assert.ok((await texts(g)).includes('누비에게 장착'), '장착 버튼');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, slot(device, 'story_5'), count(device, 'desert_finish_thread_equipped'), count(device, 'final_unlocked')], ['CH05_COMPLETE', 5, 1, 1, 1]);
    assert.equal(await backend.equipConcurrently(device, 'golden_finish_thread', 5), 0, '동시 장착 요청은 새로 기록하지 않는다');
    await g.advanceDialogue(glimpseShown('five-relics'));
    await g.capture('desert_five_relics');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('사막 지도', MAP_READY, 30_000);
    assert.equal(count(device, 'desert_chapter_complete_seen'), 1);
    // 새로고침: 장면 반복 없음
    await g.reload();
    await g.until('사막 지도', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '장 완료 장면이 반복됨');
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, threadQty(device)], ['CH05_COMPLETE', 5, [1]]);
  }, backend, device);
  await g.close();
});

test('5장 C5-3 ③(640×360): 황금 재단인형 전투 도중 새로고침 → 끊은 연결점(다시 꿰매짐)·줄 예고가 그대로 복원 → 승리', async () => {
  const device = 'e2e-desert-boss-640';
  await backend.start(seedDesert(device, 'crossed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, { width: 640, height: 360 });
  await withDiagnosis(g, 'desert-boss-640', async () => {
    await enterDesert(g);
    backend.displace(device, { x: 2950, y: 470 });
    await g.reload();
    await g.until('사막 지도', MAP_READY, 30_000);
    await enterBattle(g, 'desert_boss_entrance', CUT_TO_BOSS, 'joystick');
    assert.equal(((await g.state()).battle as unknown as { hudMode: string }).hudMode, 'compact');
    await g.playBattle(300_000, "s.battle && s.battle.units.some((u) => u.id.startsWith('gold_point') && u.stunned)");
    const before = await snapOf(g);
    const broken = before.units.filter((u) => u.regen && u.stunned).map((u) => u.unitId).sort();
    assert.ok(broken.length >= 1);
    await g.capture('desert_boss_640_point');
    await g.reload();
    await g.until('전투 복원', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0", 30_000);
    const after = await snapOf(g);
    assert.deepEqual(after.units.filter((u) => u.regen && u.stunned).map((u) => u.unitId).sort(), broken, '끊은 연결점 그대로');
    assert.deepEqual(after.cutWarns ?? [], before.cutWarns ?? [], '줄 예고 그대로');
    await winAndSettle(g);
    assert.equal(progressOf(device).checkpoint, 'CH05_BOSS_DEFEATED');
  }, backend, device);
  await g.close();
});
