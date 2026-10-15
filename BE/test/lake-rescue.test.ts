// 10-13 C2-3: 물풀 미로 구조 — 젖은 실밥이 수호 전투, 구조 사건·집계·안전 물길·CH02_MAZE_CLEARED, 덫, 재접속, 플레이어별 독립.
// 실제 RoomsService·BattleService·StoryService + 메모리 Prisma(story-battle.test.ts와 같은 방식). 지역 데이터는 실제 lake.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService, type StageStoryData } from '../src/turby/story/story-content.service';
import { SessionService } from '../src/turby/session.service';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleSnapshotDto } from '../src/turby/battle/battle-types';
import { collisionOf, solidsFor, lockedZonesFor, checkMove } from '../src/turby/rooms/stage-collision';
import { parseStageWater, newWaterState, resolveWater, speedFactor } from '../src/turby/rooms/stage-water';
import { STORY_TRIGGERS } from '../src/turby/story/story-data';

const P = 1n;
const Q = 2n;
const content0 = new StoryContentService();
const LAKE = content0.stage('lake') as StageStoryData;
const C = collisionOf(LAKE, 3200, 2400, 'lake');
const WATER = parseStageWater(LAKE, C, 'lake')!;
const pointOf = (id: string) => LAKE.points.find((p) => p.id === id)!;
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};
const CH01 = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const SETTLED = [...CH01, 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened'];
const RESCUED = (k: string) => `lake_trapped_mulduri_${k}_rescued`;

// stats: 스타터 누비 대역(기본은 시험 시드 일반 등급). 약한 값은 "기본 공격을 이해하면 2~3회" 확인용
function setup(opts: { events?: string[]; checkpoint?: string; grade?: { atk: number; def: number; ap: number; hp: number } } = {}) {
  const db = new FakeDb();
  const g = opts.grade ?? { atk: 30, def: 6, ap: 4, hp: 200 };
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: g.atk, base_defense: g.def, base_action_power: g.ap, base_hp: g.hp });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  for (const [id, dev] of [[P, 'dev-rescue-one'], [Q, 'dev-rescue-two']] as const) {
    db.seed('player', { id, device_uuid: dev, nickname: `하늘${id}` });
    const nubi = db.seed('turby_instance', { owner_player_id: id, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
    db.seed('player_story_progress', { player_id: id, checkpoint: opts.checkpoint ?? 'CH02_SETTLEMENT_MET', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: 1 });
    for (const e of opts.events ?? SETTLED) db.seed('player_story_event', { player_id: id, event_id: e });
  }
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d), number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content0);
  const story = new StoryService(db.client(), rooms, settings as never, content0 as never, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content0 as never);
  battles.onModuleInit();
  return { db, rooms, story, battles, settings, access, session };
}
type Env = ReturnType<typeof setup>;
const who = (p: bigint) => p.toString();
const dev = (p: bigint) => (p === P ? 'dev-rescue-one' : 'dev-rescue-two');

async function enterLake(s: Env, p: bigint = P) {
  await s.rooms.identify(`sock-${p}`, dev(p));
  await s.rooms.createRoom(who(p), 'lake');
  s.rooms.startRoom(who(p));
  return s.rooms.enterMap(who(p), 'down');
}
function standAt(s: Env, pointId: string, p: bigint = P, dx = 0) {
  const pt = pointOf(pointId);
  Object.assign(s.rooms.roomOf(who(p))!.members[0], { x: pt.x + dx, y: pt.y });
}
const eventsOf = (s: Env, p: bigint = P) => s.db.rows('player_story_event', { player_id: p }).map((r) => r.event_id as string);
const count = (s: Env, id: string, p: bigint = P) => eventsOf(s, p).filter((e) => e === id).length;
const checkpoint = (s: Env, p: bigint = P) => (s.db.rows('player_story_progress', { player_id: p })[0] as { checkpoint: string }).checkpoint;

async function code(pr: Promise<unknown>): Promise<string> {
  try {
    await pr;
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return 'NO_ERROR';
}

let actionSeq = 0;
// 기본 공격을 이해한 플레이어: 인접하면 공격, 아니면 가장 가까운 적 쪽으로 이동. 서버 행동 API만 쓴다.
async function fight(s: Env, p: bigint, snap: BattleSnapshotDto, maxActions = 80): Promise<{ snapshot: BattleSnapshotDto; attacks: number; moves: number; rounds: number }> {
  let cur = (await s.battles.party(who(p), snap.battleId, [])).snapshot;
  let attacks = 0;
  let moves = 0;
  for (let i = 0; i < maxActions && cur.phase !== 'resolved'; i++) {
    if (cur.phase !== 'player_subturn') break;
    const me = cur.units.find((u) => u.side === 'party' && !u.stunned)!;
    const foes = cur.units.filter((u) => u.side === 'wild' && !u.stunned);
    const near = [...foes].sort((a, b) => Math.abs(a.col - me.col) + Math.abs(a.row - me.row) - (Math.abs(b.col - me.col) + Math.abs(b.row - me.row)))[0];
    const d = Math.abs(near.col - me.col) + Math.abs(near.row - me.row);
    const base = { battleId: cur.battleId, actionId: `a${++actionSeq}`, expectedVersion: cur.version };
    if (me.ap < 1) {
      cur = (await s.battles.action(who(p), { ...base, type: 'end' })).snapshot;
    } else if (d === 1) {
      cur = (await s.battles.action(who(p), { ...base, type: 'attack', unitId: me.unitId, targetUnitId: near.unitId })).snapshot;
      attacks++;
    } else {
      // 인접 칸(가로 우선)까지 가능한 만큼 이동
      const dir = Math.sign(near.col - me.col) || 0;
      const wantCol = near.col - dir; // 적 바로 앞 칸
      const stepCol = me.col + Math.sign(wantCol - me.col) * Math.min(me.ap, Math.abs(wantCol - me.col));
      const remaining = me.ap - Math.abs(stepCol - me.col);
      const stepRow = me.row + Math.sign(near.row - me.row) * Math.min(Math.max(0, remaining), Math.abs(near.row - me.row));
      cur = (await s.battles.action(who(p), { ...base, type: 'move', unitId: me.unitId, targetCol: stepCol, targetRow: stepRow })).snapshot;
      moves++;
    }
  }
  return { snapshot: cur, attacks, moves, rounds: cur.round };
}

async function winGuard(s: Env, k: string, p: bigint = P) {
  standAt(s, `lake_rescue_${k}`, p);
  const snap = await s.battles.startStory(who(p), `lake_guard_${k}`);
  const r = await fight(s, p, snap);
  assert.equal(r.snapshot.outcome, 'win', `${k} 승리`);
  return r;
}

// ---------- 배치·에셋 계약 ----------

test('배치: 구조 지점·적·덫·안전 물길 지점·내부 문이 지도 안이고 벽·깊은 물과 겹치지 않으며 서로 흩어져 있다', () => {
  const pts = ['a', 'b', 'c'].map((k) => pointOf(`lake_rescue_${k}`));
  const solids = solidsFor(C, new Set(SETTLED));
  const deep = WATER.areas.filter((w) => w.kind === 'deep');
  const bodyIn = (r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }, pad: number) => p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
  const overlays = LAKE.render!.overlays!;
  const marks = [
    ...[...pts, pointOf('lake_safe_route')].map((p) => ({ id: p.id, x: p.x, y: p.y })),
    ...overlays.filter((o) => ['black-thread-trap', 'wet-stitchling-idle'].includes(o.assetKey)).map((o) => ({ id: o.id, x: o.x, y: o.y })),
  ];
  assert.equal(marks.length, 4 + 3 + 4, '지점 4 + 덫 3 + 수호 적 4(A1·B1·C2)');
  for (const m of marks) {
    assert.ok(m.x >= 60 && m.y >= 60 && m.x <= 3200 - 60 && m.y <= 2400 - 60, `${m.id} 지도 안`);
    assert.equal(solids.some((r) => bodyIn(r, m, 12)), false, `${m.id}: 벽·닫힌 문과 겹침`);
    assert.equal(deep.some((r) => bodyIn(r, m, 36)), false, `${m.id}: 깊은 물과 겹침`);
  }
  // 흩어짐: 세 구조 지점 사이 거리 300px 이상, 640×360 화면 하나에는 두 곳 이상 들어가지 않는다(가로 640 안에 최대 하나)
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 300, `${pts[i].id}-${pts[j].id}`);
  // 세 곳이 640×360 화면 하나에 함께 들어가지 않는다(바깥 상자가 가로 640 또는 세로 360을 넘는다). 1280×720은 홀 너비(1230px) 때문에 보장할 수 없다
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 640 || Math.max(...ys) - Math.min(...ys) > 360, '세 지점이 640×360 한 화면에 모두 들어간다');
  // 위치 원칙(10-14 C2-7B, 최종 배경의 길 기준): A = 약한 물살 뒤 첫 마른 발판 근처, B = 깊은 물 연못 쪽 길, C = 갈래길 끝(문 앞 안전 물길 지점과 멀리)
  const weak = WATER.currents.find((f) => f.id === 'current_weak_1')!;
  const dry1 = WATER.anchors.find((a) => a.id === 'anchor_dry_1')!;
  assert.ok(pts[0].x > weak.x + weak.width && Math.hypot(pts[0].x - dry1.x, pts[0].y - dry1.y) <= 300, 'A');
  const poolS = deep.find((d) => d.id === 'deep_pool_south')!;
  assert.ok(Math.hypot(pts[1].x - (poolS.x + poolS.width / 2), pts[1].y - (poolS.y + poolS.height / 2)) <= 400, 'B: 깊은 물 옆');
  assert.ok(Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y) >= 400 && Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y) >= 400, 'C: 갈래길 끝');
  // 내부 안전 물길 문: 새 ID, 열림 조건 lake_safe_route_opened, 닫힘·열림 키
  const gateData = LAKE.layout!.gates.find((g) => g.id === 'gate_lake_safe_route')!;
  assert.deepEqual([gateData.openEvent, gateData.closedAssetKey, gateData.openAssetKey], ['lake_safe_route_opened', 'reed-gate-closed', 'reed-gate-open']);
  assert.equal(C.gates.find((g) => g.id === 'gate_reed_maze')!.openEvent, 'lake_wave_drum_awakened', '입구 문은 그대로');
});

test('덫·젖은 실밥이 표시 계약: 덫 92~128×62~86px(구조 대상 위치, 물살 오버레이보다 위), 적 96~112px, 구조 뒤 사라짐(hiddenAfter)', () => {
  const overlays = LAKE.render!.overlays!;
  const order = overlays.map((o) => o.id);
  for (const k of ['a', 'b', 'c']) {
    const trap = overlays.find((o) => o.id === `overlay_trap_${k}`)!;
    assert.ok(trap.width >= 92 && trap.width <= 128 && trap.height >= 62 && trap.height <= 86, `덫 ${trap.width}×${trap.height}`);
    assert.equal(trap.hiddenAfter, RESCUED(k));
    assert.equal(trap.layer ?? 'overlay', 'overlay', '플레이어·이야기 지점보다 아래');
    for (const f of overlays.filter((o) => o.assetKey === 'current-flow')) assert.ok(order.indexOf(trap.id) > order.indexOf(f.id), '같은 층에서 물살 오버레이보다 뒤(위)');
    const guards = overlays.filter((o) => o.id.startsWith(`overlay_guard_${k}`));
    assert.equal(guards.length, k === 'c' ? 2 : 1);
    for (const g of guards) {
      assert.ok(g.width >= 96 && g.width <= 112 && g.height >= 96 && g.height <= 112);
      assert.equal(g.hiddenAfter, RESCUED(k));
    }
  }
  // 구조 대상(물들이)은 기존 텍스처 turby-muldeuli
  for (const k of ['a', 'b', 'c']) assert.equal(LAKE.storyPoints!.find((p) => p.id === `lake_rescue_${k}`)!.assetKey, 'turby-muldeuli');
});

// ---------- 젖은 속박·전투 ----------

test('수호 전투 정의: 적은 지점마다 정해진 수(A1·B1·C2), 젖은 속박만 건다, 포획·보상·부위·지형 규칙 없음', () => {
  for (const [k, n] of [['a', 1], ['b', 1], ['c', 2]] as const) {
    const def = content0.battle(`lake_guard_${k}`)!;
    assert.equal(def.units.length, n);
    for (const u of def.units) {
      assert.equal(u.side, 'wild');
      assert.equal(u.characterCode, 'wet_stitchling');
      assert.deepEqual(u.onHit, { kind: 'wet_bind', turns: 1, movePenalty: 1 });
      assert.equal(u.partOf ?? null, null);
    }
    assert.equal(def.terrainRules, undefined);
    assert.equal(def.cornerEscape, false);
  }
});

test('스타터 누비만으로 전투 완료: A·B는 기본 공격 2~3회, C도 A·B의 1.5배를 크게 넘지 않는다(약한 능력치에서도)', async () => {
  const weak = { atk: 5, def: 1, ap: 3, hp: 30 };
  const attacks: Record<string, number> = {};
  const actions: Record<string, number> = {};
  for (const k of ['a', 'b', 'c']) {
    const s = setup({ grade: weak });
    await enterLake(s);
    const r = await winGuard(s, k);
    attacks[k] = r.attacks;
    actions[k] = r.attacks + r.moves;
    assert.deepEqual(r.snapshot.units.filter((u) => u.side === 'party').every((u) => !u.stunned), true, `${k}: 누비가 쓰러지지 않고 이김`);
  }
  assert.ok(attacks.a >= 2 && attacks.a <= 3, `A 공격 ${attacks.a}회`);
  assert.ok(attacks.b >= 2 && attacks.b <= 3, `B 공격 ${attacks.b}회`);
  assert.ok(actions.c <= Math.ceil(Math.max(actions.a, actions.b) * 1.5) + 1, `C 행동 ${actions.c} / A ${actions.a} B ${actions.b}`);
  // 기본 시험 시드(일반 등급)는 한 번에 쓰러뜨린다
  const strong = setup();
  await enterLake(strong);
  assert.equal((await winGuard(strong, 'a')).attacks, 1);
});

// ---------- 구조 서버 검증 ----------

test('전투 시작은 그 지점 반경 안에서만(다른 지점·먼 곳 거부), 선행 사건 없이는 시작할 수 없다', async () => {
  const s = setup();
  await enterLake(s);
  standAt(s, 'lake_rescue_a');
  assert.equal(await code(s.battles.startStory(who(P), 'lake_guard_b')), 'STORY_EVIDENCE_INVALID', '다른 지점의 전투를 A에서 시작');
  standAt(s, 'lake_rescue_a', P, 400);
  assert.equal(await code(s.battles.startStory(who(P), 'lake_guard_a')), 'STORY_EVIDENCE_INVALID', '반경 밖');
  standAt(s, 'lake_rescue_a');
  const snap = await s.battles.startStory(who(P), 'lake_guard_a');
  assert.equal(snap.phase, 'party_select');
  assert.equal(snap.story?.encounterKey, 'lake_guard_a');
  const early = setup({ events: [...CH01, 'lake_entry_seen', 'lake_mulduri_met'], checkpoint: 'CH02_STARTED' }); // 물결북 전
  await enterLake(early);
  standAt(early, 'lake_rescue_a');
  assert.equal(await code(early.battles.startStory(who(P), 'lake_guard_a')), 'STORY_ENCOUNTER_NOT_AVAILABLE');
});

test('승리 전 구조 거부: 구조 사건은 서버 전용(REST 거부)이고, 지거나 나가면 기록되지 않는다', async () => {
  const s = setup();
  await enterLake(s);
  for (const k of ['a', 'b', 'c']) assert.equal(await code(s.story.completeEvent(P, RESCUED(k))), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await code(s.story.completeEvent(P, 'lake_trapped_turbies_rescued')), 'STORY_EVENT_SERVER_ONLY');
  standAt(s, 'lake_rescue_a');
  const snap = await s.battles.startStory(who(P), 'lake_guard_a');
  await s.battles.party(who(P), snap.battleId, []);
  // 전투 도중 위조: 구조 트리거 요청은 이벤트를 만들지 않고 전투 키만 열어 준다
  const trig = await s.story.trigger(P, 'lake_rescue_a');
  assert.deepEqual([trig.play?.segmentId, count(s, RESCUED('a'))], ['ch02.rescue_a', 0]);
  // 나가기(이탈) = 취소: 구조 없음
  const left = await s.battles.leave(who(P), snap.battleId);
  assert.notEqual(left.snapshot.outcome, 'win');
  assert.equal(count(s, RESCUED('a')), 0);
  assert.equal(checkpoint(s), 'CH02_SETTLEMENT_MET');
  // 다시 도전하면 새 전투(재생성된 적)
  const again = await s.battles.startStory(who(P), 'lake_guard_a');
  const started = (await s.battles.party(who(P), again.battleId, [])).snapshot;
  assert.equal(started.units.filter((u) => u.side === 'wild' && !u.stunned).length, 1);
});

test('승리: 그 지점의 구조 사건만 1회 기록(중복 결과·재요청에도 한 번), 보상·체크포인트 변화 없음, 다른 지점의 승리는 증거가 아니다', async () => {
  const s = setup();
  await enterLake(s);
  const items = s.db.rows('player_item', { player_id: P }).length;
  const r = await winGuard(s, 'a');
  assert.deepEqual(r.snapshot.outcome, 'win');
  assert.equal(count(s, RESCUED('a')), 1);
  assert.equal(count(s, RESCUED('b')), 0);
  assert.equal(count(s, RESCUED('c')), 0);
  assert.equal(count(s, 'lake_trapped_turbies_rescued'), 0);
  assert.equal(checkpoint(s), 'CH02_SETTLEMENT_MET');
  assert.equal(s.db.rows('player_item', { player_id: P }).length, items, '아이템·통화 지급 없음');
  // 결과 재요청·정산 재시도
  for (let i = 0; i < 3; i++) await s.battles.snapshot(who(P), r.snapshot.battleId);
  await s.battles.activeSnapshotOf(who(P));
  assert.equal(count(s, RESCUED('a')), 1);
  // 이미 구한 지점의 전투는 다시 시작할 수 없다(적 재생성 없음)
  assert.equal(await code(s.battles.startStory(who(P), 'lake_guard_a')), 'STORY_ENCOUNTER_DONE');
  // 구조 트리거 지점은 닫힌다
  const trig = await s.story.trigger(P, 'lake_rescue_a');
  assert.equal(trig.play, null);
});

test('집계: 세 구조가 모두 끝나면 lake_trapped_turbies_rescued 1회, 그 전에는 없다. 안전 물길 지점은 그때 열린다', async () => {
  const s = setup();
  await enterLake(s);
  await winGuard(s, 'a');
  await winGuard(s, 'b');
  assert.equal(count(s, 'lake_trapped_turbies_rescued'), 0);
  const mid = await s.story.stageData(P, 'lake');
  assert.deepEqual(mid.points.map((p) => p.id), ['lake_rescue_c'], '일부 구조: 완료한 지점·덫·적은 사라지고 남은 지점만');
  assert.equal(mid.goal?.text, '붙잡힌 물들이를 구하자. 2/3');
  const overlayIds = mid.render.overlays.map((o) => o.id);
  assert.equal(overlayIds.some((id) => id.includes('trap_a') || id.includes('guard_a') || id.includes('trap_b') || id.includes('guard_b')), false);
  assert.equal(overlayIds.includes('overlay_trap_c'), true);
  await winGuard(s, 'c');
  assert.equal(count(s, 'lake_trapped_turbies_rescued'), 1);
  assert.equal(checkpoint(s), 'CH02_SETTLEMENT_MET', '장면 전에는 체크포인트 그대로');
  assert.equal(count(s, 'lake_safe_route_opened'), 0);
  const done = await s.story.stageData(P, 'lake');
  assert.deepEqual(done.points.map((p) => p.id), ['lake_safe_route']);
  assert.equal(done.goal?.text, '열린 물길의 기계음을 확인하자.');
  assert.equal(done.gates.find((g) => g.id === 'gate_lake_safe_route')!.open, false);
});

test('동시 구조 요청: 같은 승리 정산·구조 사건 요청이 겹쳐도 한 번만 기록된다(집계 포함)', async () => {
  const s = setup({ events: [...SETTLED, RESCUED('a'), RESCUED('b')] });
  await enterLake(s);
  standAt(s, 'lake_rescue_c');
  // 서버 정산 경로(completeEvent via server)를 동시에 여러 번
  const results = await Promise.all([1, 2, 3, 4].map(() => s.story.completeEvent(P, RESCUED('c'), 'server')));
  assert.equal(results.filter((r) => !r.alreadyCompleted).length, 1);
  assert.equal(count(s, RESCUED('c')), 1);
  assert.equal(count(s, 'lake_trapped_turbies_rescued'), 1);
});

// ---------- 정본 장면·안전 물길·체크포인트 ----------

test('안전 물길: 세 구조 전 장면 요청 거부, 구조 뒤 장면은 지점에서만, 장면 완료 요청이 사건 기록과 CH02_MAZE_CLEARED를 한 번에 처리한다', async () => {
  const s = setup({ events: [...SETTLED, RESCUED('a'), RESCUED('b')] });
  await enterLake(s);
  standAt(s, 'lake_safe_route');
  assert.notEqual(await code(s.story.trigger(P, 'lake_safe_route')), 'NO_ERROR', '구조 전에는 장면 시작 불가');
  assert.notEqual(await code(s.story.completeEvent(P, 'lake_safe_route_opened')), 'NO_ERROR', '구조 전 직접 완료 요청 거부');
  assert.equal(checkpoint(s), 'CH02_SETTLEMENT_MET');
  await s.story.completeEvent(P, RESCUED('c'), 'server');
  // 장면 시작: 지점 반경 밖은 거부
  standAt(s, 'lake_safe_route', P, 500);
  assert.equal(await code(s.story.trigger(P, 'lake_safe_route')), 'STORY_EVIDENCE_INVALID');
  standAt(s, 'lake_safe_route');
  const scene = await s.story.trigger(P, 'lake_safe_route');
  assert.deepEqual(scene.play, { segmentId: 'ch02.maze', endAfter: 'ch02.maze' });
  // 장면을 끝까지 보기 전(새로고침): 체크포인트·사건 그대로, 같은 지점에서 처음부터 다시 볼 수 있다
  assert.deepEqual([checkpoint(s), count(s, 'lake_safe_route_opened')], ['CH02_SETTLEMENT_MET', 0]);
  const replay = await s.story.trigger(P, 'lake_safe_route');
  assert.equal(replay.play?.segmentId, 'ch02.maze');
  // 지점에서 멀리서의 완료 요청은 거부
  standAt(s, 'lake_safe_route', P, 500);
  assert.equal(await code(s.story.completeEvent(P, 'lake_safe_route_opened')), 'STORY_EVIDENCE_INVALID');
  // 장면 완료: 사건 + CH02_MAZE_CLEARED 한 트랜잭션
  standAt(s, 'lake_safe_route');
  const res = await s.story.completeEvent(P, 'lake_safe_route_opened');
  assert.equal(res.story.checkpoint, 'CH02_MAZE_CLEARED');
  assert.deepEqual([checkpoint(s), count(s, 'lake_safe_route_opened')], ['CH02_MAZE_CLEARED', 1]);
  // 멱등: 재요청·동시 요청
  const again = await Promise.all([1, 2, 3].map(() => s.story.completeEvent(P, 'lake_safe_route_opened')));
  assert.equal(again.every((r) => r.alreadyCompleted), true);
  assert.equal(count(s, 'lake_safe_route_opened'), 1);
  // 재접속: 내부 문 열림·구조 지점 없음·다음 목표
  const view = await s.story.stageData(P, 'lake');
  assert.equal(view.gates.find((g) => g.id === 'gate_lake_safe_route')!.open, true);
  assert.deepEqual(view.points.map((p) => p.id), ['lake_nubi_crisis'], '다음 지점: 누비 위기 지점(C2-4)');
  assert.equal(view.goal?.text, '누비의 상태를 살피며 염색 샘으로 가자.');
  assert.equal(view.render.overlays.some((o) => ['black-thread-trap', 'wet-stitchling-idle'].includes(o.assetKey)), false, '덫·적이 남지 않는다');
});

test('장면 구간 데이터 연결: 세 구조 지점·안전 물길 지점의 재생 범위와 완료 사건이 서버 정의와 같다', () => {
  for (const k of ['a', 'b', 'c']) {
    const t = STORY_TRIGGERS.find((x) => x.id === `lake_rescue_${k}`)!;
    assert.equal(t.encounterKey, `lake_guard_${k}`);
    assert.deepEqual(t.unless, [RESCUED(k)]);
    assert.deepEqual(t.play, { segmentId: `ch02.rescue_${k}`, endAfter: `ch02.rescue_${k}` });
  }
  const route = STORY_TRIGGERS.find((x) => x.id === 'lake_safe_route')!;
  assert.deepEqual([route.requires, route.unless, route.play], [['lake_trapped_turbies_rescued'], ['lake_safe_route_opened'], { segmentId: 'ch02.maze', endAfter: 'ch02.maze' }]);
});

test('내부 안전 물길 문: 열림 전에는 통과할 수 없고 사건 뒤에는 C2-4 시작 지점까지 통행 가능, 입구 문과 별개', () => {
  const gate = C.gates.find((g) => g.id === 'gate_lake_safe_route')!;
  const before = new Set([...SETTLED, RESCUED('a'), RESCUED('b'), RESCUED('c'), 'lake_trapped_turbies_rescued']);
  const after = new Set([...before, 'lake_safe_route_opened']);
  const from = { x: gate.x - 40, y: gate.y + gate.height / 2 }; // 문은 동서 길목을 가로지르는 세로 막대(서쪽이 미로 쪽)
  const exit = WATER.anchors.find((a) => a.id === 'anchor_maze_exit')!;
  assert.equal(checkMove(C, solidsFor(C, before), lockedZonesFor(C, before), from, exit), 'tunnel');
  assert.equal(checkMove(C, solidsFor(C, after), lockedZonesFor(C, after), from, exit), 'ok');
  assert.equal(solidsFor(C, before).some((r) => (r as { id?: string }).id === 'gate_reed_maze'), false, '입구 문은 이미 열려 있다');
});

// ---------- 월드 덫 ----------

test('덫: 반경 안으로 들어서면 1,200ms 속도 50% 제한(서버 상한), 물살을 맞으면 그 1회 밀림만 +32px 뒤 속박 해제, 중첩 없음', () => {
  const trap = WATER.traps.find((t) => t.id === 'trap_a')!;
  const solids = solidsFor(C, new Set(SETTLED));
  const st = newWaterState();
  const ev = new Set(SETTLED);
  const out = resolveWater(WATER, C, solids, [], ev, st, { x: trap.x, y: trap.y }, 10_000);
  assert.equal(out.kind, 'trapped');
  assert.equal(speedFactor(st, 10_100), 0.5);
  assert.equal(speedFactor(st, 11_200), 1, '1,200ms 뒤 해제');
  // 같은 덫 안에서 계속 움직여도 다시 발동하지 않는다(중첩·갱신 없음)
  const again = resolveWater(WATER, C, solids, [], ev, st, { x: trap.x + 2, y: trap.y }, 10_300);
  assert.equal(again.kind, 'none');
  assert.equal(st.trapUntil, 11_200, '지속 시간 갱신 없음');
  // 묶인 채 물살: 약한 물살(64px)에 +32px, 그 뒤 해제
  const st2 = newWaterState();
  st2.trapUntil = 20_000 + 1200;
  st2.trapSlowFactor = 0.5;
  st2.trapExtraPush = 32;
  const weak = WATER.currents.find((f) => f.id === 'current_weak_1')!;
  const inField = { x: weak.x + 30, y: weak.y + 60 };
  const pushed = resolveWater(WATER, C, solids, [], ev, st2, inField, 20_000);
  assert.deepEqual([pushed.kind, pushed.kind === 'pushed' ? pushed.x - inField.x : -1, pushed.kind === 'pushed' ? pushed.trapBonus : -1], ['pushed', 96, 32]);
  assert.equal(speedFactor(st2, 20_100), 1, '밀림 적용 뒤 속박 해제');
  // 다음 밀림은 평소 거리(64px)
  const next = resolveWater(WATER, C, solids, [], ev, st2, { x: inField.x, y: inField.y }, 20_000 + weak.cooldownMs + 1);
  assert.equal(next.kind === 'pushed' ? next.x - inField.x : -1, 64);
  // 구조한 지점의 덫은 발동하지 않는다
  const st3 = newWaterState();
  const freed = new Set([...SETTLED, RESCUED('a')]);
  assert.equal(resolveWater(WATER, C, solids, [], freed, st3, { x: trap.x, y: trap.y }, 1000).kind, 'none');
});

test('덫 상태는 플레이어마다 독립이고 서버 이동 상한에 반영된다(rooms.move)', async () => {
  const s = setup();
  await enterLake(s, P);
  await enterLake(s, Q);
  const trap = WATER.traps.find((t) => t.id === 'trap_a')!;
  for (const p of [P, Q]) Object.assign(s.rooms.roomOf(who(p))!.members[0], { x: trap.x - 70, y: trap.y, lastMoveAt: 0 });
  let clock = Date.now() + 60_000;
  const r = s.rooms.move(who(P), trap.x, trap.y, 'right', (clock += 100)).result;
  assert.deepEqual([r.kind, r.kind === 'adjusted' ? r.reason : null], ['adjusted', 'trap']);
  const mP = s.rooms.roomOf(who(P))!.members[0];
  const mQ = s.rooms.roomOf(who(Q))!.members[0];
  assert.ok(mP.water.trapUntil > clock && mQ.water.trapUntil === 0, 'Q는 묶이지 않았다');
  // 묶인 동안 상한: 100ms에 (400*0.1 + 64)*0.5 = 52px를 넘는 이동은 거절
  const far = s.rooms.move(who(P), trap.x + 60, trap.y, 'right', (clock += 100)).result;
  assert.deepEqual([far.kind, far.kind === 'corrected' ? far.reason : null], ['corrected', 'speed']);
  // 같은 이동을 묶이지 않은 Q는 승인된다
  Object.assign(mQ, { x: trap.x - 200, y: trap.y - 180, lastMoveAt: clock - 100 });
  assert.equal(s.rooms.move(who(Q), trap.x - 140, trap.y - 180, 'right', clock).result.kind, 'ok');
});

// ---------- 재접속·다인 독립 ----------

test('재접속: 일부 구조 상태가 이벤트로 복원되고(구조 지점·덫·적·목표), 방을 새로 만들어도 이어진다', async () => {
  const s = setup({ events: [...SETTLED, RESCUED('b')] });
  await enterLake(s);
  const view = await s.story.stageData(P, 'lake');
  assert.deepEqual(view.points.map((p) => p.id).sort(), ['lake_rescue_a', 'lake_rescue_c']);
  assert.equal(view.goal?.text, '붙잡힌 물들이를 구하자. 1/3');
  assert.equal(view.render.overlays.some((o) => o.id === 'overlay_trap_b' || o.id === 'overlay_guard_b1'), false);
  s.rooms.leaveRoom(who(P));
  await enterLake(s);
  assert.deepEqual((await s.story.stageData(P, 'lake')).points.map((p) => p.id).sort(), ['lake_rescue_a', 'lake_rescue_c']);
  // 구조 사건이 기록된 뒤 방 안의 덫 판정도 바로 반영된다(noteStoryEvents)
  const trapB = WATER.traps.find((t) => t.id === 'trap_b')!;
  const m = s.rooms.roomOf(who(P))!.members[0];
  assert.equal(m.storyEvents.has(RESCUED('b')), true);
  assert.equal(resolveWater(WATER, C, solidsFor(C, m.storyEvents), [], m.storyEvents, newWaterState(), { x: trapB.x, y: trapB.y }, 5000).kind, 'none');
});

test('다인: 두 플레이어의 전투·구조·체크포인트가 섞이지 않는다', async () => {
  const s = setup();
  await enterLake(s, P);
  await enterLake(s, Q);
  await winGuard(s, 'a', P);
  assert.equal(count(s, RESCUED('a'), P), 1);
  assert.equal(count(s, RESCUED('a'), Q), 0);
  // Q는 같은 지점의 전투를 자기 전투로 따로 한다
  standAt(s, 'lake_rescue_a', Q);
  const snapQ = await s.battles.startStory(who(Q), 'lake_guard_a');
  const startedQ = (await s.battles.party(who(Q), snapQ.battleId, [])).snapshot;
  assert.equal(startedQ.units.filter((u) => u.side === 'wild' && !u.stunned).length, 1, 'P의 승리가 Q의 적을 지우지 않는다');
  assert.equal((await s.story.stageData(Q, 'lake')).points.length, 3);
  assert.equal((await s.story.stageData(P, 'lake')).points.length, 2);
  // Q가 끝까지 해서 장면을 완료해도 P의 체크포인트는 그대로
  await s.battles.leave(who(Q), snapQ.battleId);
  for (const k of ['a', 'b', 'c']) await s.story.completeEvent(Q, RESCUED(k), 'server');
  standAt(s, 'lake_safe_route', Q);
  await s.story.completeEvent(Q, 'lake_safe_route_opened');
  assert.deepEqual([checkpoint(s, P), checkpoint(s, Q)], ['CH02_SETTLEMENT_MET', 'CH02_MAZE_CLEARED']);
});
