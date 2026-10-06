// 10-02 v6 §7: 야생 위치의 서버 단일 정본(화면·미니맵·전체 지도), 접근 불가 야생 안내, 위치 보정 안내, 복원 지연과 다시 시도,
// 일반 야생 전투 도중의 새로고침 복원. 실제 Nest 앱(FakeDb) + 실제 게임 클라이언트 + 실제 Chrome. 이동·전투는 실제 키·조이스틱·클릭.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import type { FakeDb } from '../helpers/fake-prisma';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedExplorer, seedForest } from './fixtures';

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
const SPAWN = { x: 1600, y: 1200 };
const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story && s.map.story.greybox === true';
const BLOCKED_TEXT = '길이 막혀 있어요. 돌아서 가까이 가 보세요.';
const LOCKED_TEXT = '아직 들어갈 수 없는 곳이에요.';
const CORRECTED_TEXT = '안전한 위치에서 다시 시작했어요.';
type Wild = { index: number; characterCode: string; x: number; y: number; state: string; visible: boolean };
type MiniWild = { id: string; x: number; y: number; mini: { x: number; y: number }; full: { x: number; y: number } };
type MapState = { avatar: { x: number; y: number }; positioned: boolean; corrections: number; unreachableWilds: number; notices: string[]; captured: number; wilds: Wild[]; hudMode: string; size: { width: number; height: number }; miniMap: { wilds: MiniWild[]; scale: { mini: number; full: number }; legend: string[]; open: boolean; openButton: { x: number; y: number } } };
const mapOf = async (g: Game) => (await g.state()).map as MapState;
const texts = (g: Game) => g.page.evaluate(() => (window as any).__dev.texts()) as Promise<string[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
const byIndex = <T extends { index: number }>(list: T[]) => [...list].sort((a, b) => a.index - b.index);

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

test('야생 ①: 야생 마커는 서버가 내려 준 것만, 서버 좌표 그대로 화면·미니맵·전체 지도에 놓인다. 서버 좌표가 바뀌면 마커가 따라 옮겨진다', async () => {
  const device = 'e2e-wild-authority';
  // 예전 클라이언트 설정(2번 1600,300 · 6번 2500,1600)과 일부러 다른 좌표 — 화면이 서버 값을 쓰는지 드러난다
  await backend.start(withWilds(seedForest(device, 'rescued'), [{ index: 2, code: 'bopuli', x: 1790, y: 1090 }, { index: 6, code: 'bopuli', x: 1450, y: 1040 }]));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-authority', async () => {
    await enterForest(g);
    const server = byIndex(backend.session(device)!.wilds);
    assert.deepEqual(server.map((w) => w.index), [0, 2, 6], '서버의 야생 마커(기본 0번 + 시험용 2개)');
    let m = await mapOf(g);
    assert.deepEqual(byIndex(m.wilds), server.map((w) => ({ ...w, visible: true })), '화면 마커 = 서버 마커(ID·종류·좌표·상태). 서버에 없는 마커는 없다');
    assert.deepEqual(m.size, { width: 3200, height: 2400 }, '지도 크기도 서버의 지역 데이터 값');
    // 미니맵·전체 지도: 같은 서버 좌표를 같은 배율로 옮긴 자리
    const mini = m.miniMap.wilds;
    assert.deepEqual(mini.map((w) => [w.id, w.x, w.y]).sort(), server.map((w) => [`wild-${w.index}`, w.x, w.y]).sort());
    const [a, b] = [mini.find((w) => w.id === 'wild-2')!, mini.find((w) => w.id === 'wild-6')!];
    for (const layer of ['mini', 'full'] as const) {
      const k = m.miniMap.scale[layer];
      assert.ok(Math.abs((a[layer].x - b[layer].x) - (a.x - b.x) * k) < 0.01 && Math.abs((a[layer].y - b[layer].y) - (a.y - b.y) * k) < 0.01, `${layer}: 지도 위 간격 = 서버 좌표 간격 × 배율`);
    }
    assert.ok(m.miniMap.legend.includes('wild'), '범례에 야생 터비(모양으로 구분)');
    await g.capture('01a_server_wilds_on_screen_and_minimap');
    await g.clickAt(m.miniMap.openButton.x, m.miniMap.openButton.y, 's.map.miniMap.open === true');
    assert.ok((await texts(g)).some((t) => t.includes('야생 터비 — 세모')), '전체 지도 범례');
    await g.capture('01b_server_wilds_on_full_map');
    await g.page.keyboard.press('Escape');
    await g.until('지도 닫힘', 's.map.miniMap.open === false');

    // 서버에 없는 번호(예전 클라이언트 설정에만 있던 1번)는 화면에도 없고 조우도 안 된다
    const res = (await g.page.evaluate(() => (window as any).__dev.rawRequest('battle:start', { spawnIndex: 1 }))) as { ok: boolean; code: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([res.ok, res.code], [false, 'INVALID_SPAWN']);

    // 서버 좌표가 바뀌면 같은 마커 ID가 새 좌표로 옮겨진다(화면·미니맵 모두)
    backend.moveWild(device, 6, { x: 1400, y: 1120 });
    await g.until('마커 이동', 's.map.wilds.find((w) => w.index === 6).x === 1400 && s.map.miniMap.wilds.find((w) => w.id === "wild-6").y === 1120');
    m = await mapOf(g);
    assert.deepEqual(byIndex(m.wilds).map((w) => [w.index, w.x, w.y]), [[0, 520, 500], [2, 1790, 1090], [6, 1400, 1120]]);
    assert.equal(m.wilds.length, 3, '마커가 늘거나 겹치지 않는다');
  }, backend, device);
  await g.close();
});

test('야생 ②: 울타리 너머의 야생 — 서버 거부를 "길이 막혀 있어요" 안내로 알리고, 재확인(1.5초)마다 반복하지 않으며(3초 억제), 안내 중에도 걸을 수 있다', async () => {
  const device = 'e2e-wild-notice';
  await backend.start(withWilds(seedForest(device, 'rescued'), [{ index: 3, code: 'bopuli', x: 2100, y: 900 }]));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-blocked-notice', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1900, y: 1110 }, 'keys');
    await g.walkTo('Map', { x: 2100, y: 990 }, 'keys');
    await g.page.keyboard.down('ArrowUp');
    try {
      await g.until('서버가 조우를 거부', 's.map.unreachableWilds >= 1');
      await g.until('안내 표시', `s.map.notices.length === 1 && window.__dev.texts().includes(${JSON.stringify(BLOCKED_TEXT)})`);
      await g.capture('02_wild_behind_fence_notice');
      // 두 번째 거부(1.5초 뒤)에는 같은 안내를 다시 띄우지 않는다
      await g.until('재확인', 's.map.unreachableWilds >= 2');
      const m = await mapOf(g);
      if (m.unreachableWilds === 2) assert.deepEqual(m.notices, [BLOCKED_TEXT], '같은 야생·같은 사유는 3초 안에 반복하지 않는다');
      assert.ok(m.notices.length <= Math.ceil(m.unreachableWilds / 2), `안내 ${m.notices.length}회 ≤ 거부 ${m.unreachableWilds}회의 절반`);
    } finally {
      await g.page.keyboard.up('ArrowUp');
    }
    // 안내가 떠 있는 동안에도 이동한다(서버가 승인)
    const at = (await mapOf(g)).avatar;
    await g.walkTo('Map', { x: at.x - 120, y: at.y + 60 }, 'keys');
    const moved = await serverCatchesUp(g, device);
    assert.ok(moved.x < at.x - 60, `안내 중에도 이동: ${JSON.stringify(moved)}`);
    const st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect') && !st.scenes.includes('Battle'));
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === 3)!.state, 'free');
    for (const t of (await mapOf(g)).notices) assert.doesNotMatch(t, /\d|blocked|locked/, '좌표·거리·사유 코드를 드러내지 않는다');
  }, backend, device);
  await g.close();
});

test('야생 ③: 아직 들어갈 수 없는 구역 안의 야생 — "아직 들어갈 수 없는 곳이에요" 안내, 전투는 시작되지 않는다', async () => {
  const device = 'e2e-wild-locked';
  await backend.start(withWilds(seedForest(device, 'rescued'), [{ index: 4, code: 'bopuli', x: 1716, y: 1380 }]));
  // 시험용 잠긴 구역을 이 서버 인스턴스의 지역 데이터에 덧붙인다(실제 회색상자의 잠긴 구역은 두꺼운 벽에 둘러싸여 조우 거리 안으로 다가갈 수 없다).
  // 화면에는 내려가지 않는 구역이다(공개 조건 전) — 판정은 서버가 한다
  backend.patchStage('forest', (d) => d.layout!.zones.push({ id: 'zone_test_locked', label: '잠긴 곳(시험)', x: 1700, y: 1320, width: 140, height: 120, visibleAfter: 'forest_first_knot_equipped' }));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-locked-zone-notice', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1680, y: 1380 }, 'keys', 's.map.unreachableWilds >= 1', 6);
    await g.until('서버가 조우를 거부', 's.map.unreachableWilds >= 1');
    await g.until('안내 표시', `s.map.notices.length === 1 && window.__dev.texts().includes(${JSON.stringify(LOCKED_TEXT)})`);
    await g.capture('03_wild_in_locked_zone_notice');
    assert.deepEqual((await mapOf(g)).notices, [LOCKED_TEXT]);
    const st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect') && !st.scenes.includes('Battle'), '전투가 시작되지 않음');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === 4)!.state, 'free');
  }, backend, device);
  await g.close();
});

test('야생 ④: 저장된 위치가 더는 유효하지 않으면 재입장 때 시작 지점에서 다시 시작하고 안내를 한 번만 보여 준다. 그 뒤 이동과 다음 재접속에는 안내가 없다', async () => {
  const device = 'e2e-position-corrected';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'position-corrected-notice', async () => {
    await enterForest(g);
    assert.deepEqual((await mapOf(g)).notices, [], '정상 입장에는 안내 없음');
    await g.walkTo('Map', { x: 1420, y: 1100 }, 'keys');
    await serverCatchesUp(g, device);
    backend.displace(device, { x: 1700, y: 830 }); // 먼지풀(bush_04) 안 — 저장된 위치가 막힌 곳이 된 상황
    await g.reload();
    await g.until('Map 복원', READY);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, backend.serverPosition(device)], [SPAWN, SPAWN], '시작 지점으로 보정');
    await g.until('보정 안내', `s.map.notices.length === 1 && window.__dev.texts().includes(${JSON.stringify(CORRECTED_TEXT)})`);
    await g.capture('04_position_corrected_notice');
    // 위치 확정 뒤 입력은 정상이고, 걸어도(작은 이동 보정이 있더라도) 안내가 다시 뜨지 않는다
    await g.walkTo('Map', { x: 1500, y: 1140 }, 'keys');
    const after = await serverCatchesUp(g, device);
    assert.ok(after.x < 1560, `보정 뒤 이동: ${JSON.stringify(after)}`);
    m = await mapOf(g);
    assert.deepEqual(m.notices, [CORRECTED_TEXT], '한 번만');
    // 다음 재접속: 위치가 유효하므로 안내 없음
    await g.reload();
    await g.until('Map 복원', READY);
    m = await mapOf(g);
    assert.deepEqual([m.avatar, m.notices], [after, []]);
  }, backend, device);
  await g.close();
});

test('야생 ⑤: 640×360 — 복원이 늦어지면 연결 상태 안내와 다시 시도 버튼, 실패 응답에도 다시 시도, 연속 재시도 뒤 같은 세션의 Map으로 복원(방이 늘지 않고, 늦게 온 낡은 응답이 화면을 덮지 않는다)', async () => {
  const device = 'e2e-restore-retry';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'restore-slow-retry', async () => {
    await enterForest(g);
    await g.walkTo('Map', { x: 1480, y: 1060 }, 'joystick');
    const before = await serverCatchesUp(g, device);
    const room = backend.session(device)!.code;
    assert.equal(backend.roomCount(), 1);

    const hold = backend.holdHello(); // 접속 인증 응답을 붙잡는다(느린 서버)
    const t0 = Date.now();
    await g.reload();
    await g.until('불러오는 중', "s.boot && s.boot.phase === 'loading' && s.boot.retry === false");
    assert.ok((await texts(g)).includes('이어서 불러오는 중…'));
    // 1) 오래 걸리면: 연결 상태 설명 + 다시 시도 버튼
    await g.until('지연 안내', "s.boot && s.boot.phase === 'slow' && s.boot.retry === true", 15_000);
    assert.ok(Date.now() - t0 >= 3000, '지연 안내는 일정 시간이 지난 뒤에만');
    assert.ok((await texts(g)).some((t) => t.includes('연결이 늦어지고 있어요')));
    assert.ok(!(await g.state()).scenes.includes('Village'), '응답 없이 마을로 넘어가지 않는다');
    await g.capture('05_restore_loading_slow');
    // 2) 다시 시도 → 이번에는 서버가 실패로 응답 → 실패 안내 + 다시 시도
    await g.clickLabel('다시 시도', { exact: true, expect: "s.boot.attempts === 2 && s.boot.phase === 'loading'" });
    while (hold.calls < 2) await g.page.waitForFunction(() => true, null, { polling: 50 });
    hold.release(2, true);
    await g.until('실패 안내', "s.boot && s.boot.phase === 'failed' && s.boot.retry === true");
    assert.ok((await texts(g)).some((t) => t.includes('서버에 연결하지 못했어요')));
    await g.capture('06_restore_failed_retry');
    // 3) 다시 시도(연속 세 번째) → 정상 응답 → 같은 세션의 Map·같은 자리
    await g.clickLabel('다시 시도', { exact: true, expect: 's.boot.attempts === 3' });
    while (hold.calls < 3) await g.page.waitForFunction(() => true, null, { polling: 50 });
    hold.release(3);
    await g.until('Map 복원', READY);
    let m = await mapOf(g);
    assert.deepEqual([m.avatar, backend.serverPosition(device), backend.session(device)!.code, backend.roomCount(), m.hudMode], [before, before, room, 1, 'compact'], '같은 자리·같은 세션, 방은 하나');
    // 4) 맨 처음 붙잡아 둔 낡은 응답이 이제야 도착한다 — 화면도 세션도 그대로다
    hold.release(1);
    hold.restore();
    await g.walkTo('Map', { x: before.x - 160, y: before.y + 40 }, 'joystick');
    const after = await serverCatchesUp(g, device);
    assert.ok(after.x < before.x - 100, `복원 뒤 이동이 서버에 반영: ${JSON.stringify(after)}`);
    m = await mapOf(g);
    const st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('Boot') && !st.scenes.includes('Village'));
    assert.deepEqual([m.corrections, m.notices, backend.session(device)!.code, backend.roomCount()], [0, [], room, 1]);
  }, backend, device);
  await g.close();
});

test('야생 ⑥: 일반 야생 전투 도중 새로고침 → 같은 전투·라운드·유닛 상태로 복원(스토리 대화로 돌아가지 않음) → 승리·포획 결과 → Map 복귀 → 같은 야생은 다시 조우하지 않는다', async () => {
  const device = 'e2e-wild-battle-reload';
  const WILD = { index: 2, code: 'muldeuli', x: 1760, y: 1330 };
  await backend.start(
    withWilds((db) => {
      seedExplorer(device)(db);
      // 여러 번 때려야 이기는 야생(공격은 약하다) — 전투 도중의 상태를 볼 수 있게
      db.seed('turby_grade', { id: 4, name: '끈질김', base_attack: 1, base_defense: 0, base_action_power: 1, base_hp: 100 });
      db.seed('turby_character', { code: 'muldeuli', name: '물들이', grade_id: 4, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
    }, [WILD]),
  );
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'wild-battle-reload', async () => {
    const p = backend.playerByDevice(device)!;
    await enterForest(g);
    assert.ok(!(await g.state()).scenes.includes('StoryDialogue'));
    // 1) 일반 야생 조우 → 2) PartySelect 완료
    await g.walkTo('Map', { x: WILD.x, y: WILD.y }, 'keys', "s.scenes.includes('PartySelect')", 8);
    await g.until('일반 파티 선택', 's.party && !s.party.story && s.party.selected.length === 1');
    await g.clickLabel('선택 완료', { exact: true, expect: "s.scenes.includes('Battle')" });
    // 3) 전투를 진행하다(야생의 체력이 깎인 뒤, 내 차례) 새로고침
    const wounded = "s.battle.units.some((u) => u.side === 'wild' && u.hp < u.maxHp) && s.battle.round >= 2";
    const mid = await g.playBattle(120_000, wounded);
    assert.ok(!mid.resultShown && mid.phase === 'player_subturn', `전투 도중: ${mid.phase}`);
    // 버전은 비교하지 않는다: 끊김·재접속 표시도 전투 이벤트라 새로고침하면 버전이 오른다(전투 내용은 그대로)
    const pick = (b: Record<string, unknown>) => ({ battleId: b.battleId, round: b.round, phase: b.phase, spawnIndex: b.spawnIndex, story: b.story, returnTo: b.returnTo, units: b.units });
    const versionBefore = (await g.state()).battle.version as number;
    const beforeReload = pick((await g.state()).battle);
    assert.deepEqual([beforeReload.spawnIndex, beforeReload.story, beforeReload.returnTo], [WILD.index, false, null], '일반 전투: 서버 마커 ID, 스토리 표식·대화 복귀 없음');
    await g.capture('07_wild_battle_before_reload');

    await g.reload();
    await g.until('전투 복원', `s.scenes.includes('Battle') && s.battle && s.battle.battleId === ${JSON.stringify(beforeReload.battleId)}`);
    // 4) 같은 일반 전투·라운드·유닛 상태
    await g.until('내 차례', 'window.__dev.battleStep() !== null');
    assert.deepEqual(pick((await g.state()).battle), beforeReload, '새로고침 뒤 같은 전투·라운드·차례·유닛 위치와 체력·행동력');
    assert.ok(((await g.state()).battle.version as number) >= versionBefore, '서버 전투 상태가 되돌아가지 않는다');
    let st = await g.state();
    assert.ok(!st.scenes.includes('StoryDialogue') && !st.scenes.includes('Village') && !st.scenes.includes('Map'), '전투 화면으로 바로 복원');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === WILD.index)!.state, 'engaged', '같은 마커가 교전 중');
    await g.capture('08_wild_battle_restored_same_state');

    // 5) 승리 → 포획 결과
    const win = await g.playBattle();
    assert.deepEqual([win.outcome, win.story], ['win', false]);
    await g.until('보상 확정', 's.battle.settled === true');
    assert.ok((await texts(g)).some((t) => t.includes('포획 성공!')));
    await g.capture('09a_capture_result_after_reload');
    // 6) Map으로 복귀(스토리 대화를 거치지 않는다)
    await g.clickResult("s.scenes.includes('Map')");
    await g.until('Map 복귀', READY);
    st = await g.state();
    assert.ok(!st.scenes.includes('StoryDialogue') && !st.scenes.includes('Battle'), '일반 전투 뒤에는 대화로 돌아가지 않는다');
    assert.equal(backend.db.rows('turby_instance', { owner_player_id: p.id, acquired_via: 'wild_capture' }).length, 1, '포획한 터비 지급(한 번)');
    // 7) 같은 야생: 서버 상태 captured, 화면에서 사라지고, 그 자리를 밟아도 다시 조우하지 않는다
    await g.until('포획 표시', `s.map.captured === 1 && s.map.wilds.find((w) => w.index === ${WILD.index}).visible === false && window.__dev.texts().includes('포획: 1')`);
    const m = await mapOf(g);
    assert.deepEqual(m.wilds.find((w) => w.index === WILD.index), { index: WILD.index, characterCode: WILD.code, x: WILD.x, y: WILD.y, state: 'captured', visible: false });
    assert.ok(!m.miniMap.wilds.some((w) => w.id === `wild-${WILD.index}`), '미니맵에서도 사라진다');
    assert.equal(backend.session(device)!.wilds.find((w) => w.index === WILD.index)!.state, 'captured');
    await g.walkTo('Map', { x: WILD.x - 90, y: WILD.y }, 'keys');
    await g.walkTo('Map', { x: WILD.x, y: WILD.y }, 'keys', 'false', 10);
    await serverCatchesUp(g, device);
    const again = (await g.page.evaluate((i) => (window as any).__dev.rawRequest('battle:start', { spawnIndex: i }), WILD.index)) as { ok: boolean; code: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([again.ok, again.code], [false, 'WILD_GONE']);
    st = await g.state();
    assert.ok(st.scenes.includes('Map') && !st.scenes.includes('PartySelect') && !st.scenes.includes('Battle'), '같은 야생과 다시 조우하지 않는다');
    await g.capture('09b_map_after_capture_wild_gone');
  }, backend, device);
  await g.close();
});
