// 10-14 C2-6: 물빛 염색실 장착·색 회복 장면·성장 2·CH02_COMPLETE·3장 개방.
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
const DEFEATED = [...CRISIS, 'lake_boss_defeated', 'lake_dye_thread_granted', 'lake_boss_aftermath_seen'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setup(opts: { events?: string[]; checkpoint?: string; story1?: boolean; owned?: boolean; growth?: number; companion?: boolean } = {}) {
  const db = new FakeDb();
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 3, stage_code: 'underground', clear_character_code: 'nubi', title: '3장 — 마루바닥 밑', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2 });
  db.seed('player', { id: P, device_uuid: 'dev-boss-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: opts.companion !== false, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH02_BOSS_DEFEATED', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: opts.growth ?? 1 });
  for (const e of opts.events ?? DEFEATED) db.seed('player_story_event', { player_id: P, event_id: e });
  if (opts.story1 !== false) db.seed('turby_equipment', { turby_instance_id: nubi.id, slot_key: 'story_1', item_definition_id: (db.rows('item_definition', { code: 'first_knot' })[0] as { id: number }).id });
  if (opts.owned !== false) db.seed('player_item', { player_id: P, item_definition_id: (db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number }).id, quantity: 1, is_new: false, is_locked: true, first_acquired_at: new Date(), last_acquired_at: new Date() });
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
const slot = (s: Env, key: string) => s.db.rows('turby_equipment', { turby_instance_id: s.nubiId, slot_key: key });
const dyeRows = (s: Env) => {
  const def = s.db.rows('item_definition', { code: 'water_dye_yarn' })[0] as { id: number } | undefined;
  return def ? (s.db.rows('player_item', { player_id: P, item_definition_id: def.id }) as { quantity: number; is_new: boolean; is_locked: boolean; first_acquired_at: Date | null }[]) : [];
};
const count = (s: Env, id: string) => events(s).filter((e) => e === id).length;


const state = (s: Env) => ({ cp: checkpoint(s), growth: growth(s), slot2: slot(s, 'story_2').length, events: events(s).filter((e) => ['lake_dye_thread_equipped', 'underfloor_unlocked'].includes(e)).length });
const untouched = { cp: 'CH02_BOSS_DEFEATED', growth: 1, slot2: 0, events: 0 };
const knitNeedleId = (s: Env) => (s.db.rows('item_definition', { code: 'knit_needle' })[0] as { id: number }).id;

test('장착 조건 아홉 개: 하나라도 빠지면 거부되고 슬롯·성장·사건·체크포인트가 그대로다', async () => {
  const cases: [string, Env][] = [
    ['체크포인트', setup({ checkpoint: 'CH02_NUBI_CRISIS_SEEN' })],
    ['장면 완료 사건', setup({ events: DEFEATED.filter((e) => e !== 'lake_boss_aftermath_seen') })],
    ['정산 사건', setup({ events: DEFEATED.filter((e) => e !== 'lake_boss_defeated') })],
    ['염색실 지급 사건', setup({ events: DEFEATED.filter((e) => e !== 'lake_dye_thread_granted') })],
    ['보유', setup({ owned: false })],
    ['동료 표식', setup({ companion: false })],
    ['첫 매듭 장착', setup({ story1: false })],
    ['성장 단계 0', setup({ growth: 0 })],
    ['성장 단계 2', setup({ growth: 2 })],
  ];
  for (const [name, s] of cases) {
    const before = JSON.stringify(state(s));
    assert.notEqual(await codeOf(s.story.equipRelic(P, 'water_dye_yarn')), 'NO_ERROR', name);
    assert.equal(JSON.stringify(state(s)), before, `${name}: 상태 불변`);
    assert.equal(slot(s, 'story_2').length, 0, name);
  }
  // story_2가 이미 차 있음
  const occ = setup();
  occ.db.seed('turby_equipment', { turby_instance_id: occ.nubiId, slot_key: 'story_2', item_definition_id: knitNeedleId(occ) });
  assert.equal(await codeOf(occ.story.equipRelic(P, 'water_dye_yarn')), 'STORY_SLOT_OCCUPIED');
  assert.equal(growth(occ), 1);
  // 인벤토리 판정도 같은 규칙: 조건이 모두 맞을 때만 버튼 활성
  const ok = setup();
  assert.equal((await ok.inventory.list(P)).items.find((i) => i.itemCode === 'water_dye_yarn')!.storyAction!.available, true);
  const noKnot = setup({ story1: false });
  assert.equal((await noKnot.inventory.list(P)).items.find((i) => i.itemCode === 'water_dye_yarn')!.storyAction!.available, false);
});

test('다른 플레이어 누비·일반 장비 API·클라이언트 직접 요청으로는 장착·완료할 수 없다', async () => {
  const s = setup();
  const other = s.db.seed('turby_instance', { owner_player_id: 2n, character_id: 1, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  (s.db.rows('player_story_progress', { player_id: P })[0] as { story_nubi_turby_instance_id: bigint }).story_nubi_turby_instance_id = other.id;
  assert.equal(await codeOf(s.story.equipRelic(P, 'water_dye_yarn')), 'STORY_NUBI_MISSING');
  assert.deepEqual(state(s), untouched);
  const g = setup();
  assert.equal(await codeOf(g.equipment.equip('1', String(g.nubiId), 'water_dye_yarn')), 'NOT_EQUIPPABLE');
  assert.equal(await codeOf(g.equipment.unequip('1', String(g.nubiId), 'story_2')), 'STORY_SLOT_RESERVED');
  assert.equal(await codeOf(g.story.completeEvent(P, 'lake_dye_thread_equipped')), 'STORY_EVENT_SERVER_ONLY');
  assert.equal(await codeOf(g.story.completeEvent(P, 'underfloor_unlocked')), 'STORY_EVENT_SERVER_ONLY');
  assert.deepEqual(state(g), untouched);
});

test('원자적 완료: 장착·성장 2·사건 둘·CH02_COMPLETE·3장 개방이 한 번에 기록되고 물빛 염색실 소유가 유지된다', async () => {
  const s = setup();
  assert.equal((await s.story.getState(P)).stages.find((x) => x.stageCode === 'underground')!.canEnter, false);
  const res = await s.story.equipRelic(P, 'water_dye_yarn');
  assert.equal(res.alreadyCompleted, false);
  assert.equal(res.play?.segmentId, 'ch02.chapter_complete');
  assert.deepEqual(state(s), { cp: 'CH02_COMPLETE', growth: 2, slot2: 1, events: 2 });
  assert.deepEqual(dyeRows(s).map((r) => r.quantity), [1], '보유 레코드 유지');
  const st = await s.story.getState(P);
  const under = st.stages.find((x) => x.stageCode === 'underground')!;
  assert.deepEqual([under.canEnter, st.storyNubi!.growthStage, st.storyNubi!.slots.map((x) => x.slotKey)], [true, 2, ['story_1', 'story_2']]);
  assert.equal(st.stages.find((x) => x.stageCode === 'lake')!.state, 'cleared');
  const again = await Promise.all(Array.from({ length: 5 }, () => s.story.equipRelic(P, 'water_dye_yarn')));
  assert.equal(again.every((r) => r.alreadyCompleted), true);
  await s.story.equipRelic(P, 'water_dye_yarn');
  assert.deepEqual(state(s), { cp: 'CH02_COMPLETE', growth: 2, slot2: 1, events: 2 });
  const it = (await s.inventory.list(P)).items.find((i) => i.itemCode === 'water_dye_yarn')!;
  assert.deepEqual([it.equippedOnStoryNubi, it.isLocked, it.storyAction], [true, true, null]);
  assert.deepEqual(Object.values(it.permissions), [false, false, false, false, false]);
});

test('동시 5건 첫 요청: 한 번만 기록되고 성장은 정확히 2', async () => {
  const s = setup();
  const res = await Promise.all(Array.from({ length: 5 }, () => s.story.equipRelic(P, 'water_dye_yarn')));
  assert.equal(res.filter((r) => !r.alreadyCompleted).length, 1);
  assert.deepEqual(state(s), { cp: 'CH02_COMPLETE', growth: 2, slot2: 1, events: 2 });
});

test('롤백: 완료 항목 하나라도 실패하면(이미 있는 개방 사건 충돌) 슬롯·성장·사건·체크포인트가 모두 그대로다', async () => {
  const s = setup({ events: [...DEFEATED, 'underfloor_unlocked'] });
  await assert.rejects(s.story.equipRelic(P, 'water_dye_yarn'));
  assert.equal(slot(s, 'story_2').length, 0);
  assert.equal(growth(s), 1);
  assert.equal(checkpoint(s), 'CH02_BOSS_DEFEATED');
  assert.equal(count(s, 'lake_dye_thread_equipped'), 0);
});

test('정본 장면: 문구·순서·{playerName} 토큰, cue는 nubi-color-restore 하나, 장면 완료는 한 번만 기록된다', async () => {
  const file = JSON.parse(readFileSync(join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch02.json'), 'utf8')) as { segments: { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: { kind: string; text: string; speakerLabel?: string; cameraCue: string | null }[] }[] };
  const seg = file.segments.find((x) => x.segmentId === 'ch02.chapter_complete')!;
  assert.deepEqual([seg.resumeFrom, seg.replayOnResume, seg.completesWith], ['CH02_COMPLETE', true, 'lake_chapter_complete_seen']);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const docs = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
  const md = readFileSync(join(docs, 'docs/scene/2장.md'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const from = md.findIndex((l) => l === '## 돌아온 색');
  const want: { who: string | null; text: string }[] = [];
  let who: string | null = null;
  for (const l of md.slice(from + 1)) {
    if (l.startsWith('>')) break;
    if (!l) continue;
    if (l.startsWith('**') && l.endsWith('**')) who = l.slice(2, -2);
    else if (l.startsWith('“')) {
      want.push({ who, text: l.replace(/^“/, '').replace(/”$/, '') });
      who = null;
    } else want.push({ who: null, text: l });
  }
  assert.equal(want.length, 6);
  assert.deepEqual(seg.entries.map((e) => [e.speakerLabel ?? null, e.text]), want.map((w) => [w.who, w.text]));
  assert.deepEqual(seg.entries.map((e) => e.kind), ['narration', 'line', 'line', 'line', 'narration', 'line']);
  assert.equal(seg.entries[3].text, '{playerName}. 이번에는 바로 기억났어.');
  assert.equal(seg.entries[2].speakerLabel, '{playerName}');
  assert.deepEqual(seg.entries.map((e) => e.cameraCue).filter(Boolean), ['nubi-color-restore']);

  const s = setup();
  assert.notEqual(await codeOf(s.story.completeEvent(P, 'lake_chapter_complete_seen')), 'NO_ERROR');
  await s.story.equipRelic(P, 'water_dye_yarn');
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch02.chapter_complete', '장착 뒤 장면 미완료: 재접속하면 장면 처음부터');
  assert.equal((await s.story.completeEvent(P, 'lake_chapter_complete_seen')).alreadyCompleted, false);
  assert.equal((await s.story.completeEvent(P, 'lake_chapter_complete_seen')).alreadyCompleted, true);
  assert.equal(count(s, 'lake_chapter_complete_seen'), 1);
  assert.deepEqual(state(s), { cp: 'CH02_COMPLETE', growth: 2, slot2: 1, events: 2 });
  assert.equal((await s.story.getState(P)).resume.segmentId, null);
  assert.equal(resumeOf({ checkpoint: 'CH02_COMPLETE', events: new Set(['lake_chapter_complete_seen']), objectives: new Map(), growthStage: 2 }).segmentId, null);
});

test('완료 후 호수: 보스·위기·구조 지점이 다시 열리지 않고 다음 목표가 표시된다(자유 탐험)', async () => {
  const s = setup({ checkpoint: 'CH02_COMPLETE', events: [...DEFEATED, 'lake_dye_thread_equipped', 'underfloor_unlocked', 'lake_chapter_complete_seen'] });
  const view = await s.story.stageData(P, 'lake');
  assert.deepEqual(view.points.map((p) => p.id), []);
  assert.equal(view.goal?.text, '마루바닥 밑에서 들려오는 울림을 따라가자.');
  await enter(s);
  const entry = await s.story.trigger(P, 'lake_entry');
  assert.equal(entry.play, null, '호수 재입장: 장면 미반복');
  assert.notEqual(await codeOf(s.battles.startStory('1', 'lake_boss_sewn_doll')), 'NO_ERROR');
});

test('에셋: nubi-color-restore는 1152×192·원본 해시 일치, 6프레임 8~10fps 등록, 1→6 순서 1회 재생(drain 역재생 아님)', () => {
  const bytes = readFileSync(join(ROOT, 'save-a-turby', 'src', 'assets', 'fx', 'story', 'nubi-color-restore.png'));
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1152, 192]);
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), '8F24BBB927F028D36240A5E00DE218655F9E4DD9F38CA99900A3D40A36947794');
  const reg = readFileSync(join(ROOT, 'save-a-turby', 'src', 'assets', 'registry.ts'), 'utf8');
  assert.match(reg, /'nubi-color-restore': \{ size: 192, frames: 6, fps: 9 \}/);
  const scene = readFileSync(join(ROOT, 'save-a-turby', 'src', 'scenes', 'OpeningScene.ts'), 'utf8');
  assert.match(scene, /'nubi-color-restore-once', frames: this\.anims\.generateFrameNumbers\('nubi-color-restore', \{ start: 0, end: sheet\.frames - 1 \}\), frameRate: sheet\.fps, repeat: 0/);
  assert.doesNotMatch(scene, /start: sheet\.frames - 1, end: 0/);
});
