// 10-06 v8 §7: 1장 전체 흐름(신규 계정, 최종 지도) — 오프닝 → 이름 → 누비 합류 → 마을 출구 → 잘린 실 → 보풀이 구조 → 실가루 10개 → 나침판 → 숨은 길 →
// 거대 매듭 → 첫 매듭 장착 → 단수링 → 2장 개방. 한 번은 중단 없이, 한 번은 10곳에서 새로고침·재접속하며 이어서 끝까지.
// 보상·전투 결과·유물·이벤트·2장 개방은 한 번만 일어나야 한다. 마지막에 요약 캡처(v5 목록)를 만든다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite } from './harness';

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
// 첫 길에서 가까운 것부터 순환 길을 한 바퀴
const DUST_ORDER = [3, 1, 2, 10, 9, 8, 7, 6, 5, 4];
const story = async (g: Game) => (await g.state()).map.story as { objects: string[]; points: string[]; gates: Record<string, boolean>; objective: { collected: number } | null; prompt: string | null; promptText: string | null; interact: { x: number; y: number } };

function dbOf(device: string) {
  const p = backend.playerByDevice(device)!;
  const itemQty = (code: string) => {
    const def = backend.db.rows('item_definition', { code })[0] as { id: number };
    return ((backend.db.rows('player_item', { player_id: p.id, item_definition_id: def.id })[0] as { quantity: number } | undefined)?.quantity ?? 0) as number;
  };
  return {
    checkpoint: (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string } | undefined)?.checkpoint,
    events: backend.db.rows('player_story_event', { player_id: p.id }).map((r) => r.event_id as string),
    collected: backend.db.rows('player_story_objective_progress', { player_id: p.id }).length,
    dust: itemQty('glowing_yarn_dust'),
    compass: itemQty('yarn_tremor_compass'),
    knot: itemQty('first_knot'),
    equipped: backend.db.rows('turby_equipment', { slot_key: 'story_1' }).length,
    turbies: backend.db.rows('turby_instance', { owner_player_id: p.id }).length,
    battles: backend.db.rows('battle_result', { player_id: p.id }).length,
  };
}
const once = (events: string[], id: string) => events.filter((e) => e === id).length;

async function goForest(g: Game) {
  await g.waitScene('Village');
  await g.until('마을 준비', 's.village && s.village.ready');
  const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
  await g.clickLabel(exit.prompt);
  await g.waitScene('StageSelect');
  await g.clickLabel('1장 — 숲', { exact: true });
}
const MAP_READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
async function toMap(g: Game) {
  await g.until('지도 또는 이야기 장면', "s.scenes.includes('Map') || s.scenes.includes('StoryDialogue')");
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('지도 준비', MAP_READY);
}
async function press(g: Game, expect: string) {
  const at = (await story(g)).interact;
  await g.clickAt(at.x, at.y, expect);
}
// 지점·오브젝트까지 걸어가 안내 버튼이 그 대상을 가리킬 때까지(경유지는 길 중심선을 따라 harness가 만든다)
async function walkToTarget(g: Game, id: string) {
  await g.walkTo('Map', pointOf(id), 'keys', `s.map && s.map.story && s.map.story.prompt === '${id}'`);
  await g.until(`${id} 안내 버튼`, `s.map && s.map.story && s.map.story.prompt === '${id}' && !!s.map.story.promptText`);
}
async function interact(g: Game, id: string, expect: string) {
  await walkToTarget(g, id);
  await press(g, expect);
}
// 결과 화면·대화·지도 어디에 있든 결과를 확인하고 대화를 넘겨 지도에 닿는다
async function settleToMap(g: Game) {
  for (let i = 0; i < 8; i++) {
    const sc = (await g.state()).scenes;
    if (sc.includes('StoryDialogue')) await g.advanceDialogue("!s.scenes.includes('StoryDialogue')");
    else if (sc.includes('Battle')) await g.clickResult("s.scenes.includes('StoryDialogue') || s.scenes.includes('Map')");
    else if (sc.includes('Map') && (await g.state()).map?.ready) {
      await g.page.waitForTimeout(600); // 지도가 열린 뒤에 이어 볼 장면이 뜨는 경우를 한 번 더 확인한다
      if (!(await g.state()).scenes.includes('StoryDialogue')) break;
    } else await g.page.waitForTimeout(300);
  }
  await g.until('지도 준비', MAP_READY);
}
const toMapAfterDialogue = (g: Game) => g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");

async function runChapter(device: string, reloads: boolean) {
  const log: string[] = [];
  let g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  // 재접속 도우미: 새로고침 또는 페이지를 닫았다 다시 열기(같은 기기)
  const reconnect = async (label: string, hard = false) => {
    if (!reloads) return;
    log.push(label);
    if (hard) {
      await g.close();
      g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
    } else await g.reload();
  };
  const resumeMap = async () => {
    // 새로고침 뒤: 마을·지도·전투 어디로 복원되든 지도(탐험 세션)로 돌아온다
    await g.until('복원', "s.scenes.includes('Map') || s.scenes.includes('Village') || s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')", 30_000);
  };
  const body = (
    async () => {
      // 1) 오프닝 → 이름 → 누비 합류
      await g.waitScene('Opening');
      await g.advanceDialogue('s.dialogue && s.dialogue.nameInput');
      await g.page.locator('input[aria-label="이름"]').click();
      await g.page.keyboard.type('하늘');
      await g.clickLabel('정했어요');
      await g.advanceDialogue("s.scenes.includes('Village')");
      assert.equal(dbOf(device).checkpoint, 'OPENING_COMPLETE');
      assert.equal(dbOf(device).turbies, 1, '이야기 누비 1마리');

      // 2) 마을 출구 → 숲 입구 장면 → 잘린 실오라기
      await goForest(g);
      await g.waitScene('StoryDialogue'); // 숲 입구의 걷는 장면(자동)
      await toMapAfterDialogue(g);
      await g.until('지도 준비', MAP_READY);
      await g.capture(`${reloads ? 'r' : 's'}01_forest_entry`);
      await interact(g, 'forest_cut_thread', "s.scenes.includes('StoryDialogue')");
      await toMapAfterDialogue(g);
      assert.equal(once(dbOf(device).events, 'forest_cut_thread_inspected'), 1);

      // 3) 보풀이 구조 전투
      await interact(g, 'forest_bopuli_ambush', "s.scenes.includes('StoryDialogue')");
      await g.advanceDialogue("s.scenes.includes('PartySelect')");
      await g.until('스토리 파티 선택', 's.party && s.party.story');
      await g.clickLabel('선택 완료');
      await g.waitScene('Battle');
      assert.equal((await g.playBattle()).outcome, 'win');
      await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton');
      await g.clickResult("s.scenes.includes('StoryDialogue')");
      await g.advanceDialogue("!s.scenes.includes('StoryDialogue')");
      assert.equal(dbOf(device).checkpoint, 'CH01_BOPUL_RESCUED');
      // ── 복원 지점 1: 보풀이 구조 직후
      await reconnect('1 보풀이 구조 직후');
      if (reloads) {
        await resumeMap();
        await toMap(g);
        assert.equal(dbOf(device).checkpoint, 'CH01_BOPUL_RESCUED');
      }
      await g.until('지도 준비', MAP_READY);
      assert.deepEqual([(await story(g)).objects.length, (await story(g)).objective?.collected], [10, 0], '실가루 10개가 열려 있다');
      await g.capture(`${reloads ? 'r' : 's'}02_after_rescue`);

      // 4) 실가루 10개
      let n = 0;
      for (const num of DUST_ORDER) {
        const id = dustId(num);
        await walkToTarget(g, id);
        await press(g, `!s.map.story.objects.includes('${id}')`);
        n++;
        await g.until(`목표 ${n}/10`, `s.map.story.objective && s.map.story.objective.collected === ${n} && s.map.story.busy === false`);
        assert.deepEqual([dbOf(device).collected, dbOf(device).dust], [n, n]);
        if (n === 5) {
          // ── 복원 지점 2: 실가루 일부 수집 후
          await reconnect('2 실가루 5/10');
          if (reloads) {
            await resumeMap();
            await toMap(g);
            assert.deepEqual([(await story(g)).objective?.collected, (await story(g)).objects.length], [5, 5], '주운 것은 다시 생기지 않는다');
          }
        }
      }
      assert.equal(dbOf(device).dust, 10);

      // 5) 보풀이에게 전달 → 나침판 제작
      await interact(g, 'forest_bopuli_return', "s.scenes.includes('StoryDialogue')");
      // ── 복원 지점 3: 실가루 전달 직후(나침판 제작 장면이 열린 상태)
      await reconnect('3 실가루 전달 직후(장면 중)');
      if (reloads) {
        await resumeMap();
        if ((await g.state()).scenes.includes('StoryDialogue')) await toMapAfterDialogue(g);
        await g.until('지도 준비', MAP_READY);
      } else await toMapAfterDialogue(g);
      assert.deepEqual([dbOf(device).checkpoint, dbOf(device).dust, dbOf(device).compass], ['CH01_COMPASS_ACQUIRED', 0, 1], '실가루는 한 번만 쓰이고 나침판은 한 개');
      // ── 복원 지점 4: 나침판 획득 직후
      await reconnect('4 나침판 획득 직후', true);
      if (reloads) {
        await resumeMap();
        await toMap(g);
      }
      assert.deepEqual([dbOf(device).dust, dbOf(device).compass, once(dbOf(device).events, 'forest_compass_granted')], [0, 1, 1]);
      await g.capture(`${reloads ? 'r' : 's'}03_wind_closed`);

      // 6) 숨은 길
      await interact(g, 'forest_hidden_path', "s.scenes.includes('StoryDialogue')");
      await toMapAfterDialogue(g);
      await g.until('문이 열림', "s.map.story.gates.gate_hidden_path === true && s.map.story.points.join() === 'forest_giant_knot'");
      // ── 복원 지점 5: 숨은 길 개방 직후
      await reconnect('5 숨은 길 개방 직후', true);
      if (reloads) {
        await resumeMap();
        await toMap(g);
        assert.equal((await story(g)).gates.gate_hidden_path, true, '개방 상태 유지');
      }
      assert.equal(once(dbOf(device).events, 'forest_hidden_path_opened'), 1);
      await g.capture(`${reloads ? 'r' : 's'}04_hidden_path_open`);

      // 7) 거대 매듭 전투
      await interact(g, 'forest_giant_knot', "s.scenes.includes('StoryDialogue') || s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
      if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
      await g.until('스토리 파티 선택', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')");
      // ── 복원 지점 6: 거대 매듭 전투 중
      await reconnect('6 거대 매듭 전투 중');
      if (reloads) await g.until('같은 전투 복원', "s.scenes.includes('PartySelect') || s.scenes.includes('Battle')", 30_000);
      if ((await g.state()).scenes.includes('PartySelect')) await g.clickLabel('선택 완료');
      await g.waitScene('Battle');
      const boss = await g.playBattle(240_000);
      assert.equal(boss.outcome, 'win', '거대 매듭 승리');
      await g.until('결과 확정', 's.battle && s.battle.settled === true && s.battle.resultButton');
      // ── 복원 지점 7: 거대 매듭 승리 직후(결과 화면)
      await reconnect('7 거대 매듭 승리 직후');
      if (reloads) {
        await g.until('결과 복원', "(s.battle && s.battle.resultShown === true) || s.scenes.includes('Map') || s.scenes.includes('Village') || s.scenes.includes('StoryDialogue')", 30_000);
        if ((await g.state()).scenes.includes('Village')) {
          await g.until('결과 보기 안내', "s.village && !!window.__dev.find('결과 보기', true)", 15_000).catch(() => undefined);
          const btn = (await g.page.evaluate(() => (window as any).__dev.find('결과 보기', true))) as { x: number; y: number } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (btn) await g.click(btn.x, btn.y);
          await g.until('결과 화면', 's.battle && s.battle.resultShown === true', 15_000);
        }
      }
      await settleToMap(g);
      assert.equal(once(dbOf(device).events, 'forest_giant_knot_defeated'), 1, '승리 이벤트 한 번');

      // 8) 끊어진 오래된 실(첫 매듭 각성)
      await g.capture(`${reloads ? 'r' : 's'}05_ancient_strand_after_defeat`);
      // 승리 결과 → 각성 장면(자동) 뒤에 첫 매듭을 받는다 — 지도의 '끊어진 오래된 실' 지점은 장면을 놓쳤을 때만 남는다
      assert.equal(dbOf(device).knot, 1, '첫 매듭은 한 개');
      // ── 복원 지점 8: 첫 매듭 획득 직후
      await reconnect('8 첫 매듭 획득 직후');
      if (reloads) {
        await resumeMap();
        await toMap(g);
      }
      assert.deepEqual([dbOf(device).knot, once(dbOf(device).events, 'forest_first_knot_awakened'), dbOf(device).equipped], [1, 1, 0]);

      // 9) 첫 매듭 장착(인벤토리 → 스토리 → 첫 매듭 → 누비에게 장착) → 장착 대화
      await g.clickLabel('인벤토리', { exact: true });
      await g.until('인벤토리 준비', "s.inventory && s.inventory.state === 'ready'");
      await g.clickLabel('스토리', { exact: true, expect: "s.inventory.tab === 'story'" });
      await g.clickLabel('첫', { exact: true, expect: "s.inventory.selected === 'first_knot'" });
      await g.clickLabel('누비에게 장착', { exact: true });
      await g.waitScene('StoryDialogue');
      await g.advanceDialogue("!s.scenes.includes('StoryDialogue')");
      assert.equal(dbOf(device).checkpoint, 'CH01_FIRST_KNOT_EQUIPPED');
      // ── 복원 지점 9: 첫 매듭 장착 직후
      await reconnect('9 첫 매듭 장착 직후', true);
      if (reloads) {
        await resumeMap();
        await toMap(g);
      }
      assert.deepEqual([dbOf(device).equipped, once(dbOf(device).events, 'forest_first_knot_equipped')], [1, 1], '장착은 한 번');
      await g.until('실뿌리 문 열림', "s.map.story.gates.gate_root === true && s.map.story.points.join() === 'forest_dansuring'");
      await g.capture(`${reloads ? 'r' : 's'}06_root_gate_open_dansuring`);

      // 10) 단수링 → 장 완료 → 2장 개방
      await interact(g, 'forest_dansuring', "s.scenes.includes('StoryDialogue')");
      await g.advanceDialogue("s.scenes.includes('Map') || s.scenes.includes('Village')");
      assert.equal(dbOf(device).checkpoint, 'CH01_COMPLETE');
      // ── 복원 지점 10: 단수링 대화와 장 완료 직후
      await reconnect('10 단수링·장 완료 직후');
      if (reloads) {
        await resumeMap();
        await g.until('복원 뒤 화면', "s.scenes.includes('Map') || s.scenes.includes('Village')", 30_000);
      }
      const done = dbOf(device);
      assert.equal(done.checkpoint, 'CH01_COMPLETE');
      assert.equal(once(done.events, 'forest_primordial_knot_seen'), 1, '장 완료 이벤트 한 번');
      assert.equal(once(done.events, 'lake_unlocked'), 1, '2장 개방 한 번');
      assert.deepEqual([done.knot, done.equipped, done.compass, done.dust], [1, 1, 1, 0], '유물·장착·나침판·실가루가 한 번만');
      assert.equal(new Set(done.events).size, done.events.length, '이벤트 중복 없음');
    }
  );
  try {
    await body();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const report = await g.diagnose(`chapter1-full-${reloads ? 'reloads' : 'straight'}`, e, dbOf(device).checkpoint ?? null).catch(() => null);
    e.message += `
[진단] 장면=${JSON.stringify(report?.state?.scenes)} 체크포인트=${dbOf(device).checkpoint} 복원지점=${log.join(' / ')}`;
    throw e;
  }
  await g.close();
  return log;
}

test('1장 전체 ①: 신규 계정이 오프닝부터 단수링·2장 개방까지 중단 없이(최종 지도, 1280×720)', async () => {
  const device = 'e2e-ch1-straight';
  await backend.start();
  await runChapter(device, false);
});

test('1장 전체 ②: 같은 흐름에서 10곳(구조 직후·실가루 일부·전달 직후·나침판 직후·숨은 길 직후·보스전 중·승리 직후·첫 매듭 직후·장착 직후·장 완료 직후)마다 새로고침·재접속하고 이어서 끝낸다', async () => {
  const device = 'e2e-ch1-reloads';
  await backend.start();
  const log = await runChapter(device, true);
  assert.equal(log.length, 10, `복원 지점 10곳: ${log.join(' / ')}`);
});
