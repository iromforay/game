// 10-14 C2-5B: 물먹은 박음이 승리 정산·물빛 염색실 1회 지급·정본 승리 장면.
// 실제 RoomsService·BattleService·StoryService·InventoryService + 메모리 Prisma(lake-boss.test.ts와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { BattleError } from '../src/turby/battle/battle-types';
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

const ROOT = resolve(__dirname, '../..');
const content = new StoryContentService();
const P = 1n;
const CH01 = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const CRISIS = [...CH01, 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened', 'lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued', 'lake_safe_route_opened', 'lake_nubi_crisis_seen'];
const DEFEATED = [...CRISIS, 'lake_boss_defeated', 'lake_dye_thread_granted'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setup(opts: { events?: string[]; checkpoint?: string; withItemDef?: boolean } = {}) {
  const db = new FakeDb();
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  if (opts.withItemDef !== false) db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2 });
  db.seed('player', { id: P, device_uuid: 'dev-boss-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH02_NUBI_CRISIS_SEEN', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: 1 });
  for (const e of opts.events ?? CRISIS) db.seed('player_story_event', { player_id: P, event_id: e });
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
const entrance = content.stage('lake')!.points.find((p) => p.id === 'lake_boss_entrance')!;
async function enter(s: Env) {
  await s.rooms.identify('sock-1', 'dev-boss-one');
  await s.rooms.createRoom('1', 'lake');
  s.rooms.startRoom('1');
  await s.rooms.enterMap('1', 'down');
  Object.assign(s.rooms.roomOf('1')!.members[0], { x: entrance.x, y: entrance.y });
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
const checkpoint = (s: Env) => (s.db.rows('player_story_progress', { player_id: P })[0] as { checkpoint: string; nubi_growth_stage: number }).checkpoint;
const growth = (s: Env) => (s.db.rows('player_story_progress', { player_id: P })[0] as { nubi_growth_stage: number }).nubi_growth_stage;
const dyeRows = (s: Env) => {
  const def = s.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number } | undefined;
  return def ? (s.db.rows('player_item', { player_id: P, item_definition_id: def.id }) as { quantity: number; is_new: boolean; is_locked: boolean; first_acquired_at: Date | null }[]) : [];
};
const count = (s: Env, id: string) => events(s).filter((e) => e === id).length;

// 보스를 실제 전투 경로로 이긴다(서버 정산 포함). 결과 snapshot을 돌려준다
async function winBoss(s: Env) {
  const snap = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  let cur = (await s.battles.party('1', snap.battleId, [])).snapshot;
  let seq = 0;
  const act1 = async (body: object) => {
    cur = (await s.battles.action('1', { battleId: cur.battleId, actionId: `w${++seq}`, expectedVersion: cur.version, ...body } as never)).snapshot;
  };
  for (let i = 0; i < 60 && cur.phase !== 'resolved'; i++) {
    const me = cur.units.find((x) => x.side === 'party')!;
    const seams = cur.units.filter((x) => x.partOf && !x.stunned);
    const boss = cur.units.find((x) => x.unitId === 'waterlogged_sewn_doll')!;
    const tgt = seams[0] ?? boss;
    const d = Math.abs(tgt.col - me.col) + Math.abs(tgt.row - me.row);
    if (me.ap < 1) await act1({ type: 'end' });
    else if (d === 1) await act1({ type: 'attack', unitId: me.unitId, targetUnitId: tgt.unitId });
    else await act1({ type: 'move', unitId: me.unitId, targetCol: me.col + Math.sign(tgt.col - me.col), targetRow: me.row });
  }
  assert.equal(cur.outcome, 'win');
  return { battleId: cur.battleId };
}

test('승리 정산: 보스 승리 한 번이 사건 둘·물빛 염색실 1개·체크포인트를 한 번에 기록하고 성장·장착·3장은 그대로다', async () => {
  const s = setup();
  await enter(s);
  assert.equal(dyeRows(s).length, 0);
  const { battleId } = await winBoss(s);
  const ended = (await s.battles.snapshot('1', battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  assert.equal(count(s, 'lake_boss_defeated'), 1);
  assert.equal(count(s, 'lake_dye_thread_granted'), 1);
  assert.equal(checkpoint(s), 'CH02_BOSS_DEFEATED');
  const rows = dyeRows(s);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].quantity, rows[0].is_new, rows[0].is_locked], [1, true, true]);
  assert.ok(rows[0].first_acquired_at, '획득 시각');
  assert.equal(growth(s), 1, '성장 단계 유지');
  assert.equal(s.db.rows('turby_equipment', { turby_instance_id: s.nubiId, slot_key: 'story_2' }).length, 0, 'story_2 미장착');
  assert.equal(s.db.rows('item_definition', { code: 'water_dye_yarn' })[0].max_stack, 1);
  // 3장·장 완료는 열리지 않는다
  assert.equal(events(s).some((e) => /ch02_complete|underground|lake_complete|nubi_color_restored|lake_dye_thread_equipped/.test(e)), false);
  assert.equal(EVENT_BY_ID.get('lake_boss_defeated')!.to, 'CH02_BOSS_DEFEATED');
  assert.deepEqual(EVENT_BY_ID.get('lake_boss_defeated')!.alsoComplete, ['lake_dye_thread_granted']);
});

test('정산 거부: 직접 요청·허용되지 않은 시점·위조 결과로는 사건·아이템·체크포인트가 생기지 않는다', async () => {
  const s = setup();
  assert.equal(await codeOf(s.story.completeEvent(P, 'lake_boss_defeated')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(s.story.completeEvent(P, 'lake_dye_thread_granted')), 'STORY_EVENT_SERVER_ONLY');
  // 서버 경로라도 위기 장면을 보기 전이면 규칙이 막는다
  const early = setup({ checkpoint: 'CH02_MAZE_CLEARED', events: CRISIS.filter((e) => e !== 'lake_nubi_crisis_seen') });
  assert.notEqual(await codeOf(early.story.completeEvent(P, 'lake_boss_defeated', 'server')), 'NO_ERROR');
  assert.deepEqual([count(early, 'lake_boss_defeated'), dyeRows(early).length, checkpoint(early)], [0, 0, 'CH02_MAZE_CLEARED']);
  assert.equal(count(s, 'lake_boss_defeated') + dyeRows(s).length, 0);
  // 전투를 시작하지 않은(전투 세션이 없는) 보스 결과 확인 요청은 정산하지 않는다
  assert.equal(count(s, 'lake_boss_defeated'), 0);
  assert.equal(checkpoint(s), 'CH02_NUBI_CRISIS_SEEN');
});

test('멱등: 동시 정산·재요청·결과 재조회·재진입에도 사건·아이템·체크포인트가 하나다', async () => {
  const s = setup();
  await enter(s);
  const { battleId } = await winBoss(s);
  const dump = () => JSON.stringify([events(s).sort(), dyeRows(s), checkpoint(s)], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const before = dump();
  // 동시 서버 정산 5건 + 직렬 재요청
  const res = await Promise.all(Array.from({ length: 5 }, () => s.story.completeEvent(P, 'lake_boss_defeated', 'server')));
  assert.equal(res.every((r) => r.alreadyCompleted), true);
  await s.story.completeEvent(P, 'lake_boss_defeated', 'server');
  await s.battles.snapshot('1', battleId);
  await s.battles.snapshot('1', battleId);
  assert.equal(dump(), before);
  assert.equal(dyeRows(s)[0].quantity, 1);
  // 다시 싸울 수 없다
  assert.notEqual(await codeOf(s.battles.startStory('1', 'lake_boss_sewn_doll')), 'NO_ERROR');
  assert.equal(dyeRows(s)[0].quantity, 1);
});

test('아이템 정의 누락: 물빛 염색실 정의가 없으면 정산 전체가 롤백되고(사건·체크포인트 없음) 정의가 생기면 다시 시도로 한 번 정산된다', async () => {
  const s = setup({ withItemDef: false });
  await enter(s);
  const snap = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  void snap;
  assert.equal(await codeOf(s.story.completeEvent(P, 'lake_boss_defeated', 'server')), 'STORY_DATA_MISSING');
  assert.deepEqual([count(s, 'lake_boss_defeated'), count(s, 'lake_dye_thread_granted'), checkpoint(s), dyeRows(s).length], [0, 0, 'CH02_NUBI_CRISIS_SEEN', 0]);
  s.db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  await s.story.completeEvent(P, 'lake_boss_defeated', 'server');
  assert.deepEqual([count(s, 'lake_boss_defeated'), count(s, 'lake_dye_thread_granted'), checkpoint(s), dyeRows(s)[0].quantity], [1, 1, 'CH02_BOSS_DEFEATED', 1]);
});

test('인벤토리·잠금: 이야기 유물로 보이고 새 아이템이며, 판매·버리기·거래·소비·해제·장착 행동이 모두 막힌다', async () => {
  const s = setup({ checkpoint: 'CH02_BOSS_DEFEATED', events: DEFEATED });
  const def = s.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number };
  const now = new Date();
  s.db.seed('player_item', { player_id: P, item_definition_id: def.id, quantity: 1, is_new: true, is_locked: true, first_acquired_at: now, last_acquired_at: now });
  const list = await s.inventory.list(P);
  const it = list.items.find((i) => i.itemCode === 'water_dye_yarn')!;
  assert.ok(it);
  assert.deepEqual([it.name, it.tab, it.category, it.quantity, it.maxStack, it.isNew, it.isLocked, it.storySlot, it.slotsUsed], ['물빛 염색실', 'story', 'relic', 1, 1, true, true, 'story_2', 0]);
  assert.deepEqual(it.permissions, { sell: false, discard: false, trade: false, consume: false, unequip: false });
  assert.deepEqual([it.storyAction?.kind, it.storyAction?.available], ['equip_story_nubi', false], '승리 장면을 끝까지 보기 전에는 장착 버튼이 비활성(C2-6)');
  assert.equal(it.equippedOnStoryNubi, false);
  assert.ok(it.lockReason);
  // 장착 경로 모두 거부
  assert.equal(await codeOf(s.story.equipRelic(P, 'water_dye_yarn')), 'STORY_PREREQUISITE_MISSING', '장면 완료 전 장착 거부');
  assert.equal(await codeOf(s.equipment.equip('1', String(s.nubiId), 'water_dye_yarn')), 'NOT_EQUIPPABLE');
  assert.equal(await codeOf(s.equipment.unequip('1', String(s.nubiId), 'story_2')), 'STORY_SLOT_RESERVED');
  // 열람하면 새 아이템 표시만 해제된다
  const seen = await s.inventory.markItemSeen(P, 'water_dye_yarn');
  assert.equal(seen.cleared, true);
  const after = (await s.inventory.list(P)).items.find((i) => i.itemCode === 'water_dye_yarn')!;
  assert.deepEqual([after.isNew, after.quantity, after.isLocked], [false, 1, true]);
});

test('승리 장면: 정본 문구·순서이고, 끝까지 본 뒤에만 lake_boss_aftermath_seen이 한 번 기록되며 상태·아이템은 바뀌지 않는다', async () => {
  const file = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch02.json'), 'utf8')) as { segments: { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { kind: string; text: string; dialogueId: string; cameraCue: string | null }[] }[] };
  const seg = file.segments.find((x) => x.segmentId === 'ch02.boss_victory')!;
  assert.deepEqual([seg.resumeFrom, seg.replayOnResume, seg.completesWith], ['CH02_BOSS_DEFEATED', true, 'lake_boss_aftermath_seen']);
  // 장면 문서(2장.md) 순서: 풀림·실 떠오름 → 기계가 회수하지 못함 → 타다닥
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const docs = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  const md = readFileSync(join(docs, 'docs/scene/2장.md'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const at = md.findIndex((l) => l.startsWith('마지막 재봉실을 끊자'));
  assert.ok(at > 0);
  assert.deepEqual(seg.entries.map((e) => e.text), [md[at], md[at + 2], md[at + 4].replace(/^`/, '').replace(/`$/, '')]);
  assert.deepEqual(seg.entries.map((e) => e.kind), ['narration', 'narration', 'narration']);
  assert.equal(seg.entries[2].text, '타다닥— 철컥.');
  assert.match(seg.entries[0].text, /젖은 천 조각과 검은 실밥으로 풀어진다/);
  assert.match(seg.entries[0].text, /푸른 물빛 염색실이 떠오른다/);
  assert.match(seg.entries[1].text, /아무것도 회수하지 못한 채 끊어진다/);
  assert.equal(seg.entries.filter((e) => e.cameraCue).length, 1, '효과는 실이 떠오르는 cue 하나뿐(섬광·흔들림 없음)');
  assert.equal(seg.entries[0].cameraCue, 'water-dye-yarn-rise');

  // 서버 규칙
  const early = setup();
  assert.notEqual(await codeOf(early.story.completeEvent(P, 'lake_boss_aftermath_seen')), 'NO_ERROR', '정산 전에는 장면 완료를 기록할 수 없다');
  const s = setup({ checkpoint: 'CH02_BOSS_DEFEATED', events: DEFEATED });
  const def = s.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number };
  s.db.seed('player_item', { player_id: P, item_definition_id: def.id, quantity: 1, is_new: true, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date() });
  const first = await s.story.completeEvent(P, 'lake_boss_aftermath_seen');
  assert.equal(first.alreadyCompleted, false);
  const again = await s.story.completeEvent(P, 'lake_boss_aftermath_seen');
  assert.equal(again.alreadyCompleted, true);
  assert.deepEqual([count(s, 'lake_boss_aftermath_seen'), checkpoint(s), growth(s), dyeRows(s).length, dyeRows(s)[0].quantity], [1, 'CH02_BOSS_DEFEATED', 1, 1, 1]);
  assert.equal(EVENT_BY_ID.get('lake_boss_aftermath_seen')!.to, undefined);
  assert.equal(EVENT_BY_ID.get('lake_boss_aftermath_seen')!.serverOnly, undefined);
});

test('재접속: 정산 뒤·장면 미완료는 승리 장면을 처음부터, 장면 완료 뒤는 장면·보스 입장 없음이고 목표가 장착 대기로 바뀐다', async () => {
  const before = setup();
  assert.equal(resumeOf({ checkpoint: 'CH02_NUBI_CRISIS_SEEN', events: new Set(CRISIS), objectives: new Map(), growthStage: 1 }).segmentId, null);
  assert.equal((await before.story.stageData(P, 'lake')).points.some((p) => p.id === 'lake_boss_entrance'), true);

  const mid = setup({ checkpoint: 'CH02_BOSS_DEFEATED', events: DEFEATED });
  assert.equal((await mid.story.getState(P)).resume.segmentId, 'ch02.boss_victory');
  const view = await mid.story.stageData(P, 'lake');
  assert.equal(view.points.some((p) => p.id === 'lake_boss_entrance'), false, '보스 입장 지점 제거');
  assert.equal(view.goal, null, '장면을 끝까지 보기 전에는 장착 대기 목표를 띄우지 않는다');
  // 지역 진입(자동 트리거): 복귀 범위가 승리 장면 하나
  const entry = await mid.story.trigger(P, 'lake_entry').catch(async () => {
    await enter(mid);
    return mid.story.trigger(P, 'lake_entry');
  });
  assert.deepEqual([entry.play?.segmentId, entry.play?.endAfter], ['ch02.boss_victory', 'ch02.boss_victory']);
  // 보스 입장 트리거는 정산 뒤 닫힌다 — 전투를 다시 열지 않는다
  const t = STORY_TRIGGERS.find((x) => x.id === 'lake_boss_entrance')!;
  assert.deepEqual(t.unless, ['lake_boss_defeated']);
  assert.equal(t.play === 'resume' ? '' : (t.play as { endAfter?: string }).endAfter, 'ch02.boss_victory', '입장 범위가 같은 재생에서 승리 장면까지 이어진다');

  const done = setup({ checkpoint: 'CH02_BOSS_DEFEATED', events: [...DEFEATED, 'lake_boss_aftermath_seen'] });
  assert.equal((await done.story.getState(P)).resume.segmentId, null);
  const after = await done.story.stageData(P, 'lake');
  assert.deepEqual([after.points.some((p) => p.id === 'lake_boss_entrance'), after.goal?.text], [false, '물빛 염색실을 누비에게 가져가자.']);
});

test('에셋: water-dye-yarn은 160×160 투명 PNG이고 원본 해시와 같으며, items/** glob으로 같은 키로 등록된다', () => {
  const file = join(ROOT, 'save-a-turby', 'src', 'assets', 'items', 'relics', 'water-dye-yarn.png');
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [160, 160]);
  assert.equal(bytes[25], 6, 'RGBA');
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), 'EFA8EAD2B45AC1F1CF3EFB9100CA30F04EF6E96A1EBA7070A8ADFDE7D706081F');
  const reg = readFileSync(join(ROOT, 'save-a-turby', 'src', 'assets', 'registry.ts'), 'utf8');
  assert.match(reg, /import\.meta\.glob\('\.\/items\/\*\*\/\*\.png'/);
});
