// 개발 전용 캡처·조작·진단 도우미(배포 번들 제외 — src에서 import하지 않는다). 실제 게임 클라이언트(개발 서버, window.__game)에서
// `await import('/dev/captureHelper.ts')`로 불러 window.__dev를 설치한다. 브라우저 E2E(BE/test/e2e)도 이걸로 화면을 읽는다.
//   cap(name): 게임 캔버스를 실제 표시 크기로 저장(로컬 캡처 수신기 127.0.0.1:5199)
//   tap(x, y): 캔버스 좌표(1280×720)에서 가장 위에 있는 입력 대상에 pointerdown — 뷰포트 에뮬레이션에서 화면 좌표가 어긋날 때용
//   find(label, exact?): 글자에 label이(exact면 글자 전체가 label과 같은) 들어간 "누를 수 있는" 요소의 캔버스 좌표(가장 위) — E2E는 이 좌표를 실제 마우스로 누른다
//   state(): 현재 장면과 화면 상태 요약(진단용 — 토큰·식별 정보 없음)
//   battleStep(): 전투 화면에서 다음에 누를 곳(이동 칸·공격 대상·턴 종료) — 판단만 하고 누르지 않는다
//   keepAlive(): 창이 숨겨져 rAF가 멈춰도 게임 루프가 돌도록 Phaser 루프를 타이머 방식으로 다시 시작
//   active(): 실행 중인 씬 키
import type Phaser from 'phaser';
import { reachableCells, targetState } from '../src/battle/battleView';
import { liveInventoryWindows } from '../src/ui/InventoryWindow';
import type { BattleSnapshot, BattleUnit } from '../src/net/battleTypes';

import { roomClient } from '../src/net/roomClient';
const game = () => (window as unknown as { __game: Phaser.Game }).__game;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function cap(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = game();
    g.renderer.snapshot((img) => {
      const w = Math.round(g.scale.displaySize.width);
      const h = Math.round(g.scale.displaySize.height);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img as HTMLImageElement, 0, 0, w, h);
      fetch('http://127.0.0.1:5199/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${w}x${h}_${name}.jpg`, dataUrl: c.toDataURL('image/jpeg', 0.9) }) })
        .then((r) => r.json())
        .then((j: { file: string }) => resolve(j.file), reject);
    }, 'image/png');
  });
}

type Hit = { o: Phaser.GameObjects.GameObject; depth: number; order: number };
function walkScenes(visit: (o: Any, depth: number, order: number, scene: Phaser.Scene) => void) {
  const g = game();
  let order = 0;
  for (const scene of g.scene.getScenes(true)) {
    const walk = (list: Phaser.GameObjects.GameObject[], base: number) => {
      for (const o of list) {
        order++;
        const any = o as unknown as Any;
        if (any.visible === false) continue;
        if (any.list) walk(any.list, base + (any.depth ?? 0));
        visit(any, base + (any.depth ?? 0), order, scene);
      }
    };
    walk(scene.children.list, g.scene.getIndex(scene) * 100000);
  }
}

// 화면 좌표(캔버스 1280×720 기준): 스크롤되는 월드 오브젝트는 카메라 위치를 뺀다
function screenRect(o: Any, scene: Phaser.Scene) {
  const b = o.getBounds() as Phaser.Geom.Rectangle;
  const cam = scene.cameras.main;
  const sf = o.scrollFactorX ?? 1;
  return { x: b.x - cam.scrollX * sf, y: b.y - cam.scrollY * sf, w: b.width, h: b.height };
}

function interactiveAt(x: number, y: number): Hit | null {
  const hits: Hit[] = [];
  walkScenes((o, depth, order, scene) => {
    if (!o.input?.enabled || !o.getBounds) return;
    const r = screenRect(o, scene);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) hits.push({ o: o as Phaser.GameObjects.GameObject, depth, order });
  });
  hits.sort((a, b) => b.depth - a.depth || b.order - a.order);
  return hits[0] ?? null;
}

function tap(x: number, y: number): string | null {
  const top = interactiveAt(x, y)?.o;
  top?.emit('pointerdown');
  return top ? ((top as unknown as { text?: string }).text ?? top.type) : null;
}

// label이 들어간 글자 중 실제로 눌리는 것(글자 가운데를 눌렀을 때 가장 위 입력 대상이 그 글자 또는 그 글자를 담은 버튼)
function find(label: string, exact = false): { x: number; y: number } | null {
  const found: { x: number; y: number; depth: number; order: number }[] = [];
  walkScenes((o, depth, order, scene) => {
    if (typeof o.text !== 'string' || !(exact ? o.text.trim() === label : o.text.includes(label)) || !o.getBounds) return;
    const r = screenRect(o, scene);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (interactiveAt(cx, cy)) found.push({ x: cx, y: cy, depth, order });
  });
  found.sort((a, b) => b.depth - a.depth || b.order - a.order);
  return found[0] ? { x: Math.round(found[0].x), y: Math.round(found[0].y) } : null;
}

function state() {
  const g = game();
  const scenes = g.scene.getScenes(true).map((s) => s.scene.key);
  const out: Any = { scenes, displayWidth: Math.round(g.scale.displaySize.width) };
  const boot = g.scene.getScene('Boot') as unknown as Any;
  if (scenes.includes('Boot') && boot.debugRestore) out.boot = boot.debugRestore; // 복원 화면: 단계(loading·slow·failed)·시도 횟수·다시 시도 버튼
  const battle = g.scene.getScene('Battle') as unknown as Any;
  if (scenes.includes('Battle') && battle.snap) {
    // 결과창의 누를 수 있는 버튼(돌아가기·다시 확인) 가운데 좌표
    const btn = (battle.resultObjs ?? []).filter((o: Any) => o.type === 'Container' && o.input?.enabled).pop();
    out.battle = { battleId: battle.snap.battleId, version: battle.snap.version, round: battle.snap.round, spawnIndex: battle.snap.spawnIndex, units: battle.snap.units.map((u: Any) => ({ id: u.unitId, side: u.side, col: u.col, row: u.row, hp: u.hp, maxHp: u.maxHp, ap: u.ap, stunned: u.stunned, phase: u.phase ?? null })), zones: battle.snap.zones ?? null, telegraphed: battle.snap.telegraphedCurrent ?? null, lastCurrent: battle.snap.lastCurrent ?? null, hintsShown: battle.snap.hintsShown ?? null, returnTo: battle.initData?.returnTo?.scene ?? null, phase: battle.snap.phase, outcome: battle.snap.outcome, story: !!battle.snap.story, resultShown: battle.resultShown, settled: battle.resultEnded?.settled ?? null, hudMode: battle.hud?.mode, goalOpen: battle.goalOpen, resultButton: btn ? { x: Math.round(btn.x), y: Math.round(btn.y), label: btn.list?.find((c: Any) => typeof c.text === 'string')?.text } : null };
  }
  const party = g.scene.getScene('PartySelect') as unknown as Any;
  if (scenes.includes('PartySelect') && party.layout) out.party = { selected: [...party.selected], page: party.page, pages: party.layout.pages, story: !!party.snap?.story, cardW: party.layout.cards[0]?.w };
  for (const key of ['Opening', 'StoryDialogue']) {
    const d = g.scene.getScene(key) as unknown as Any;
    if (scenes.includes(key) && d) out.dialogue = { key, waiting: !!d.advanceResolver, typing: !!d.typing, line: String(d.fullText ?? '').slice(0, 40), fx: d.fxState ?? null, nameInput: !!document.querySelector('input[aria-label="이름"]') };
  }
  const sel = g.scene.getScene('StageSelect') as unknown as Any;
  if (scenes.includes('StageSelect') && sel.L) {
    const perPage = sel.L.pager?.perPage ?? sel.L.cards.length;
    out.stageSelect = {
      page: sel.page, pages: sel.L.pager?.pages ?? 1, busy: sel.busy, mode: sel.L.mode, count: sel.statuses.length, shown: perPage,
      // 지금 페이지의 카드: 가운데 좌표와 서버가 준 상태(입장 가능·잠금 사유)
      cards: sel.statuses.slice(sel.page * perPage, (sel.page + 1) * perPage).map((st: Any, i: number) => ({ code: st.chapter.stageCode, state: st.state, enterable: st.enterable, lockedReason: st.lockedReason, x: Math.round(sel.L.cards[i].x + sel.L.cards[i].w / 2), y: Math.round(sel.L.cards[i].y + sel.L.cards[i].h / 2) })),
    };
  }
  const market = g.scene.getScene('Market') as unknown as Any;
  if (scenes.includes('Market') && market.L) {
    const perPage = market.L.pager?.perPage ?? Math.max(1, market.L.cards.length);
    out.market = {
      page: market.page, pages: market.L.pager?.pages ?? 1, pending: market.pendingProductId, count: market.products.length, mode: market.L.mode, tare: market.tareText?.text ?? '',
      // 지금 페이지의 상품: 구매 버튼 가운데 좌표
      cards: market.products.slice(market.page * perPage, (market.page + 1) * perPage).map((p: Any, i: number) => ({ id: p.id, code: p.code, price: p.price, x: Math.round(market.L.cards[i].x + market.L.inner.buy.x + market.L.inner.buy.w / 2), y: Math.round(market.L.cards[i].y + market.L.inner.buy.y + market.L.inner.buy.h / 2) })),
    };
  }
  const home = g.scene.getScene('Home') as unknown as Any;
  if (scenes.includes('Home') && home.L) {
    const texts = home.children.list.filter((o: Any) => typeof o.text === 'string').map((o: Any) => o.text as string);
    const count = (prefix: string) => Number(/· (\d+)마리/.exec(texts.find((x: string) => x.startsWith(prefix)) ?? '')?.[1] ?? -1);
    out.home = { pages: [...home.pages], busy: home.busy, mode: home.L.mode, equip: home.equipPanel?.debugState ?? null, bag: count('가방 ('), shelf: count('선반 (') };
  }
  const village = g.scene.getScene('Village') as unknown as Any;
  if (scenes.includes('Village') && village.hud) out.village = { ready: village.ready, hudMode: village.hud.mode, prompt: village.activeInteraction?.type ?? null, locked: village.locked, restorePrompt: (village.restorePrompt?.length ?? 0) > 0, paused: village.paused, miniMap: village.miniMap?.debugState ?? null };
  const map = g.scene.getScene('Map') as unknown as Any;
  if (scenes.includes('Map') && map.hud) {
    const center = (r: Any) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
    out.map = {
      ready: map.ready, hudMode: map.hud.mode, avatar: map.avatar ? { x: Math.round(map.avatar.x), y: Math.round(map.avatar.y) } : null,
      goal: map.deliveryLayer.length > 0, goalHeight: map.deliveryLayer[0] ? Math.round(map.deliveryLayer[0].height) : 0,
      room: map.roomLabel?.text ?? null, inRoom: map.inRoomMap, turbyPanel: map.inventoryPanel?.isVisible ?? false,
      miniMap: map.miniMap?.debugState ?? null, joystickZone: map.hud.joystickZone,
      buttons: { home: center(map.hud.home), inventory: center(map.hud.inventory), turbys: center(map.hud.turbys) },
      inputPatch: g.registry.get('inputPatch') ?? null,
      render: map.debugRender,
      ...map.debugPosition, // 10-02 v4: 서버가 정한 위치에 배치됐는가, 서버 보정 횟수
      // 10-02 v3: 지역 스토리 화면(서버가 내려 준 것)과 지금 누를 수 있는 대상
      story: map.stageView ? {
        greybox: map.stageView.greybox, objects: map.stageView.objects.map((o: Any) => o.id), locked: map.stageView.objects.filter((o: Any) => o.state === 'locked').length,
        points: map.stageView.points.map((p: Any) => p.id), gates: Object.fromEntries(map.stageView.gates.map((x: Any) => [x.id, x.open])),
        objective: map.stageView.objectives[0] ?? null, goal: map.stageView.goal?.text ?? null, goalShown: map.shownGoal ?? null,
        prompt: map.activeTarget?.target.id ?? null, promptText: map.interactLabel?.visible ? map.interactLabel.text : null, busy: map.storyBusy, interact: center(map.hud.interact), interactRect: map.hud.interact,
      } : null,
    };
  }
  const inv = [...liveInventoryWindows].find((w) => w.isVisible);
  if (inv) out.inventory = inv.debugState;
  return out;
}

// 전투: 다음에 누를 곳(내 차례가 아니거나 처리 중이면 null)
function battleStep(): { x: number; y: number; kind: 'attack' | 'move' | 'end' } | null {
  const b = game().scene.getScene('Battle') as unknown as Any;
  if (!b?.snap || b.busy || b.resultShown) return null;
  const snap = b.snap as BattleSnapshot;
  if (snap.phase !== 'player_subturn' || snap.currentPlayerId !== b.myId) return null;
  const u = snap.units.find((x) => x.unitId === b.selectedUnitId) as BattleUnit | undefined;
  const d = (a: { col: number; row: number }, c: { col: number; row: number }) => Math.abs(a.col - c.col) + Math.abs(a.row - c.row);
  const foes = snap.units.filter((x) => x.side === 'wild' && !x.stunned && !x.inactive && !x.fled && targetState(snap, x) === 'ok' && !x.invulnerable);
  const end = find('턴 종료');
  if (!u || u.ap <= 0 || u.stunned) return end && { ...end, kind: 'end' };
  const adj = foes.find((f) => d(u, f) === 1);
  if (adj) {
    const p = b.tileToWorld(adj.col, adj.row);
    return { x: Math.round(p.x), y: Math.round(p.y), kind: 'attack' };
  }
  const goals = foes.flatMap((f) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, c]) => ({ col: f.col + a, row: f.row + c })));
  const gap = (x: { col: number; row: number }) => Math.min(...goals.map((y) => d(x, y)));
  const best = reachableCells(snap, u).sort((a, c) => gap(a) - gap(c))[0];
  if (best && gap(best) < gap(u)) {
    const p = b.tileToWorld(best.col, best.row);
    return { x: Math.round(p.x), y: Math.round(p.y), kind: 'move' };
  }
  return end && { ...end, kind: 'end' };
}

function keepAlive() {
  const loop = game().loop as unknown as { forceSetTimeOut: boolean; stop(): void; start(cb: unknown): void; callback: unknown };
  if (loop.forceSetTimeOut) return 'already';
  const cb = loop.callback;
  loop.stop();
  loop.forceSetTimeOut = true;
  loop.start(cb);
  return 'timer loop';
}

const active = () => game().scene.getScenes(true).map((s) => s.scene.key);

// 화면에 보이는 글자 전부(상태·안내 문구가 실제로 보이는지 확인용)
function texts(): string[] {
  const out: string[] = [];
  walkScenes((o) => {
    if (typeof o.text === 'string' && o.text.trim() && (o.alpha ?? 1) > 0) out.push(o.text);
  });
  return out;
}

// 변조한 클라이언트 흉내(시험 전용): 게임 화면을 거치지 않고 같은 소켓으로 임의 요청을 보낸다 — 서버가 무시·거절하는지 확인하는 데만 쓴다
const rawRequest = (event: string, body?: unknown) => roomClient.request<unknown>(event, body).catch((e: { code?: string; message?: string; battleId?: string | null }) => ({ ok: false, code: e.code ?? null, message: e.message ?? String(e), battleId: e.battleId ?? undefined }));

(window as unknown as { __dev?: unknown }).__dev = { cap, tap, find, state, texts, battleStep, keepAlive, active, rawRequest };
export {};
