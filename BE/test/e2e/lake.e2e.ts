// 10-13 C2-1: 2장 호수 입구·정착지·물결북 — 1장을 마친 계정이 호수에 입장해 도입 대화 → 새로고침(반복 없음) →
// 물들이 → 물결북 반응 → 목표 갱신 → 새로고침(CH02_SETTLEMENT_MET 복원). 1280×720과 640×360 필수 UI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
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

const LAKE = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/lake.json'), 'utf8')) as { spawnPoint: { x: number; y: number }; points: { id: string; x: number; y: number }[]; layout: { gates: { id: string; x: number; width: number }[] } };
const pointOf = (id: string) => LAKE.points.find((p) => p.id === id)!;
const SMALL = { width: 640, height: 360 };
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const GOAL_FOLLOW_THREAD = '검은 실이 사라진 방향을 따라가자';
const GOAL_FOLLOW_RIPPLE = '물결북의 파문을 따라 물풀 미로를 지나가자.';

type StoryState = { points: string[]; gates: Record<string, boolean>; prompt: string | null; promptText: string | null; busy: boolean; interact: { x: number; y: number }; interactRect: { x: number; y: number; w: number; h: number }; goal: string | null; goalShown: string | null };
const story = async (g: Game) => (await g.state()).map.story as StoryState;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;

function dbOf(device: string) {
  const p = backend.playerByDevice(device)!;
  return {
    checkpoint: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint,
    growth: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { nubi_growth_stage: number }).nubi_growth_stage,
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string),
    items: backend.db.rows('player_item', { player_id: p.id }).map((r) => `${r.item_definition_id}:${r.quantity}`).sort(),
  };
}
const once = (events: string[], id: string) => events.filter((e) => e === id).length;

async function enterLake(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('2장 — 호수', { exact: true });
}
async function reachMap(g: Game, expectIntro: boolean) {
  await g.until('호수 지도 또는 이야기 장면', `(${MAP_READY}) || s.scenes.includes('StoryDialogue')`, 30_000);
  if ((await g.state()).scenes.includes('StoryDialogue')) {
    assert.equal(expectIntro, true, '이미 본 장면이 다시 재생됨');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  }
  await g.until('호수 지도', MAP_READY);
  if (!expectIntro) {
    await g.page.waitForTimeout(800); // 늦게 뜨는 장면이 없는지 한 번 더 본다
    assert.equal((await g.state()).scenes.includes('StoryDialogue'), false, '이미 본 도입이 반복됨');
  }
}
async function interact(g: Game, id: string, how: 'keys' | 'joystick', beforeClick?: () => Promise<void>) {
  await g.walkDirect('Map', pointOf(id), how, `s.map && s.map.story && s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내 버튼`, `s.map && s.map.story && s.map.story.prompt === '${id}' && !!s.map.story.promptText`);
  await beforeClick?.();
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
  await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY);
}

type RenderState = { overlays: string[]; overlayPlans: { id: string; assetKey: string; x: number; y: number; width: number; height: number; rotation: number; alpha: number; depth: number }[]; pointArts: { id: string; assetKey: string | null; art: { width: number; height: number; pivot: number[] } | null }[] };
const render = async (g: Game) => (await g.state()).map.render as RenderState;
// 물결북 상태별 표시(10-13 v1c): 반응 전 = idle 그림(88~112px)·오버레이 없음, 반응 뒤 = active·파문 오버레이(바닥층·플레이어보다 아래)
async function assertDrumIdle(g: Game) {
  const r = await render(g);
  const drum = r.pointArts.find((p) => p.id === 'lake_wave_drum')!;
  assert.equal(drum.assetKey, 'wave-drum-idle', '반응 전 물결북 그림');
  assert.ok(drum.art && drum.art.width >= 88 && drum.art.width <= 112);
  assert.equal(r.pointArts.find((p) => p.id === 'lake_mulduri')?.assetKey ?? 'turby-muldeuli', 'turby-muldeuli');
  assert.deepEqual(r.overlays.filter((k) => k !== 'current-flow'), []); // 물살 그림(current-flow)은 상태와 무관하게 있다
}
async function assertDrumActive(g: Game) {
  const r = await render(g);
  assert.equal(r.pointArts.some((p) => p.assetKey === 'wave-drum-idle'), false, 'idle 그림이 남음');
  assert.deepEqual(r.overlays.filter((k) => k !== 'current-flow').sort(), ['wave-drum-active', 'wave-path']);
  const path = r.overlayPlans.find((o) => o.assetKey === 'wave-path')!;
  const active = r.overlayPlans.find((o) => o.assetKey === 'wave-drum-active')!;
  assert.ok(path.depth < 0 && active.depth < 0, '플레이어·NPC(깊이 0)보다 아래');
  assert.ok(path.alpha <= 0.72 && path.width >= 420 && path.width <= 560 && active.width >= 88 && active.width <= 112);
}

test('2장 C2-1 ①: 호수 입장 → 도입 → 새로고침(반복 없음) → 물들이 → 물결북 → 목표 갱신 → 새로고침(CH02_SETTLEMENT_MET 복원)', async () => {
  const device = 'e2e-lake-1280';
  await backend.start(seedLake(device), { 'story.stageAccessV2': true }); // 신 판정(이벤트 기반 개방) — 구 판정(대표 터비 포획)에서는 1장 완료 계정도 호수 카드가 잠긴다
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-c2-1', async () => {
    const before = dbOf(device);
    assert.equal(before.checkpoint, 'CH01_COMPLETE');
    await enterLake(g);
    // 1) 도입 대화(물빛 입구) — 끝까지 보면 CH02_STARTED
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.capture('lake_01_intro');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('호수 지도', MAP_READY);
    let db = dbOf(device);
    assert.equal(db.checkpoint, 'CH02_STARTED');
    assert.equal(once(db.events, 'lake_entry_seen'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '보상·성장 변화 없음');
    let s = await story(g);
    assert.equal(s.goalShown, GOAL_FOLLOW_THREAD, `목표 패널: ${s.goalShown}`);
    assert.deepEqual(s.points, ['lake_mulduri'], '도입 뒤 정착지의 물들이가 표시됨');
    await g.capture('lake_02_after_intro');

    // 2) 새로고침: 도입이 반복되지 않는다
    await g.reload();
    await reachMap(g, false);
    s = await story(g);
    assert.equal(s.goalShown, GOAL_FOLLOW_THREAD);
    assert.equal(dbOf(device).checkpoint, 'CH02_STARTED');

    // 3) 물들이 → 정착지 대화(물결북 앞까지). 체크포인트는 그대로, 물결북 지점이 열린다
    await interact(g, 'lake_mulduri', 'keys');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH02_STARTED');
    assert.equal(once(db.events, 'lake_mulduri_met'), 1);
    s = await story(g);
    assert.ok(s.points.includes('lake_wave_drum'), '물결북 지점이 열림');
    await g.capture('lake_03_after_mulduri');

    // 4) 물결북 반응 → CH02_SETTLEMENT_MET, 목표 갱신
    await interact(g, 'lake_wave_drum', 'keys', async () => {
      await assertDrumIdle(g);
      await g.capture('wave_drum_idle');
    });
    await assertDrumActive(g);
    await g.capture('wave_drum_active_path');
    db = dbOf(device);
    assert.equal(db.checkpoint, 'CH02_SETTLEMENT_MET');
    assert.equal(once(db.events, 'lake_wave_drum_awakened'), 1);
    assert.deepEqual([db.growth, db.items], [before.growth, before.items], '정착지 단계에도 보상 없음');
    s = await story(g);
    assert.equal(s.goalShown, GOAL_FOLLOW_RIPPLE);
    assert.deepEqual(s.points, [], '상호작용 지점 없음(임시 미로 표식 제거)');
    assert.equal(s.gates.gate_reed_maze, true, '물결북 반응과 함께 물풀문이 열린다');
    // 회색상자 지도 자체의 표준 안내(기능 맵 단계)는 제외하고, 이번 단계의 대기 상태에 개발 진행 문구를 쓰지 않는다
    assert.equal((await texts(g)).some((t) => /다음 개발|개발 단계|TODO/.test(t)), false, '개발 진행 문구가 화면에 없다');
    await g.capture('lake_04_settlement_met');

    // 5) 다시 새로고침: SETTLEMENT_MET에서 복원, 장면 반복 없음
    await g.reload();
    await reachMap(g, false);
    s = await story(g);
    assert.equal(dbOf(device).checkpoint, 'CH02_SETTLEMENT_MET');
    assert.equal(s.goalShown, GOAL_FOLLOW_RIPPLE);
    assert.deepEqual(s.points, []);
    assert.equal(s.gates.gate_reed_maze, true, '새로고침 뒤에도 열린 문');

    // 6) 미로 안쪽 안전 물길 사건(lake_safe_route_opened)은 기록되지 않는다(C2-3 구조 뒤)
    assert.equal(dbOf(device).checkpoint, 'CH02_SETTLEMENT_MET');
    assert.deepEqual(dbOf(device).events.filter((e) => e.startsWith('lake_')).sort(), ['lake_entry_seen', 'lake_mulduri_met', 'lake_unlocked', 'lake_wave_drum_awakened']);
  }, backend, device);
  await g.close();
});

test('2장 C2-1 ②: 640×360 — 도입·물들이·물결북이 같은 흐름으로 동작하고, 안내 버튼은 조이스틱 영역 위, 목표 패널과 겹치지 않는다', async () => {
  const device = 'e2e-lake-640';
  await backend.start(seedLake(device), { 'story.stageAccessV2': true }); // 신 판정(이벤트 기반 개방) — 구 판정(대표 터비 포획)에서는 1장 완료 계정도 호수 카드가 잠긴다
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-c2-1-small', async () => {
    await enterLake(g);
    await g.until('도입 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.capture('lake_s01_intro');
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('호수 지도', MAP_READY);
    assert.equal(dbOf(device).checkpoint, 'CH02_STARTED');
    await interact(g, 'lake_mulduri', 'joystick');
    // 안내 버튼·목표 패널 배치(기존 반응형 규칙): 물결북 앞에서 확인
    await g.walkDirect('Map', pointOf('lake_wave_drum'), 'joystick', "s.map.story.prompt === 'lake_wave_drum'");
    await g.until('물결북 안내', "s.map.story.prompt === 'lake_wave_drum' && !!s.map.story.promptText");
    const s = await story(g);
    const m = (await g.state()).map as { hudMode: string; joystickZone: { x: number; y: number; w: number; h: number } };
    assert.equal(m.hudMode, 'compact');
    assert.ok(s.interactRect.y + s.interactRect.h <= m.joystickZone.y, '안내 버튼은 조이스틱 영역 위');
    assert.ok(s.interactRect.h * 0.5 >= 40 && s.interactRect.w * 0.5 >= 200, '실제 화면에서 누를 수 있는 크기');
    assert.equal(s.goalShown, GOAL_FOLLOW_THREAD);
    await assertDrumIdle(g);
    await g.capture('wave_drum_idle_prompt');
    await g.clickAt(s.interact.x, s.interact.y, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('지도 준비', MAP_READY);
    assert.equal(dbOf(device).checkpoint, 'CH02_SETTLEMENT_MET');
    assert.equal((await story(g)).goalShown, GOAL_FOLLOW_RIPPLE);
    await assertDrumActive(g);
    await g.capture('wave_drum_active_path');

    assert.equal((await story(g)).gates.gate_reed_maze, true, '물풀문이 열려 있다');
  }, backend, device);
  await g.close();
});
