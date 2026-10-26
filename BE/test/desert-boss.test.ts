// 10-26 C5-3: 5장 능선 앞 전투·황금 재단인형의 서버 정산(사건·아이템·체크포인트), 금빛 마감실 1회 지급, 가위 장면, 누비에게 장착(성장 5·story_5·종장 개방), 재접속·멱등.
// 실제 RoomsService·BattleService·StoryService·InventoryService·EquipmentService + 메모리 Prisma(fridge-boss.test.ts와 같은 방식).
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
import { EVENT_BY_ID, STORY_TRIGGERS, SEGMENT_CHAIN_END, SEGMENT_AFTER_EVENT } from '../src/turby/story/story-data';
import { resumeOf } from '../src/turby/story/story-rules';

const content = new StoryContentService();
const P = 1n;
const CH04_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked', 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_granted', 'lake_boss_aftermath_seen', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_chapter_complete_seen', 'underfloor_entry_seen', 'underfloor_boss_defeated', 'underfloor_cotton_core_granted', 'underfloor_boss_aftermath_seen', 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'underfloor_chapter_complete_seen', 'fridge_entry_seen', 'fridge_ganeuri_freed', 'fridge_frozen_guard_won', 'fridge_storage_seen', 'fridge_confession_seen', 'fridge_boss_defeated', 'fridge_microfiber_granted', 'fridge_boss_aftermath_seen', 'fridge_microfiber_equipped', 'desert_unlocked', 'fridge_chapter_complete_seen'];
const JOINED = [...CH04_DONE, 'desert_entry_seen', 'desert_clues_seen'];
const CROSSED = [...JOINED, 'desert_scorched_won', 'desert_ridge_pad', 'desert_ridge_scent', 'desert_ridge_thread', 'desert_ridge_crossed'];
const DEFEATED = [...CROSSED, 'desert_boss_defeated', 'desert_finish_thread_granted'];
const AFTERMATH = [...DEFEATED, 'desert_boss_aftermath_seen'];
const REVEALED = [...AFTERMATH, 'desert_scissors_seen'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setup(opts: { events?: string[]; checkpoint?: string; growth?: number; story4?: boolean; owned?: boolean; withItemDef?: boolean } = {}) {
  const db = new FakeDb();
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 마루바닥 밑'], [4, 'ice', 'ganeuri', '4장 — 냉장고 속'], [5, 'desert', 'geumbiti', '5장 — 보일러 옆 사막']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  if (opts.withItemDef !== false) db.seed('item_definition', { code: 'golden_finish_thread', name: '금빛 마감실', category: 'relic', story_slot: 'story_5', max_stack: 1 });
  for (const [code, name, slotKey] of [['ice_microfiber', '얼음 극세사', 'story_4'], ['old_cotton_core', '오래된 솜심', 'story_3'], ['water_dye_yarn', '물빛 염색실', 'story_2'], ['first_knot', '첫 매듭', 'story_1']]) db.seed('item_definition', { code, name, category: 'relic', story_slot: slotKey, max_stack: 1 });
  db.seed('player', { id: P, device_uuid: 'dev-desert-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH05_RIDGE_CROSSED', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: opts.growth ?? 4 });
  for (const e of opts.events ?? CROSSED) db.seed('player_story_event', { player_id: P, event_id: e });
  const def = (code: string) => (db.rows('item_definition', { code })[0] as { id: number }).id;
  for (const [slotKey, code] of [['story_1', 'first_knot'], ['story_2', 'water_dye_yarn'], ['story_3', 'old_cotton_core']]) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: slotKey, item_definition_id: def(code) });
  if (opts.story4 !== false) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_4', item_definition_id: def('ice_microfiber') });
  if (opts.owned) db.seed('player_item', { player_id: P, item_definition_id: def('golden_finish_thread'), quantity: 1, is_new: false, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date() });
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
const point = (id: string) => content.stage('desert')!.points.find((p) => p.id === id)!;
async function enter(s: Env, pointId: string) {
  await s.rooms.identify('sock-1', 'dev-desert-one');
  await s.rooms.createRoom('1', 'desert');
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
const threadRows = (s: Env) => {
  const def = s.db.rows('item_definition', { code: 'golden_finish_thread' })[0] as { id: number } | undefined;
  return def ? (s.db.rows('player_item', { player_id: P, item_definition_id: def.id }) as { quantity: number; is_new: boolean; is_locked: boolean }[]) : [];
};

// ---------- 실제 경로로 이기는 자동 플레이(fridge-boss.test.ts와 같은 방식) ----------
const dist = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
function stepToward(cur: BattleSnapshotDto, from: { col: number; row: number }, target: { col: number; row: number }): { col: number; row: number } | null {
  if (dist(from, target) === 1) return null;
  const occupied = new Set([...cur.units.filter((x) => !x.stunned && !x.inactive).map((x) => `${x.col},${x.row}`), ...(cur.blocked ?? [])]);
  const seen = new Set<string>([`${from.col},${from.row}`]);
  let frontier = [{ col: from.col, row: from.row, first: null as { col: number; row: number } | null }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const col = c.col + dc;
        const row = c.row + dr;
        const k = `${col},${row}`;
        if (col < 0 || row < 0 || col >= cur.grid.cols || row >= cur.grid.rows || seen.has(k) || occupied.has(k)) continue;
        const first = c.first ?? { col, row };
        if (dist({ col, row }, target) === 1) return first;
        seen.add(k);
        next.push({ col, row, first });
      }
    }
    frontier = next;
  }
  return null;
}
async function autoWin(s: Env, key: string, pick: (cur: BattleSnapshotDto) => string | undefined, maxActions = 600) {
  const snap = await s.battles.startStory('1', key);
  let cur = (await s.battles.party('1', snap.battleId, [])).snapshot;
  let seq = 0;
  const act = async (body: object) => {
    cur = (await s.battles.action('1', { battleId: cur.battleId, actionId: `w${++seq}`, expectedVersion: cur.version, ...body } as never)).snapshot;
  };
  for (let i = 0; i < maxActions && cur.phase !== 'resolved'; i++) {
    const me = cur.units.find((x) => x.side === 'party' && !x.stunned)!;
    const tgt = cur.units.find((x) => x.unitId === pick(cur));
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
const live = (cur: BattleSnapshotDto, ids: string[]) => cur.units.find((x) => ids.includes(x.unitId) && !x.stunned && !x.fled);
// 능선 앞: 매듭(남아 있으면 먼저) → 실밥이 → 박음이
const winAmbush = (s: Env) =>
  autoWin(s, 'desert_scorched_ambush', (cur) => cur.units.find((x) => x.knotOf && !x.stunned && !x.fled)?.unitId ?? live(cur, ['cutting_stitch_a', 'cutting_stitch_b'])?.unitId ?? live(cur, ['scorched_doll_a', 'scorched_doll_b'])?.unitId);
// 황금 재단인형: 연결점 셋(가까운 것부터) → 안쪽 연결(이야기 누비)
const winBoss = (s: Env) =>
  autoWin(s, 'desert_boss_golden_doll', (cur) => {
    const me = cur.units.find((x) => x.side === 'party' && !x.stunned)!;
    const points = cur.units.filter((x) => x.regen && !x.stunned).sort((a, b) => dist(me, a) - dist(me, b));
    return points[0]?.unitId ?? live(cur, ['inner_link'])?.unitId;
  });

// ---------- 능선 앞 ----------

test('능선 앞 승리 정산: desert_scorched_won 한 번, 체크포인트·성장·아이템 그대로, 물들이 지점이 열리고 다시 싸울 수 없다', async () => {
  const s = setup({ checkpoint: 'CH05_CLUES_JOINED', events: JOINED });
  await enter(s, 'desert_scorched');
  const items = s.db.rows('player_item', { player_id: P }).length;
  const cur = await winAmbush(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  assert.equal(count(s, 'desert_scorched_won'), 1);
  assert.deepEqual([progress(s).checkpoint, progress(s).nubi_growth_stage], ['CH05_CLUES_JOINED', 4]);
  assert.equal(s.db.rows('player_item', { player_id: P }).length, items, '아이템 없음');
  assert.ok((await s.story.stageData(P, 'desert')).points.some((p) => p.id === 'desert_ridge_pad'), '물들이 지점이 열린다');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'desert_scorched_ambush')), 'NO_ERROR');
});

test('능선 앞 조건: 단서 길 장면 전에는 시작할 수 없고, 직접 요청으로 사건을 만들 수 없다', async () => {
  const s = setup({ checkpoint: 'CH05_STARTED', events: [...CH04_DONE, 'desert_entry_seen'] });
  await enter(s, 'desert_scorched');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'desert_scorched_ambush')), 'NO_ERROR');
  assert.equal(await codeOf(s.story.completeEvent(P, 'desert_scorched_won')), 'STORY_EVENT_SERVER_ONLY');
});

// ---------- 황금 재단인형 ----------

test('황금 재단인형 승리 정산(이야기 누비가 안쪽 연결을 푼다): 사건 둘·금빛 마감실 1개·CH05_BOSS_DEFEATED가 한 번 기록되고 성장·장착·종장은 그대로다', async () => {
  const s = setup();
  await enter(s, 'desert_boss_entrance');
  const cur = await winBoss(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.settled], ['win', true]);
  assert.deepEqual([count(s, 'desert_boss_defeated'), count(s, 'desert_finish_thread_granted'), progress(s).checkpoint], [1, 1, 'CH05_BOSS_DEFEATED']);
  const rows = threadRows(s);
  assert.deepEqual([rows.length, rows[0].quantity, rows[0].is_new, rows[0].is_locked], [1, 1, true, true]);
  assert.deepEqual([progress(s).nubi_growth_stage, slot(s, 'story_5').length], [4, 0]);
  assert.equal(events(s).some((e) => /finish_thread_equipped|final_unlocked|scissors_seen/.test(e)), false, '가위 장면·장착·종장은 아직');
  await Promise.all(Array.from({ length: 5 }, () => s.story.completeEvent(P, 'desert_boss_defeated', 'server')));
  assert.equal(threadRows(s)[0].quantity, 1);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'desert_boss_golden_doll')), 'NO_ERROR', '다시 싸울 수 없다');
});

test('황금 재단인형 조건과 아이템 정의 누락: 능선을 건너기 전에는 시작할 수 없고, 정의가 없으면 정산 전체가 롤백된다', async () => {
  const early = setup({ checkpoint: 'CH05_CLUES_JOINED', events: CROSSED.filter((e) => e !== 'desert_ridge_crossed') });
  await enter(early, 'desert_boss_entrance');
  assert.notEqual(await codeOf(early.battles.startStory('1', 'desert_boss_golden_doll')), 'NO_ERROR');
  const s = setup({ withItemDef: false });
  assert.equal(await codeOf(s.story.completeEvent(P, 'desert_boss_defeated', 'server')), 'STORY_DATA_MISSING');
  assert.deepEqual([count(s, 'desert_boss_defeated'), progress(s).checkpoint], [0, 'CH05_RIDGE_CROSSED']);
});

// ---------- 승리 장면·가위·장착·장 완료 ----------

test('승리 장면 → 가위: 한 재생 범위로 이어지고, 승리 장면 완료(체크포인트 그대로) → 가위 장면 완료로 CH05_SCISSORS_REVEALED. 재접속은 남은 장면부터', async () => {
  const t = STORY_TRIGGERS.find((x) => x.id === 'desert_boss_entrance')!;
  assert.deepEqual([t.unless, (t.play as { endAfter?: string }).endAfter, t.encounterKey], [['desert_boss_defeated'], 'ch05.scissors', 'desert_boss_golden_doll']);
  assert.equal(SEGMENT_CHAIN_END['ch05.boss_victory'], 'ch05.scissors');
  const s = setup({ checkpoint: 'CH05_BOSS_DEFEATED', events: DEFEATED, owned: true });
  assert.deepEqual((await s.story.getState(P)).resume, { segmentId: 'ch05.boss_victory', tutorial: null });
  assert.equal(await codeOf(s.story.completeEvent(P, 'desert_scissors_seen')), 'STORY_PREREQUISITE_MISSING', '승리 장면 전에는 가위 장면을 끝낼 수 없다');
  await s.story.completeEvent(P, 'desert_boss_aftermath_seen');
  assert.equal(progress(s).checkpoint, 'CH05_BOSS_DEFEATED');
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch05.scissors');
  assert.equal(await codeOf(s.story.equipRelic(P, 'golden_finish_thread')), 'STORY_EVENT_NOT_ALLOWED', '가위 장면 전에는 장착할 수 없다(정본: 장착하려는 순간 가위)');
  const r = await s.story.completeEvent(P, 'desert_scissors_seen');
  assert.deepEqual([r.story.checkpoint, r.grants.length], ['CH05_SCISSORS_REVEALED', 0]);
  assert.equal((await s.story.getState(P)).resume.segmentId, null, '장착은 인벤토리에서');
});

const state = (s: Env) => ({ cp: progress(s).checkpoint, growth: progress(s).nubi_growth_stage, slot5: slot(s, 'story_5').length, events: events(s).filter((e) => ['desert_finish_thread_equipped', 'final_unlocked'].includes(e)).length });

test('장착 조건: 가위 장면 미완료·보유 없음·극세사 미장착·성장 단계가 다르면 거부되고 상태가 그대로다', async () => {
  const cases: [string, Env][] = [
    ['가위 장면', setup({ checkpoint: 'CH05_BOSS_DEFEATED', events: AFTERMATH, owned: true })],
    ['보유 없음', setup({ checkpoint: 'CH05_SCISSORS_REVEALED', events: REVEALED, owned: false })],
    ['극세사 미장착', setup({ checkpoint: 'CH05_SCISSORS_REVEALED', events: REVEALED, owned: true, story4: false })],
    ['성장 단계', setup({ checkpoint: 'CH05_SCISSORS_REVEALED', events: REVEALED, owned: true, growth: 3 })],
  ];
  for (const [name, s] of cases) {
    const before = JSON.stringify(state(s));
    assert.notEqual(await codeOf(s.story.equipRelic(P, 'golden_finish_thread')), 'NO_ERROR', name);
    assert.equal(JSON.stringify(state(s)), before, `${name}: 상태 불변`);
  }
});

test('장착 성공: story_5 + 성장 4→5 + 사건 둘 + CH05_COMPLETE를 한 번에, 마지막 마감 장면 → 종장 개방 기록. 동시 요청도 한 번', async () => {
  const s = setup({ checkpoint: 'CH05_SCISSORS_REVEALED', events: REVEALED, owned: true });
  const results = await Promise.all([1, 2, 3].map(() => s.story.equipRelic(P, 'golden_finish_thread').then((r) => r, (e: unknown) => e)));
  assert.deepEqual(state(s), { cp: 'CH05_COMPLETE', growth: 5, slot5: 1, events: 2 });
  assert.equal(threadRows(s)[0].quantity, 1, '보유 레코드는 지우지 않는다');
  const first = results.find((r) => !(r instanceof Error) && !(r as { alreadyCompleted: boolean }).alreadyCompleted) as { play?: { segmentId: string } };
  assert.equal(first.play?.segmentId, 'ch05.chapter_complete');
  assert.equal(SEGMENT_AFTER_EVENT.desert_finish_thread_equipped, 'ch05.chapter_complete');
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch05.chapter_complete');
  assert.equal((await s.story.completeEvent(P, 'desert_chapter_complete_seen')).alreadyCompleted, false);
  assert.equal((await s.story.getState(P)).resume.segmentId, null);
  assert.deepEqual(state(s), { cp: 'CH05_COMPLETE', growth: 5, slot5: 1, events: 2 }, '장면 완료는 상태를 바꾸지 않는다');
  assert.equal(EVENT_BY_ID.get('desert_finish_thread_equipped')!.to, 'CH05_COMPLETE');
  assert.equal(resumeOf({ checkpoint: 'CH05_COMPLETE', events: new Set([...REVEALED, 'desert_finish_thread_equipped', 'final_unlocked', 'desert_chapter_complete_seen']), objectives: new Map(), growthStage: 5 }).segmentId, null);
});

test('인벤토리: 금빛 마감실은 이야기 유물(story_5)로 잠겨 있고, 가위 장면을 끝까지 보기 전에는 장착 버튼이 비활성이다', async () => {
  const s = setup({ checkpoint: 'CH05_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  const it = (await s.inventory.list(P)).items.find((i) => i.itemCode === 'golden_finish_thread')!;
  assert.deepEqual([it.name, it.tab, it.category, it.isLocked, it.storySlot], ['금빛 마감실', 'story', 'relic', true, 'story_5']);
  assert.deepEqual(it.permissions, { sell: false, discard: false, trade: false, consume: false, unequip: false });
  assert.deepEqual([it.storyAction?.kind, it.storyAction?.available], ['equip_story_nubi', false]);
  const ready = setup({ checkpoint: 'CH05_SCISSORS_REVEALED', events: REVEALED, owned: true });
  assert.equal((await ready.inventory.list(P)).items.find((i) => i.itemCode === 'golden_finish_thread')!.storyAction?.available, true);
});
