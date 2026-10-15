// 10-15 C2-7D: 호수 최종 표식 모드와 구조 장면·안전 물길 문의 화면 분리 — 장면 주변에서만 실제로 접근하고(위치·상태 시드), 보이는 외곽(텍스처 알파 경계)으로 겹침을 잰다.
// ① 1280×720: 구조 A·B·C, 안전 물길 문(닫힘·열림) — 캐릭터 외곽 간격 8px·HUD 교차 0·일반 화면 임시 표식(반경 원·글자) 0, 캡처
// ② 640×360: 구조 C, 안전 물길 문(닫힘·열림) — 같은 기준, 캡처
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { join } from 'path';
import { Backend, Game, ROOT, freePort, launchBrowser, startVite, withDiagnosis } from './harness';
import { seedLake } from './fixtures';
import type { Pt } from '../helpers/lake-route';

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
const RESCUED_ALL = ['lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued'];
const GATE_SAFE = { x: 2270, y: 452, width: 40, height: 100 };
// 구조 지점마다: 접근 시작 위치(시드) → 길을 따라 안내가 뜰 때까지 걷는 경유지
const APPROACH: Record<'a' | 'b' | 'c', { start: Pt; walk: Pt[] }> = {
  a: { start: { x: 1788, y: 972 }, walk: [{ x: 1828, y: 1012 }, { x: 1868, y: 1036 }, { x: 1908, y: 1076 }, { x: 1932, y: 1084 }] },
  b: { start: { x: 1556, y: 1012 }, walk: [{ x: 1596, y: 972 }, { x: 1620, y: 924 }, { x: 1636, y: 884 }] },
  c: { start: { x: 1564, y: 1300 }, walk: [{ x: 1556, y: 1348 }, { x: 1556, y: 1396 }, { x: 1580, y: 1436 }, { x: 1604, y: 1468 }] },
};

type MapState = { avatar: Pt; story: { prompt: string | null; promptText: string | null; gates: Record<string, boolean> } };
const map = async (g: Game) => (await g.state()).map as MapState;
const via = async (g: Game, pts: Pt[], stop = 'false') => {
  for (const p of pts) {
    if (await g.page.evaluate(`(() => { const s = window.__dev.state(); return !!(${stop}); })()`)) return;
    await g.walkDirect('Map', p, 'joystick', stop, 30);
  }
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
async function startAt(g: Game, device: string, p: Pt) {
  backend.displace(device, p);
  await g.reload();
  await g.until('호수 지도', MAP_READY, 30_000);
}
const promptIs = (id: string) => `s.map.story.prompt === '${id}'`;

// 화면 측정(월드 좌표에서 카메라 시점을 뺀 게임 화면 좌표, 1280×720 기준 — 640×360은 같은 화면을 축소해 보여 준다)
// 보이는 외곽 = 표시 경계 중 텍스처 알파(>40)가 있는 부분. 플레이어는 캐릭터 그림(발밑 슬롯 고리는 따로 잰다)
type Box = { x0: number; y0: number; x1: number; y1: number };
type Measure = { boxes: Record<string, Box>; gaps: Record<string, number>; minGap: number; hudOverlaps: string[]; tempMarkers: string[]; ringGaps: Record<string, number> };
async function measure(g: Game, pointId: string | null, extra: 'closedGate' | 'openGate' | null): Promise<Measure> {
  // 카메라가 플레이어를 부드럽게 따라가므로(lerp 0.1) 카메라 스크롤이 멈춘 뒤 잰다 — 연속 5회(50ms 간격) 같은 값이면 멈춘 것(상태 조건 대기, 고정 지연 아님)
  await g.page.evaluate(() => { (window as any).__camStable = { x: NaN, y: NaN, n: 0 }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.page.waitForFunction(() => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = w.__game.scene.getScene('Map').cameras.main;
    const st = w.__camStable;
    st.n = Math.abs(c.scrollX - st.x) < 0.5 && Math.abs(c.scrollY - st.y) < 0.5 ? st.n + 1 : 0;
    st.x = c.scrollX;
    st.y = c.scrollY;
    return st.n >= 5;
  }, null, { timeout: 5000, polling: 50 });
  return g.page.evaluate(({ pid, extra, gate }) => {
    const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = w.__game.scene.getScene('Map');
    const wv = s.cameras.main.worldView;
    w.__alphaCache ??= {};
    const alpha = (o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const f = o.frame;
      const key = `${o.texture.key}:${f.name}`;
      if (!w.__alphaCache[key]) {
        const c = document.createElement('canvas');
        c.width = f.cutWidth;
        c.height = f.cutHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(f.source.image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
        const d = ctx.getImageData(0, 0, f.cutWidth, f.cutHeight).data;
        let x0 = f.cutWidth, y0 = f.cutHeight, x1 = 0, y1 = 0; // prettier-ignore
        for (let y = 0; y < f.cutHeight; y++) for (let x = 0; x < f.cutWidth; x++) if (d[(y * f.cutWidth + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); } // prettier-ignore
        w.__alphaCache[key] = { x0: x0 / f.cutWidth, y0: y0 / f.cutHeight, x1: x1 / f.cutWidth, y1: y1 / f.cutHeight };
      }
      return w.__alphaCache[key];
    };
    const vis = (o: any): Box => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const b = o.getBounds();
      const a = alpha(o);
      const sx = o.scrollFactorX === 0 ? 0 : wv.x;
      const sy = o.scrollFactorY === 0 ? 0 : wv.y;
      return { x0: b.x - sx + b.width * a.x0, y0: b.y - sy + b.height * a.y0, x1: b.x - sx + b.width * a.x1, y1: b.y - sy + b.height * a.y1 };
    };
    const gapOf = (a: Box, b: Box) => Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);
    const flat = s.storyLayer.flatMap((o: any) => (o.list ? o.list : [o])); // eslint-disable-line @typescript-eslint/no-explicit-any
    const boxes: Record<string, Box> = { player: vis(s.avatar) };
    if (pid) {
      const pt = s.stageView.points.find((p: any) => p.id === pid); // eslint-disable-line @typescript-eslint/no-explicit-any
      const mul = flat.find((o: any) => o.texture?.key === 'turby-muldeuli' && o.parentContainer && o.parentContainer.x === pt.x && o.parentContainer.y === pt.y); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (mul) boxes.mulduri = vis(mul);
      flat.filter((o: any) => o.texture?.key === 'wet-stitchling-idle' && o.visible && Math.hypot(o.x - pt.x, o.y - pt.y) < 300).forEach((o: any, i: number) => (boxes[`guard${i + 1}`] = vis(o))); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const gx = gate.x + gate.width / 2;
    const gy = gate.y + gate.height / 2;
    if (extra === 'closedGate') flat.filter((o: any) => o.texture?.key === 'reed-gate-closed' && Math.hypot(o.x - gx, o.y - gy) < 160).forEach((o: any) => (boxes.gateClosed = vis(o))); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (extra === 'openGate') flat.filter((o: any) => o.texture?.key === 'reed-gate-open' && Math.hypot(o.x - gx, o.y - gy) < 160).sort((a: any, b: any) => a.y - b.y).forEach((o: any, i: number) => (boxes[i === 0 ? 'gateTop' : 'gateBottom'] = vis(o))); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 최종 모드에서 남은 작은 식별 고리(그림 없는 필수 지점) — 문·플레이어와 겹치면 안 된다
    flat.filter((o: any) => o.type === 'Arc' && o.radius === 20 && o.visible).forEach((o: any, i: number) => { const b = o.getBounds(); boxes[`marker${i + 1}`] = { x0: b.x - wv.x, y0: b.y - wv.y, x1: b.right - wv.x, y1: b.bottom - wv.y }; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const names = Object.keys(boxes);
    const gaps: Record<string, number> = {};
    let minGap = Infinity;
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        if (names[i].startsWith('gate') && names[j].startsWith('gate')) continue; // 문 조각끼리는 아래 틈으로 따로 본다
        if (names[i].startsWith('marker') && names[j].startsWith('marker')) continue;
        const v = Math.round(gapOf(boxes[names[i]], boxes[names[j]]) * 10) / 10;
        gaps[`${names[i]}-${names[j]}`] = v;
        minGap = Math.min(minGap, v);
      }
    if (boxes.gateTop && boxes.gateBottom) gaps.gateOpening = Math.round((boxes.gateBottom.y0 - boxes.gateTop.y1) * 10) / 10;
    // HUD: 화면 고정·깊이 2000 이상·보이는 것(목표 문구·안내 버튼·미니맵·우측 버튼)
    const hudOverlaps: string[] = [];
    for (const h of s.children.list.filter((o: any) => o.visible && o.depth >= 2000 && o.scrollFactorX === 0 && o.getBounds)) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (h.type === 'Text' && !h.text) continue;
      const b = h.getBounds();
      if (b.width === 0 || b.height === 0) continue;
      const hb = { x0: b.x, y0: b.y, x1: b.right, y1: b.bottom };
      for (const n of names) if (!n.startsWith('marker') && gapOf(boxes[n], hb) < 0) hudOverlaps.push(`${n}×${h.type}(${Math.round(b.x)},${Math.round(b.y)})`);
    }
    // 일반 화면의 임시 표식: 이야기 지점 반경 원(반지름 = 지점 반경)과 지점 글자는 0이어야 한다
    const radii = new Set(s.stageView.points.map((p: any) => p.radius)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const tempMarkers = flat.filter((o: any) => o.visible && ((o.type === 'Arc' && radii.has(o.radius)) || o.type === 'Text')).map((o: any) => `${o.type}:${o.radius ?? o.text}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 참고: 발밑 슬롯 고리(캐릭터 그림이 아님)와 다른 캐릭터의 간격
    const ringGaps: Record<string, number> = {};
    if (s.selfRing) {
      const b = s.selfRing.getBounds();
      const a = s.selfRing.texture ? alpha(s.selfRing) : { x0: 0, y0: 0, x1: 1, y1: 1 };
      const rb = { x0: b.x - wv.x + b.width * a.x0, y0: b.y - wv.y + b.height * a.y0, x1: b.x - wv.x + b.width * a.x1, y1: b.y - wv.y + b.height * a.y1 };
      for (const n of names) if (n !== 'player') ringGaps[n] = Math.round(gapOf(rb, boxes[n]) * 10) / 10;
    }
    const round = (b: Box) => ({ x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });
    return { boxes: Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, round(v)])), gaps, minGap, hudOverlaps, tempMarkers, ringGaps };
  }, { pid: pointId, extra, gate: GATE_SAFE });
}
function assertSeparated(me: Measure, where: string) {
  // 캐릭터(플레이어·물들이·적)끼리는 보이는 외곽 8px 이상, 문 그림·식별 고리와는 겹치지 않음(간격 0 초과)
  const chars = Object.entries(me.gaps).filter(([k]) => !k.includes('marker') && !k.includes('gate'));
  for (const [k, v] of chars) assert.ok(v >= 8, `${where}: ${k} 보이는 외곽 간격 ${v}px (8px 이상) ${JSON.stringify(me.boxes)}`);
  for (const [k, v] of Object.entries(me.gaps).filter(([k]) => k.includes('gate') && k !== 'gateOpening' && !k.includes('marker'))) assert.ok(v > 0, `${where}: ${k} 문 그림과 겹침(${v}px)`);
  for (const [k, v] of Object.entries(me.gaps).filter(([k]) => k.includes('marker') && (k.includes('player') || k.includes('gate')))) assert.ok(v > 0, `${where}: 식별 고리가 ${k}와 겹침(${v})`);
  assert.deepEqual(me.hudOverlaps, [], `${where}: HUD 교차`);
  assert.deepEqual(me.tempMarkers, [], `${where}: 일반 화면 임시 표식(반경 원·글자)`);
}
const results: Record<string, Measure> = {};

async function rescueScene(g: Game, device: string, k: 'a' | 'b' | 'c', label: string) {
  await startAt(g, device, APPROACH[k].start);
  await via(g, APPROACH[k].walk, promptIs(`lake_rescue_${k}`)); // 안내가 뜨는 자리에서 멈춘다
  await g.until(`구조 ${k} 안내`, `${promptIs(`lake_rescue_${k}`)} && !!s.map.story.promptText`, 20_000);
  const me = (results[`${label}-rescue-${k}`] = await measure(g, `lake_rescue_${k}`, null));
  console.log(`[C2-7D] ${label}-rescue-${k} ${JSON.stringify(me)}`);
  assert.ok(me.boxes.mulduri && me.boxes.guard1, `구조 ${k} 물들이·적 그림이 보인다`);
  assertSeparated(me, `${label} 구조 ${k}`);
  await g.capture(`rescue-${k}-final`);
}
async function safeRouteScenes(g: Game, device: string, label: string) {
  backend.grantEvents(device, RESCUED_ALL);
  await startAt(g, device, { x: 2124, y: 516 }); // 안전 물길 지점 서쪽 길 위(시드)
  assert.equal((await map(g)).story.gates.gate_lake_safe_route, false);
  // 닫힌 문으로 3초 밀기 — 문 앞에서 멈춘다
  await g.page.evaluate(() => { (window as any).__stopAt = Date.now() + 3000; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  await g.walkDirect('Map', { x: GATE_SAFE.x + GATE_SAFE.width + 60, y: GATE_SAFE.y + GATE_SAFE.height / 2 }, 'joystick', 'Date.now() > window.__stopAt', 20);
  const at = (await map(g)).avatar;
  assert.ok(at.x <= GATE_SAFE.x - 8, `닫힌 문 앞에서 멈춘다(x ${at.x})`);
  const closed = (results[`${label}-safe-closed`] = await measure(g, null, 'closedGate'));
  console.log(`[C2-7D] ${label}-safe-closed ${JSON.stringify(closed)}`);
  assert.ok(closed.boxes.gateClosed, '닫힌 문 그림');
  assertSeparated(closed, `${label} 안전 물길 닫힘`);
  await g.capture('safe-route-closed-final');
  // 안전 물길 개방(시드) → 재접속(같은 자리) → 열린 문 조각과 가운데 틈
  backend.grantEvents(device, ['lake_safe_route_opened'], 'CH02_MAZE_CLEARED');
  await g.reload();
  await g.until('호수 지도', MAP_READY, 30_000);
  assert.equal((await map(g)).story.gates.gate_lake_safe_route, true);
  const open = (results[`${label}-safe-open`] = await measure(g, null, 'openGate'));
  console.log(`[C2-7D] ${label}-safe-open ${JSON.stringify(open)}`);
  assert.ok(open.boxes.gateTop && open.boxes.gateBottom, '열린 문 조각 2개');
  assert.ok(open.gaps.gateOpening >= 24, `열린 문 가운데 틈 ${open.gaps.gateOpening}px`);
  assertSeparated(open, `${label} 안전 물길 열림`);
  await g.capture('safe-route-open-final');
}

test('2장 C2-7D ①(1280×720): 구조 A·B·C와 안전 물길 문(닫힘·열림) — 캐릭터 보이는 외곽 8px·HUD 교차 0·임시 표식 0', async () => {
  const device = 'e2e-visual-1280';
  await backend.start(seedLake(device, 'maze'), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device);
  await withDiagnosis(g, 'lake-visual-1280', async () => {
    await enterLake(g);
    for (const k of ['a', 'b', 'c'] as const) await rescueScene(g, device, k, '1280');
    await safeRouteScenes(g, device, '1280');
  }, backend, device);
  await g.close();
});

test('2장 C2-7D ②(640×360): 구조 C와 안전 물길 문(닫힘·열림) — 같은 기준', async () => {
  const device = 'e2e-visual-640';
  await backend.start(seedLake(device, 'maze', ['a', 'b']), { 'story.stageAccessV2': true });
  const g = await Game.open(browser, `${vite.url}/?device=${device}`, device, SMALL);
  await withDiagnosis(g, 'lake-visual-640', async () => {
    await enterLake(g);
    await rescueScene(g, device, 'c', '640');
    await safeRouteScenes(g, device, '640');
  }, backend, device);
  await g.close();
});
