// v4 §5 실제 프런트·서버 통합 경로 — 실제 NestJS 터비 앱(컨트롤러·소켓 게이트웨이·서비스)을 임의 포트에 띄우고,
// 프런트와 같은 방식(HTTP /player/me/* + X-Turby-Session, socket.io presence:hello·room·map·battle)으로 접속한다.
// DB만 테스트 격리 환경(FakeDb)으로 바꾼다. 1장 대화는 프런트의 실제 대화 진행기(dialogueRunner)로, 전투 판정은 프런트 battleView로 돌린다.
import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import { FakeDb } from './helpers/fake-prisma';
import { PrismaService } from '../src/turby/prisma.service';
import { PlayerService } from '../src/turby/player.service';
import { PlayerController } from '../src/turby/player.controller';
import { ShopService } from '../src/turby/shop.service';
import { EquipmentService } from '../src/turby/equipment.service';
import { ShopController } from '../src/turby/shop.controller';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { RoomsGateway } from '../src/turby/rooms/rooms.gateway';
import { SettingsService } from '../src/turby/rooms/settings.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { BattleGateway } from '../src/turby/battle/battle.gateway';
import { SessionService } from '../src/turby/session.service';
import { InventoryService } from '../src/turby/inventory.service';
import { MeController } from '../src/turby/me.controller';
import { StoryController } from '../src/turby/story/story.controller';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
// 프런트 실제 모듈(순수 — Phaser 없음). 프런트 패키지는 ES 모듈이라 네이티브 import()로 불러온다(ts-node가 require로 바꾸지 않게)
type Runner = typeof import('../../save-a-turby/src/story/dialogueRunner');
type View = typeof import('../../save-a-turby/src/battle/battleView');
const nativeImport = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>;
let runDialogue: Runner['runDialogue'];
let reachableCells: View['reachableCells'];

// 보존·유예 시간은 짧게(테스트가 끝난 뒤 남은 서버 타이머가 프로세스를 붙잡지 않게)
const SETTINGS: Record<string, unknown> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 5, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 1, 'battle.encounterRadiusPx': 200,
  'room.reconnectGraceMs': 1000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

const db = new FakeDb();
let app: INestApplication;
let base = '';

function seed() {
  for (const [k, v] of Object.entries(SETTINGS)) db.seed('game_setting', { setting_key: k, value_json: JSON.stringify(v) });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 2000, map_height: 2000 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 2000, map_height: 2000 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  db.seed('turby_grade', { id: 2, name: '약함', base_attack: 1, base_defense: 0, base_action_power: 1, base_hp: 1 });
  db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: 2, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 0, character_code: 'bopuli', x: 520, y: 500 });
  // M1 아이템 정의(2026-09-29_turby_story_m1_items.sql)와 일반 장비(2026-09-21_shop_equipment.sql) 값
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('item_definition', { code: 'yarn_tremor_compass', name: '실의 떨림을 찾는 나침판', category: 'mission' });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2 });
}

before(async () => {
  const { pathToFileURL } = await import('url');
  runDialogue = ((await nativeImport(pathToFileURL(join(__dirname, '../../save-a-turby/src/story/dialogueRunner.ts')).href)) as Runner).runDialogue;
  reachableCells = ((await nativeImport(pathToFileURL(join(__dirname, '../../save-a-turby/src/battle/battleView.ts')).href)) as View).reachableCells;
  seed();
  @Module({
    controllers: [MeController, StoryController, PlayerController, ShopController],
    providers: [
      { provide: PrismaService, useValue: db.client() },
      SettingsService, SessionService, PlayerService, ShopService, EquipmentService, InventoryService,
      RoomsService, RoomsGateway, BattleService, BattleGateway, StoryContentService, StageAccessService, StoryService,
    ],
  })
  class IntegrationModule {}
  app = await NestFactory.create(IntegrationModule, { logger: false });
  app.enableCors();
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
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

test('통합 2: 숲 진입 응답 story.play → 실제 대화 진행기 → 소켓 스토리 전투 → 결과 → 대화 복귀 → 보풀이 단서, 재진입은 거짓 진행 없음', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  assert.equal((await c.req('room:create', { stageCode: 'forest' })).ok, true);
  assert.equal((await c.req('room:start')).ok, true);
  const enter = await c.req<{ story: { play: { segmentId: string; endAfter: string } | null } }>('map:enter', { x: 500, y: 500, dir: 'down' });
  assert.deepEqual(enter.story.play, { segmentId: 'ch01.first_path', endAfter: 'ch01.bopul_clue' });

  const battles: string[] = [];
  const shownAfterBattle: string[] = [];
  await runDialogue(ch01, enter.story.play!.segmentId, {
    show: async (line) => {
      if (battles.length) shownAfterBattle.push(line.entry.dialogueId);
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
  }, { endAfter: enter.story.play!.endAfter, exact: true });

  assert.deepEqual(battles, ['forest_stitchling_ambush:win']);
  assert.ok(shownAfterBattle.length > 0, '전투 뒤 대화가 이어짐');
  const st = await c.me<{ checkpoint: string; delivery: { have: number; need: number } }>('/story');
  assert.equal(st.body.checkpoint, 'CH01_BOPUL_RESCUED');
  assert.deepEqual([st.body.delivery.have, st.body.delivery.need], [0, 10]);
  // 이긴 전투 재요청은 DONE, 숲 재진입은 재생 구간 없음(거짓 진행 없음)
  assert.equal((await c.req('battle:story:start', { encounterKey: 'forest_stitchling_ambush' })).code, 'STORY_ENCOUNTER_DONE');
  const again = await c.req<{ story: { play: unknown } }>('map:enter', { x: 500, y: 500, dir: 'down' });
  assert.equal(again.story.play, null);
  c.close();
});

test('통합 3: 인벤토리 실제 API(스토리 탭·잠금·개별 신규 해제), 보풀이 전달 트리거(동시 2건 → 1회 소비), 첫 매듭 장착 API와 재접속 유지', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  await c.req('room:create', { stageCode: 'forest' });
  await c.req('room:start');
  await c.req('map:enter', { x: 500, y: 500, dir: 'down' });
  // 픽스처: 실가루 10개(테스트 격리 DB)
  const dust = db.rows('item_definition', { code: 'glowing_yarn_dust' })[0];
  db.seed('player_item', { player_id: pid(c), item_definition_id: dust.id, quantity: 10, is_new: true, is_locked: true, last_acquired_at: new Date() });
  const inv = await c.me<{ items: { itemCode: string; tabLabel: string; isLocked: boolean; isNew: boolean; quantity: number }[] }>('/inventory');
  assert.deepEqual(inv.body.items.map((i) => [i.itemCode, i.tabLabel, i.isLocked, i.isNew, i.quantity]), [['glowing_yarn_dust', '스토리', true, true, 10]]);
  assert.equal((await c.me<{ cleared: boolean }>('/inventory/items/glowing_yarn_dust/seen', {})).body.cleared, true);
  assert.equal((await c.me<{ items: { isNew: boolean }[] }>('/inventory')).body.items[0].isNew, false);

  const [a, b] = await Promise.all([c.me<{ play: { segmentId: string } | null }>('/story/triggers/npc_bopuli', {}), c.me<{ play: unknown }>('/story/triggers/npc_bopuli', {})]);
  assert.deepEqual([a.body.play, b.body.play].filter(Boolean).length, 1, '제작 장면은 한 번');
  const after = await c.me<{ items: { itemCode: string; quantity: number }[] }>('/inventory');
  assert.deepEqual(after.body.items.map((i) => [i.itemCode, i.quantity]), [['yarn_tremor_compass', 1]], '실가루 10개 1회 소비, 나침판 1개');

  // 픽스처: 첫 매듭 각성 상태(좌표가 필요한 숨은 길·보스전은 실제 진행으로 위조하지 않음)
  for (const e of ['forest_giant_knot_defeated', 'forest_first_knot_awakened']) db.seed('player_story_event', { player_id: pid(c), event_id: e });
  const knot = db.rows('item_definition', { code: 'first_knot' })[0];
  db.seed('player_item', { player_id: pid(c), item_definition_id: knot.id, quantity: 1, is_new: true, is_locked: true, last_acquired_at: new Date() });
  const before = (await c.me<{ items: { itemCode: string; storyAction: { available: boolean } | null }[] }>('/inventory')).body.items.find((i) => i.itemCode === 'first_knot')!;
  assert.equal(before.storyAction?.available, true);
  const eq = await c.me<{ alreadyCompleted: boolean; play: { segmentId: string } | null }>('/story/relics/first_knot/equip', {});
  assert.deepEqual([eq.body.alreadyCompleted, eq.body.play?.segmentId], [false, 'ch01.first_knot_equipped']);
  c.close();

  // 재접속(새 세션·새 소켓): 장착 유지, 재요청은 현재 상태만
  const c2 = new Client('dev-test-live-1');
  await c2.identify();
  await c2.connect();
  const st = await c2.me<{ checkpoint: string; storyNubi: { slots: { slotKey: string; itemCode: string }[] } }>('/story');
  assert.equal(st.body.checkpoint, 'CH01_FIRST_KNOT_EQUIPPED');
  assert.deepEqual(st.body.storyNubi.slots.map((s) => [s.slotKey, s.itemCode]), [['story_1', 'first_knot']]);
  const again = await c2.me<{ alreadyCompleted: boolean; play: unknown }>('/story/relics/first_knot/equip', {});
  assert.deepEqual([again.body.alreadyCompleted, again.body.play], [true, null]);
  c2.close();
});

test('통합 4(회귀): 일반 야생 전투 — 누비 강제 참가·스토리 표식 없음, 포획 보상 지급 / 일반 장비 슬롯 장착', async () => {
  const c = new Client('dev-test-live-1');
  await c.identify();
  await c.connect();
  await c.req('room:create', { stageCode: 'forest' });
  await c.req('room:start');
  await c.req('map:enter', { x: 500, y: 500, dir: 'down' });
  const start = await c.req<{ snapshot: Snap }>('battle:start', { spawnIndex: 0 });
  assert.equal(start.ok, true);
  assert.equal(start.snapshot.story, undefined, '일반 전투에는 스토리 표식 없음');
  const nubiId = String(db.rows('turby_instance', { owner_player_id: pid(c) })[0].id);
  const party = await c.req<{ snapshot: Snap }>('battle:party', { battleId: start.snapshot.battleId, turbyIds: [] });
  assert.equal(party.ok, false, '일반 전투는 빈 파티 거부(누비 자동 편성 없음)');
  const party2 = await c.req<{ snapshot: Snap }>('battle:party', { battleId: start.snapshot.battleId, turbyIds: [nubiId] });
  assert.equal(party2.ok, true);
  const { snap, ended } = await playToEnd(c, party2.snapshot);
  assert.equal(snap.outcome, 'win');
  const mine = ended!.rewards.find((r) => r.playerId === c.playerId)!;
  assert.deepEqual([mine.rewardStatus, mine.capturedTurby?.characterCode], ['granted', 'bopuli'], '포획 보상 유지');

  const needle = db.rows('item_definition', { code: 'knit_needle' })[0];
  db.seed('player_item', { player_id: pid(c), item_definition_id: needle.id, quantity: 1 });
  const eq = await c.me<{ equipment: { slotKey: string; itemCode: string }[] }>(`/turby/${nubiId}/equip`, { itemCode: 'knit_needle' });
  assert.deepEqual(eq.body.equipment.map((e) => [e.slotKey, e.itemCode]).sort(), [['story_1', 'first_knot'], ['weapon', 'knit_needle']], '일반 슬롯과 이야기 슬롯 공존');
  const inv = await c.me<{ items: { itemCode: string; tabLabel: string; isLocked: boolean }[] }>('/inventory');
  assert.deepEqual(inv.body.items.find((i) => i.itemCode === 'knit_needle'), { ...inv.body.items.find((i) => i.itemCode === 'knit_needle'), tabLabel: '장비', isLocked: false }, '일반 아이템은 스토리 잠금이 아님');
  c.close();
});
