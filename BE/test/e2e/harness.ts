// 브라우저 E2E 공용 도구(v5 §2): 실제 터비 Nest 앱(FakeDb) + 실제 게임 클라이언트(Vite 개발 서버) + 실제 브라우저(설치된 Chrome, playwright-core).
// - 서버는 테스트마다 새 FakeDb로 같은 임의 포트에 다시 띄운다(테스트 간 사용자·DB 격리). 운영 DB·.env는 쓰지 않는다.
// - 입력은 실제 마우스·키보드(캔버스 좌표 → 페이지 좌표). 기다림은 화면 상태·네트워크 완료 조건으로만(고정 지연 없음).
// - 실패하면 장면·체크포인트·최근 오류 코드와 스크린샷을 .artifacts에 남긴다(토큰·세션·식별 정보는 기록하지 않음).
import { createServer } from 'net';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { FakeDb } from '../helpers/fake-prisma';
import { seedBase, startTurbyApp } from '../helpers/turby-app';

import { RoomsService } from '../../src/turby/rooms/rooms.service';
import { RoomError } from '../../src/turby/rooms/types';
import { StoryContentService, type StageStoryData } from '../../src/turby/story/story-content.service';
import { walkRoute } from '../helpers/forest-geo';
import { SettingsService } from '../../src/turby/rooms/settings.service';
import { BattleService } from '../../src/turby/battle/battle.service';
export const ROOT = join(__dirname, '../../..');
export const ARTIFACTS = process.env.E2E_ARTIFACT_DIR ?? join(__dirname, '.artifacts');
export const CAPTURE_DIR = process.env.E2E_CAPTURE_DIR ?? null; // 지정하면 캡처(v5 §7)를 여기에 저장
const nativeImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 이 프로세스가 이미 내준 포트는 다시 내주지 않는다 — 서버 포트는 before에서 고르고 테스트 본문에서 여는데,
// 그 사이 Vite가 같은 포트를 받으면 서버 기동이 실패한다(같은 파일의 테스트가 한꺼번에 실패).
// 병렬 shard(E2E_PORT_BASE)에서는 shard마다 겹치지 않는 포트 범위(base ~ base+999) 안에서만 고르고 실제로 비어 있는지 확인한다 —
// 운영체제가 준 번호를 닫은 뒤 나중에 다시 바인딩하는 사이에 다른 프로세스가 같은 번호를 받는 경합을 없앤다.
// 후보가 막혀 있으면(EADDRINUSE) 제한된 횟수만 다른 번호로 다시 고르고, 끝까지 실패하면 숨기지 않고 오류로 끝낸다.
const handedOut = new Set<number>();
const PORT_PICK_ATTEMPTS = 50;
function probe(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => {
      const { port: got } = s.address() as { port: number };
      s.close(() => resolve(got));
    });
  });
}
export async function freePort(): Promise<number> {
  const base = process.env.E2E_PORT_BASE ? Number(process.env.E2E_PORT_BASE) : null;
  let lastError: unknown;
  for (let attempt = 0; attempt < PORT_PICK_ATTEMPTS; attempt += 1) {
    try {
      const port = await probe(base === null ? 0 : base + Math.floor(Math.random() * 1000));
      if (handedOut.has(port)) continue;
      handedOut.add(port);
      return port;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      lastError = e;
    }
  }
  throw new Error(`사용 가능한 포트를 ${PORT_PICK_ATTEMPTS}번 시도했지만 찾지 못했다(${base === null ? 'OS 지정' : `범위 ${base}~${base + 999}`}): ${(lastError as Error | undefined)?.message ?? ''}`);
}

// ---------- 서버(테스트마다 새 DB) ----------
export class Backend {
  db!: FakeDb;
  private app: INestApplication | null = null;
  constructor(readonly port: number) {}
  // settings: game_setting 덮어쓰기. 재접속 유예는 E2E 기본 30초(새로고침이 유예 안에 끝나도록) — 유예 만료를 보는 시험만 짧게 준다
  async start(seed?: (db: FakeDb) => void, settings: Record<string, unknown> = {}) {
    await this.stop();
    this.db = new FakeDb();
    // 조우 반경은 서버 설정이 유일한 정본(10-06 v1 §3) — E2E 기본은 실제 걸음으로 닿을 만한 60px. 반경을 보는 시험은 settings로 덮어쓴다
    seedBase(this.db, { 'room.reconnectGraceMs': 30_000, 'battle.encounterRadiusPx': 60, ...settings });
    seed?.(this.db);
    const started = await startTurbyApp(this.db, this.port);
    this.app = started.app;
    // 클라이언트(Vite)는 이 포트로 서버에 접속하도록 이미 설정돼 있다 — 실제로 바인딩된 포트와 같아야 한다
    if (started.port !== this.port) throw new Error(`서버가 예상과 다른 포트에 바인딩됐다: ${started.port} ≠ ${this.port}`);
  }
  async stop() {
    await this.app?.close();
    this.app = null;
  }
  playerByDevice(device: string) {
    return this.db.rows('player', { device_uuid: `dev-device-${device}-account` })[0] as { id: bigint } | undefined;
  }
  // 그 계정의 탐험 세션(없으면 null): 방 코드와 야생 마커(서버가 가진 위치·종류·상태)
  session(device: string): { code: string; wilds: { index: number; characterCode: string; x: number; y: number; state: string }[] } | null {
    const p = this.playerByDevice(device);
    const room = p ? this.app?.get(RoomsService).roomOf(p.id.toString()) : undefined;
    return room ? { code: room.code, wilds: room.wilds.map((w) => ({ index: w.index, characterCode: w.characterCode, x: w.x, y: w.y, state: w.state })) } : null;
  }
  // 서버에 열려 있는 탐험 세션(방) 수 — 재시도가 방을 새로 만들지 않는지 확인하는 데 쓴다
  roomCount(): number {
    return ((this.app!.get(RoomsService) as unknown as { rooms: Map<string, unknown> }).rooms).size;
  }
  // 시험용 지역 데이터 덧붙이기(이 서버 인스턴스의 메모리에서만 — 파일은 그대로다). 방을 만들기 전에 불러야 한다
  patchStage(stageCode: string, patch: (data: StageStoryData) => void) {
    patch(this.app!.get(StoryContentService).stage(stageCode)!);
  }
  // 서버의 야생 마커 좌표를 바꾸고 상태 방송을 보낸다(서버 좌표가 바뀌면 화면 마커가 따라오는지 볼 때)
  moveWild(device: string, index: number, to: { x: number; y: number }) {
    const p = this.playerByDevice(device)!;
    const rooms = this.app!.get(RoomsService);
    const room = rooms.roomOf(p.id.toString())!;
    const w = room.wilds.find((x) => x.index === index)!;
    w.x = to.x;
    w.y = to.y;
    rooms.events.emit('wild:changed', room, w);
  }
  // 서버에 저장된 탐험 위치를 다른 자리로 바꾼다(저장돼 있던 위치가 더는 유효하지 않게 된 상황을 만든다 — 재입장 보정 시험용)
  displace(device: string, to: { x: number; y: number }) {
    const p = this.playerByDevice(device)!;
    const m = this.app!.get(RoomsService).roomOf(p.id.toString())!.members.find((x) => x.playerId === p.id.toString())!;
    m.x = to.x;
    m.y = to.y;
  }
  // 접속 인증(presence:hello) 응답을 붙잡아 둔다(느린 서버·끊긴 연결 흉내). 호출마다 따로 풀어 준다.
  //   release(n)      : n번째(1부터) 인증을 정상 처리해 응답한다
  //   release(n, true): n번째 인증을 실패로 응답한다(늦게 도착한 낡은 응답이 화면을 덮지 않는지 볼 때)
  //   restore()       : 붙잡기를 끝내고 남은 것을 모두 정상 처리한다
  holdHello() {
    const rooms = this.app!.get(RoomsService);
    const original = rooms.identify.bind(rooms);
    const gates: { open: (fail: boolean) => void }[] = [];
    let held = true;
    rooms.identify = async (...args: Parameters<RoomsService['identify']>) => {
      if (held) {
        const fail = await new Promise<boolean>((resolve) => gates.push({ open: resolve }));
        if (fail) throw new RoomError('TEST_HELD', '시험용 실패 응답');
      }
      return original(...args);
    };
    return {
      get calls() {
        return gates.length;
      },
      release: (n: number, fail = false) => gates[n - 1]?.open(fail),
      restore: () => {
        held = false;
        gates.forEach((g) => g.open(false));
        rooms.identify = original;
      },
    };
  }
  // 서버 시작 전(시험 데이터를 만드는 중)에 계정 id를 찾는다
  playerByDeviceIn(db: FakeDb, device: string): bigint {
    return (db.rows('player', { device_uuid: `dev-device-${device}-account` })[0] as { id: bigint }).id;
  }
  // 그 계정에 스토리 이벤트를 기록한다(구역 개방 등 — DB 행과 서버 메모리의 판정 상태를 함께 갱신). 실제 진행 경로가 아니라 시험용 상태 만들기
  grantEvent(device: string, eventId: string) {
    const p = this.playerByDevice(device)!;
    this.db.seed('player_story_event', { player_id: p.id, event_id: eventId });
    this.app!.get(RoomsService).noteStoryEvents(p.id.toString(), [eventId]);
  }
  // game_setting 값을 바꾼다(이 서버 인스턴스의 메모리에서만). 클라이언트는 다음 Map 상태(map:enter·hello)에서 새 값을 받는다
  setSetting(key: string, value: unknown) {
    ((this.app!.get(SettingsService) as unknown as { values: Map<string, unknown> }).values).set(key, value);
  }
  // 탐험 세션 이탈(room:leave) 요청 횟수를 센다 — 마을 복귀 버튼이 서버 요청을 한 번만 보내는지 볼 때
  countLeaves() {
    const rooms = this.app!.get(RoomsService);
    const original = rooms.leaveRoom.bind(rooms);
    const counter = { calls: 0 };
    rooms.leaveRoom = (...args: Parameters<RoomsService['leaveRoom']>) => {
      counter.calls++;
      return original(...args);
    };
    return counter;
  }
  // 앞으로 n번의 전투 결과 정산을 일부러 실패시킨다(정산 직전의 새로고침 시험). 운영 코드의 시험용 주입 경로를 그대로 쓴다
  failNextSettles(n: number) {
    (this.app!.get(BattleService) as unknown as { injectedSettleFailures: number }).injectedSettleFailures = n;
  }
  // 특정 야생(spawnIndex)에 대한 조우 요청(battle:start)의 처리를 붙잡아 둔다(느린 서버 흉내). release()로 풀면 원래 처리가 이어진다
  holdBattleStart(spawnIndex: number) {
    const battles = this.app!.get(BattleService);
    const original = battles.start.bind(battles);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const state = { calls: 0 };
    battles.start = async (playerId: string, idx: unknown) => {
      if (idx === spawnIndex) {
        state.calls++;
        await gate;
      }
      return original(playerId, idx);
    };
    return {
      get calls() {
        return state.calls;
      },
      release: () => {
        open();
      },
      restore: () => {
        open();
        battles.start = original;
      },
    };
  }
  // 서버가 마지막으로 승인한 탐험 위치(탐험 세션이 없으면 null) — 화면의 위치와 서버 위치를 비교하는 데 쓴다
  serverPosition(device: string): { x: number; y: number } | null {
    const p = this.playerByDevice(device);
    const rooms = this.app?.get(RoomsService);
    const room = p && rooms ? rooms.roomOf(p.id.toString()) : undefined;
    const m = room && p ? rooms!.memberPosition(room, p.id.toString()) : null;
    return m ? { x: Math.round(m.x), y: Math.round(m.y) } : null;
  }
}

// ---------- 프런트(Vite 개발 서버) ----------
export async function startVite(root: string, env: Record<string, string>): Promise<{ url: string; close: () => Promise<void> }> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v; // Vite는 실행 중인 환경 변수를 .env보다 먼저 쓴다(운영 주소가 끼어들지 않게 모두 명시)
  }
  const { pathToFileURL } = await import('url');
  const vite = await nativeImport(pathToFileURL(require.resolve('vite', { paths: [root] })).href);
  // 포트는 고르는 순간과 실제로 여는 순간이 달라서 드물게 EADDRINUSE가 난다 — 제한된 횟수만 새 번호로 다시 시도하고, 끝까지 실패하면 그대로 던진다
  const cacheDir = process.env.VITE_CACHE_DIR; // 병렬 shard마다 의존성 캐시를 따로 쓴다(없으면 기본 위치)
  let server: { listen: () => Promise<unknown>; close: () => Promise<void> } | undefined;
  let port = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3 && !server; attempt += 1) {
    port = await freePort();
    try {
      const candidate = await vite.createServer({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', clearScreen: false, ...(cacheDir ? { cacheDir } : {}), server: { port, strictPort: true, host: '127.0.0.1', hmr: false } });
      await candidate.listen();
      server = candidate;
    } catch (e) {
      lastError = e;
      if (!/EADDRINUSE|already in use|Port \d+ is already/i.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  if (!server) throw lastError;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const started = server;
  return { url: `http://127.0.0.1:${port}`, close: () => started.close() };
}

// ---------- 브라우저 ----------
function chromePath(): string | undefined {
  const list = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return list.find((p) => p && existsSync(p));
}
export async function launchBrowser(): Promise<Browser> {
  const executablePath = chromePath();
  if (!executablePath) {
    throw new Error(
      '브라우저 E2E: 설치된 Chrome/Edge를 찾지 못했습니다. 기본 설치 경로에 없으면 실행 파일 경로를 CHROME_PATH 환경 변수로 지정하세요. ' +
        '예) PowerShell: $env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"; npm run test:e2e  ·  bash: CHROME_PATH=/usr/bin/google-chrome npm run test:e2e (test/e2e/README.md)',
    );
  }
  return chromium.launch({ executablePath, headless: process.env.E2E_HEADED !== '1', args: ['--mute-audio'] });
}

type Net = { at: number; kind: 'http' | 'socket'; what: string; status?: number; code?: string };

// 게임 한 화면(페이지)을 다루는 도우미 — 모든 조작은 실제 입력, 모든 기다림은 상태 조건
export class Game {
  readonly net: Net[] = [];
  readonly consoleErrors: string[] = [];
  private constructor(readonly ctx: BrowserContext, readonly page: Page, readonly name: string) {}

  // initScript: 페이지 스크립트보다 먼저 실행할 코드(예: visualViewport 모의)
  static async open(browser: Browser, url: string, name: string, viewport = { width: 1280, height: 720 }, initScript?: string): Promise<Game> {
    const ctx = await browser.newContext({ viewport });
    if (initScript) await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    const g = new Game(ctx, page, name);
    g.record();
    await page.goto(url);
    await g.ready();
    return g;
  }

  // 네트워크 결과만 기록: 경로·상태·오류 코드(본문·헤더·토큰은 기록하지 않음)
  private record() {
    this.page.on('response', async (res) => {
      const u = new URL(res.url());
      if (!u.pathname.startsWith('/player')) return;
      let code: string | undefined;
      if (res.status() >= 400) code = await res.json().then((j: { code?: string }) => j.code, () => undefined);
      this.net.push({ at: Date.now(), kind: 'http', what: `${res.request().method()} ${u.pathname}`, status: res.status(), code });
    });
    this.page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => {
        const m = /^43\d*(\[.*\])$/s.exec(String(payload)); // socket.io 응답(ack)
        if (!m) return;
        try {
          const body = (JSON.parse(m[1]) as { ok?: boolean; code?: string }[])[0];
          if (body && body.ok === false) this.net.push({ at: Date.now(), kind: 'socket', what: 'ack', code: body.code });
        } catch {
          /* 무시 */
        }
      });
    });
    this.page.on('console', (m) => {
      if (m.type() === 'error') this.consoleErrors.push(m.text().slice(0, 200));
    });
  }

  // 게임 인스턴스와 도우미가 준비될 때까지
  async ready() {
    await this.page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game, null, { timeout: 30_000 });
    await this.page.evaluate("import('/dev/captureHelper.ts')"); // 문자열로(ts-node가 import()를 require로 바꾸지 않게)
    await this.page.waitForFunction(() => (window as any).__dev?.active().length > 0, null, { timeout: 30_000 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async reload() {
    await this.page.reload();
    await this.ready();
  }

  state(): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.page.evaluate(() => (window as any).__dev.state()); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  // 조건이 참이 될 때까지(화면 상태 폴링 — 고정 지연 아님)
  async until(desc: string, pred: string, timeout = 20_000) {
    try {
      await this.page.waitForFunction(`(() => { const s = window.__dev.state(); return (${pred}); })()`, null, { timeout, polling: 100 });
    } catch (e) {
      throw new Error(`기다리던 상태가 오지 않음: ${desc} (${pred})\n${(e as Error).message.split('\n')[0]}`);
    }
  }
  waitScene(key: string, timeout = 20_000) {
    return this.until(`장면 ${key}`, `s.scenes.includes(${JSON.stringify(key)})`, timeout);
  }

  // 캔버스 좌표(1280×720) → 페이지 좌표로 실제 마우스 클릭
  async click(x: number, y: number) {
    const r = await this.page.evaluate(() => {
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      return { left: c.left, top: c.top, w: c.width, h: c.height };
    });
    await this.page.mouse.click(r.left + (x * r.w) / 1280, r.top + (y * r.h) / 720, { delay: 40 }); // 사람이 누르는 것처럼 짧게 눌렀다 뗀다
  }
  async canvasToPage(x: number, y: number) {
    const r = await this.page.evaluate(() => {
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      return { left: c.left, top: c.top, w: c.width, h: c.height };
    });
    return { x: r.left + (x * r.w) / 1280, y: r.top + (y * r.h) / 720 };
  }

  // ----- 단일 클릭 원칙(10-01 v1 §1.3): UI 행동은 한 번만 누른다. 누른 뒤 기대 상태가 오지 않으면 다시 누르지 않고 실패한다 -----

  private async expectAfterClick(what: string, expect: string, timeout = 10_000) {
    try {
      await this.page.waitForFunction(`(() => { const s = window.__dev.state(); return (${expect}); })()`, null, { timeout, polling: 50 });
    } catch {
      throw new Error(`한 번 눌렀지만 상태가 바뀌지 않음(입력 누락): ${what} → ${expect}`);
    }
  }

  // 글자로 버튼을 찾아(보일 때까지 기다림) 실제로 한 번 누른다. expect를 주면 그 상태가 될 때까지 기다린다(다시 누르지 않음)
  async clickLabel(label: string, opts: { exact?: boolean; timeout?: number; expect?: string } = {}) {
    const h = await this.page.waitForFunction(([l, e]) => (window as any).__dev.find(l, e), [label, !!opts.exact] as const, { timeout: opts.timeout ?? 20_000, polling: 100 }).catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!h) throw new Error(`버튼을 찾지 못함: ${label}`);
    const p = (await h.jsonValue()) as { x: number; y: number };
    await this.click(p.x, p.y);
    if (opts.expect) await this.expectAfterClick(label, opts.expect);
  }

  // 좌표를 한 번 누르고 expect 상태를 기다린다
  async clickAt(x: number, y: number, expect: string) {
    await this.click(x, y);
    await this.expectAfterClick(`(${x}, ${y})`, expect);
  }

  // 전투 결과창의 버튼을 한 번 누르고 expect 상태를 기다린다
  async clickResult(expect: string) {
    await this.until('결과 버튼', 's.battle && s.battle.resultButton');
    const btn = (await this.state()).battle.resultButton as { x: number; y: number };
    await this.click(btn.x, btn.y);
    await this.expectAfterClick('결과 버튼', expect);
  }

  // 대화: 입력을 기다리는 동안 화면을 눌러 진행. stop 조건이 참이 되면 멈춘다
  async advanceDialogue(stop: string, max = 400) {
    for (let i = 0; i < max; i++) {
      const s = await this.state();
      if (await this.page.evaluate(`(() => { const s = window.__dev.state(); return (${stop}); })()`)) return;
      if (!s.dialogue || !s.dialogue.waiting) {
        await this.page.waitForFunction(`(() => { const s = window.__dev.state(); return (${stop}) || (s.dialogue && s.dialogue.waiting); })()`, null, { timeout: 20_000, polling: 50 });
        continue;
      }
      const sig = JSON.stringify(s.dialogue);
      await this.click(640, 440);
      await this.page.waitForFunction(`(() => { const s = window.__dev.state(); return (${stop}) || JSON.stringify(s.dialogue) !== ${JSON.stringify(sig)}; })()`, null, { timeout: 20_000, polling: 50 });
    }
    throw new Error(`대화가 끝나지 않음: ${stop}`);
  }

  // 전투: 내 차례마다 이동·공격·턴 종료를 실제 클릭 한 번씩으로. 결과창이 뜰 때까지.
  // 누른 뒤에는 서버 응답·재생이 끝나 전투 버전이 바뀌기를 기다린다. 바뀌지 않으면 다시 누르지 않고 입력 누락으로 실패한다
  // stop: 이 상태 조건이 참이 되면(내 차례·처리 중이 아닐 때만 본다) 전투를 끝내지 않고 멈춘다 — 전투 도중의 화면을 볼 때
  async playBattle(deadlineMs = 120_000, stop?: string) {
    const until = Date.now() + deadlineMs;
    const changed = (v: number, timeout: number) =>
      this.page.waitForFunction(
        (ver) => {
          const b = (window as any).__game.scene.getScene('Battle'); // eslint-disable-line @typescript-eslint/no-explicit-any
          return !b?.snap || b.resultShown || (!b.busy && b.snap.version !== ver && (window as any).__dev.battleStep() !== null) || (!b.busy && b.snap.phase === 'resolved'); // eslint-disable-line @typescript-eslint/no-explicit-any
        },
        v,
        { timeout, polling: 50 },
      );
    while (Date.now() < until) {
      const s = await this.state();
      if (s.battle?.resultShown) return s.battle;
      const step = (await this.page.evaluate(() => (window as any).__dev.battleStep())) as { x: number; y: number; kind: string } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (stop && step && (await this.page.evaluate(`(() => { const s = window.__dev.state(); return !!(${stop}); })()`))) return (await this.state()).battle;
      const before = (await this.page.evaluate(() => (window as any).__game.scene.getScene('Battle').snap?.version ?? -1)) as number; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!step) {
        // 내 차례가 아니거나 재생 중 — 누르지 않고 차례가 오기를 기다린다
        await this.page.waitForFunction(() => { const b = (window as any).__game.scene.getScene('Battle'); return !b?.snap || b.resultShown || (window as any).__dev.battleStep() !== null; }, null, { timeout: 30_000, polling: 50 }); // eslint-disable-line @typescript-eslint/no-explicit-any
        continue;
      }
      await this.click(step.x, step.y);
      await changed(before, 30_000).catch(() => {
        throw new Error(`한 번 눌렀지만 전투 상태가 바뀌지 않음(입력 누락): ${step.kind} (${step.x}, ${step.y})`);
      });
    }
    throw new Error('전투가 끝나지 않음');
  }

  // 아바타를 목표 지점까지 실제 입력으로 걷게 한다. 마을은 방향키, 탐험 맵은 가상 조이스틱(마우스 누른 채 끌기).
  // stop 조건(예: 장면 전환)이 먼저 참이 되면 멈춘다. 막히면 옆으로 비켜 간다.
  // 탐험 맵(Map)은 길이 굽어 있어 직선으로 갈 수 없다 — 길 중심선(layout.paths)을 따라 가까운 경유지를 차례로 걷고, 마지막에 목표로 간다.
  async walkTo(sceneKey: string, target: { x: number; y: number }, how: 'keys' | 'joystick', stop = 'false', near = 24) {
    if (sceneKey !== 'Map') return this.walkDirect(sceneKey, target, how, stop, near);
    const at = (await this.page.evaluate(() => { const a = (window as any).__game.scene.getScene('Map')?.avatar; return a ? { x: a.x, y: a.y } : null; })) as { x: number; y: number } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!at) return;
    const stopped = () => this.page.evaluate(`(() => { const s = window.__dev.state(); return !!(${stop}); })()`) as Promise<boolean>;
    const legs = walkRoute(at, target);
    for (let i = 0; i < legs.length; i++) {
      if (await stopped()) return;
      const last = i === legs.length - 1;
      await this.walkDirect(sceneKey, legs[i], how, stop, last ? near : 28);
    }
  }

  async walkDirect(sceneKey: string, target: { x: number; y: number }, how: 'keys' | 'joystick', stop = 'false', near = 24) {
    const pos = () => this.page.evaluate((k) => { const a = (window as any).__game.scene.getScene(k)?.avatar; return a ? { x: a.x, y: a.y } : null; }, sceneKey); // eslint-disable-line @typescript-eslint/no-explicit-any
    const stopped = () => this.page.evaluate(`(() => { const s = window.__dev.state(); return !!(${stop}); })()`) as Promise<boolean>;
    const anchor = { x: 640, y: 560 };
    let held: string[] = [];
    let pressed = false;
    const release = async () => {
      for (const k of held) await this.page.keyboard.up(k);
      held = [];
      if (pressed) await this.page.mouse.up();
      pressed = false;
    };
    try {
      let detour = 0;
      for (let i = 0; i < 200; i++) {
        if (await stopped()) return;
        const p = await pos();
        if (!p) return;
        let dx = target.x - p.x;
        let dy = target.y - p.y;
        if (Math.hypot(dx, dy) <= near) return;
        if (detour > 0) {
          [dx, dy] = [-dy, dx]; // 막혔으면 잠시 옆으로
          detour--;
        }
        if (how === 'keys') {
          const want = [dx > 8 ? 'ArrowRight' : dx < -8 ? 'ArrowLeft' : null, dy > 8 ? 'ArrowDown' : dy < -8 ? 'ArrowUp' : null].filter((k): k is string => !!k);
          for (const k of held.filter((k) => !want.includes(k))) await this.page.keyboard.up(k);
          for (const k of want.filter((k) => !held.includes(k))) await this.page.keyboard.down(k);
          held = want;
        } else {
          const len = Math.hypot(dx, dy) || 1;
          const a = await this.canvasToPage(anchor.x, anchor.y);
          const b = await this.canvasToPage(anchor.x + (dx / len) * 70, anchor.y + (dy / len) * 70);
          if (!pressed) {
            await this.page.mouse.move(a.x, a.y);
            await this.page.mouse.down();
            pressed = true;
          }
          await this.page.mouse.move(b.x, b.y);
        }
        // 조금 움직이거나(40px) 멈춤 조건이 될 때까지 — 움직이지 않으면 막힌 것
        const moved = await this.page
          .waitForFunction(
            ([k, x0, y0, st]) => {
              const s = (window as any).__dev.state(); // eslint-disable-line @typescript-eslint/no-explicit-any
              if (new Function('s', `return !!(${st})`)(s)) return true;
              const av = (window as any).__game.scene.getScene(k)?.avatar; // eslint-disable-line @typescript-eslint/no-explicit-any
              return !av || Math.hypot(av.x - x0, av.y - y0) >= 40;
            },
            [sceneKey, p.x, p.y, stop] as const,
            { timeout: 1500, polling: 50 },
          )
          .then(() => true, () => false);
        if (!moved) detour = 6;
      }
      throw new Error(`목표 지점에 가지 못함: ${JSON.stringify(target)}`);
    } finally {
      await release();
    }
  }

  // 캔버스를 실제 표시 크기 그대로 저장(v5 §7). CAPTURE_DIR이 없으면 아무것도 하지 않는다
  async capture(name: string) {
    if (!CAPTURE_DIR) return;
    mkdirSync(CAPTURE_DIR, { recursive: true });
    // 화면 전환 페이드가 끝난 뒤에 찍는다(상태 조건 — 고정 지연 아님)
    await this.page
      .waitForFunction(() => (window as any).__game.scene.getScenes(true).every((s: any) => !s.cameras?.main?.fadeEffect?.isRunning), null, { timeout: 5000, polling: 50 }) // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => undefined);
    const box = await this.page.locator('canvas').boundingBox();
    if (!box) return;
    await this.page.screenshot({ path: join(CAPTURE_DIR, `${Math.round(box.width)}x${Math.round(box.height)}_${name}.png`), clip: box });
  }

  // 실패 진단: 장면·화면 상태·체크포인트·최근 오류 코드·콘솔 오류 + 스크린샷(토큰·식별 정보 없음)
  async diagnose(label: string, err: unknown, checkpoint: string | null = null) {
    mkdirSync(ARTIFACTS, { recursive: true });
    const safe = label.replace(/[^\w가-힣-]+/g, '_').slice(0, 80);
    const state = await this.state().catch(() => null);
    const errors = this.net.filter((n) => (n.status ?? 200) >= 400 || n.code).slice(-15);
    const report = { test: label, error: String(err instanceof Error ? err.message : err).slice(0, 800), state, checkpoint, recentErrors: errors, consoleErrors: this.consoleErrors.slice(-10) };
    writeFileSync(join(ARTIFACTS, `${safe}.json`), JSON.stringify(report, null, 2));
    await this.page.screenshot({ path: join(ARTIFACTS, `${safe}.png`) }).catch(() => undefined);
    return report;
  }

  async close() {
    await this.ctx.close();
  }
}

// 실패하면 진단을 남기고 다시 던진다
export async function withDiagnosis<T>(game: Game, label: string, run: () => Promise<T>, backend?: Backend, device?: string): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const player = backend && device ? backend.playerByDevice(device) : undefined;
    const checkpoint = player ? ((backend!.db.rows('player_story_progress', { player_id: player.id })[0] as { checkpoint?: string } | undefined)?.checkpoint ?? null) : null;
    const report = await game.diagnose(label, err, checkpoint);
    const e = err instanceof Error ? err : new Error(String(err));
    e.message += `\n[진단] 장면=${JSON.stringify(report.state?.scenes)} 체크포인트=${report.checkpoint} 최근오류=${JSON.stringify(report.recentErrors.map((n) => n.code ?? n.status))} (파일: ${ARTIFACTS})`;
    throw e;
  }
}
