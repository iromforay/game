// 10-16 C3-3: 3장 매복·보스 전투의 서버 정산(사건·아이템·체크포인트), 오래된 솜심 1회 지급, 누비에게 장착(성장 3·story_3·4장 개방), 재접속·멱등.
// 실제 RoomsService·BattleService·StoryService·InventoryService·EquipmentService + 메모리 Prisma(lake-reward.test.ts·lake-chapter.test.ts와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleSnapshotDto } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { SessionService } from '../src/turby/session.service';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { InventoryService } from '../src/turby/inventory.service';
import { EquipmentService } from '../src/turby/equipment.service';
import { EVENT_BY_ID, STORY_TRIGGERS } from '../src/turby/story/story-data';
import { resumeOf } from '../src/turby/story/story-rules';

const content = new StoryContentService();
const P = 1n;
const CH02_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked', 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_granted', 'lake_boss_aftermath_seen', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_chapter_complete_seen'];
const ELDER_MET = [...CH02_DONE, 'underfloor_entry_seen', 'underfloor_elder_met'];
const ITEMS_DONE = [...ELDER_MET, 'underfloor_glove_inspected', 'underfloor_blanket_inspected', 'underfloor_doll_inspected', 'underfloor_items_inspected'];
const TRAIL = [...ITEMS_DONE, 'underfloor_ambush_won', 'underfloor_memory_trail_found'];
const FRAGMENT = [...TRAIL, 'underfloor_memory_fragment_seen'];
const DEFEATED = [...FRAGMENT, 'underfloor_boss_defeated', 'underfloor_cotton_core_granted'];
const AFTERMATH = [...DEFEATED, 'underfloor_boss_aftermath_seen'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setup(opts: { events?: string[]; checkpoint?: string; growth?: number; story1?: boolean; story2?: boolean; owned?: boolean; withItemDef?: boolean } = {}) {
  const db = new FakeDb();
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 3, stage_code: 'underground', clear_character_code: 'pokshini', title: '3장 — 마루바닥 밑', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 4, stage_code: 'ice', clear_character_code: 'ganeuri', title: '4장 — 얼음', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  if (opts.withItemDef !== false) db.seed('item_definition', { code: 'old_cotton_core', name: '오래된 솜심', category: 'relic', story_slot: 'story_3', max_stack: 1 });
  db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2 });
  db.seed('player', { id: P, device_uuid: 'dev-ug-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH03_MEMORY_FRAGMENT_SEEN', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: opts.growth ?? 2 });
  for (const e of opts.events ?? FRAGMENT) db.seed('player_story_event', { player_id: P, event_id: e });
  const def = (code: string) => (db.rows('item_definition', { code })[0] as { id: number }).id;
  if (opts.story1 !== false) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_1', item_definition_id: def('first_knot') });
  if (opts.story2 !== false) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_2', item_definition_id: def('water_dye_yarn') });
  if (opts.owned) db.seed('player_item', { player_id: P, item_definition_id: def('old_cotton_core'), quantity: 1, is_new: false, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date() });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d), number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  const story = new StoryService(db.client(), rooms, settings as never, content as never, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content as never);
  battles.onModuleInit();
  const inventory = new InventoryService(db.client(), settings as never);
  const equipment = new EquipmentService(db.client());
  return { db, rooms, story, battles, inventory, equipment, nubiId: nubi.id as bigint };
}
type Env = ReturnType<typeof setup>;
const point = (id: string) => content.stage('underground')!.points.find((p) => p.id === id)!;
async function enter(s: Env, pointId: string) {
  await s.rooms.identify('sock-1', 'dev-ug-one');
  await s.rooms.createRoom('1', 'underground');
  s.rooms.startRoom('1');
  await s.rooms.enterMap('1', 'down');
  Object.assign(s.rooms.roomOf('1')!.members[0], { x: point(pointId).x, y: point(pointId).y });
}
async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    if (e instanceof HttpException) return (e.getResponse() as { code: string }).code;
    throw e;
  }
  return 'NO_ERROR';
}
const events = (s: Env) => s.db.rows('player_story_event', { player_id: P }).map((r) => r.event_id as string);
const count = (s: Env, id: string) => events(s).filter((e) => e === id).length;
const progress = (s: Env) => s.db.rows('player_story_progress', { player_id: P })[0] as { checkpoint: string; nubi_growth_stage: number };
const slot = (s: Env, key: string) => s.db.rows('turby_equipment', { turby_instance_id: s.nubiId, slot_key: key });
const coreRows = (s: Env) => {
  const def = s.db.rows('item_definition', { code: 'old_cotton_core' })[0] as { id: number } | undefined;
  return def ? (s.db.rows('player_item', { player_id: P, item_definition_id: def.id }) as { quantity: number; is_new: boolean; is_locked: boolean; first_acquired_at: Date | null }[]) : [];
};

// ---------- 전투를 실제 경로로 이기는 자동 플레이 ----------
const dist = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
// 대상 옆 빈 칸으로 가는 최단 경로의 첫 걸음(유닛·막힌 칸을 피한다). 이미 옆이면 null
function stepToward(cur: BattleSnapshotDto, from: { col: number; row: number }, target: { col: number; row: number }): { col: number; row: number } | null {
  if (dist(from, target) === 1) return null;
  const occupied = new Set(cur.units.filter((x) => !x.stunned && !x.inactive).map((x) => `${x.col},${x.row}`));
  const blocked = new Set(cur.blocked ?? []);
  const seen = new Map<string, { col: number; row: number } | null>([[`${from.col},${from.row}`, null]]);
  let frontier = [{ col: from.col, row: from.row, first: null as { col: number; row: number } | null }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const col = c.col + dc;
        const row = c.row + dr;
        const k = `${col},${row}`;
        if (col < 0 || row < 0 || col >= cur.grid.cols || row >= cur.grid.rows || seen.has(k) || occupied.has(k) || blocked.has(k)) continue;
        const first = c.first ?? { col, row };
        if (dist({ col, row }, target) === 1) return first;
        seen.set(k, first);
        next.push({ col, row, first });
      }
    }
    frontier = next;
  }
  return null;
}
async function autoWin(s: Env, key: string, pick: (cur: BattleSnapshotDto) => string | undefined, maxActions = 400) {
  const snap = await s.battles.startStory('1', key);
  let cur = (await s.battles.party('1', snap.battleId, [])).snapshot;
  let seq = 0;
  const act = async (body: object) => {
    cur = (await s.battles.action('1', { battleId: cur.battleId, actionId: `w${++seq}`, expectedVersion: cur.version, ...body } as never)).snapshot;
  };
  for (let i = 0; i < maxActions && cur.phase !== 'resolved'; i++) {
    const me = cur.units.find((x) => x.side === 'party' && !x.stunned)!;
    const tid = pick(cur);
    const tgt = cur.units.find((x) => x.unitId === tid);
    if (!tgt || me.ap < 1) {
      await act({ type: 'end' });
      continue;
    }
    if (dist(me, tgt) === 1) await act({ type: 'attack', unitId: me.unitId, targetUnitId: tgt.unitId });
    else {
      const st = stepToward(cur, me, tgt);
      if (!st) await act({ type: 'end' });
      else await act({ type: 'move', unitId: me.unitId, targetCol: st.col, targetRow: st.row });
    }
  }
  assert.equal(cur.outcome, 'win', '자동 플레이로 이긴다');
  return cur;
}
const nearest = (cur: BattleSnapshotDto, ids: string[]) => {
  const me = cur.units.find((x) => x.side === 'party')!;
  return cur.units.filter((x) => ids.includes(x.unitId) && !x.stunned).sort((a, b) => dist(me, a) - dist(me, b))[0]?.unitId;
};
const winAmbush = (s: Env) => autoWin(s, 'underfloor_ambush', (cur) => nearest(cur, ['pressed_doll_a', 'pressed_doll_b', 'pressed_doll_c', 'small_spool']));
const winBoss = (s: Env) =>
  autoWin(s, 'underfloor_boss_memory_spool', (cur) => {
    const hinted = cur.units.find((x) => x.hinted && !x.stunned);
    return hinted ? hinted.unitId : 'memory_spool';
  });

// ---------- 매복 ----------

test('매복 승리 정산: 사건 둘(승리·실패 자국 길)과 CH03_MEMORY_TRAIL_FOUND가 한 번 기록되고 보상·성장은 없다. 다시 싸울 수 없다', async () => {
  const s = setup({ checkpoint: 'CH03_ELDER_MET', events: ITEMS_DONE });
  await enter(s, 'underfloor_ambush');
  const items = s.db.rows('player_item', { player_id: P }).length;
  const cur = await winAmbush(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  assert.equal(count(s, 'underfloor_ambush_won'), 1);
  assert.equal(count(s, 'underfloor_memory_trail_found'), 1);
  assert.equal(progress(s).checkpoint, 'CH03_MEMORY_TRAIL_FOUND');
  assert.equal(progress(s).nubi_growth_stage, 2);
  assert.equal(s.db.rows('player_item', { player_id: P }).length, items, '아이템 없음');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'underfloor_ambush')), 'NO_ERROR');
  // 동시 재정산도 한 번
  await Promise.all(Array.from({ length: 4 }, () => s.story.completeEvent(P, 'underfloor_ambush_won', 'server')));
  assert.equal(count(s, 'underfloor_ambush_won'), 1);
});

test('매복 조건: 조사 3곳을 모두 하기 전에는 시작할 수 없고, 직접 요청으로 사건을 만들 수 없다', async () => {
  const s = setup({ checkpoint: 'CH03_ELDER_MET', events: ELDER_MET });
  await enter(s, 'underfloor_ambush');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'underfloor_ambush')), 'NO_ERROR');
  assert.equal(await codeOf(s.story.completeEvent(P, 'underfloor_ambush_won')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.story.completeEvent(P, 'underfloor_memory_trail_found')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(progress(s).checkpoint, 'CH03_ELDER_MET');
});

// ---------- 보스 ----------

test('보스 승리 정산: 사건 둘·오래된 솜심 1개·CH03_BOSS_DEFEATED가 한 번 기록되고 성장·장착·4장은 그대로다', async () => {
  const s = setup();
  await enter(s, 'underfloor_boss_entrance');
  assert.equal(coreRows(s).length, 0);
  const cur = await winBoss(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  assert.equal(count(s, 'underfloor_boss_defeated'), 1);
  assert.equal(count(s, 'underfloor_cotton_core_granted'), 1);
  assert.equal(progress(s).checkpoint, 'CH03_BOSS_DEFEATED');
  const rows = coreRows(s);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].quantity, rows[0].is_new, rows[0].is_locked], [1, true, true]);
  assert.ok(rows[0].first_acquired_at);
  assert.equal(progress(s).nubi_growth_stage, 2, '성장 단계 유지');
  assert.equal(slot(s, 'story_3').length, 0, 'story_3 미장착');
  assert.equal(events(s).some((e) => /cotton_core_equipped|fridge_unlocked/.test(e)), false, '4장은 열리지 않는다');
  assert.equal(EVENT_BY_ID.get('underfloor_boss_defeated')!.to, 'CH03_BOSS_DEFEATED');
  assert.deepEqual(EVENT_BY_ID.get('underfloor_boss_defeated')!.alsoComplete, ['underfloor_cotton_core_granted']);
});

test('보스 정산 거부와 멱등: 직접 요청·기억 조각 전·동시 정산·재요청에도 솜심은 하나다', async () => {
  const s = setup();
  assert.equal(await codeOf(s.story.completeEvent(P, 'underfloor_boss_defeated')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.story.completeEvent(P, 'underfloor_cotton_core_granted')), 'STORY_EVENT_SERVER_ONLY');
  const early = setup({ checkpoint: 'CH03_MEMORY_TRAIL_FOUND', events: TRAIL });
  assert.notEqual(await codeOf(early.story.completeEvent(P, 'underfloor_boss_defeated', 'server')), 'NO_ERROR');
  assert.deepEqual([count(early, 'underfloor_boss_defeated'), coreRows(early).length, progress(early).checkpoint], [0, 0, 'CH03_MEMORY_TRAIL_FOUND']);

  await enter(s, 'underfloor_boss_entrance');
  await winBoss(s);
  const dump = () => JSON.stringify([events(s).sort(), coreRows(s), progress(s)], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const before = dump();
  const res = await Promise.all(Array.from({ length: 5 }, () => s.story.completeEvent(P, 'underfloor_boss_defeated', 'server')));
  assert.equal(res.every((r) => r.alreadyCompleted), true);
  assert.equal(dump(), before);
  assert.equal(coreRows(s)[0].quantity, 1);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'underfloor_boss_memory_spool')), 'NO_ERROR', '다시 싸울 수 없다');
});

test('아이템 정의 누락: 오래된 솜심 정의가 없으면 정산 전체가 롤백되고, 정의가 생기면 다시 시도로 한 번 정산된다', async () => {
  const s = setup({ withItemDef: false });
  await enter(s, 'underfloor_boss_entrance');
  await s.battles.startStory('1', 'underfloor_boss_memory_spool');
  assert.equal(await codeOf(s.story.completeEvent(P, 'underfloor_boss_defeated', 'server')), 'STORY_DATA_MISSING');
  assert.deepEqual([count(s, 'underfloor_boss_defeated'), count(s, 'underfloor_cotton_core_granted'), progress(s).checkpoint, coreRows(s).length], [0, 0, 'CH03_MEMORY_FRAGMENT_SEEN', 0]);
  s.db.seed('item_definition', { code: 'old_cotton_core', name: '오래된 솜심', category: 'relic', story_slot: 'story_3', max_stack: 1 });
  await s.story.completeEvent(P, 'underfloor_boss_defeated', 'server');
  assert.deepEqual([count(s, 'underfloor_boss_defeated'), count(s, 'underfloor_cotton_core_granted'), progress(s).checkpoint, coreRows(s)[0].quantity], [1, 1, 'CH03_BOSS_DEFEATED', 1]);
});

// ---------- 승리 장면·장착·장 완료 ----------

test('승리 장면: 정산 전에는 완료를 기록할 수 없고, 끝까지 본 뒤에만 한 번 기록되며 상태·아이템은 바뀌지 않는다', async () => {
  const early = setup();
  assert.notEqual(await codeOf(early.story.completeEvent(P, 'underfloor_boss_aftermath_seen')), 'NO_ERROR');
  const s = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: DEFEATED, owned: true });
  const first = await s.story.completeEvent(P, 'underfloor_boss_aftermath_seen');
  assert.equal(first.alreadyCompleted, false);
  assert.equal((await s.story.completeEvent(P, 'underfloor_boss_aftermath_seen')).alreadyCompleted, true);
  assert.deepEqual([count(s, 'underfloor_boss_aftermath_seen'), progress(s).checkpoint, progress(s).nubi_growth_stage, coreRows(s)[0].quantity], [1, 'CH03_BOSS_DEFEATED', 2, 1]);
});

const state = (s: Env) => ({ cp: progress(s).checkpoint, growth: progress(s).nubi_growth_stage, slot3: slot(s, 'story_3').length, events: events(s).filter((e) => ['underfloor_cotton_core_equipped', 'fridge_unlocked'].includes(e)).length });
const untouched = { cp: 'CH03_BOSS_DEFEATED', growth: 2, slot3: 0, events: 0 };

test('장착 조건: 하나라도 빠지면 거부되고 슬롯·성장·사건·체크포인트가 그대로다', async () => {
  const cases: [string, Env][] = [
    ['체크포인트', setup({ checkpoint: 'CH03_MEMORY_FRAGMENT_SEEN', events: AFTERMATH, owned: true })],
    ['장면 완료 사건', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: DEFEATED, owned: true })],
    ['정산 사건', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH.filter((e) => e !== 'underfloor_boss_defeated'), owned: true })],
    ['지급 사건', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH.filter((e) => e !== 'underfloor_cotton_core_granted'), owned: true })],
    ['보유', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH })],
    ['첫 매듭 장착', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true, story1: false })],
    ['물빛 염색실 장착', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true, story2: false })],
    ['성장 단계 1', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true, growth: 1 })],
    ['성장 단계 3', setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true, growth: 3 })],
  ];
  for (const [name, s] of cases) {
    const before = JSON.stringify(state(s));
    assert.notEqual(await codeOf(s.story.equipRelic(P, 'old_cotton_core')), 'NO_ERROR', name);
    assert.equal(JSON.stringify(state(s)), before, `${name}: 상태 불변`);
  }
});

test('장착 성공: story_3 장착 + 성장 2→3 + 사건 둘 + CH03_COMPLETE가 한 번에 기록되고 솜심은 남는다. 재요청·동시 요청은 한 번', async () => {
  const s = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  assert.deepEqual(state(s), untouched);
  const results = await Promise.all([1, 2, 3].map(() => s.story.equipRelic(P, 'old_cotton_core').then((r) => r, (e: unknown) => e)));
  const ok = results.filter((r) => !(r instanceof Error));
  assert.ok(ok.length >= 1);
  assert.deepEqual(state(s), { cp: 'CH03_COMPLETE', growth: 3, slot3: 1, events: 2 });
  assert.equal(count(s, 'underfloor_cotton_core_equipped'), 1);
  assert.equal(count(s, 'fridge_unlocked'), 1);
  assert.equal(coreRows(s)[0].quantity, 1, '보유 레코드는 지우지 않는다');
  assert.equal(EVENT_BY_ID.get('underfloor_cotton_core_equipped')!.to, 'CH03_COMPLETE');
  // 재요청: 이미 장착 — 거부되거나 같은 결과이며 상태는 그대로
  await codeOf(s.story.equipRelic(P, 'old_cotton_core'));
  assert.deepEqual(state(s), { cp: 'CH03_COMPLETE', growth: 3, slot3: 1, events: 2 });
  // 장 완료 장면
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch03.chapter_complete');
  assert.equal((await s.story.completeEvent(P, 'underfloor_chapter_complete_seen')).alreadyCompleted, false);
  assert.equal((await s.story.completeEvent(P, 'underfloor_chapter_complete_seen')).alreadyCompleted, true);
  assert.equal(count(s, 'underfloor_chapter_complete_seen'), 1);
  assert.equal((await s.story.getState(P)).resume.segmentId, null);
  assert.deepEqual(state(s), { cp: 'CH03_COMPLETE', growth: 3, slot3: 1, events: 2 }, '장면 완료는 상태를 바꾸지 않는다');
  // 4장(냉장고 속) 개방
  const stages = (await s.story.getState(P)).stages;
  assert.equal(stages.find((x) => x.stageCode === 'ice')!.canEnter, true);
});

test('재접속·지점: 정산 뒤 장면 미완료는 승리 장면 처음부터, 보스 입장 지점은 정산 뒤 닫히고 목표가 바뀐다', async () => {
  assert.equal(resumeOf({ checkpoint: 'CH03_MEMORY_FRAGMENT_SEEN', events: new Set(FRAGMENT), objectives: new Map(), growthStage: 2 }).segmentId, null);
  const before = setup();
  assert.equal((await before.story.stageData(P, 'underground')).points.some((p) => p.id === 'underfloor_boss_entrance'), true);
  assert.equal((await before.story.stageData(P, 'underground')).goal?.text, '넓은 빈 공간으로 가자.');

  const mid = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: DEFEATED, owned: true });
  assert.equal((await mid.story.getState(P)).resume.segmentId, 'ch03.boss_victory');
  const view = await mid.story.stageData(P, 'underground');
  assert.equal(view.points.some((p) => p.id === 'underfloor_boss_entrance'), false);
  assert.equal(view.goal, null);

  const t = STORY_TRIGGERS.find((x) => x.id === 'underfloor_boss_entrance')!;
  assert.deepEqual(t.unless, ['underfloor_boss_defeated']);
  assert.equal(t.play === 'resume' ? '' : (t.play as { endAfter?: string }).endAfter, 'ch03.boss_victory');

  const done = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  assert.equal((await done.story.getState(P)).resume.segmentId, null);
  assert.equal((await done.story.stageData(P, 'underground')).goal?.text, '오래된 솜심을 누비에게 가져가자.');

  const complete = setup({ checkpoint: 'CH03_COMPLETE', events: [...AFTERMATH, 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'underfloor_chapter_complete_seen'], growth: 3, owned: true });
  assert.equal((await complete.story.stageData(P, 'underground')).goal?.text, '은빛 실이 가리키는 북쪽으로 가자.');
});

test('인벤토리: 오래된 솜심은 이야기 유물(story_3)로 잠겨 있고, 장면을 끝까지 보기 전에는 장착 버튼이 비활성이다', async () => {
  const s = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: DEFEATED, owned: true });
  const it = (await s.inventory.list(P)).items.find((i) => i.itemCode === 'old_cotton_core')!;
  assert.ok(it);
  assert.deepEqual([it.name, it.tab, it.category, it.quantity, it.maxStack, it.isLocked, it.storySlot], ['오래된 솜심', 'story', 'relic', 1, 1, true, 'story_3']);
  assert.deepEqual(it.permissions, { sell: false, discard: false, trade: false, consume: false, unequip: false });
  assert.deepEqual([it.storyAction?.kind, it.storyAction?.available], ['equip_story_nubi', false]);
  assert.equal(await codeOf(s.equipment.equip('1', String(s.nubiId), 'old_cotton_core')), 'NOT_EQUIPPABLE');
  assert.equal(await codeOf(s.equipment.unequip('1', String(s.nubiId), 'story_3')), 'STORY_SLOT_RESERVED');
  const ready = setup({ checkpoint: 'CH03_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  const it2 = (await ready.inventory.list(P)).items.find((i) => i.itemCode === 'old_cotton_core')!;
  assert.equal(it2.storyAction?.available, true);
});
