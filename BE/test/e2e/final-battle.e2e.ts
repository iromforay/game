// 10-26 F-3a: 종장 가위 최종 전투 — 결속을 마친 계정이 검은 틈에서 가위 등장 장면 → 최종 전투(한 전투 안의 3단계: 잘린 길·잘린 기억·다섯 기억의 매듭)
// → 승리(서버 정산 final_boss_defeated, CHFINAL_SCISSORS_DEFEATED) → 다섯 기억의 매듭 → 귀환의 대가 → 다섯 실이 풀리다 → 현실 세계 → 암전·제목 카드(ENDING_COMPLETE, F-3b). 자동 진행(__dev.battleStep)은 누비 환영을 치지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedFinal } from './fixtures';

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

type Pt = { x: number; y: number };
const HOME = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/home_core.json'), 'utf8')) as { points: (Pt & { id: string })[] };
const pointOf = (id: string) => HOME.points.find((p) => p.id === id)!;
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
type BUnit = { id: string; side: string; phase: string | null };
const battle = async (g: Game) => (await g.state()).battle as unknown as { units: BUnit[]; outcome: string | null };
const snapOf = (g: Game) => g.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap) as Promise<{ stage?: { index: number; label: string }; units: { unitId: string; fled?: boolean; phantom?: boolean }[]; blocked?: string[]; sealed?: string[] }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const stageIs = (n: number) => `(() => { const b = window.__game.scene.getScene('Battle'); return !!b && !!b.snap && !!b.snap.stage && b.snap.stage.index === ${n} && b.snap.currentPlayerId === b.myId; })()`;
const eventsOf = (device: string) => backend.db.rows('player_story_event', { player_id: backend.playerByDevice(device)!.id }).map((r) => r.event_id as string);
const count = (device: string, id: string) => eventsOf(device).filter((e) => e === id).length;
const ENDING_SHOWN = `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && !!sc.fxState.endingShown; })()`;
const checkpointOf = (device: string) => (backend.db.rows('player_story_progress', { player_id: backend.playerByDevice(device)!.id })[0] as { checkpoint: string }).checkpoint;

async function enterHome(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.until('지역 카드', 's.stageSelect && s.stageSelect.cards && s.stageSelect.cards.length >= 1');
  await g.clickLabel('▶', { exact: true, expect: 's.stageSelect.page === 1' });
  await g.clickLabel('종장 — 집의 중심', { exact: true });
  await g.until('집의 중심 지도', MAP_READY, 30_000);
}

test('종장 F-3a ①(1280×720): 검은 틈 → 가위 등장 → 최종 전투 3단계(잘린 길·잘린 기억·다섯 기억의 매듭) → 승리 정산 → 매듭·귀환의 대가·다섯 실·현실 세계 → 암전·제목 카드(ENDING_COMPLETE)', async () => {
  const device = 'e2e-final-boss-1280';
  await backend.start(seedFinal(device, 'revealed'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'final-boss-1280', async () => {
    await enterHome(g);
    backend.displace(device, pointOf('final_core'));
    await g.reload();
    await g.until('집의 중심 지도', MAP_READY, 30_000);
    // 검은 틈 → 가위 등장 장면 → 파티 선택 → 전투
    await g.walkDirect('Map', pointOf('final_scissors'), 'keys', "s.map.story.prompt === 'final_scissors'");
    await g.until('검은 틈 안내', "s.map.story.prompt === 'final_scissors' && !!s.map.story.promptText", 20_000);
    const at = ((await g.state()).map.story as { interact: Pt }).interact;
    await g.clickAt(at.x, at.y, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
    await g.until('전투 화면', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0");
    let snap = await snapOf(g);
    assert.deepEqual([snap.stage!.index, snap.stage!.label], [0, '1단계 — 잘린 길']);
    assert.ok(['muldeuli', 'old_pokshini', 'ganeuri', 'bopuli'].every((id) => snap.units.some((u) => u.unitId === id)), '동료 넷이 함께 있다');
    await g.capture('final_boss_stage1');
    // 1단계 → 2단계: 유물 매듭 다섯을 순서대로(봉합된 길)
    await g.playBattle(300_000, stageIs(1));
    snap = await snapOf(g);
    assert.equal((snap.sealed ?? []).length, 4, '네 벽에 길이 이어졌다');
    assert.ok(snap.units.filter((u) => u.phantom).length === 4);
    await g.capture('final_boss_stage2');
    // 2단계 → 3단계: 검정실 넷(환영은 치지 않는다)
    await g.playBattle(300_000, stageIs(2));
    snap = await snapOf(g);
    assert.equal(snap.stage!.label, '3단계 — 다섯 기억의 매듭');
    await g.capture('final_boss_stage3');
    // 3단계: 두 날 → 누비가 다섯 기억의 매듭을 묶는다
    const b = await g.playBattle(300_000);
    assert.equal(b.outcome, 'win');
    await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
    assert.equal((await battle(g)).units.find((u) => u.id === 'scissors')!.phase, 'exposed', '가위가 묶여 풀림(파괴 아님)');
    assert.deepEqual([count(device, 'final_boss_defeated'), checkpointOf(device)], [1, 'CHFINAL_SCISSORS_DEFEATED']);
    // F-3b: 다섯 기억의 매듭 → 귀환의 대가 → 다섯 실이 풀리다 → 현실 세계 → 즉시 암전·제목 카드(한 재생 범위)
    await g.clickLabel('이야기 계속하기', { exact: true });
    await g.until('매듭 장면', "s.scenes.includes('StoryDialogue')", 30_000);
    await g.advanceDialogue(ENDING_SHOWN);
    assert.deepEqual([count(device, 'final_boss_aftermath_seen'), count(device, 'final_cost_accepted'), count(device, 'ending_yarn_reunion_seen'), checkpointOf(device)], [1, 1, 1, 'ENDING_COMPLETE']);
    for (const id of ['game_cleared', 'nubi_bound_to_real_yarn', 'relics_final_unraveled', 'dansuring_returned']) assert.equal(count(device, id), 1, `정식 결말 상태 ${id}`);
    await g.until('제목 카드(누를 수 있음)', `(() => { const sc = window.__game.scene.getScenes(true).find((x) => x.fxState); return !!sc && !!sc.fxState.endingReady; })()`, 15_000);
    await g.capture('final_ending_title');
    await g.clickAt(640, 360, "s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('집의 중심 지도', MAP_READY, 30_000);
  }, backend, device);
  await g.close();
});
