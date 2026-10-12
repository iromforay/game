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
  fullMap?: boolean; // 전체 지도(범례 포함)를 연 상태로 찍는다
}

// 두 사각형의 겹침 사각형(겹치지 않으면 0 크기)
function area2(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return { left, top, right: Math.max(left, Math.min(a.right, b.right)), bottom: Math.max(top, Math.min(a.bottom, b.bottom)) };
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
    if (shot.fullMap) {
      const b = ((await g.state()).map as { miniMap: { openButton: { x: number; y: number } } }).miniMap.openButton;
      await g.clickAt(b.x, b.y, 's.map.miniMap.open === true');
    }
    await g.capture(shot.name);
    // 10-08 v2 §2: 캡처 해상도의 실제 화면 좌표로 목표 경계와 HUD(미니맵·인벤토리·터비 버튼) 경계를 재서 겹친 픽셀을 기록한다
    const box = (await g.page.locator('canvas').boundingBox())!;
    const k = box.width / 1280; // 논리 1280 → 실제 화면 px
    const raw = (await g.page.evaluate(() => {
      const m = (window as any).__game.scene.getScene('Map'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const cam = m.cameras.main;
      const v = m.stageView;
      const toL = (x: number, y: number) => ({ x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom });
      const rect = (id: string, x: number, y: number, w: number, h: number, pv: number[]) => { const a = toL(x - w * pv[0], y - h * pv[1]); return { id, l: a.x, t: a.y, r: a.x + w * cam.zoom, b: a.y + h * cam.zoom }; };
      const items = [
        ...v.render.overlays.map((o: any) => rect(o.id, o.x, o.y, o.width, o.height, o.pivot ?? [0.5, 0.5])),
        ...v.gates.filter((g2: any) => g2.art).map((g2: any) => rect(g2.id, g2.art.x, g2.art.y, g2.art.width, g2.art.height, g2.art.pivot ?? [0.5, 0.5])),
      ];
      const h = m.hud;
      const hud = [['miniMap', h.miniMap], ['inventory', h.inventory], ['turbys', h.turbys], ['interact', h.interact]].map(([id, r]: any) => ({ id, l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h }));
      const av = m.avatar;
      const player = rect('player', av.x, av.y, 32, 32, [0.5, 0.5]);
      return { items: [...items, player], hud };
    })) as { items: { id: string; l: number; t: number; r: number; b: number }[]; hud: { id: string; l: number; t: number; r: number; b: number }[] };
    const px = (o: { l: number; t: number; r: number; b: number }) => ({ left: Math.round(box.x + o.l * k), top: Math.round(box.y + o.t * k), right: Math.round(box.x + o.r * k), bottom: Math.round(box.y + o.b * k) });
    const hudBounds = raw.hud.map((h) => ({ id: h.id, ...px(h) }));
    const area = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const screenRect = { left: 0, top: 0, right: size.width, bottom: size.height };
    HUD_LOG.push({
      shot: shot.name, viewportWidth: size.width, viewportHeight: size.height, hudBounds,
      targets: raw.items.map((t) => {
        const targetBounds = px(t);
        const vis = area(targetBounds, screenRect);
        const hits = hudBounds.map((h) => ({ hud: h.id, visibleIntersectionPx: area(area2(targetBounds, screenRect), h), gapToHudLeftPx: h.left - targetBounds.right })).filter((x) => x.visibleIntersectionPx > 0);
        const btn = hudBounds.find((h) => h.id === 'interact')!;
        const gapBelowObjectiveButtonPx = targetBounds.left < btn.right && btn.left < targetBounds.right ? targetBounds.top - btn.bottom : null; // 목표(상호작용) 버튼 아래쪽 간격(실제 화면 px, 가로로 겹칠 때만)
        return { id: t.id, targetBounds, offscreen: vis === 0, visibleIntersectionPx: hits.reduce((n, x) => n + x.visibleIntersectionPx, 0), hits, gapBelowObjectiveButtonPx };
      }),
    });
  } finally {
    await g.close();
  }
}

const DUST = { x: 1487, y: 1300 }; // 실가루·이야기 지점·야생 마커가 함께 있는 공터 근처(10-12 v2의 실가루 구역과 같은 상태)
const SHOTS_1280: Shot[] = [
  { name: 'v3_01_minimap_dust_story_1280', seed: 'rescued', at: DUST },
  { name: 'v3_03_full_map_legend_1280', seed: 'rescued', at: DUST, fullMap: true },
];
const SHOTS_640: Shot[] = [
  { name: 'v3_02_minimap_dust_story_640', seed: 'rescued', at: DUST },
];

test('최종 캡처 1280×720', async () => {
  for (const s of SHOTS_1280) await shoot(s, { width: 1280, height: 720 });
  assert.ok(true);
});
test('최종 캡처 640×360', async () => {
  for (const s of SHOTS_640) await shoot(s, { width: 640, height: 360 });
  assert.ok(true);
});
