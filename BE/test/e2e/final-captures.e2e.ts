// 10-06 v8 §8: 1장 숲 최종 캡처(v5) — 1280×720 12장 + 640×360 6장. 시험이 아니라 "상태를 만들어 그 화면을 찍는" 확인용이다.
// 각 장면은 진행 상태를 DB에 직접 준비하고(플레이로 위조하지 않음), 아바타를 길 위의 자리로 옮긴 뒤 새로고침해 그 자리에서 찍는다.
// E2E_CAPTURE_DIR이 없으면 아무것도 저장하지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite } from './harness';
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

const READY = 's.map && s.map.ready && s.map.inRoom && s.map.positioned && s.map.story';
const OPENED = ['forest_hidden_path_opened'];
const DEFEATED = [...OPENED, 'forest_giant_knot_defeated'];
const AWAKENED = [...DEFEATED, 'forest_first_knot_awakened'];
const COMPLETE = ['forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];

interface Shot {
  name: string;
  seed: 'started' | 'cut' | 'rescued' | 'compass' | 'equipped';
  events?: string[];
  lateEvents?: string[]; // 지도에 들어선 뒤 기록하는 이벤트(이어 보기 장면이 입장을 가로채지 않게)
  at?: { x: number; y: number }; // 없으면 시작 지점
  complete?: boolean; // 1장 완료 + 지역 선택 화면(2장 개방)
}

async function reachMap(g: Game) {
  await g.until('숲 지도 또는 입구 장면', `(${READY}) || s.scenes.includes('StoryDialogue')`);
  if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
  await g.until('숲 지도', READY);
}

async function shoot(shot: Shot, size: { width: number; height: number }) {
  try {
    await shootOnce(shot, size);
  } catch (err) {
    console.log('재시도', shot.name, err instanceof Error ? err.message.slice(0, 120) : err); // 브라우저·개발 서버 기동이 늦은 경우를 한 번 더 시도한다
    await shootOnce(shot, size);
  }
}

async function shootOnce(shot: Shot, size: { width: number; height: number }) {
  const device = `cap-${shot.name.slice(0, 8)}-${size.width}`; // 기기 ID 길이 제한 때문에 짧게
  await backend.start(seedForest(device, shot.seed));
  const p = backend.playerByDevice(device)!;
  for (const e of shot.events ?? []) backend.db.seed('player_story_event', { player_id: p.id, event_id: e });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, size);
  try {
    await g.until('시작 화면', "s.scenes.includes('Village') || s.scenes.includes('Opening') || s.scenes.includes('StageSelect') || s.scenes.includes('StoryDialogue')");
    if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Village') || s.scenes.includes('Map')"); // 이어 볼 장면이 남은 상태(예: 각성 장면)
    if (!(await g.state()).scenes.includes('Village')) throw new Error(`마을이 아닌 시작 화면: ${JSON.stringify((await g.state()).scenes)}`);
    await g.until('마을 준비', 's.village && s.village.ready');
    const exit = (await g.page.evaluate(() => (window as any).__game.scene.getScene('Village').layout.interactions.find((i: any) => i.type === 'exit'))) as { zone: { x: number; y: number; w: number; h: number }; prompt: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (shot.complete) {
      for (const e of COMPLETE) backend.db.seed('player_story_event', { player_id: p.id, event_id: e });
      (backend.db.rows('player_story_progress', { player_id: p.id })[0] as { checkpoint: string }).checkpoint = 'CH01_COMPLETE';
    }
    await g.walkTo('Village', { x: exit.zone.x + exit.zone.w / 2, y: exit.zone.y + exit.zone.h / 2 }, 'keys', "s.village && s.village.prompt === 'exit'");
    await g.clickLabel(exit.prompt);
    await g.waitScene('StageSelect');
    if (shot.complete) {
      await g.capture(shot.name);
      return;
    }
    await g.clickLabel('1장 — 숲', { exact: true });
    await g.until('숲 지도 또는 입구 장면', `(${READY}) || s.scenes.includes('StoryDialogue')`);
    if ((await g.state()).scenes.includes('StoryDialogue')) await g.advanceDialogue("s.scenes.includes('Map') && !s.scenes.includes('StoryDialogue')");
    await g.until('숲 지도', READY);
    if (shot.at) {
      backend.displace(device, shot.at);
      await g.reload();
      await reachMap(g);
    }
    if (shot.lateEvents) {
      for (const e of shot.lateEvents) backend.grantEvent(device, e);
      await g.page.evaluate(() => (window as any).__game.scene.getScene('Map').refreshStageView()); // eslint-disable-line @typescript-eslint/no-explicit-any
      await g.page.waitForTimeout(600);
    }
    await g.capture(shot.name);
  } finally {
    await g.close();
  }
}

const SHOTS_1280: Shot[] = [
  { name: 'v5_01_forest_entry', seed: 'started' },
  { name: 'v5_02_cut_thread', seed: 'started', at: { x: 1488, y: 1880 } },
  { name: 'v5_03a_bopuli_before_rescue', seed: 'cut', at: { x: 1490, y: 1570 } },
  { name: 'v5_03b_bopuli_after_rescue', seed: 'rescued', at: { x: 1490, y: 1570 } },
  { name: 'v5_04_dust_loop', seed: 'rescued', at: { x: 864, y: 1362 } },
  { name: 'v5_05_dust_wind_closed', seed: 'compass', at: { x: 1820, y: 1002 } },
  { name: 'v5_06_hidden_path_open', seed: 'compass', events: OPENED, at: { x: 1870, y: 1004 } },
  { name: 'v5_07_giant_knot_clearing', seed: 'compass', events: OPENED, at: { x: 2150, y: 1000 } },
  { name: 'v5_08_ancient_strand_after_defeat', seed: 'compass', events: OPENED, lateEvents: ['forest_giant_knot_defeated'], at: { x: 2250, y: 1000 } },
  { name: 'v5_09a_root_gate_closed', seed: 'compass', events: OPENED, lateEvents: ['forest_giant_knot_defeated', 'forest_first_knot_awakened'], at: { x: 2760, y: 990 } },
  { name: 'v5_09b_root_gate_open', seed: 'equipped', at: { x: 2760, y: 990 } },
  { name: 'v5_10a_dansuring', seed: 'equipped', at: { x: 2880, y: 1018 } },
  { name: 'v5_10b_chapter_complete_stage_select', seed: 'equipped', complete: true },
];
const SHOTS_640: Shot[] = [
  { name: 'v5_s01_path_readability', seed: 'rescued', at: { x: 1488, y: 1720 } },
  { name: 'v5_s02_dust_visible', seed: 'rescued', at: { x: 1480, y: 1340 } },
  { name: 'v5_s03a_bopuli_before', seed: 'cut', at: { x: 1490, y: 1570 } },
  { name: 'v5_s03b_bopuli_after', seed: 'rescued', at: { x: 1490, y: 1570 } },
  { name: 'v5_s04_giant_knot_visible', seed: 'compass', events: OPENED, at: { x: 2100, y: 985 } },
  { name: 'v5_s05_open_gate_dansuring', seed: 'equipped', at: { x: 2840, y: 1015 } },
  { name: 'v5_s06_chapter_complete_chapter2_open', seed: 'equipped', complete: true },
];

test('최종 캡처 1280×720', async () => {
  for (const s of SHOTS_1280) await shoot(s, { width: 1280, height: 720 });
  assert.ok(true);
});
test('최종 캡처 640×360', async () => {
  for (const s of SHOTS_640) await shoot(s, { width: 640, height: 360 });
  assert.ok(true);
});
