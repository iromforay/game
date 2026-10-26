// 10-16 C3-3: 3장 전투·보스·장 완료 — 실제 화면으로
// ① 1280×720 매복: 기계음 장면 → 파티 선택 → 전투(납작·작은 실패굴이) → 승리 → 실패 자국 길 개방(문 열림·CH03_MEMORY_TRAIL_FOUND)
// ② 1280×720 보스: 입장 → 기억실 5가닥(다음 실 표시) → 승리 → 승리 장면 → 솜심 1개(CH03_BOSS_DEFEATED)
// ③ 640×360 보스: 중간 새로고침 → 전투 복원 → 승리
// ④ 1280×720 장 완료: 인벤토리 → 누비에게 장착 → 성장 3·story_3·CH03_COMPLETE·4장 개방 → 장면 → 재입장 시 장면 미반복
// 상태는 테스트 격리 DB에 직접 준비한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedUnderfloor } from './fixtures';
import { SPAWN_TO_AMBUSH, SPAWN_TO_BOSS, type Pt } from '../helpers/underfloor-route';

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

const UG = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/underground.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
const pointOf = (id: string) => UG.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';

type BUnit = { id: string; side: string; col: number; row: number; hp: number; stunned: boolean; phase: string | null };
type BState = { labels: { id: string; x: number; y: number; w: number; h: number }[]; units: BUnit[]; round: number; hudMode: string };
const battle = async (g: Game) => (await g.state()).battle as unknown as BState;
const unit = (b: BState, id: string) => b.units.find((u) => u.id === id)!;
type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; goalShown: string | null; interact: { x: number; y: number } };
const story = async (g: Game) => (await g.state()).map.story as StoryState;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
type Inv = { state: string; selected: string | null; nubiGrowth: number | null; nubiSlotKeys: string[]; cells: { code: string; x: number; y: number; w: number; h: number }[] };
const inv = async (g: Game) => (await g.state()).inventory as Inv;

const eventsOf = (device: string) => backend.db.rows('player_story_event', { player_id: backend.playerByDevice(device)!.id }).map((r) => r.event_id as string);
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;
const progressOf = (device: string) => backend.db.rows('player_story_progress', { player_id: backend.playerByDevice(device)!.id })[0] as { checkpoint: string; nubi_growth_stage: number; story_nubi_turby_instance_id: bigint };
const slot = (device: string, key: string) => backend.db.rows('turby_equipment', { turby_instance_id: progressOf(device).story_nubi_turby_instance_id, slot_key: key }).length;
const coreQty = (device: string) => {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'old_cotton_core' })[0] as { id: number };
  return (backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id }) as { quantity: number }[]).map((r) => r.quantity);
};

async function enterUnderfloor(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('3장 — 마루바닥 밑', { exact: true });
  await g.until('마루 밑 지도', MAP_READY, 30_000);
}
// 지점까지 걸어가 안내 버튼 → (대화) → 파티 선택 → 전투 화면
async function enterBattle(g: Game, id: string, route: Pt[], how: 'keys' | 'joystick') {
  for (const p of route) await g.walkDirect('Map', p, how, 'false', 30);
  await g.until(`${id} 안내`, `s.map.story.prompt === '${id}' && !!s.map.story.promptText`, 20_000);
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
  if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
  await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
}
function assertNoLabelOverlap(b: BState, where: string) {
  for (let i = 0; i < b.labels.length; i++) {
    for (let j = i + 1; j < b.labels.length; j++) {
      const a = b.labels[i];
      const c = b.labels[j];
      assert.equal(a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y, false, `${where}: 이름표 교차 ${a.id} ↔ ${c.id}`);
    }
  }
}
async function winAndSettle(g: Game) {
  const b = await g.playBattle(300_000);
  assert.equal(b.outcome, 'win');
  await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
}

test('3장 C3-3 ①(1280×720): 매복 — 기계음 장면 → 전투(납작·작은 실패굴이) → 승리 → 실패 자국 길 개방', async () => {
  const device = 'e2e-ambush-1280';
  await backend.start(seedUnderfloor(device, 'items'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'underfloor-ambush-1280', async () => {
    assert.equal(progressOf(device).checkpoint, 'CH03_ELDER_MET');
    await enterUnderfloor(g);
    assert.equal((await story(g)).gates.gate_dust_yarn, false);
    await enterBattle(g, 'underfloor_ambush', SPAWN_TO_AMBUSH, 'keys');
    const b = await battle(g);
    assert.deepEqual(b.units.filter((u) => u.side === 'wild').map((u) => u.id).sort(), ['carrier_thread', 'pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c', 'small_spool']);
    assertNoLabelOverlap(b, '매복 시작');
    const t = await texts(g);
    assert.ok(t.some((x) => x.includes('납작')), '납작 표식');
    await g.capture('ambush_start');
    await winAndSettle(g);
    // 정산은 전투 확정 시 서버가 한 번
    assert.equal(count(device, 'underfloor_ambush_won'), 1);
    assert.equal(count(device, 'underfloor_memory_trail_found'), 1);
    assert.equal(progressOf(device).checkpoint, 'CH03_MEMORY_TRAIL_FOUND');
    assert.equal(progressOf(device).nubi_growth_stage, 2);
    await g.capture('ambush_result');
    await g.clickResult("s.scenes.includes('Map') || s.scenes.includes('StoryDialogue')");
    if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('마루 밑 지도', MAP_READY, 30_000);
    // 지도는 전투에서 돌아온 뒤 지역 화면 데이터를 다시 받는다(받기 전에는 전투 전 문 상태) — 갱신을 기다린다
    await g.until('먼지 실타래 문 열림 반영', 's.map.story.gates.gate_dust_yarn === true', 10_000);
    const s = await story(g);
    assert.equal(s.gates.gate_dust_yarn, true, '먼지 실타래 문이 열린다');
    assert.deepEqual(s.points, ['underfloor_fragment']);
    assert.equal(s.goalShown, '굴러간 실패 자국을 따라가자.');
  }, backend, device);
  await g.close();
});

test('3장 C3-3 ②(1280×720): 보스 — 기억실 5가닥·다음 실 표시 → 약점 노출 → 승리 → 승리 장면 → 솜심 1개', async () => {
  const device = 'e2e-boss-ug-1280';
  await backend.start(seedUnderfloor(device, 'fragment'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'underfloor-boss-1280', async () => {
    await enterUnderfloor(g);
    assert.deepEqual(coreQty(device), []);
    await enterBattle(g, 'underfloor_boss_entrance', SPAWN_TO_BOSS, 'keys');
    let b = await battle(g);
    assert.equal(unit(b, 'memory_spool').phase, 'bound');
    assert.equal(b.units.filter((u) => u.id.startsWith('thread_') && !u.stunned).length, 5);
    assertNoLabelOverlap(b, '보스 시작');
    const t = await texts(g);
    assert.ok(t.some((x) => x.includes('기억실 4') && (x.includes('▶') || x.includes('다음 실'))), '다음 실 표시');
    await g.capture('boss_start');
    await g.playBattle(300_000, "s.battle && s.battle.units.some((u) => u.id === 'memory_spool' && u.phase === 'exposed')");
    b = await battle(g);
    assert.equal(b.units.filter((u) => ['thread_4', 'thread_2', 'thread_5'].includes(u.id) && u.stunned).length, 3, '진짜 실 셋이 끊김');
    assertNoLabelOverlap(b, '약점 노출');
    await g.capture('boss_exposed');
    await winAndSettle(g);
    assert.equal(count(device, 'underfloor_boss_defeated'), 1);
    assert.equal(count(device, 'underfloor_cotton_core_granted'), 1);
    assert.deepEqual(coreQty(device), [1]);
    assert.equal(progressOf(device).checkpoint, 'CH03_BOSS_DEFEATED');
    assert.equal(progressOf(device).nubi_growth_stage, 2);
    assert.equal(slot(device, 'story_3'), 0, '아직 미장착');
    await g.clickResult("s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('마루 밑 지도', MAP_READY, 30_000);
    assert.equal(count(device, 'underfloor_boss_aftermath_seen'), 1, '승리 장면을 끝까지 보면 한 번 기록');
    assert.equal((await story(g)).goalShown, '오래된 솜심을 누비에게 가져가자.');
    assert.equal((await story(g)).points.includes('underfloor_boss_entrance'), false, '입장 지점이 닫힌다');
  }, backend, device);
  await g.close();
});

test('3장 C3-3 ③(640×360): 보스 전투 도중 새로고침 → 같은 전투·기억실 상태 복원 → 승리', async () => {
  const device = 'e2e-boss-ug-640';
  await backend.start(seedUnderfloor(device, 'fragment'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'underfloor-boss-640', async () => {
    await enterUnderfloor(g);
    await enterBattle(g, 'underfloor_boss_entrance', SPAWN_TO_BOSS, 'joystick');
    assert.equal((await battle(g)).hudMode, 'compact');
    await g.playBattle(300_000, "s.battle && s.battle.units.some((u) => u.id.startsWith('thread_') && u.stunned)");
    let b = await battle(g);
    const cut = b.units.filter((u) => u.id.startsWith('thread_') && u.stunned).map((u) => u.id).sort();
    assert.ok(cut.length >= 1);
    assertNoLabelOverlap(b, '640 진행');
    await g.reload();
    await g.until('전투 복원', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0", 30_000);
    b = await battle(g);
    assert.deepEqual(b.units.filter((u) => u.id.startsWith('thread_') && u.stunned).map((u) => u.id).sort(), cut, '끊은 실이 그대로');
    await winAndSettle(g);
    assert.equal(progressOf(device).checkpoint, 'CH03_BOSS_DEFEATED');
    assert.deepEqual(coreQty(device), [1]);
  }, backend, device);
  await g.close();
});

test('3장 C3-3 ④(1280×720): 인벤토리 → 누비에게 장착 → 성장 3·story_3·CH03_COMPLETE·4장 개방 → 장면 → 재입장 시 장면 반복 없음', async () => {
  const device = 'e2e-complete-ug-1280';
  await backend.start(seedUnderfloor(device, 'aftermath'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'underfloor-complete-1280', async () => {
    await enterUnderfloor(g);
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, slot(device, 'story_3')], ['CH03_BOSS_DEFEATED', 2, 0]);
    await g.clickLabel('인벤토리', { exact: true });
    await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
    await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
    const cell = (await inv(g)).cells.find((c) => c.code === 'old_cotton_core');
    assert.ok(cell, '오래된 솜심 칸');
    await g.click(cell.x + cell.w / 2, cell.y + cell.h / 2);
    await g.until('오래된 솜심 선택', "s.inventory.selected === 'old_cotton_core'");
    const t = await texts(g);
    assert.ok(t.includes('누비에게 장착'), '장착 버튼');
    assert.ok(t.some((x) => x.includes('이야기 동료 전용')), '잠금 표시');
    await g.capture('core_equip_action');
    await g.clickLabel('누비에게 장착', { exact: true });
    await g.waitScene('StoryDialogue');
    // 장착은 장면 전에 서버에서 끝났다
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage, slot(device, 'story_3'), count(device, 'underfloor_cotton_core_equipped'), count(device, 'fridge_unlocked')], ['CH03_COMPLETE', 3, 1, 1, 1]);
    assert.deepEqual(coreQty(device), [1], '솜심 보유 유지');
    assert.equal(await backend.equipConcurrently(device, 'old_cotton_core', 5), 0, '동시 장착 요청은 새로 기록하지 않는다');
    assert.equal(count(device, 'underfloor_chapter_complete_seen'), 0);
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('마루 밑 지도', MAP_READY, 30_000);
    assert.equal(count(device, 'underfloor_chapter_complete_seen'), 1);
    assert.equal((await story(g)).goalShown, '은빛 실이 가리키는 북쪽으로 가자.');
    // 새로고침: 장면 반복 없음
    await g.reload();
    await g.until('마루 밑 지도', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '장 완료 장면이 반복됨');
    assert.deepEqual([progressOf(device).checkpoint, progressOf(device).nubi_growth_stage], ['CH03_COMPLETE', 3]);
    void pointOf;
  }, backend, device);
  await g.close();
});
