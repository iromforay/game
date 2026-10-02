// 10-02 v3 §7: 1장 숲 — 고유 오브젝트(빛나는 실가루) 수집과 숲 안의 이야기 지점. 실제 Nest 앱(FakeDb) + 실제 게임 클라이언트 + 실제 Chrome.
// 이동은 실제 키·조이스틱 입력, 상호작용은 안내 버튼 한 번 클릭. 좌표는 서버 지역 데이터(회색상자 — 임시)에서 읽는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { readFileSync } from 'fs';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedForest } from './fixtures';

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

const FOREST = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/stages/forest.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
const dustId = (n: number) => `forest_dust_${String(n).padStart(2, '0')}`;
const COLLECT = 'POST /player/me/story/objectives/forest_glowing_dust/progress';
const SMALL = { width: 640, height: 360 };
const requests = (g: Game, what: string) => g.net.filter((n) => n.kind === 'http' && n.what === what);
const texts = (g: Game) => g.page.evaluate('window.__dev.texts()') as Promise<string[]>;
const story = async (g: Game) => (await g.state()).map.story as { objects: string[]; locked: number; points: string[]; gates: Record<string, boolean>; objective: { collected: number; required: number } | null; prompt: string | null; promptText: string | null; busy: boolean; interact: { x: number; y: number }; interactRect: { x: number; y: number; w: number; h: number } };

function dbState(device: string) {
  const p = backend.playerByDevice(device)!;
  const def = backend.db.rows('item_definition', { code: 'glowing_yarn_dust' })[0] as { id: number };
  return {
    collected: backend.db.rows('player_story_objective_progress', { player_id: p.id }).length,
    dust: ((backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id })[0] as { quantity: number } | undefined)?.quantity ?? 0) as number,
    checkpoint: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint,
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string),
    token: (backend.db.rows('player', { id: p.id })[0] as { session_token: string }).session_token,
  };
}

// 마을 출구 → 지역 선택 → 숲. 숲에 들어서 지역 스토리 화면이 준비될 때까지
async function enterForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
  await g.until('숲 지도와 이야기 화면', 's.map && s.map.ready && s.map.inRoom && s.map.story && s.map.story.greybox === true');
}

// 지점·오브젝트까지 걸어가 안내 버튼이 그 대상을 가리킬 때까지(경유지는 막힌 곳을 돌아가는 길)
async function walkToTarget(g: Game, id: string, how: 'keys' | 'joystick' = 'keys', via: { x: number; y: number }[] = []) {
  for (const w of via) await g.walkTo('Map', w, how);
  await g.walkTo('Map', pointOf(id), how, `s.map && s.map.story && s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내 버튼`, `s.map && s.map.story && s.map.story.prompt === '${id}' && !!s.map.story.promptText`);
}
// 응답까지 끝난 요청이 n건 기록될 때까지(상태 조건 — 고정 지연 아님)
async function waitRequests(g: Game, what: string, n: number) {
  const until = Date.now() + 10_000;
  while (requests(g, what).filter((r) => r.status !== undefined).length < n) {
    if (Date.now() > until) throw new Error(`기다리던 요청이 오지 않음: ${what} × ${n}`);
    await g.page.waitForFunction(() => true, null, { polling: 50 });
  }
}
async function press(g: Game, expect: string) {
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, expect);
}

// 실가루 줍는 순서와 돌아가는 길(회색상자 배치의 먼지풀을 피한다)
const ROUTE: [number, { x: number; y: number }[]][] = [
  [2, []],
  [3, []],
  [1, []],
  [7, []],
  [9, []],
  [6, []],
  [10, []],
  [5, [{ x: 1960, y: 1450 }]],
  [8, []],
  [4, []],
];

test('숲 ①: 보풀이 구조 전에는 실가루가 잠겨 보이고 수집이 거부된다(1280×720) — 서버 거절 뒤 화면·DB 변화 없음', async () => {
  const device = 'e2e-forest-locked';
  await backend.start(seedForest(device, 'cut'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'forest-locked', async () => {
    await enterForest(g);
    let s = await story(g);
    assert.deepEqual([s.objects.length, s.locked, s.points], [10, 10, ['forest_bopuli_ambush']], '실가루 10개가 잠긴 채 보이고, 열린 지점은 공터 하나');
    assert.equal((await g.state()).map.goal, false, '의뢰 전에는 수집 목표가 없다');
    // 동선 개요(개발용 화면 축소 — 캡처만을 위한 것이며 조작이 아니다)
    await g.page.evaluate(() => { const cam = (window as any).__game.scene.getScene('Map').cameras.main; cam.setZoom(0.4); }); // eslint-disable-line @typescript-eslint/no-explicit-any
    await g.capture('01_greybox_forest_overview');
    await g.page.evaluate(() => { const cam = (window as any).__game.scene.getScene('Map').cameras.main; cam.setZoom(1); }); // eslint-disable-line @typescript-eslint/no-explicit-any

    await walkToTarget(g, dustId(2));
    s = await story(g);
    assert.equal(s.promptText, '아직 모을 수 없어요');
    await g.capture('02_dust_locked_before_rescue');
    // 눌러도 서버가 거절한다: 요청 한 번, 409, 안내 표시, 화면·DB 그대로
    await press(g, 'true');
    await waitRequests(g, COLLECT, 1);
    await g.until('거절 응답 처리', 's.map.story.busy === false');
    const sent = requests(g, COLLECT);
    assert.deepEqual(sent.map((n) => [n.status, n.code]), [[409, 'OBJECTIVE_NOT_ACTIVE']]);
    assert.ok((await texts(g)).includes('지금은 진행할 수 없는 이야기입니다.'), '거절 이유 표시');
    s = await story(g);
    assert.deepEqual([s.objects.length, s.locked], [10, 10], '서버 상태로 다시 맞춘 뒤에도 그대로');
    assert.deepEqual([dbState(device).collected, dbState(device).dust], [0, 0]);
  }, backend, device);
  await g.close();
});

test('숲 ②: 구조 뒤 실가루 10개를 각 한 번씩 수집 — 중복 클릭·동시 요청에도 10개, 5개에서 재접속해도 유지 → 보풀이 전달·나침판 → 숨은 길 → 거대 매듭 전투 진입 → 끝난 지점은 다시 발동하지 않는다', async () => {
  const device = 'e2e-forest-collect';
  await backend.start(seedForest(device, 'rescued'));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  // 목표 패널은 숲 입장 응답 뒤에 그려진다 — 패널이 뜬 것을 확인한 다음 문구를 본다
  const goal = (n: number) => g.until(`목표 ${n}/10`, `s.map && s.map.goal === true && window.__dev.texts().includes('빛나는 실가루 모으기 ${n}/10')`);
  await withDiagnosis(g, 'forest-collect', async () => {
    await enterForest(g);
    let s = await story(g);
    assert.deepEqual([s.objects.length, s.locked, s.points, s.gates], [10, 0, ['forest_bopuli_return'], { gate_hidden_path: false }]); // 실뿌리 문은 숨은 길이 열린 뒤에만 지도에 나온다
    await goal(0);
    await g.capture('04a_goal_0_of_10');

    let n = 0;
    for (const [num, via] of ROUTE) {
      const id = dustId(num);
      await walkToTarget(g, id, 'keys', via);
      if (n === 0) {
        assert.equal((await story(g)).promptText, '빛나는 실가루 줍기');
        await g.capture('03_dust_collectable_prompt');
      }
      const before = requests(g, COLLECT).length;
      if (n === 2) {
        // 같은 실가루에 동시 요청 10건(다른 기기·재전송을 흉내 — 같은 계정의 직접 요청) + 화면 클릭 한 번 → 효과는 한 번
        const { token } = dbState(device);
        const direct = Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${backend.port}/player/me/story/objectives/forest_glowing_dust/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': token }, body: JSON.stringify({ objectId: id, quantity: 99 }) }).then((r) => r.json() as Promise<{ alreadyCollected: boolean }>));
        const [, results] = await Promise.all([press(g, `!s.map.story.objects.includes('${id}')`), Promise.all(direct)]);
        assert.ok(results.filter((r) => r.alreadyCollected === false).length <= 1, '직접 요청 중 새 수집은 많아야 하나');
      } else if (n === 4) {
        // 빠른 이중 클릭: 화면이 잠겨 요청은 한 번만 나간다
        const at = (await story(g)).interact;
        const p = await g.canvasToPage(at.x, at.y);
        await g.page.mouse.click(p.x, p.y);
        await g.page.mouse.click(p.x, p.y);
        await g.until('수집 반영', `!s.map.story.objects.includes('${id}') && s.map.story.busy === false`);
      } else {
        await press(g, `!s.map.story.objects.includes('${id}')`);
      }
      n++;
      await g.until(`목표 ${n}/10`, `s.map.story.objective && s.map.story.objective.collected === ${n} && s.map.story.busy === false`);
      assert.equal(requests(g, COLLECT).length - before, 1, `${id}: 화면에서 나간 요청은 한 번`);
      assert.deepEqual([dbState(device).collected, dbState(device).dust], [n, n], `${id}: 기록·인벤토리 ${n}`);
      s = await story(g);
      assert.equal(s.objects.length, 10 - n, '주운 것은 지도에서 사라진다');

      if (n === 5) {
        await goal(5);
        await g.capture('04b_goal_5_of_10_collected_gone');
        // 재접속(새로고침): 같은 탐험 세션의 Map으로 복원(10-02 v5) — 5개 주운 상태·서 있던 자리 그대로, 주운 것은 다시 생기지 않는다
        const left = s.objects;
        const stood = backend.serverPosition(device)!;
        const room = backend.session(device)!.code;
        await g.reload();
        await g.until('Map 복원', 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story && s.map.story.greybox === true');
        s = await story(g);
        assert.deepEqual([s.objects, s.objective?.collected], [left, 5]);
        assert.deepEqual([(await g.state()).map.avatar, backend.session(device)!.code], [stood, room], '같은 자리·같은 탐험 세션');
        await goal(5);
      }
    }
    await goal(10);
    assert.deepEqual([(await story(g)).objects, dbState(device).dust], [[], 10]);
    await g.capture('04c_goal_10_of_10');

    // 보풀이에게 전달 → 나침판 제작 장면 → 지도에는 숨은 길 지점, 문은 아직 닫혀 있다
    await walkToTarget(g, 'forest_bopuli_return', 'keys', [{ x: 1600, y: 780 }]);
    await press(g, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('나침판 뒤 지도', "s.map && s.map.story && s.map.story.points.join() === 'forest_hidden_path'");
    assert.deepEqual([dbState(device).checkpoint, dbState(device).dust, (await story(g)).gates.gate_hidden_path], ['CH01_COMPASS_ACQUIRED', 0, false]);
    assert.equal((await g.state()).map.goal, false, '전달이 끝나면 수집 목표가 사라진다');

    // 숨은 길: 나침판을 꺼내면 길이 열린다
    await walkToTarget(g, 'forest_hidden_path', 'keys', [{ x: 1900, y: 1110 }]);
    await press(g, "s.scenes.includes('StoryDialogue')");
    await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('문이 열림', "s.map && s.map.story && s.map.story.gates.gate_hidden_path === true && s.map.story.points.join() === 'forest_giant_knot'");
    await g.capture('06_hidden_path_opened_after_compass');
    // 끝난 지점: 그 자리에 서 있어도 안내 버튼이 없고, 직접 요청해도 다시 재생되지 않는다
    assert.equal((await story(g)).prompt, null, '끝난 숨은 길 지점은 누를 대상이 아니다');
    const { token } = dbState(device);
    const again = (await (await fetch(`http://127.0.0.1:${backend.port}/player/me/story/triggers/forest_hidden_path`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': token }, body: '{}' })).json()) as { play: unknown };
    assert.equal(again.play, null);
    assert.equal(dbState(device).events.filter((e) => e === 'forest_hidden_path_opened').length, 1);

    // 열린 문을 지나 거대 매듭 지점 → 전투 진입(스토리 파티 선택)
    await walkToTarget(g, 'forest_giant_knot');
    await g.capture('07_giant_knot_entry_point');
    // 이 지점의 재생 범위는 전투 항목부터 시작한다 — 대화 화면을 거쳐 곧바로 스토리 파티 선택으로 넘어간다
    await press(g, "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    await g.until('전투 화면으로', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
    await g.until('거대 매듭 스토리 전투', "(s.party && s.party.story) || s.scenes.includes('Battle')");
    assert.ok(!dbState(device).events.includes('forest_giant_knot_defeated'), '전투 진입만으로는 승리가 기록되지 않는다');
  }, backend, device);
  await g.close();
});

test('숲 ③: 640×360 — 조이스틱으로 걸어가 수집, 안내 버튼은 조이스틱 영역·다른 HUD와 겹치지 않고, 닫힌 문은 지나갈 수 없다', async () => {
  const device = 'e2e-forest-small';
  await backend.start(seedForest(device, 'rescued', [dustId(1), dustId(3)]));
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'forest-small', async () => {
    await enterForest(g);
    let s = await story(g);
    assert.deepEqual([s.objects.length, s.objective?.collected], [8, 2], '이미 주운 두 개는 처음부터 보이지 않는다');
    await walkToTarget(g, dustId(2), 'joystick');
    s = await story(g);
    const m = (await g.state()).map as { hudMode: string; joystickZone: { x: number; y: number; w: number; h: number }; buttons: Record<string, { x: number; y: number }> };
    const r = s.interactRect;
    assert.equal(m.hudMode, 'compact');
    assert.ok(r.y + r.h <= m.joystickZone.y, '안내 버튼은 조이스틱 영역 위');
    assert.ok(r.h * 0.5 >= 40 && r.w * 0.5 >= 200, `실제 화면 크기 ${r.w * 0.5}×${r.h * 0.5}`);
    await g.capture('08_collect_ui_small');
    await press(g, `!s.map.story.objects.includes('${dustId(2)}')`);
    await g.until('3/10', 's.map.story.objective.collected === 3 && s.map.story.busy === false');
    assert.equal(requests(g, COLLECT).length, 1, '한 번의 터치 → 요청 한 번');
    await g.until('목표 갱신', "window.__dev.texts().includes('빛나는 실가루 모으기 3/10')");
    assert.ok((await texts(g)).includes('빛나는 실가루 모으기 3/10'));
    await g.capture('08b_collect_ui_small_after');

    // 닫힌 숨은 길 문: 문 쪽으로 계속 밀어도 문 너머로 가지 못한다(나침판 전)
    await g.walkTo('Map', { x: 1900, y: 1110 }, 'joystick');
    await g.walkTo('Map', { x: 2240, y: 1250 }, 'joystick');
    await g.page.keyboard.down('ArrowRight');
    try {
      await g.until('문에 닿음', 's.map.avatar.x >= 2270');
      // 계속 밀어도 문 너머(x > 2300)로 넘어가지 않는다
      const crossed = await g.page.waitForFunction(() => (window as any).__game.scene.getScene('Map').avatar.x > 2300, null, { timeout: 1500, polling: 50 }).then(() => true, () => false); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(crossed, false, '닫힌 문을 지나갔다');
    } finally {
      await g.page.keyboard.up('ArrowRight');
    }
    const av = (await g.state()).map.avatar as { x: number; y: number };
    assert.ok(av.x < 2300, `닫힌 문(x=2300) 앞에서 멈춤: ${JSON.stringify(av)}`);
    assert.equal((await story(g)).gates.gate_hidden_path, false);
  }, backend, device);
  await g.close();
});
