// 10-06 v1 §8: 조우 반경의 서버 단일 정본, 요청 중 이동 유지와 늦은 거부 응답, 복원 실패 → 마을 → 연결 회복, 일반 전투 결과 새로고침 네 시점.
// 실제 Nest 앱(FakeDb) + 실제 게임 클라이언트 + 실제 Chrome. 이동·전투는 실제 키·조이스틱·클릭.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import type { FakeDb } from '../helpers/fake-prisma';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedExplorer } from './fixtures';

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

const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story && s.map.story.greybox === true';
const BLOCKED_TEXT = '길이 막혀 있어요. 돌아서 가까이 가 보세요.';
type Wild = { index: number; characterCode: string; x: number; y: number; state: string; visible: boolean };
type MapState = { avatar: { x: number; y: number }; unreachableWilds: number; notices: string[]; captured: number; wilds: Wild[] };
const mapOf = async (g: Game) => (await g.state()).map as MapState;
const texts = (g: Game) => g.page.evaluate(() => (window as any).__dev.texts()) as Promise<string[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
const radiusOf = (g: Game) => g.page.evaluate(() => (window as any).__rooms.encounterRadius) as Promise<number>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function enterForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 지도·서버 위치 배치', READY);
}
async function serverCatchesUp(g: Game, device: string) {
  const until = Date.now() + 5000;
  for (;;) {
    const a = (await mapOf(g)).avatar;
    const s = backend.serverPosition(device)!;
    if (Math.hypot(a.x - s.x, a.y - s.y) <= 2) return s;
    if (Date.now() > until) throw new Error(`기다리던 상태가 오지 않음: 서버 위치 ${JSON.stringify(s)} ≠ 화면 ${JSON.stringify(a)}`);
    await g.page.waitForFunction(() => true, null, { polling: 100 });
  }
}
const withWilds = (seed: (db: FakeDb) => void, wilds: { index: number; code: string; x: number; y: number }[]) => (db: FakeDb) => {
  seed(db);
  for (const w of wilds) db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: w.index, character_code: w.code, x: w.x, y: w.y });
};
// 여러 번 때려야 이기는 약한 야생(공격력 1) — 전투 도중·결과의 여러 시점을 볼 수 있다
const sturdy = (db: FakeDb) => {
  db.seed('turby_grade', { id: 4, name: '끈질김', base_attack: 1, base_defense: 0, base_action_power: 1, base_hp: 100 });
  db.seed('turby_character', { code: 'muldeuli', name: '물들이', grade_id: 4, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
};

test('반경 ①: 서버 조우 반경이 40보다 작을 때 — 클라이언트는 서버 값(25)을 쓰고, 35px 거리에서는 조우하지 않고 20px 안에서만 조우한다', async () => {
  const device = 'e2e-radius-small';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]), { 'battle.encounterRadiusPx': 25 });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'radius-small', async () => {
    await enterForest(g);
    assert.equal(await radiusOf(g), 25, '클라이언트가 서버 값을 쓴다(고정 40이 아니다)');
    // 서버가 저장한 위치를 야생에서 정확히 35px 떨어진 곳으로 바꾸고 새로고침해 그 자리에 놓는다(걸음 간격에 흔들리지 않는 정확한 거리)
    backend.displace(device, { x: WILD.x - 35, y: WILD.y });
    await g.reload();
    await g.until('Map 복원', READY);
    assert.equal(await radiusOf(g), 25);
    const at = await serverCatchesUp(g, device);
    assert.deepEqual(at, { x: WILD.x - 35, y: WILD.y });
    await g.page.waitForTimeout(2500); // 2.5초 기다려도
    let st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect'), `35px(반경 25 밖, 예전 고정 40 안)에서는 조우하지 않는다: ${JSON.stringify(at)}`);
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === 2)!.state, 'free');
    await g.capture('03_radius_25_no_encounter_at_35px');
    await g.walkTo('Map', { x: WILD.x - 4, y: WILD.y }, 'keys', "s.scenes.includes('PartySelect')", 6);
    await g.waitScene('PartySelect');
    st = await g.state();
    assert.ok(st.scenes.includes('PartySelect'), '반경 25 안에서 조우');
    await g.capture('03_radius_25_encounter_inside');
  }, backend, device);
  await g.close();
});

test('반경 ②: 서버 반경이 40보다 클 때(150) 먼 거리에서 자동 조우한다 — 설정을 바꾸면 재접속 없이 다음 Map 입장에서 새 값을 쓴다', async () => {
  const device = 'e2e-radius-large';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]), { 'battle.encounterRadiusPx': 150 });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'radius-large', async () => {
    await enterForest(g);
    assert.equal(await radiusOf(g), 150);
    // 서버 설정을 25로 바꿔도 이미 받은 값은 그대로이고, 새 Map 상태를 받으면(마을 갔다가 다시 입장 — 재접속 없음) 바뀐다
    backend.setSetting('battle.encounterRadiusPx', 25);
    assert.equal(await radiusOf(g), 150, '새 Map 상태를 받기 전에는 이전 값');
    await g.clickLabel('마을로', { exact: true, expect: "s.scenes.includes('Village')" });
    await g.until('마을 준비', 's.village && s.village.ready');
    const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
    await g.clickLabel(exit.prompt);
    await g.waitScene('StageSelect');
    await g.clickLabel('1장 — 숲', { exact: true });
    await g.until('숲 지도', READY);
    assert.equal(await radiusOf(g), 25, '재접속 없이 새 반경');
    backend.setSetting('battle.encounterRadiusPx', 150);
    // 큰 반경: 새 Map 입장 전에는 25, 150으로 바꾼 뒤 다시 입장하면 150 — 150px 떨어진 곳에서 자동 조우
    await g.clickLabel('마을로', { exact: true, expect: "s.scenes.includes('Village')" });
    await g.until('마을 준비', 's.village && s.village.ready');
    await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
    await g.clickLabel(exit.prompt);
    await g.waitScene('StageSelect');
    await g.clickLabel('1장 — 숲', { exact: true });
    await g.until('숲 지도', READY);
    assert.equal(await radiusOf(g), 150);
    await g.walkTo('Map', { x: WILD.x - 140, y: WILD.y }, 'keys', "s.scenes.includes('PartySelect')", 6);
    await g.waitScene('PartySelect');
    const st = await g.state();
    assert.ok(st.scenes.includes('PartySelect'), '반경 150 안(예전 고정 40 밖)에서 조우');
    await g.capture('04_radius_150_encounter_far');
  }, backend, device);
  await g.close();
});

test('이동 유지: 조우 요청이 서버에서 처리되는 동안에도 걸을 수 있고, 그 사이 다른 야생에 승인되면 늦게 온 거부 응답이 전투 전환을 덮지 않는다', async () => {
  const device = 'e2e-wild-move-while-pending';
  const FENCED = 3; // 울타리 너머(서버가 blocked로 거부)
  const NEAR = { index: 7, code: 'bopuli', x: 2000, y: 1200 };
  await backend.start(withWilds(seedExplorer(device), [NEAR]), { 'battle.encounterRadiusPx': 100 });
  const hold = backend.holdBattleStart(FENCED); // 3번 야생의 조우 요청 처리를 붙잡는다(느린 서버)
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-move-while-pending', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1900, y: 1110 }, 'keys');
    await g.walkTo('Map', { x: 2100, y: 990 }, 'keys');
    await g.until('조우 요청이 서버에 도착해 붙잡힘', 'true');
    while (hold.calls < 1) await g.page.waitForFunction(() => true, null, { polling: 50 });
    const before = await serverCatchesUp(g, device);
    // 요청이 처리 중인 동안 계속 걷는다: 서버가 승인한 위치가 움직인다
    await g.page.keyboard.down('ArrowLeft');
    await g.page.waitForTimeout(700);
    await g.page.keyboard.up('ArrowLeft');
    const moved = await serverCatchesUp(g, device);
    assert.ok(moved.x < before.x - 60, `요청 중에도 이동: ${JSON.stringify(before)} → ${JSON.stringify(moved)}`);
    assert.equal(hold.calls, 1, '같은 야생으로 중복 요청을 보내지 않았다');
    await g.capture('05_wild_request_pending_still_moving');
    // 다른 야생(7번)에 정상 접근 → 승인되어 파티 선택으로 넘어간다
    await g.walkTo('Map', { x: NEAR.x, y: NEAR.y }, 'keys', "s.scenes.includes('PartySelect')", 6);
    await g.waitScene('PartySelect');
    // 이제야 처음 요청(3번)의 거부 응답이 도착한다 — 이미 시작한 전투 전환을 덮지 않는다
    hold.release();
    await g.page.waitForTimeout(1500);
    const st = await g.state();
    assert.ok(st.scenes.includes('PartySelect') && !st.scenes.includes('Map'), '전투 전환 유지(이동 잠금이 풀리거나 Map이 되살아나지 않는다)');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === NEAR.index)!.state, 'engaged', '7번과의 전투가 그대로 진행');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === FENCED)!.state, 'free');
    hold.restore();
  }, backend, device);
  await g.close();
});

test('이동 유지: 막힌 야생에 대한 거부 안내(3초 억제)가 떠 있는 동안에도 계속 걷는다', async () => {
  const device = 'e2e-wild-blocked-keep-moving';
  await backend.start(seedExplorer(device), { 'battle.encounterRadiusPx': 100 });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-blocked-keep-moving', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1900, y: 1110 }, 'keys');
    await g.walkTo('Map', { x: 2100, y: 990 }, 'keys');
    await g.until('거부 안내', `s.map.unreachableWilds >= 1 && window.__dev.texts().includes(${JSON.stringify(BLOCKED_TEXT)})`);
    const at = await serverCatchesUp(g, device);
    await g.walkTo('Map', { x: at.x - 100, y: at.y + 60 }, 'keys');
    const moved = await serverCatchesUp(g, device);
    assert.ok(moved.x < at.x - 60, `안내 중 계속 이동: ${JSON.stringify(moved)}`);
    assert.ok(!(await g.state()).scenes.includes('PartySelect'));
    await g.capture('06_blocked_wild_notice_and_moving');
  }, backend, device);
  await g.close();
});

// 조우 → 파티 선택 → 전투 화면까지(마커 위에 서서 자동 조우)
async function startBattle(g: Game, wild: { x: number; y: number }) {
  await enterForest(g);
  await g.walkTo('Map', wild, 'keys', "s.scenes.includes('PartySelect')", 8);
  await g.until('일반 파티 선택', 's.party && !s.party.story && s.party.selected.length === 1');
  await g.clickLabel('선택 완료', { exact: true, expect: "s.scenes.includes('Battle')" });
}
const captures = (device: string) => backend.db.rows('turby_instance', { owner_player_id: backend.playerByDevice(device)!.id, acquired_via: 'wild_capture' }).length;
const results = (device: string) => backend.db.rows('battle_result', { player_id: backend.playerByDevice(device)!.id }).length;

test('결과 새로고침 ①(적 행동 직전): 내 차례에 새로고침 → 같은 전투·상태로 복원 → 한 라운드만 진행(적 행동이 두 번 일어나지 않음) → 승리·포획은 한 번', async () => {
  const device = 'e2e-battle-reload-before-enemy';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'battle-reload-before-enemy', async () => {
    await startBattle(g, WILD);
    const mid = await g.playBattle(120_000, "s.battle.round >= 2 && s.battle.units.some((u) => u.side === 'wild' && u.hp < u.maxHp)");
    const pick = (b: Record<string, unknown>) => ({ battleId: b.battleId, round: b.round, phase: b.phase, units: b.units });
    const before = pick(mid);
    await g.reload();
    await g.until('전투 복원', `s.scenes.includes('Battle') && s.battle && s.battle.battleId === ${JSON.stringify(before.battleId)}`);
    await g.until('내 차례', 'window.__dev.battleStep() !== null');
    assert.deepEqual(pick((await g.state()).battle), before, '새로고침 전후 같은 상태');
    // 다음 라운드까지만 진행: 적은 한 번만 행동한다(라운드가 정확히 하나 오른다)
    const after = await g.playBattle(120_000, `s.battle.round >= ${(before.round as number) + 1}`);
    assert.ok(after.round === (before.round as number) + 1 || after.resultShown, `라운드는 하나만 올랐다(적 행동 중복 없음): ${String(before.round)} → ${String(after.round)}`);
    const win = await g.playBattle();
    assert.equal(win.outcome, 'win');
    await g.until('보상 확정', 's.battle.settled === true');
    assert.equal(captures(device), 1);
    assert.equal(results(device), 1);
  }, backend, device);
  await g.close();
});

test('결과 새로고침 ②(정산 직전): 정산이 실패한 채 새로고침 → 결과 화면 복원, 서버가 재정산 → 포획 한 번·같은 야생 재조우 없음', async () => {
  const device = 'e2e-battle-reload-before-settle';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]), { 'battle.resolvedRetentionSeconds': 600 });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'battle-reload-before-settle', async () => {
    await startBattle(g, WILD);
    backend.failNextSettles(2); // 전투 종료 때 한 번, 새로고침 뒤 서버의 재확인에서 한 번 실패하고 그다음부터 성공한다
    await g.playBattle(120_000, "false").catch(() => undefined); // 결과가 뜰 때까지 진행(승리 직후 결과 화면)
    const s = await g.state();
    assert.ok(s.battle.phase === 'resolved' && s.battle.settled !== true, `정산 전 결과: settled=${String(s.battle.settled)}`);
    assert.equal(captures(device), 0, '아직 보상이 기록되지 않았다');
    await g.capture('07a_result_unsettled_before_reload');
    await g.reload();
    await g.until('결과 화면 복원', "s.scenes.includes('Battle') && s.battle && s.battle.phase === 'resolved'");
    await g.until('정산 확정', 's.battle.settled === true', 30_000);
    assert.ok((await texts(g)).some((t) => t.includes('포획 성공!')));
    assert.deepEqual([captures(device), results(device)], [1, 1], '보상은 한 번만');
    await g.capture('07b_result_restored_and_settled');
    await g.clickResult("s.scenes.includes('Map')");
    await g.until('Map 복귀', READY);
    const m = await mapOf(g);
    assert.equal(m.wilds.find((w) => w.index === WILD.index)!.state, 'captured');
    assert.equal(m.wilds.find((w) => w.index === WILD.index)!.visible, false, '같은 야생이 다시 나타나지 않는다');
  }, backend, device);
  await g.close();
});

test('결과 새로고침 ③④(정산 직후·포획 성공 뒤 Map 복귀 직전·Map 복귀 직후): 결과가 사라지지 않고 보상은 한 번, 확인(Map 복귀) 뒤에는 결과가 다시 나오지 않고 같은 야생이 다시 나타나지 않는다', async () => {
  const device = 'e2e-battle-reload-after-settle';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]), { 'battle.resolvedRetentionSeconds': 600 });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'battle-reload-after-settle', async () => {
    await startBattle(g, WILD);
    const win = await g.playBattle();
    assert.equal(win.outcome, 'win');
    await g.until('보상 확정', 's.battle.settled === true');
    assert.ok((await texts(g)).some((t) => t.includes('포획 성공!')));
    assert.equal(captures(device), 1);
    // ③ 정산 직후(결과 화면, 버튼을 누르기 전) 새로고침
    await g.capture('08a_result_after_settle_before_reload');
    await g.reload();
    await g.until('결과 화면 복원', "s.scenes.includes('Battle') && s.battle && s.battle.phase === 'resolved' && s.battle.resultShown && s.battle.settled === true");
    assert.ok((await texts(g)).some((t) => t.includes('포획 성공!')), '결과(포획)가 사라지지 않았다');
    assert.deepEqual([captures(device), results(device)], [1, 1]);
    await g.capture('08b_result_restored_after_reload');
    // ④ 포획 성공 결과 위에서 한 번 더 새로고침(Map 복귀 직전)
    await g.reload();
    await g.until('결과 화면 복원', "s.scenes.includes('Battle') && s.battle && s.battle.resultShown && s.battle.settled === true");
    assert.deepEqual([captures(device), results(device)], [1, 1]);
    await g.clickResult("s.scenes.includes('Map')");
    await g.until('Map 복귀', READY);
    // Map 복귀로 결과를 확인했다 — 새로고침하면 Map(같은 자리)로 복원되고 결과는 다시 나오지 않는다
    await g.reload();
    await g.until('Map 복원', READY);
    const st = await g.state();
    assert.ok(!st.scenes.includes('Battle') && !st.scenes.includes('PartySelect'), '결과 화면이 다시 나오지 않는다');
    const m = await mapOf(g);
    assert.equal(m.captured, 1);
    assert.deepEqual(m.wilds.find((w) => w.index === WILD.index), { index: WILD.index, characterCode: WILD.code, x: WILD.x, y: WILD.y, state: 'captured', visible: false }, '같은 야생이 다시 나타나지 않는다');
    assert.deepEqual([captures(device), results(device)], [1, 1], '보상·결과는 한 번만');
  }, backend, device);
  await g.close();
});

test('복원 실패 → 마을 → 연결 회복: 두 버튼, 마을 복귀는 요청 한 번(방을 만들지 않음), 낡은 응답이 마을 화면을 덮지 않고, 연결이 돌아오면 남은 전투를 안내한다', async () => {
  const device = 'e2e-restore-escape';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(withWilds((db) => { seedExplorer(device)(db); sturdy(db); }, [WILD]));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'restore-escape-village', async () => {
    await startBattle(g, WILD);
    const battleId = (await g.state()).battle.battleId as string;
    const rooms = backend.roomCount();
    const leaves = backend.countLeaves();
    const hold = backend.holdHello();
    await g.reload();
    await g.until('지연 안내', "s.boot && s.boot.phase === 'slow' && s.boot.retry === true && s.boot.village === true", 20_000);
    const t = await texts(g);
    assert.ok(t.includes('연결이 늦어지고 있어요. 서버 응답을 기다리고 있어요.'));
    assert.ok(t.includes('다시 시도') && t.includes('마을 화면으로 돌아가기'), '두 버튼');
    await g.capture('09_restore_failed_two_buttons');
    // 마을 복귀: 여러 번 눌러도 한 번 — 첫 클릭 뒤 버튼이 사라지고, 서버에 닿지 않은 상태라 이탈 요청도 가지 않는다
    const btn = (await g.page.evaluate(() => (window as any).__dev.find('마을 화면으로 돌아가기', true))) as { x: number; y: number }; // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.click(btn.x, btn.y);
    await g.click(btn.x, btn.y);
    await g.click(btn.x, btn.y);
    await g.waitScene('Village');
    await g.until('마을 준비', 's.village && s.village.ready');
    assert.equal(leaves.calls, 0, '서버에 닿지 않았으므로 이탈 요청 없음');
    assert.equal(backend.roomCount(), rooms, '새 탐험 방을 만들지 않았다');
    // 늦게 온 첫 복원 응답(서버가 활성 전투를 알려 줌)이 마을 화면을 덮지 않고, 새 활동 전에 복원 안내가 뜬다
    hold.release(1);
    await g.until('복원 안내', 's.village && s.village.restorePrompt === true');
    let st = await g.state();
    assert.ok(st.scenes.includes('Village') && !st.scenes.includes('Battle'), '자동으로 전투로 끌고 가지 않는다');
    assert.ok((await texts(g)).includes('이어서 하기'));
    await g.capture('10_village_restore_prompt_after_connection_back');
    hold.restore();
    await g.clickLabel('이어서 하기', { exact: true, expect: "s.scenes.includes('Battle')" });
    assert.equal((await g.state()).battle.battleId, battleId, '같은 전투로 이어진다');
    assert.equal(backend.roomCount(), rooms);
  }, backend, device);
  await g.close();
});
