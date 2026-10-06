// v4 §5 실제 프런트·서버 통합 경로 — 실제 NestJS 터비 앱(컨트롤러·소켓 게이트웨이·서비스)을 임의 포트에 띄우고,
// 프런트와 같은 방식(HTTP /player/me/* + X-Turby-Session, socket.io presence:hello·room·map·battle)으로 접속한다.
// DB만 테스트 격리 환경(FakeDb)으로 바꾼다. 1장 대화는 프런트의 실제 대화 진행기(dialogueRunner)로, 전투 판정은 프런트 battleView로 돌린다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import { FakeDb } from './helpers/fake-prisma';
import { seedBase, startTurbyApp } from './helpers/turby-app';
import { routeTo } from './helpers/forest-route';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { solidsFor } from '../src/turby/rooms/stage-collision';
// 프런트 실제 모듈(순수 — Phaser 없음). 프런트 패키지는 ES 모듈이라 네이티브 import()로 불러온다(ts-node가 require로 바꾸지 않게)
type Runner = typeof import('../../save-a-turby/src/story/dialogueRunner');
type View = typeof import('../../save-a-turby/src/battle/battleView');
const nativeImport = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>;
let runDialogue: Runner['runDialogue'];
let reachableCells: View['reachableCells'];

const db = new FakeDb();
let app: INestApplication;
let base = '';

before(async () => {
  const { pathToFileURL } = await import('url');
  runDialogue = ((await nativeImport(pathToFileURL(join(__dirname, '../../save-a-turby/src/story/dialogueRunner.ts')).href)) as Runner).runDialogue;
  reachableCells = ((await nativeImport(pathToFileURL(join(__dirname, '../../save-a-turby/src/battle/battleView.ts')).href)) as View).reachableCells;
  // 이동 속도 제한만 푼다(걷는 시간을 생략). 충돌·경계·문 검증은 그대로다
  seedBase(db, { 'move.maxSpeedPxPerSec': 1_000_000, 'move.minIntervalMs': 0, 'move.slackPx': 1_000_000 });
  ({ app, base } = await startTurbyApp(db));
});

after(async () => {
  await app?.close();
});

// ---------- 프런트와 같은 접속 방식 ----------
class Client {
  token = '';
  playerId = '';
  socket!: Socket;
  constructor(readonly device: string) {}
  async identify() {
    const r = (await (await fetch(`${base}/player/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceUuid: this.device }) })).json()) as { playerId: string; sessionToken: string };
    this.token = r.sessionToken;
    this.playerId = String(r.playerId);
  }
  async me<T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}/player/me${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': this.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  }
  async connect() {
    this.socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', reject);
    });
    return this.req('presence:hello', { deviceUuid: this.device, sessionToken: this.token });
  }
  req<T = Record<string, unknown>>(event: string, body?: unknown): Promise<T & { ok: boolean; code?: string }> {
    return this.socket.timeout(5000).emitWithAck(event, body) as Promise<T & { ok: boolean; code?: string }>;
  }
  close() {
    this.socket?.disconnect();
  }
}

type Snap = { battleId: string; version: number; phase: string; currentPlayerId: string | null; outcome: string | null; story?: unknown; grid: { cols: number; rows: number }; units: { unitId: string; side: string; col: number; row: number; ap: number; stunned: boolean; targetable?: boolean; invulnerable?: boolean }[] };

// 프런트 전투 화면이 보내는 것과 같은 의도(이동·공격·턴 종료)만 보내는 자동 진행
async function playToEnd(c: Client, start: Snap): Promise<{ snap: Snap; ended: { outcome: string; rewards: { playerId: string; rewardStatus: string; capturedTurby: { characterCode: string } | null }[]; settled: boolean } | null }> {
  let snap = start;
  let ended = null;
  const d = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  for (let i = 0; i < 400 && snap.phase !== 'resolved'; i++) {
    if (snap.phase !== 'player_subturn' || snap.currentPlayerId !== c.playerId) {
      const r = await c.req<{ snapshot: Snap; ended: typeof ended }>('battle:snapshot', { battleId: snap.battleId });
      snap = r.snapshot;
      ended = r.ended;
      await new Promise((res) => setTimeout(res, 20));
      continue;
    }
    const me = snap.units.find((u) => u.side === 'party' && !u.stunned && u.ap > 0);
    const foes = snap.units.filter((u) => u.side === 'wild' && !u.stunned && u.targetable !== false && !u.invulnerable);
    let body: Record<string, unknown> = { type: 'end' };
    if (me) {
      const adj = foes.find((f) => d(me, f) === 1);
      if (adj) body = { type: 'attack', unitId: me.unitId, targetUnitId: adj.unitId };
      else if (foes[0]) {
        const cells = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ col: foes[0].col + a, row: foes[0].row + b }));
        const gap = (x: { col: number; row: number }) => Math.min(...cells.map((y) => d(x, y)));
        const best = reachableCells(snap as never, me as never).sort((a, b) => gap(a) - gap(b))[0];
        if (best && gap(best) < gap(me)) body = { type: 'move', unitId: me.unitId, targetCol: best.col, targetRow: best.row };
      }
    }
    const r = await c.req<{ snapshot: Snap; ended: typeof ended }>('battle:action', { battleId: snap.battleId, actionId: `a${i}-${Math.random()}`, expectedVersion: snap.version, ...body });
    if (r.ok) {
      snap = r.snapshot;
      ended = r.ended;
    } else snap = ((r as unknown as { snapshot?: Snap }).snapshot ?? snap);
  }
  return { snap, ended };
}

const ch01 = JSON.parse(readFileSync(join(__dirname, '../story-data/save-a-turby/dialogue/ch01.json'), 'utf8'));
const pid = (c: Client) => BigInt(c.playerId);
// 소켓 방송이 도착할 때까지(조건 폴링 — 고정 지연 아님)
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('기다리던 방송이 오지 않음');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('통합 1: 오프닝 전 직접 요청 차단(방 생성·스토리 전투·1장 시작 이벤트), 오프닝 완료 뒤 이야기 누비 1마리', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  const st = await c.me<{ openingRequired: boolean; stages: { stageCode: string; lockedReason: string | null }[] }>('/story');
  assert.equal(st.body.openingRequired, true);
  assert.equal(st.body.stages.find((s) => s.stageCode === 'forest')!.lockedReason, 'OPENING_REQUIRED');
  const hello = await c.connect();
  assert.equal(hello.ok, true);
  assert.equal((await c.req('room:create', { stageCode: 'forest' })).code, 'OPENING_REQUIRED');
  assert.equal((await c.req('battle:story:start', { encounterKey: 'forest_stitchling_ambush' })).code, 'OPENING_REQUIRED');
  const direct = await c.me<{ code: string }>('/story/events/forest_first_path_started/complete', {});
  assert.deepEqual([direct.status, direct.body.code], [403, 'STORY_EVENT_SERVER_ONLY']);

  await c.me('/story/events/opening_fall_completed/complete', {});
  await c.me('/profile/name', { name: '하늘' });
  const done = await c.me<{ story: { checkpoint: string } }>('/story/events/story_nubi_granted/complete', {});
  assert.equal(done.body.story.checkpoint, 'OPENING_COMPLETE');
  assert.equal(db.rows('turby_instance', { owner_player_id: pid(c) }).length, 1, '이야기 누비 1마리(스타터 자동 지급 없음)');
  c.close();
});

// ---------- 숲 안의 이야기 지점(10-02 v3): 실제 지역 데이터(story-data/stages/forest.json) 좌표로 이동해 발동 ----------
type Play = { segmentId: string; endAfter: string; fromEntry?: string; untilEntry?: string };
const FOREST = JSON.parse(readFileSync(join(__dirname, '../story-data/save-a-turby/stages/forest.json'), 'utf8')) as { points: { id: string; x: number; y: number }[] };
const pointOf = (id: string) => FOREST.points.find((p) => p.id === id)!;
// 서버가 승인하는 이동만으로 그 지점까지 간다: 벽·닫힌 문을 돌아가는 경유지를 map:move로 차례로 보고한다(10-02 v4 — 입장 좌표는 서버가 정한다).
// 갈 수 없는 곳(닫힌 문 너머)이면 false
const serverPos = (c: Client) => {
  const rooms = app.get(RoomsService);
  const room = rooms.roomOf(c.playerId)!;
  const m = room.members[0];
  return { room, x: m.x, y: m.y, solids: solidsFor(room.collision, m.storyEvents) };
};
async function moveTo(c: Client, to: { x: number; y: number }): Promise<boolean> {
  const at = serverPos(c);
  const path = routeTo(at.solids, { x: at.x, y: at.y }, to);
  if (!path) return false;
  for (const p of path) c.socket.emit('map:move', { x: p.x, y: p.y, dir: 'down' });
  // map:move는 응답이 없다 — 서버 위치가 목적지가 될 때까지 기다린다
  for (let i = 0; i < 200; i++) {
    const now = serverPos(c);
    if (now.x === to.x && now.y === to.y) return true;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error(`서버가 이동을 승인하지 않음: ${JSON.stringify(to)} (현재 ${JSON.stringify({ x: serverPos(c).x, y: serverPos(c).y })})`);
}
const goTo = async (c: Client, id: string) => assert.equal(await moveTo(c, pointOf(id)), true, `${id}까지 가는 길이 있어야 한다`);

// 서버가 알려 준 범위를 실제 대화 진행기로 재생한다(전투는 소켓으로 끝까지 진행)
async function runPlay(c: Client, play: Play, battles: string[]) {
  const shown: string[] = [];
  await runDialogue(ch01, play.segmentId, {
    show: async (line) => {
      shown.push(line.entry.dialogueId);
      return 'next';
    },
    cue: () => undefined,
    askName: async () => undefined,
    completeEvent: async (eventId) => {
      const r = await c.me(`/story/events/${eventId}/complete`, {});
      if (r.status >= 400) throw new Error(`${eventId} ${r.status}`);
    },
    saveName: async () => ({ playerName: '하늘' }),
    waitRetry: async (m) => {
      throw new Error(`재시도 없이 끝나야 함: ${m}`);
    },
    needsName: () => false,
    playerName: () => '하늘',
    isSeen: () => false,
    markSeen: () => undefined,
    // 프런트 StoryDialogueScene.startBattle과 같은 계약: battle:story:start → battle:party → 전투 → 결과
    startBattle: async (key) => {
      const s = await c.req<{ snapshot: Snap }>('battle:story:start', { encounterKey: key });
      if (!s.ok) return s.code === 'STORY_ENCOUNTER_DONE' ? 'already_won' : 'lost';
      assert.deepEqual(s.snapshot.story, { encounterKey: key, captureEnabled: false, wildRewards: false });
      const party = await c.req<{ snapshot: Snap }>('battle:party', { battleId: s.snapshot.battleId, turbyIds: [] });
      assert.ok(party.snapshot.units.some((u) => u.side === 'party'), '이야기 누비 자동 편성');
      const { snap, ended } = await playToEnd(c, party.snapshot);
      battles.push(`${key}:${snap.outcome}`);
      assert.deepEqual(ended?.rewards, [], '스토리 전투는 포획·보상 없음');
      return snap.outcome === 'win' ? 'won' : 'lost';
    },
  }, { endAfter: play.endAfter, fromEntry: play.fromEntry, untilEntry: play.untilEntry, exact: true });
  return shown;
}

type StageView = { greybox: boolean; objects: { id: string; state: string }[]; points: { id: string }[]; gates: { id: string; open: boolean }[]; objectives: { key: string; collected: number; required: number; active: boolean }[] };
const viewOf = async (c: Client) => (await c.me<StageView>('/story/stages/forest')).body;
const trig = (c: Client, id: string) => c.me<{ code?: string; play: Play | null; shortage: unknown }>(`/story/triggers/${id}`, {});

test('통합 2: 숲 진입 → 걷는 장면 → 잘린 실 지점 → 공터 지점의 스토리 전투 → 보풀이 단서. 지점은 순서대로만 열리고, 구조 전 실가루는 잠겨 있다', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  assert.equal((await c.req('room:create', { stageCode: 'forest' })).ok, true);
  assert.equal((await c.req('room:start')).ok, true);
  const battles: string[] = [];
  const FP = 'ch01.first_path';

  // 1) 숲 입구: 걷는 장면만(전투는 공터 지점이 연다)
  const enter = await c.req<{ story: { play: Play | null } }>('map:enter', { x: 1600, y: 1200, dir: 'down' });
  assert.deepEqual(enter.story.play, { segmentId: FP, endAfter: FP, untilEntry: `${FP}.004` });
  assert.deepEqual(await runPlay(c, enter.story.play!, battles), [1, 2, 3, 4].map((n) => `${FP}.00${n}`));

  // 지도: 지금 열린 지점은 잘린 실 하나, 실가루 10개는 잠긴 채로 보인다
  let view = await viewOf(c);
  assert.equal(view.greybox, true);
  assert.deepEqual(view.points.map((p) => p.id), ['forest_cut_thread']);
  assert.deepEqual([view.objects.length, view.objects.every((o) => o.state === 'locked')], [10, true]);
  // 구조 전 실가루 수집 거부(가까이 있어도), 닫힌 지점·좌표 밖 요청 거부
  await goTo(c, 'forest_dust_01');
  const early = await c.me<{ code: string }>('/story/objectives/forest_glowing_dust/progress', { objectId: 'forest_dust_01' });
  assert.deepEqual([early.status, early.body.code], [409, 'OBJECTIVE_NOT_ACTIVE']);
  await goTo(c, 'forest_bopuli_ambush');
  assert.equal((await trig(c, 'forest_bopuli_ambush')).body.code, 'STORY_EVENT_NOT_ALLOWED', '잘린 실을 보기 전');
  assert.equal((await c.req('battle:story:start', { encounterKey: 'forest_stitchling_ambush' })).code, 'STORY_ENCOUNTER_NOT_AVAILABLE', '전투 직접 시작도 선행 지점을 건너뛸 수 없다');
  assert.equal((await trig(c, 'forest_cut_thread')).body.code, 'STORY_EVIDENCE_INVALID', '잘린 실에서 멀리');

  // 2) 잘린 실오라기 조사
  await goTo(c, 'forest_cut_thread');
  const cut = await trig(c, 'forest_cut_thread');
  assert.deepEqual(cut.body.play, { segmentId: FP, endAfter: FP, fromEntry: `${FP}.005`, untilEntry: `${FP}.009` });
  await runPlay(c, cut.body.play!, battles);
  assert.equal((await trig(c, 'forest_cut_thread')).body.play, null, '완료한 지점은 다시 발동하지 않는다');
  assert.deepEqual((await viewOf(c)).points.map((p) => p.id), ['forest_bopuli_ambush']);

  // 3)~4) 공터: 매복 전투 → 구조 → 단서. 지점 발동과 전투 시작을 동시에 보내도 전투는 하나
  await goTo(c, 'forest_bopuli_ambush');
  const [amb, raced] = await Promise.all([trig(c, 'forest_bopuli_ambush'), c.req<{ snapshot?: Snap }>('battle:story:start', { encounterKey: 'forest_stitchling_ambush' })]);
  assert.deepEqual(amb.body.play, { segmentId: FP, endAfter: 'ch01.bopul_clue', fromEntry: `${FP}.010` });
  assert.equal(raced.ok, true);
  assert.equal(db.rows('player_story_event', { player_id: pid(c), event_id: 'forest_stitchling_battle_won' }).length, 0, '발동·전투 시작만으로는 승리가 기록되지 않는다');
  const shown = await runPlay(c, amb.body.play!, battles); // 진행기의 battle:story:start는 같은 전투로 이어진다
  assert.deepEqual(battles, ['forest_stitchling_ambush:win']);
  assert.ok(shown.includes('ch01.bopul_clue.013'), '전투 뒤 보풀이 단서 대화까지 이어짐');

  const st = await c.me<{ checkpoint: string; delivery: { have: number; need: number; triggerId: string } }>('/story');
  assert.equal(st.body.checkpoint, 'CH01_BOPUL_RESCUED');
  assert.deepEqual([st.body.delivery.have, st.body.delivery.need, st.body.delivery.triggerId], [0, 10, 'forest_bopuli_return']);
  // 이긴 전투 재요청은 DONE, 끝난 지점 재요청·숲 재진입은 재생 없음(거짓 진행 없음)
  assert.equal((await c.req('battle:story:start', { encounterKey: 'forest_stitchling_ambush' })).code, 'STORY_ENCOUNTER_DONE');
  assert.equal((await trig(c, 'forest_bopuli_ambush')).body.play, null);
  const again = await c.req<{ story: { play: unknown } }>('map:enter', { x: 1600, y: 1200, dir: 'down' });
  assert.equal(again.story.play, null);
  view = await viewOf(c);
  assert.deepEqual(view.points.map((p) => p.id), ['forest_bopuli_return']);
  assert.ok(view.objects.every((o) => o.state === 'available') && view.objects.length === 10, '구조 뒤 실가루 10개 수집 가능');
  c.close();
});

test('통합 3: 실가루 10개 수집(동시 10건·재접속·다른 지역·먼 거리) → 인벤토리 → 보풀이 전달(동시 2건) → 숨은 길 → 거대 매듭 전투 → 첫 매듭 각성·장착, 재접속 유지', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  await c.req('room:create', { stageCode: 'forest' });
  await c.req('room:start');
  await c.req('map:enter', { dir: 'down' });
  await goTo(c, 'forest_dust_01');
  const collect = (id: unknown) => c.me<{ code?: string; alreadyCollected: boolean; collected: number; required: number; grants: unknown[]; stage: StageView }>('/story/objectives/forest_glowing_dust/progress', { objectId: id });
  const dustQty = () => {
    const def = db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
    return (db.rows('player_item', { player_id: pid(c), item_definition_id: def.id })[0]?.quantity as number | undefined) ?? 0;
  };

  // 같은 실가루 동시 10건: 한 번만 효과
  const ten = await Promise.all(Array.from({ length: 10 }, () => collect('forest_dust_01')));
  assert.deepEqual([ten.filter((r) => r.status === 200).length, ten.filter((r) => !r.body.alreadyCollected).length], [10, 1]);
  assert.deepEqual([dustQty(), ten[0].body.collected, ten[0].body.stage.objects.length], [1, 1, 9]);
  // 임의 ID·수량, 먼 거리 거부
  assert.equal((await collect('forest_dust_99')).body.code, 'OBJECT_UNKNOWN');
  assert.equal((await c.me<{ code: string }>('/story/objectives/forest_glowing_dust/progress', { objectId: 'forest_dust_02', quantity: 10 })).body.code, 'STORY_EVIDENCE_INVALID', '02는 멀리 있다(수량 필드는 무시된다)');
  assert.equal(dustQty(), 1);

  // 수집 직후 연결 끊김 → 재접속: 주운 것은 사라진 채로, 목표는 1/10
  c.close();
  const c2 = new Client('dev-test-live-1');
  await c2.identify();
  await c2.connect();
  const restored = await viewOf(c2);
  assert.deepEqual([restored.objects.length, restored.objects.some((o) => o.id === 'forest_dust_01'), restored.objectives[0].collected], [9, false, 1]);
  assert.equal((await c2.me<{ delivery: { have: number } }>('/story')).body.delivery.have, 1);
  c2.close();

  // 다시 접속해 서로 다른 실가루를 동시에(각자 위치가 달라 한 번에 하나만 범위 안) — 범위 안의 것만 수집된다
  await c.identify();
  await c.connect();
  const back = await c.req<{ self: { x: number; y: number }; corrected: boolean }>('map:enter', { dir: 'down' });
  assert.deepEqual([back.self.x, back.self.y, back.corrected], [pointOf('forest_dust_01').x, pointOf('forest_dust_01').y, false], '유예 안 재접속: 마지막 승인 위치 그대로');
  await goTo(c, 'forest_dust_02');
  const mixed = await Promise.all(['forest_dust_02', 'forest_dust_03', 'forest_dust_04'].map((id) => collect(id)));
  assert.deepEqual(mixed.map((r) => r.status), [200, 422, 422]);
  for (let i = 3; i <= 5; i++) {
    const id = `forest_dust_0${i}`;
    await goTo(c, id);
    const got = await collect(id); assert.equal(got.body.collected, i, JSON.stringify([id, got.status, got.body.code]));
  }
  // 5/10 상태에서 다른 지역으로: 호수는 잠겨 있고, 숲 밖에서는 수집할 수 없다
  await c.req('room:leave');
  assert.equal((await collect('forest_dust_06')).body.code, 'STORY_EVIDENCE_INVALID', '탐험 세션 밖');
  assert.equal((await viewOf(c)).objectives[0].collected, 5, '숲을 나갔다 와도 5/10');
  await c.req('room:create', { stageCode: 'forest' });
  await c.req('room:start');
  const fresh = await c.req<{ self: { x: number; y: number } }>('map:enter', { dir: 'down' });
  assert.deepEqual([fresh.self.x, fresh.self.y], [1600, 1200], '끝난 세션 뒤 새 입장은 시작 지점');
  for (let i = 6; i <= 10; i++) {
    const id = `forest_dust_${String(i).padStart(2, '0')}`;
    await goTo(c, id);
    // 9/10에서 재접속해도 이어서 모을 수 있다
    if (i === 10) assert.deepEqual([(await viewOf(c)).objects.map((o) => o.id), dustQty()], [['forest_dust_10'], 9]);
    const got = await collect(id); assert.equal(got.body.collected, i, JSON.stringify([id, got.status, got.body.code]));
  }
  const full = await viewOf(c);
  assert.deepEqual([full.objects.length, full.objectives[0], dustQty()], [0, { key: 'forest_glowing_dust', collected: 10, required: 10, active: true }, 10]);
  // 10개 뒤 재요청: 늘지 않는다
  assert.equal((await collect('forest_dust_10')).body.alreadyCollected, true);
  assert.equal(dustQty(), 10);

  const inv = await c.me<{ items: { itemCode: string; tabLabel: string; isLocked: boolean; isNew: boolean; quantity: number }[] }>('/inventory');
  assert.deepEqual(inv.body.items.map((i) => [i.itemCode, i.tabLabel, i.isNew, i.quantity]), [['glowing_yarn_dust', '스토리', true, 10]]);
  assert.equal((await c.me<{ cleared: boolean }>('/inventory/items/glowing_yarn_dust/seen', {})).body.cleared, true);
  assert.equal((await c.me<{ items: { isNew: boolean }[] }>('/inventory')).body.items[0].isNew, false);

  // 보풀이에게 전달: 멀리서는 거부, 곁에서 동시 2건 → 제작 한 번
  assert.equal((await trig(c, 'forest_bopuli_return')).body.code, 'STORY_EVIDENCE_INVALID');
  await goTo(c, 'forest_bopuli_return');
  const [a, b] = await Promise.all([trig(c, 'forest_bopuli_return'), trig(c, 'forest_bopuli_return')]);
  assert.deepEqual([a.body.play, b.body.play].filter(Boolean).length, 1, '제작 장면은 한 번');
  const after = await c.me<{ items: { itemCode: string; quantity: number }[] }>('/inventory');
  assert.deepEqual(after.body.items.map((i) => [i.itemCode, i.quantity]), [['yarn_tremor_compass', 1]], '실가루 10개 1회 소비, 나침판 1개');
  // 나침판 제작 후: 수집 요청은 효과 없음, 지도에 실가루 없음
  await goTo(c, 'forest_dust_01');
  assert.equal((await collect('forest_dust_01')).body.alreadyCollected, true);
  assert.equal(dustQty(), 0);
  let view = await viewOf(c);
  assert.deepEqual([view.objects.length, view.points.map((p) => p.id), view.gates.find((g) => g.id === 'gate_hidden_path')!.open], [0, ['forest_hidden_path'], false]);

  // 숨은 길 → 거대 매듭 전투 → 첫 매듭 각성
  const battles: string[] = [];
  // 숨은 길을 열기 전: 문 너머로 가는 길이 없고, 좌표를 끼운 입장 요청·큰 점프로도 넘어갈 수 없다
  await goTo(c, 'forest_hidden_path');
  assert.equal(await moveTo(c, pointOf('forest_giant_knot')), false, '닫힌 문 너머로는 길이 없다');
  const here = { x: serverPos(c).x, y: serverPos(c).y };
  const tampered = await c.req<{ self: { x: number; y: number }; corrected: boolean }>('map:enter', { x: pointOf('forest_giant_knot').x, y: pointOf('forest_giant_knot').y, dir: 'down' });
  assert.deepEqual([tampered.self.x, tampered.self.y, tampered.corrected], [here.x, here.y, false], '입장 요청의 좌표는 무시되고 서버 위치 그대로');
  const corrected = new Promise<{ x: number; y: number; reason: string }>((resolve) => c.socket.once('map:correct', resolve));
  c.socket.emit('map:move', { x: pointOf('forest_giant_knot').x, y: pointOf('forest_giant_knot').y, dir: 'down' });
  assert.deepEqual(await corrected, { ...here, reason: 'tunnel' }, '벽 너머로의 점프는 거절되고 마지막 승인 위치를 돌려준다');
  assert.equal((await trig(c, 'forest_giant_knot')).body.code, 'STORY_EVIDENCE_INVALID', '닫힌 문 너머의 지점은 발동되지 않는다');
  assert.deepEqual({ x: serverPos(c).x, y: serverPos(c).y }, here);
  const hp = await trig(c, 'forest_hidden_path');
  assert.deepEqual(hp.body.play, { segmentId: 'ch01.hidden_path', endAfter: 'ch01.hidden_path', untilEntry: 'ch01.hidden_path.002' });
  await runPlay(c, hp.body.play!, battles);
  view = await viewOf(c);
  assert.deepEqual([view.points.map((p) => p.id), view.gates.find((g) => g.id === 'gate_hidden_path')!.open], [['forest_giant_knot'], true]);
  await goTo(c, 'forest_giant_knot');
  const gk = await trig(c, 'forest_giant_knot');
  assert.deepEqual(gk.body.play, { segmentId: 'ch01.hidden_path', endAfter: 'ch01.first_knot_awaken', fromEntry: 'ch01.hidden_path.003' });
  await runPlay(c, gk.body.play!, battles);
  assert.deepEqual(battles, ['forest_giant_knot:win']);
  assert.equal((await trig(c, 'forest_giant_knot')).body.play, null, '끝난 전투 지점');

  const before = (await c.me<{ items: { itemCode: string; storyAction: { available: boolean } | null }[] }>('/inventory')).body.items.find((i) => i.itemCode === 'first_knot')!;
  assert.equal(before.storyAction?.available, true);
  assert.equal((await viewOf(c)).gates.find((g) => g.id === 'gate_root')!.open, false, '장착 전에는 실뿌리 문이 닫혀 있다');
  const eq = await c.me<{ alreadyCompleted: boolean; play: { segmentId: string } | null }>('/story/relics/first_knot/equip', {});
  assert.deepEqual([eq.body.alreadyCompleted, eq.body.play?.segmentId], [false, 'ch01.first_knot_equipped']);
  view = await viewOf(c);
  assert.deepEqual([view.points.map((p) => p.id), view.gates.find((g) => g.id === 'gate_root')!.open], [['forest_dansuring'], true]);
  c.close();

  // 재접속(새 세션·새 소켓): 장착 유지, 재요청은 현재 상태만
  const c3 = new Client('dev-test-live-1');
  await c3.identify();
  await c3.connect();
  const st = await c3.me<{ checkpoint: string; storyNubi: { slots: { slotKey: string; itemCode: string }[] } }>('/story');
  assert.equal(st.body.checkpoint, 'CH01_FIRST_KNOT_EQUIPPED');
  assert.deepEqual(st.body.storyNubi.slots.map((s) => [s.slotKey, s.itemCode]), [['story_1', 'first_knot']]);
  const again = await c3.me<{ alreadyCompleted: boolean; play: unknown }>('/story/relics/first_knot/equip', {});
  assert.deepEqual([again.body.alreadyCompleted, again.body.play], [true, null]);
  c3.close();
});

test('통합 4(회귀): 일반 야생 전투 — 야생 마커는 서버가 위치·상태를 내려 준다(입장·상태 방송·재접속에서 같은 ID), 누비 강제 참가·스토리 표식 없음, 포획 보상 지급, 포획 뒤 재조우 없음 / 일반 장비 슬롯 장착', async () => {
  type Wild = { index: number; characterCode: string; x: number; y: number; state: string; visible: boolean };
  const WILD0 = { index: 0, characterCode: 'bopuli', x: 520, y: 500 }; // 서버 DB(stage_wild_spawn)의 값 — 클라이언트 설정에는 좌표가 없다
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  await c.req('room:create', { stageCode: 'forest' });
  await c.req('room:start');
  const entered = await c.req<{ self: { x: number; y: number }; wilds: Wild[] }>('map:enter', { x: 500, y: 500, dir: 'down' });
  // 앞 시험의 탐험 세션이 유예 안에 이어진다 → 마지막 승인 위치(거대 매듭 앞). 요청에 넣은 좌표(500,500)는 무시된다
  assert.deepEqual([entered.self.x, entered.self.y], [pointOf('forest_giant_knot').x, pointOf('forest_giant_knot').y]);
  // 10-02 v6 §1: 입장 응답의 야생 마커 = 서버 마커 ID·종류·서버 좌표·상태·표시 여부. 서버에 없는 마커는 없다
  assert.deepEqual(entered.wilds, [{ ...WILD0, state: 'free', visible: true }]);
  assert.equal((await c.req('battle:start', { spawnIndex: 7 })).code, 'INVALID_SPAWN', '서버에 없는 마커 번호로는 조우할 수 없다');
  const changes: Wild[] = [];
  c.socket.on('wild:changed', (w: Wild) => changes.push(w));
  assert.equal((await c.req('battle:start', { spawnIndex: 0 })).code, 'TOO_FAR', '야생 터비에게서 멀다');
  assert.equal(await moveTo(c, { x: 500, y: 500 }), true);
  const start = await c.req<{ snapshot: Snap & { spawnIndex: number } }>('battle:start', { spawnIndex: 0 });
  assert.equal(start.ok, true);
  assert.equal(start.snapshot.story, undefined, '일반 전투에는 스토리 표식 없음');
  assert.equal(start.snapshot.spawnIndex, 0, '전투도 같은 서버 마커 ID');
  await until(() => changes.length >= 1);
  assert.deepEqual(changes[0], { ...WILD0, state: 'engaged', visible: true }, '상태 방송도 같은 ID·서버 좌표');
  // 전투 중 재접속: 접속 인증 응답의 야생 마커가 같은 ID·같은 상태(engaged)이고, 진행 중 전투도 같은 마커를 가리킨다
  c.close();
  const hello = await c.connect() as unknown as { inMap: boolean; wilds: Wild[]; battle: { battleId: string; spawnIndex: number } | null };
  assert.deepEqual([hello.inMap, hello.wilds, hello.battle?.battleId, hello.battle?.spawnIndex], [true, [{ ...WILD0, state: 'engaged', visible: true }], start.snapshot.battleId, 0]);
  c.socket.on('wild:changed', (w: Wild) => changes.push(w));
  const nubiId = String(db.rows('turby_instance', { owner_player_id: pid(c) })[0].id);
  const party = await c.req<{ snapshot: Snap }>('battle:party', { battleId: start.snapshot.battleId, turbyIds: [] });
  assert.equal(party.ok, false, '일반 전투는 빈 파티 거부(누비 자동 편성 없음)');
  const party2 = await c.req<{ snapshot: Snap }>('battle:party', { battleId: start.snapshot.battleId, turbyIds: [nubiId] });
  assert.equal(party2.ok, true);
  const { snap, ended } = await playToEnd(c, party2.snapshot);
  assert.equal(snap.outcome, 'win');
  const mine = ended!.rewards.find((r) => r.playerId === c.playerId)!;
  assert.deepEqual([mine.rewardStatus, mine.capturedTurby?.characterCode], ['granted', 'bopuli'], '포획 보상 유지');
  // 포획 뒤: 같은 마커는 보이지 않게 되고(visible=false) 다시 조우할 수 없다. 맵에 다시 들어와도 같다
  await until(() => changes.some((w) => w.state === 'captured'));
  assert.deepEqual(changes.at(-1), { ...WILD0, state: 'captured', visible: false });
  assert.equal((await c.req('battle:start', { spawnIndex: 0 })).code, 'WILD_GONE', '전투 뒤 같은 마커 재조우 방지');
  const again = await c.req<{ wilds: Wild[] }>('map:enter', { dir: 'down' });
  assert.deepEqual(again.wilds, [{ ...WILD0, state: 'captured', visible: false }]);

  const needle = db.rows('item_definition', { code: 'knit_needle' })[0];
  db.seed('player_item', { player_id: pid(c), item_definition_id: needle.id, quantity: 1 });
  const eq = await c.me<{ equipment: { slotKey: string; itemCode: string }[] }>(`/turby/${nubiId}/equip`, { itemCode: 'knit_needle' });
  assert.deepEqual(eq.body.equipment.map((e) => [e.slotKey, e.itemCode]).sort(), [['story_1', 'first_knot'], ['weapon', 'knit_needle']], '일반 슬롯과 이야기 슬롯 공존');
  const inv = await c.me<{ items: { itemCode: string; tabLabel: string; isLocked: boolean }[] }>('/inventory');
  assert.deepEqual(inv.body.items.find((i) => i.itemCode === 'knit_needle'), { ...inv.body.items.find((i) => i.itemCode === 'knit_needle'), tabLabel: '장비', isLocked: false }, '일반 아이템은 스토리 잠금이 아님');
  c.close();
});

test('통합 5(감사): 잘못된 ID는 400, 이야기 슬롯은 일반 해제 거부, 남의 터비·다른 플레이어 세션은 403, 세션 없는 /me 요청은 401', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  const nubiId = String(db.rows('turby_instance', { owner_player_id: pid(c), is_story_companion: true })[0].id);
  // 숫자가 아닌 ID: 서버 오류(500)가 아니라 400 INVALID_ID
  for (const path of ['/turby/abc/equip', '/turby/1e3/unequip', '/turby/%20/bag', '/turby/-1/shelf']) {
    const r = await c.me<{ code: string }>(path, { itemCode: 'knit_needle', slotKey: 'weapon', slotIndex: 0 });
    assert.deepEqual([r.status, r.body.code], [400, 'INVALID_ID'], path);
  }
  // 이야기 슬롯은 일반 해제·장착 경로로 바꿀 수 없다
  const un = await c.me<{ code: string }>(`/turby/${nubiId}/unequip`, { slotKey: 'story_1' });
  assert.deepEqual([un.status, un.body.code], [400, 'STORY_SLOT_RESERVED']);
  assert.equal(db.rows('turby_equipment', { turby_instance_id: BigInt(nubiId), slot_key: 'story_1' }).length, 1, '이야기 유물은 그대로');
  const relic = await c.me<{ code: string }>(`/turby/${nubiId}/equip`, { itemCode: 'first_knot' });
  assert.equal(relic.status, 400, '유물은 일반 장착 경로로 장착할 수 없음');

  // 다른 플레이어: 남의 터비 조작 403, URL에 남의 번호를 넣은 구 경로도 403
  const other = new Client('dev-test-live-2');
  await other.identify();
  const theirs = await other.me<{ code: string }>(`/turby/${nubiId}/equip`, { itemCode: 'knit_needle' });
  assert.deepEqual([theirs.status, theirs.body.code], [403, 'NOT_YOUR_TURBY']);
  const legacy = await fetch(`${base}/player/${c.playerId}/turby/${nubiId}/bag`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': other.token }, body: '{}' });
  assert.deepEqual([legacy.status, ((await legacy.json()) as { code: string }).code], [403, 'SESSION_PLAYER_MISMATCH']);
  const badLegacy = await fetch(`${base}/player/abc/turby`, { headers: { 'X-Turby-Session': '' } });
  assert.equal(badLegacy.status, 400, '구 경로의 잘못된 플레이어 번호도 400');
  // 세션 없이 /me: 401
  const anon = await fetch(`${base}/player/me/inventory`);
  assert.deepEqual([anon.status, ((await anon.json()) as { code: string }).code], [401, 'SESSION_REQUIRED']);
  // 서버 전용 이벤트와 체크포인트 직접 쓰기 경로 없음
  const ev = await other.me<{ code: string }>('/story/events/forest_giant_knot_defeated/complete', {});
  assert.deepEqual([ev.status, ev.body.code], [403, 'STORY_EVENT_SERVER_ONLY']);
  const cp = await fetch(`${base}/player/me/story/checkpoint`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turby-Session': other.token }, body: JSON.stringify({ checkpoint: 'CH01_COMPLETE' }) });
  assert.equal(cp.status, 404, '체크포인트를 직접 쓰는 경로는 없다');
});
