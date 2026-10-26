// 10-23 C4-3: 4장 저장고 앞 전투·서리 미싱의 서버 정산(사건·아이템·체크포인트), 얼음 극세사 1회 지급, 누비에게 장착(성장 4·story_4·5장 개방), 재접속·멱등.
// 실제 RoomsService·BattleService·StoryService·InventoryService·EquipmentService + 메모리 Prisma(underfloor-boss.test.ts와 같은 방식).
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
const CH03_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked', 'lake_entry_seen', 'lake_boss_defeated', 'lake_dye_thread_granted', 'lake_boss_aftermath_seen', 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_chapter_complete_seen', 'underfloor_entry_seen', 'underfloor_boss_defeated', 'underfloor_cotton_core_granted', 'underfloor_boss_aftermath_seen', 'underfloor_cotton_core_equipped', 'fridge_unlocked', 'underfloor_chapter_complete_seen'];
const RESCUED = [...CH03_DONE, 'fridge_entry_seen', 'fridge_ganeuri_freed'];
const CONFESSED = [...RESCUED, 'fridge_frozen_guard_won', 'fridge_storage_seen', 'fridge_confession_seen'];
const DEFEATED = [...CONFESSED, 'fridge_boss_defeated', 'fridge_microfiber_granted'];
const AFTERMATH = [...DEFEATED, 'fridge_boss_aftermath_seen'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setup(opts: { events?: string[]; checkpoint?: string; growth?: number; story3?: boolean; owned?: boolean; withItemDef?: boolean } = {}) {
  const db = new FakeDb();
  for (const [order, stage, code, title] of [[1, 'forest', 'nubi', '1장 — 숲'], [2, 'lake', 'muldeuli', '2장 — 호수'], [3, 'underground', 'pokshini', '3장 — 마루바닥 밑'], [4, 'ice', 'ganeuri', '4장 — 냉장고 속'], [5, 'desert', 'geumbiti', '5장 — 사막']] as const) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 3200, map_height: 2400 });
  }
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  if (opts.withItemDef !== false) db.seed('item_definition', { code: 'ice_microfiber', name: '얼음 극세사', category: 'relic', story_slot: 'story_4', max_stack: 1 });
  db.seed('item_definition', { code: 'old_cotton_core', name: '오래된 솜심', category: 'relic', story_slot: 'story_3', max_stack: 1 });
  db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('player', { id: P, device_uuid: 'dev-ice-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH04_CONFESSION_SEEN', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: opts.growth ?? 3 });
  for (const e of opts.events ?? CONFESSED) db.seed('player_story_event', { player_id: P, event_id: e });
  const def = (code: string) => (db.rows('item_definition', { code })[0] as { id: number }).id;
  db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_1', item_definition_id: def('first_knot') });
  db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_2', item_definition_id: def('water_dye_yarn') });
  if (opts.story3 !== false) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_3', item_definition_id: def('old_cotton_core') });
  if (opts.owned) db.seed('player_item', { player_id: P, item_definition_id: def('ice_microfiber'), quantity: 1, is_new: false, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date() });
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
const point = (id: string) => content.stage('ice')!.points.find((p) => p.id === id)!;
async function enter(s: Env, pointId: string) {
  await s.rooms.identify('sock-1', 'dev-ice-one');
  await s.rooms.createRoom('1', 'ice');
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
const fiberRows = (s: Env) => {
  const def = s.db.rows('item_definition', { code: 'ice_microfiber' })[0] as { id: number } | undefined;
  return def ? (s.db.rows('player_item', { player_id: P, item_definition_id: def.id }) as { quantity: number; is_new: boolean; is_locked: boolean }[]) : [];
};

// ---------- 실제 경로로 이기는 자동 플레이(3장 정산 시험과 같은 방식) ----------
const dist = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
function stepToward(cur: BattleSnapshotDto, from: { col: number; row: number }, target: { col: number; row: number }): { col: number; row: number } | null {
  if (dist(from, target) === 1) return null;
  const occupied = new Set(cur.units.filter((x) => !x.stunned && !x.inactive).map((x) => `${x.col},${x.row}`));
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
async function autoWin(s: Env, key: string, pick: (cur: BattleSnapshotDto) => string | undefined, maxActions = 500) {
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
// 저장고 앞: 실밥 → 파편(남아 있으면 먼저) → 골무막이 → 박음이
const winGuard = (s: Env) =>
  autoWin(s, 'fridge_frozen_guard', (cur) => {
    const shard = cur.units.find((x) => x.shardOf && !x.stunned && !x.fled);
    return live(cur, ['black_stitch'])?.unitId ?? shard?.unitId ?? live(cur, ['thimble_guard'])?.unitId ?? live(cur, ['frozen_doll_a', 'frozen_doll_b'])?.unitId;
  });
// 서리 미싱: 밑실 둘 → 윗실(혼자라 연결 실은 가느리가 끊는다)
const winBoss = (s: Env) => autoWin(s, 'fridge_boss_frost_machine', (cur) => live(cur, ['lower_thread_1', 'lower_thread_2'])?.unitId ?? live(cur, ['upper_thread'])?.unitId);

// ---------- 저장고 앞 ----------

test('저장고 앞 승리 정산: fridge_frozen_guard_won 한 번, 체크포인트·성장·아이템 그대로(P-01), 저장고 문이 열리고 다시 싸울 수 없다', async () => {
  const s = setup({ checkpoint: 'CH04_GANEURI_RESCUED', events: RESCUED });
  await enter(s, 'fridge_guard');
  const items = s.db.rows('player_item', { player_id: P }).length;
  const cur = await winGuard(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  assert.equal(count(s, 'fridge_frozen_guard_won'), 1);
  assert.deepEqual([progress(s).checkpoint, progress(s).nubi_growth_stage], ['CH04_GANEURI_RESCUED', 3]);
  assert.equal(s.db.rows('player_item', { player_id: P }).length, items, '아이템 없음');
  assert.equal((await s.story.stageData(P, 'ice')).gates.find((g) => g.id === 'gate_storage_door')!.open, true);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'fridge_frozen_guard')), 'NO_ERROR');
  await Promise.all(Array.from({ length: 4 }, () => s.story.completeEvent(P, 'fridge_frozen_guard_won', 'server')));
  assert.equal(count(s, 'fridge_frozen_guard_won'), 1);
});

test('저장고 앞 조건: 가느리를 구하기 전에는 시작할 수 없고, 직접 요청으로 사건을 만들 수 없다', async () => {
  const s = setup({ checkpoint: 'CH04_STARTED', events: [...CH03_DONE, 'fridge_entry_seen'] });
  await enter(s, 'fridge_guard');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'fridge_frozen_guard')), 'NO_ERROR');
  assert.equal(await codeOf(s.story.completeEvent(P, 'fridge_frozen_guard_won')), 'STORY_EVENT_SERVER_ONLY');
});

// ---------- 서리 미싱 ----------

test('서리 미싱 승리 정산: 사건 둘·얼음 극세사 1개·CH04_BOSS_DEFEATED가 한 번 기록되고 성장·장착·5장은 그대로다', async () => {
  const s = setup();
  await enter(s, 'fridge_boss_entrance');
  const cur = await winBoss(s);
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.settled], ['win', true]);
  assert.deepEqual([count(s, 'fridge_boss_defeated'), count(s, 'fridge_microfiber_granted'), progress(s).checkpoint], [1, 1, 'CH04_BOSS_DEFEATED']);
  const rows = fiberRows(s);
  assert.deepEqual([rows.length, rows[0].quantity, rows[0].is_new, rows[0].is_locked], [1, 1, true, true]);
  assert.deepEqual([progress(s).nubi_growth_stage, slot(s, 'story_4').length], [3, 0]);
  assert.equal(events(s).some((e) => /microfiber_equipped|desert_unlocked/.test(e)), false, '5장은 열리지 않는다');
  // 멱등·재도전 불가
  await Promise.all(Array.from({ length: 5 }, () => s.story.completeEvent(P, 'fridge_boss_defeated', 'server')));
  assert.equal(fiberRows(s)[0].quantity, 1);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'fridge_boss_frost_machine')), 'NO_ERROR', '다시 싸울 수 없다');
});

test('서리 미싱 조건과 아이템 정의 누락: 고백 전에는 시작할 수 없고, 정의가 없으면 정산 전체가 롤백된다', async () => {
  const early = setup({ checkpoint: 'CH04_STORAGE_CLEARED', events: CONFESSED.filter((e) => e !== 'fridge_confession_seen') });
  await enter(early, 'fridge_boss_entrance');
  assert.notEqual(await codeOf(early.battles.startStory('1', 'fridge_boss_frost_machine')), 'NO_ERROR');
  assert.equal(await codeOf(early.story.completeEvent(P, 'fridge_boss_defeated')), 'STORY_EVENT_SERVER_ONLY');
  const s = setup({ withItemDef: false });
  assert.equal(await codeOf(s.story.completeEvent(P, 'fridge_boss_defeated', 'server')), 'STORY_DATA_MISSING');
  assert.deepEqual([count(s, 'fridge_boss_defeated'), progress(s).checkpoint], [0, 'CH04_CONFESSION_SEEN']);
  s.db.seed('item_definition', { code: 'ice_microfiber', name: '얼음 극세사', category: 'relic', story_slot: 'story_4', max_stack: 1 });
  await s.story.completeEvent(P, 'fridge_boss_defeated', 'server');
  assert.deepEqual([count(s, 'fridge_boss_defeated'), progress(s).checkpoint, fiberRows(s)[0].quantity], [1, 'CH04_BOSS_DEFEATED', 1]);
});

// ---------- 승리 장면·장착·장 완료 ----------

const state = (s: Env) => ({ cp: progress(s).checkpoint, growth: progress(s).nubi_growth_stage, slot4: slot(s, 'story_4').length, events: events(s).filter((e) => ['fridge_microfiber_equipped', 'desert_unlocked'].includes(e)).length });

test('장착 조건: 장면 미완료·보유 없음·솜심 미장착·성장 단계가 다르면 거부되고 상태가 그대로다', async () => {
  const cases: [string, Env][] = [
    ['장면 완료 사건', setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: DEFEATED, owned: true })],
    ['보유', setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH })],
    ['오래된 솜심 장착', setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true, story3: false })],
    ['성장 단계 2', setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true, growth: 2 })],
    ['성장 단계 4', setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true, growth: 4 })],
  ];
  for (const [name, s] of cases) {
    const before = JSON.stringify(state(s));
    assert.notEqual(await codeOf(s.story.equipRelic(P, 'ice_microfiber')), 'NO_ERROR', name);
    assert.equal(JSON.stringify(state(s)), before, `${name}: 상태 불변`);
  }
});

test('장착 성공: story_4 + 성장 3→4 + 사건 둘 + CH04_COMPLETE를 한 번에, 장 완료 장면 → 5장 개방. 동시 요청도 한 번', async () => {
  const s = setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  await Promise.all([1, 2, 3].map(() => s.story.equipRelic(P, 'ice_microfiber').then((r) => r, (e: unknown) => e)));
  assert.deepEqual(state(s), { cp: 'CH04_COMPLETE', growth: 4, slot4: 1, events: 2 });
  assert.equal(fiberRows(s)[0].quantity, 1, '보유 레코드는 지우지 않는다');
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch04.chapter_complete');
  assert.equal((await s.story.completeEvent(P, 'fridge_chapter_complete_seen')).alreadyCompleted, false);
  assert.equal((await s.story.completeEvent(P, 'fridge_chapter_complete_seen')).alreadyCompleted, true);
  assert.equal((await s.story.getState(P)).resume.segmentId, null);
  assert.deepEqual(state(s), { cp: 'CH04_COMPLETE', growth: 4, slot4: 1, events: 2 }, '장면 완료는 상태를 바꾸지 않는다');
  assert.equal((await s.story.getState(P)).stages.find((x) => x.stageCode === 'desert')!.canEnter, true, '5장 보일러 옆 사막 개방');
});

test('재접속·지점·목표: 정산 뒤 장면 미완료는 승리 장면부터, 보스 입구는 정산 뒤 닫히고 목표가 극세사 → 보일러 쪽으로 바뀐다', async () => {
  const before = setup();
  assert.equal((await before.story.stageData(P, 'ice')).points.some((p) => p.id === 'fridge_boss_entrance'), true);
  const mid = setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: DEFEATED, owned: true });
  assert.equal((await mid.story.getState(P)).resume.segmentId, 'ch04.boss_victory');
  assert.equal((await mid.story.stageData(P, 'ice')).points.some((p) => p.id === 'fridge_boss_entrance'), false);
  const t = STORY_TRIGGERS.find((x) => x.id === 'fridge_boss_entrance')!;
  assert.deepEqual([t.unless, (t.play as { endAfter?: string }).endAfter], [['fridge_boss_defeated'], 'ch04.boss_victory']);
  const done = setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  assert.equal(resumeOf({ checkpoint: 'CH04_BOSS_DEFEATED', events: new Set(AFTERMATH), objectives: new Map(), growthStage: 3 }).segmentId, null);
  assert.equal((await done.story.stageData(P, 'ice')).goal?.text, '얼음 극세사를 누비에게 감아 주자.');
  const complete = setup({ checkpoint: 'CH04_COMPLETE', events: [...AFTERMATH, 'fridge_microfiber_equipped', 'desert_unlocked', 'fridge_chapter_complete_seen'], growth: 4, owned: true });
  assert.equal((await complete.story.stageData(P, 'ice')).goal?.text, '뜨거운 바람이 불어오는 보일러 쪽으로 가자.');
  assert.equal(EVENT_BY_ID.get('fridge_microfiber_equipped')!.to, 'CH04_COMPLETE');
});

test('인벤토리: 얼음 극세사는 이야기 유물(story_4)로 잠겨 있고, 승리 장면을 끝까지 보기 전에는 장착 버튼이 비활성이다', async () => {
  const s = setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: DEFEATED, owned: true });
  const it = (await s.inventory.list(P)).items.find((i) => i.itemCode === 'ice_microfiber')!;
  assert.deepEqual([it.name, it.tab, it.category, it.isLocked, it.storySlot], ['얼음 극세사', 'story', 'relic', true, 'story_4']);
  assert.deepEqual(it.permissions, { sell: false, discard: false, trade: false, consume: false, unequip: false });
  assert.deepEqual([it.storyAction?.kind, it.storyAction?.available], ['equip_story_nubi', false]);
  assert.equal(await codeOf(s.equipment.unequip('1', String(s.nubiId), 'story_4')), 'STORY_SLOT_RESERVED');
  const ready = setup({ checkpoint: 'CH04_BOSS_DEFEATED', events: AFTERMATH, owned: true });
  assert.equal((await ready.inventory.list(P)).items.find((i) => i.itemCode === 'ice_microfiber')!.storyAction?.available, true);
});
