// 10-06 v8 §8: 1장 숲 최종 캡처(v5) — 1280×720 12장 + 640×360 6장. 시험이 아니라 "상태를 만들어 그 화면을 찍는" 확인용이다.
// 각 장면은 진행 상태를 DB에 직접 준비하고(플레이로 위조하지 않음), 아바타를 길 위의 자리로 옮긴 뒤 새로고침해 그 자리에서 찍는다.
// E2E_CAPTURE_DIR이 없으면 아무것도 저장하지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import type { Browser } from 'playwright-core';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite } from './harness';
import { seedForest } from './fixtures';

import { writeFileSync, mkdirSync } from 'fs';
const HUD_LOG: unknown[] = [];
let backend: Backend;
let vite: { url: string; close: () => Promise<void> };
let browser: Browser;
before(async () => {
  backend = new Backend(await freePort());
  vite = await startVite(join(ROOT, 'save-a-turby'), { VITE_TURBY_SERVER_URL: `http://127.0.0.1:${backend.port}` });
  browser = await launchBrowser();
});
after(async () => {
  if (process.env.E2E_CAPTURE_DIR && HUD_LOG.length) { mkdirSync(process.env.E2E_CAPTURE_DIR, { recursive: true }); writeFileSync(join(process.env.E2E_CAPTURE_DIR, 'hud_safe_area.json'), JSON.stringify(HUD_LOG, null, 1)); }
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
    // 목표의 화면 좌표(논리 1280×720)와 HUD 안전영역 판정을 기록한다
    const info = (await g.page.evaluate(() => {
      const m = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const cam = m.cameras.main;
      const v = m.stageView;
      const to = (x: number, y: number) => ({ x: Math.round((x - cam.worldView.x) * cam.zoom), y: Math.round((y - cam.worldView.y) * cam.zoom) });
      return [...v.points.map((p: any) => ({ id: p.id, ...to(p.x, p.y) })), ...v.render.overlays.filter((o: any) => o.assetKey !== 'fog-veil').map((o: any) => ({ id: o.id, ...to(o.x, o.y) })), ...v.gates.filter((g: any) => g.art).map((g: any) => ({ id: g.id, ...to(g.art.x, g.art.y) }))];
    })) as { id: string; x: number; y: number }[];
    const hudRight = size.width === 640 ? 1280 - 250 : 1280 - 170;
    HUD_LOG.push({ shot: shot.name, size: `${size.width}x${size.height}`, targets: info.filter((t) => t.x >= -200 && t.x <= 1500).map((t) => ({ ...t, inHud: t.x > hudRight && t.y < 260 })) });
  } finally {
    await g.close();
  }
}

const SHOTS_1280: Shot[] = [
  { name: 'v1_01_cut_thread', seed: 'started', at: { x: 1488, y: 1850 } },
  { name: 'v1_02a_bopuli_before', seed: 'cut', at: { x: 1490, y: 1570 } },
  { name: 'v1_02b_bopuli_after', seed: 'rescued', at: { x: 1490, y: 1570 } },
  { name: 'v1_03_dust_wind', seed: 'compass', at: { x: 1820, y: 1002 } },
  { name: 'v1_04_hidden_path', seed: 'compass', events: OPENED, at: { x: 1960, y: 985 } },
  { name: 'v1_05_giant_knot', seed: 'compass', events: OPENED, at: { x: 2250, y: 1000 } },
  { name: 'v1_06a_root_gate_closed', seed: 'compass', events: OPENED, lateEvents: ['forest_giant_knot_defeated', 'forest_first_knot_awakened'], at: { x: 2740, y: 985 } },
  { name: 'v1_06b_root_gate_open', seed: 'equipped', at: { x: 2740, y: 985 } },
  { name: 'v1_07_open_gate_dansuring', seed: 'equipped', at: { x: 2790, y: 1015 } },
];
const SHOTS_640: Shot[] = [
  { name: 'v1_s08_bopuli', seed: 'cut', at: { x: 1490, y: 1570 } },
  { name: 'v1_s09_hidden_path', seed: 'compass', events: OPENED, at: { x: 1960, y: 985 } },
  { name: 'v1_s10_open_gate_dansuring', seed: 'equipped', at: { x: 2790, y: 1015 } },
];

test('최종 캡처 1280×720', async () => {
  for (const s of SHOTS_1280) await shoot(s, { width: 1280, height: 720 });
  assert.ok(true);
});
test('최종 캡처 640×360', async () => {
  for (const s of SHOTS_640) await shoot(s, { width: 640, height: 360 });
  assert.ok(true);
});
