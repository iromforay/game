// 10-23 C4-1: 4장 냉장고 속 이동 규칙 — 서리 구역(이동 속도 0.7배)과 바늘 칸(서버 시각 주기, 내려찍는 동안 칸 안이면 안전 앵커로 복귀).
// 실제 지역 데이터(story-data/stages/ice.json)를 쓴다. 시험 시계는 now 인자로 직접 넘긴다. 판정은 모두 서버(stage-water.ts) — 요청의 값은 좌표뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { SessionService } from '../src/turby/session.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { collisionOf } from '../src/turby/rooms/stage-collision';
import { SAFE_RETURN_PROTECT_MS, needlePhase, parseStageWater, speedFactor, newWaterState } from '../src/turby/rooms/stage-water';

const content = new StoryContentService();
const ICE = content.stage('ice') as StageStoryData;
const C = collisionOf(ICE, 3200, 2400, 'ice');
const WATER = parseStageWater(ICE, C, 'ice')!;
const needle = (id: string) => WATER.needles.find((n) => n.id === id)!;
const anchor = (id: string) => WATER.anchors.find((a) => a.id === id)!;
const FROST = WATER.frost[0];

const RESCUED = ['fridge_unlocked', 'fridge_entry_seen', 'fridge_ganeuri_freed'];
const NUMBERS: Record<string, number> = { 'room.reconnectGraceMs': 1000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64, 'battle.encounterRadiusPx': 120 };

function setup(events: string[] = RESCUED) {
  const db = new FakeDb();
  db.seed('player', { id: 1n, device_uuid: 'dev-fridge-one', nickname: '하늘' });
  const nubi = db.rows('turby_character', {}).find((r) => r.code === 'nubi') ?? db.seed('turby_character', { code: 'nubi', name: '누비' });
  const inst = db.seed('turby_instance', { owner_player_id: 1n, character_id: nubi.id, acquired_via: 'starter', is_story_companion: true });
  db.seed('player_story_progress', { player_id: 1n, checkpoint: 'CH04_GANEURI_RESCUED', nubi_growth_stage: 3, story_nubi_turby_instance_id: inst.id });
  for (const e of events) db.seed('player_story_event', { player_id: 1n, event_id: e });
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d), number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  // 바늘 주기에 맞춰 놓을 수 있게 3,000ms 배수에서 시작하는 시험 시계
  let clock = Math.ceil((Date.now() + 60_000) / 3000) * 3000;
  const member = () => rooms.roomOf('1')!.members[0];
  return {
    rooms,
    member,
    at: () => ({ x: Math.round(member().x), y: Math.round(member().y) }),
    async join() {
      await rooms.identify('sock-1', 'dev-fridge-one');
      await rooms.createRoom('1', 'ice');
      rooms.startRoom('1');
      return rooms.enterMap('1', 'down');
    },
    place(x: number, y: number) {
      member().x = x;
      member().y = y;
    },
    // 다음 이동이 일어날 서버 시각을 바늘 주기의 phaseMs 지점으로 맞춘다(이동 간격 ms만큼 앞에서 시작)
    alignTo(phaseMs: number, ms = 150) {
      const target = Math.ceil((clock + ms) / 3000) * 3000 + phaseMs;
      clock = target - ms;
    },
    move(x: number, y: number, ms = 150) {
      clock += ms;
      return rooms.move('1', x, y, 'right', clock).result;
    },
    now: () => clock,
  };
}

// ---------- 규칙 계약 ----------

test('바늘 주기: 예고 1,000ms → 내려찍기 500ms → 쉼 1,500ms, 칸마다 offsetMs만큼 어긋난다(1 → 2 → 3 순서로 0.6초씩 늦게)', () => {
  const n1 = needle('needle_1');
  assert.deepEqual([0, 999, 1000, 1499, 1500, 2999].map((t) => needlePhase(n1, t)), ['warn', 'warn', 'strike', 'strike', 'idle', 'idle']);
  const strikeStart = (id: string) => [...Array(3000).keys()].find((t) => needlePhase(needle(id), t) === 'strike' && needlePhase(needle(id), t - 1) !== 'strike')!;
  assert.deepEqual(['needle_1', 'needle_2', 'needle_3'].map(strikeStart), [1000, 1600, 2200]);
});

test('검증: 예고 없는 바늘·쉼 없는 주기·앵커 없는 바늘·바늘 칸 위 앵커·범위 밖 서리 배율은 서버가 받아들이지 않는다', () => {
  const base = { frostZones: ICE.frostZones, needleFields: ICE.needleFields, safeAnchors: ICE.safeAnchors };
  const bad = (patch: Record<string, unknown>, msg: RegExp) => assert.throws(() => parseStageWater({ ...base, ...patch }, C, 'ice'), msg);
  const n = { id: 'n', x: 1900, y: 1460, width: 120, height: 200, periodMs: 3000, warnMs: 1000, strikeMs: 500 };
  bad({ needleFields: [{ ...n, warnMs: 0 }] }, /warnMs는 300 이상/);
  bad({ needleFields: [{ ...n, warnMs: 2000, strikeMs: 1000 }] }, /쉬는 틈/);
  bad({ needleFields: [n], safeAnchors: [] }, /safeAnchors가 없다/);
  bad({ needleFields: [n], safeAnchors: [{ id: 'a', x: 1960, y: 1560, radius: 60 }] }, /바늘 칸과 겹친다/);
  bad({ frostZones: [{ id: 'f', x: 700, y: 1780, width: 700, height: 240, slowFactor: 0.1 }] }, /slowFactor는 0.3~1/);
});

test('서리 구역: 마지막 승인 위치가 서리 안이면 속도 상한이 0.7배(같은 거리가 밖에서는 통과, 안에서는 거절), 덫 배율과는 곱으로 합쳐진다', async () => {
  const s = setup();
  await s.join();
  // 150ms 동안 상한 = 400 × 0.15 + 64 = 124px, 서리 안 = 86.8px
  s.place(500, 1940); // 성에 통로, 서리 구역(700~1400) 서쪽 밖
  assert.equal(s.move(600, 1925).kind, 'ok', '서리 밖 100px는 통과');
  s.place(900, 1900); // 서리 구역 안
  const r = s.move(1000, 1900);
  assert.equal(r.kind, 'corrected');
  assert.equal((r as { reason: string }).reason, 'speed', '서리 안 100px는 0.7배 상한을 넘는다');
  assert.equal(s.move(980, 1900).kind, 'ok', '서리 안 80px는 통과');
  assert.equal(speedFactor({ ...newWaterState(), trapUntil: 10_000, trapSlowFactor: 0.5 }, 0, WATER, { x: FROST.x + 10, y: FROST.y + 10 }), 0.35);
});

test('바늘: 내려찍는 동안 칸 안으로 들어가면 마지막 안전 앵커로 돌아가고(사유 needle·칸 ID), 예고·쉼 동안에는 그대로 지나간다. 복귀 직후 1,500ms는 다시 맞지 않는다', async () => {
  const s = setup();
  await s.join();
  const west = anchor('anchor_needle_west');
  const n1 = needle('needle_1');
  const inside = { x: n1.x + n1.width / 2, y: 1560 };
  // 앵커를 밟아 기억시킨 뒤 칸 바로 앞으로
  s.place(west.x, west.y);
  assert.equal(s.move(west.x + 60, west.y).kind, 'ok');
  s.place(n1.x - 30, 1560);
  // 예고 중: 그대로 들어간다
  s.alignTo(200);
  assert.equal(s.move(inside.x, inside.y).kind, 'ok', '예고 동안에는 지나간다');
  // 내려찍기 중: 앵커로 복귀
  s.place(n1.x - 30, 1560);
  s.alignTo(1100);
  const hit = s.move(inside.x, inside.y) as { kind: string; reason: string; currentFieldId: string; x: number; y: number };
  assert.deepEqual([hit.kind, hit.reason, hit.currentFieldId], ['adjusted', 'needle', 'needle_1']);
  assert.deepEqual(s.at(), { x: west.x, y: west.y }, '서쪽 앵커로 돌아갔다');
  // 복귀 보호: 같은 내려찍기 안에서 다시 들어가도 맞지 않는다
  s.place(n1.x - 30, 1560);
  assert.equal(s.move(inside.x, inside.y, 100).kind, 'ok', `복귀 직후 ${SAFE_RETURN_PROTECT_MS}ms 보호`);
  // 쉼 동안에도 지나간다
  s.place(n1.x - 30, 1560);
  s.alignTo(2000, 2000);
  assert.equal(s.move(inside.x, inside.y, 2000).kind, 'ok', '쉬는 동안에는 지나간다');
});

test('바늘 칸 사이의 틈에 서 있으면 양쪽 칸이 내려찍어도 맞지 않는다(가장자리를 스친 정도는 봐준다)', async () => {
  const s = setup();
  await s.join();
  const n1 = needle('needle_1');
  const n2 = needle('needle_2');
  const gapX = (n1.x + n1.width + n2.x) / 2;
  s.place(gapX - 10, 1560);
  s.alignTo(1100); // needle_1 내려찍기
  assert.equal(s.move(gapX, 1560).kind, 'ok');
  s.alignTo(1700); // needle_2 내려찍기
  assert.equal(s.move(gapX, 1560, 600).kind, 'ok');
});
