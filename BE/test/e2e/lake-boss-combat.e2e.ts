// 10-14 C2-5A: 물먹은 박음이 보스 전투 본체 — 입장 → 보스 피해 차단 → 재봉실 3개 → 구역 복구 → 약점 노출 → 승리(1280×720),
// 물살 예고·적용 → 중간 새로고침 → 상태 복원 → 승리(640×360). 상태(CH02_NUBI_CRISIS_SEEN)는 테스트 격리 DB에 직접 준비한다.
// 승리 정산(사건·물빛 염색실·체크포인트)은 C2-5B의 lake-boss-reward.e2e.ts가 본다.
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
// 정착지 → 입구 문 → 홀 → 안전 물길 문(열림) → 염색 샘 공터 → 보스 입장 지점
const ROUTE = [{ x: 900, y: 1500 }, { x: 1265, y: 1350 }, { x: 1440, y: 1350 }, { x: 1440, y: 1100 }, { x: 1560, y: 1000 }, { x: 1900, y: 1000 }, { x: 2020, y: 1000 }, { x: 2040, y: 800 }, { x: 2400, y: 790 }, { x: 2370, y: 740 }, { x: 2370, y: 590 }, { x: 2370, y: 540 }, { x: 2600, y: 440 }, { x: 2830, y: 420 }];

type BUnit = { id: string; side: string; col: number; row: number; hp: number; maxHp: number; ap: number; stunned: boolean; phase: string | null };
type BState = { labels: { id: string; x: number; y: number; w: number; h: number }[]; units: BUnit[]; round: number; zones: { id: string; state: string }[] | null; telegraphed: { direction: string; round: number } | null; lastCurrent: { round: number; direction: string; moved: string[]; skipped: string[] } | null; hintsShown: { code: string; text: string }[] | null; outcome: string | null; resultButton: unknown; settled: boolean | null; hudMode: string };
const battle = async (g: Game) => (await g.state()).battle as unknown as BState;
const unit = (b: BState, id: string) => b.units.find((u) => u.id === id)!;
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;

// 보이는 이름표가 서로 겹치지 않는다(v1a: 가독성)
function assertNoLabelOverlap(b: BState, where: string) {
  for (let i = 0; i < b.labels.length; i++) {
    for (let j = i + 1; j < b.labels.length; j++) {
      const a = b.labels[i];
      const c = b.labels[j];
      const crossing = a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;
      assert.equal(crossing, false, `${where}: 이름표 교차 ${a.id} ↔ ${c.id}`);
    }
  }
}

const permanent = (device: string) => {
  const p = backend.playerByDevice(device)!;
  return JSON.stringify({
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string).sort(),
    progress: backend.db.rows('player_story_progress', { player_id: p.id }),
    items: backend.db.rows('player_item', { player_id: p.id }),
    instances: backend.db.rows('turby_instance', { owner_player_id: p.id }),
  }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
};

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
// 지도 → (입장 대화) → 파티 선택 → 전투 화면
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
// 격자 칸 중심(캔버스 좌표) — 서버 스냅샷의 칸을 화면 좌표로
const tile = (g: Game, col: number, row: number) => g.page.evaluate(({ c, r }) => { const b = (window as any).__game.scene.getScene('Battle'); const p = b.tileToWorld(c, r); return { x: Math.round(p.x), y: Math.round(p.y) }; }, { c: col, r: row }); // eslint-disable-line @typescript-eslint/no-explicit-any
async function clickTile(g: Game, col: number, row: number) {
  const before = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap.version)) as number; // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = await tile(g, col, row);
  await g.click(p.x, p.y);
  await g.page.waitForFunction((v) => { const b = (window as any).__game.scene.getScene('Battle'); return !b.busy && b.snap.version !== v; }, before, { timeout: 20_000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function finish(g: Game) {
  const b = await g.playBattle(240_000);
  assert.equal(b.outcome, 'win');
  await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton', 30_000);
}

test('2장 C2-5A ①(1280×720): 입장 → 보스 피해 차단 → 재봉실 3개 → 구역 복구 → 약점 노출 → 승리(영구 진행 불변)', async () => {
  const device = 'e2e-boss-1280';
  await backend.start(seedLake(device, 'boss'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-boss-1280', async () => {
    await enterLake(g);
    const before = permanent(device);
    await enterBoss(g, 'keys');
    let b = await battle(g);
    assert.equal(unit(b, 'waterlogged_sewn_doll').phase, 'bound');
    assert.deepEqual(b.zones!.map((z) => z.state), ['drained', 'drained', 'drained']);
    assert.deepEqual(b.units.filter((u) => u.id.startsWith('black_seam')).map((u) => u.stunned), [false, false, false]);
    assertNoLabelOverlap(b, 'bound');
    await g.capture('boss_bound');

    // 결박 상태의 보스: 옆까지 돌아가 공격해도 피해 0(행동은 쓴다), 안내는 한 번만
    await clickTile(g, 4, 5); // (1,4)→(4,5): 재봉실을 피해 이동(AP를 다 쓰면 서버가 서브턴을 넘긴다)
    await g.until('2라운드 내 차례', "s.battle && s.battle.round >= 2 && !s.battle.resultButton", 30_000);
    await g.page.waitForFunction(() => { const b = (window as any).__game.scene.getScene('Battle'); return !b.busy && b.snap.phase === 'player_subturn'; }, null, { timeout: 30_000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
    b = await battle(g);
    const bossAt = unit(b, 'waterlogged_sewn_doll');
    const me = b.units.find((u) => u.side === 'party')!;
    // 보스가 다가왔다 — 인접한 칸으로 이동해 공격
    const target = { col: bossAt.col - 1, row: bossAt.row };
    if (Math.abs(me.col - target.col) + Math.abs(me.row - target.row) > 0) await clickTile(g, target.col, target.row);
    const hpBefore = unit(await battle(g), 'waterlogged_sewn_doll').hp;
    await clickTile(g, bossAt.col, bossAt.row);
    b = await battle(g);
    assert.equal(unit(b, 'waterlogged_sewn_doll').hp, hpBefore, '결박 중 보스 피해 0');
    assert.equal(b.hintsShown!.length, 1);
    assert.ok((await texts(g)).some((t) => t.includes('검은 재봉실을 먼저 끊자.')), '안내 문구가 한 번 표시됨');

    // 재봉실 3개 → 구역 복구 → 약점 노출(서버 판정만 따른다)
    await g.playBattle(240_000, "s.battle && s.battle.zones && s.battle.zones.some((z) => z.state === 'restored')");
    b = await battle(g);
    assert.ok(b.zones!.some((z) => z.state === 'restored'));
    assert.equal(unit(b, 'waterlogged_sewn_doll').phase, 'bound', '아직 결박');
    const removed = b.units.filter((u) => u.id.startsWith('black_seam') && u.stunned).map((u) => u.id);
    assert.ok(removed.length >= 1);
    for (const id of removed) assert.equal(b.labels.some((l) => l.id === id), false, `끊어진 ${id}의 이름표가 남음`);
    assertNoLabelOverlap(b, 'restored');
    await g.capture('zone_restored');
    await g.playBattle(240_000, "s.battle && s.battle.units.some((u) => u.id === 'waterlogged_sewn_doll' && u.phase === 'exposed')");
    b = await battle(g);
    assert.deepEqual(b.zones!.map((z) => z.state), ['restored', 'restored', 'restored']);
    assert.deepEqual(b.units.filter((u) => u.id.startsWith('black_seam')).map((u) => u.stunned), [true, true, true]);
    assert.equal(b.labels.filter((l) => l.id.startsWith('black_seam')).length, 0, 'exposed 상태의 재봉실 이름표 0개');
    assertNoLabelOverlap(b, 'exposed');
    await g.capture('boss_exposed');
    await finish(g);
    // C2-5B: 승리는 서버가 한 번 정산한다(세부는 lake-boss-reward.e2e.ts) — 사건·물빛 염색실·체크포인트가 바뀌고 성장 단계는 그대로
    assert.notEqual(permanent(device), before);
    const progress = backend.db.rows('player_story_progress', { player_id: backend.playerByDevice(device)!.id })[0] as { checkpoint: string; nubi_growth_stage: number };
    assert.deepEqual([progress.checkpoint, progress.nubi_growth_stage], ['CH02_BOSS_DEFEATED', 1]);
  }, backend, device);
  await g.close();
});

test('2장 C2-5A ②(640×360): 물살 예고와 적용 → 중간 새로고침 → 상태 복원 → 승리', async () => {
  const device = 'e2e-boss-640';
  await backend.start(seedLake(device, 'boss'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-boss-640', async () => {
    await enterLake(g);
    await enterBoss(g, 'joystick');
    assert.equal((await battle(g)).hudMode, 'compact');
    // 1라운드 행동 뒤 2라운드 시작에서 예고
    await g.playBattle(240_000, 's.battle && s.battle.telegraphed');
    let b = await battle(g);
    assert.equal(b.round, 2);
    assert.deepEqual(b.telegraphed, { direction: 'east', round: 3 });
    assert.ok((await texts(g)).some((t) => t.includes('다음 물살: →')), '방향이 글자로 표시된다');
    assert.ok((await texts(g)).some((t) => t.includes('턴 종료')), '턴 종료 버튼과 동시에 보인다');
    assertNoLabelOverlap(b, '640 예고');
    await g.capture('current_telegraph');
    const restoredBefore = b.zones!.map((z) => z.state);
    const seamsBefore = b.units.filter((u) => u.id.startsWith('black_seam')).map((u) => u.stunned);

    // 중간 새로고침: 같은 전투·페이즈·재봉실·구역·예고 물살로 복원
    await g.reload();
    await g.until('전투 복원', "s.scenes.includes('Battle') && s.battle && s.battle.units && s.battle.units.length > 0", 30_000);
    b = await battle(g);
    assert.equal(b.round, 2);
    assert.deepEqual(b.telegraphed, { direction: 'east', round: 3 });
    assert.deepEqual(b.zones!.map((z) => z.state), restoredBefore);
    assert.deepEqual(b.units.filter((u) => u.id.startsWith('black_seam')).map((u) => u.stunned), seamsBefore);
    assert.ok((await texts(g)).some((t) => t.includes('다음 물살: →')));

    // 예고 적용: 3라운드 시작에 서버가 정한 이동(피해·AP 감소 없음)
    await g.playBattle(240_000, 's.battle && s.battle.lastCurrent');
    b = await battle(g);
    assert.equal(b.lastCurrent!.round, 3);
    assert.equal(b.lastCurrent!.direction, 'east');
    assert.ok(b.lastCurrent!.moved.length + b.lastCurrent!.skipped.length >= 1);
    await finish(g);
  }, backend, device);
  await g.close();
});
