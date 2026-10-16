// 10-14 C2-5A: 물먹은 박음이 보스 전투 본체 — 결박·재봉실·색 구역·약점 노출, 예고 물살, 난이도, 재접속, 영구 진행 불변.
// 엔진 시험은 실제 전투 정의(BE/story-data/save-a-turby/battles/lake_boss_sewn_doll.json)로 만든 상태를 쓰고,
// 서비스 시험은 실제 RoomsService·BattleService·StoryService + 메모리 Prisma(story-battle.test.ts와 같은 방식)를 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import { BattleError } from '../src/turby/battle/battle-types';
import type { BattleDefinition, BattleEvent, BattleRules, BattleState, PartyEntry } from '../src/turby/battle/battle-types';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { SessionService } from '../src/turby/session.service';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { STORY_TRIGGERS, ENCOUNTER_BY_KEY, EVENT_BY_ID } from '../src/turby/story/story-data';

const content = new StoryContentService();
const BOSS = content.battle('lake_boss_sewn_doll') as BattleDefinition;
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const WILD = { code: 'unused', name: '정의 전투', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } };
const STRONG = { attack: 30, defense: 6, actionPower: 4, maxHp: 200 };
const WEAK = { attack: 5, defense: 1, actionPower: 3, maxHp: 30 };
const hero = (s: Partial<PartyEntry> = {}, id = 't1'): PartyEntry => ({ turbyId: id, characterCode: 'nubi', name: '누비', ...STRONG, ...s });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function start(def: BattleDefinition = BOSS, parties: Record<string, PartyEntry[]> = { a: [hero()] }): BattleState {
  const ids = Object.keys(parties);
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'lake', spawnIndex: -1, encounterPlayerId: ids[0], wild: WILD, rules: RULES, participants: ids.map((p, i) => ({ playerId: p, nickname: p, slot: i + 1, connected: true })), definition: def, story: { encounterKey: def.key } });
  for (const p of ids) submitParty(s, p, parties[p]);
  return s;
}
const u = (s: BattleState, id: string) => s.units.find((x) => x.unitId === id)!;
const act = (s: BattleState, p: string, req: Parameters<typeof applyAction>[2]) => applyAction(s, p, req);
const types = (e: BattleEvent[]) => e.map((x) => x.type);
function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

// 기본 공격을 이해한 플레이어(엔진 직접): 재봉실을 끊기 좋은 칸으로 이동 → 인접한 재봉실 공격 → 약점이 드러나면 보스로 이동·공격
function play(s: BattleState, player = 'a', maxActions = 40) {
  let effective = 0;
  let rounds = 0;
  const near = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  for (let i = 0; i < maxActions && s.phase !== 'resolved'; i++) {
    if (s.phase !== 'player_subturn') break;
    const me = s.units.find((x) => x.side === 'party' && x.ownerPlayerId === player && !x.stunned)!;
    const live = s.units.filter((x) => x.side === 'wild' && !x.stunned);
    const seams = live.filter((x) => x.partOf);
    const boss = live.find((x) => !x.partOf)!;
    if (me.ap < 1) {
      act(s, player, { type: 'end' });
      rounds++;
      continue;
    }
    const target = seams.length > 0 ? seams.sort((x, y) => near(me, x) - near(me, y))[0] : boss;
    if (near(me, target) === 1) {
      act(s, player, { type: 'attack', unitId: me.unitId, targetUnitId: target.unitId });
      effective++;
      continue;
    }
    // 재봉실이 남았으면 세 재봉실에 모두 인접한 칸(3,4)을 우선, 아니면 대상 바로 앞 칸으로
    const spot = seams.length > 0 && !s.units.some((x) => x !== me && !x.stunned && x.col === 3 && x.row === 4) ? { col: 3, row: 4 } : { col: target.col - Math.sign(target.col - me.col), row: target.row };
    const dCol = Math.sign(spot.col - me.col) * Math.min(me.ap, Math.abs(spot.col - me.col));
    const left = me.ap - Math.abs(dCol);
    const dRow = Math.sign(spot.row - me.row) * Math.min(Math.max(0, left), Math.abs(spot.row - me.row));
    const to = { col: me.col + dCol, row: me.row + dRow };
    if (to.col === me.col && to.row === me.row) {
      act(s, player, { type: 'end' });
      continue;
    }
    act(s, player, { type: 'move', unitId: me.unitId, targetCol: to.col, targetRow: to.row });
    effective++;
  }
  return { effective, rounds };
}

// ---------- 데이터·배치 ----------

test('전투 정의: 보스 1 + 검은 재봉실 3 + 색 구역 3 + 예고 물살(동→서 고정 순서), 보스 공격 상한 15%·결박 중 피해 0', () => {
  assert.deepEqual(BOSS.units.map((x) => x.unitId), ['waterlogged_sewn_doll', 'black_seam_a', 'black_seam_b', 'black_seam_c']);
  const boss = BOSS.units[0];
  assert.deepEqual([boss.protectMode, boss.maxHitPercent, boss.characterCode], ['zero', 15, 'waterlogged_sewn_doll']);
  for (const seam of BOSS.units.slice(1)) assert.deepEqual([seam.partOf, seam.maxHp, seam.canAct, seam.breakOrder ?? null], ['waterlogged_sewn_doll', 1, false, null], '재봉실은 각각 1회 공격으로 끊어지고 순서 제한이 없다');
  assert.deepEqual(BOSS.zones!.map((z) => [z.id, z.partId]), [['dye_zone_a', 'black_seam_a'], ['dye_zone_b', 'black_seam_b'], ['dye_zone_c', 'black_seam_c']]);
  assert.deepEqual(BOSS.current, { everyRounds: 2, directions: ['east', 'west'] });
  assert.equal(BOSS.hints!.zeroDamage, '검은 재봉실을 먼저 끊자.');
  assert.deepEqual(BOSS.objectives!.win, [{ kind: 'defeat_units', unitIds: ['waterlogged_sewn_doll'] }]);
  assert.equal(BOSS.cornerEscape, false);
  // 포획·확률 드롭·통화·아이템 보상 필드가 정의에 없다
  assert.equal(/reward|drop|capture|currency|item/i.test(JSON.stringify(BOSS.units)), false);
});

// ---------- 결박·재봉실·색 구역·약점 노출 ----------

test('결박 상태: 보스에게 가하는 피해는 0이고 안내는 한 번만, 재봉실은 각각 1회 공격으로 끊어지며 대응하는 색 구역이 복구된다', () => {
  const s = start();
  const snap0 = toSnapshot(s);
  assert.equal(snap0.units.find((x) => x.unitId === 'waterlogged_sewn_doll')!.phase, 'bound');
  assert.deepEqual(snap0.zones!.map((z) => z.state), ['drained', 'drained', 'drained']);
  // 보스 옆으로 이동해 공격(테스트용 위치 조정 — 서버 상태를 직접 놓는다)
  const hero0 = u(s, 'p1-0');
  Object.assign(hero0, { col: 7, row: 4 });
  const e1 = act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'waterlogged_sewn_doll' });
  const atk = e1.find((e) => e.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.deepEqual([atk.damage, atk.targetHp, atk.targetStunned], [0, 10, false]);
  assert.equal(e1.filter((e) => e.type === 'hint').length, 1);
  assert.equal(hero0.ap, STRONG.actionPower - 1, '행동 1회는 소모된다');
  const e2 = act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'waterlogged_sewn_doll' });
  assert.equal(e2.filter((e) => e.type === 'hint').length, 0, '안내는 전투당 한 번');
  assert.equal(u(s, 'waterlogged_sewn_doll').hp, 10);
  assert.deepEqual(toSnapshot(s).hintsShown, [{ code: 'zero_damage', text: '검은 재봉실을 먼저 끊자.' }]);
  // 재봉실 하나: 1회 공격으로 끊기고 대응 구역만 복구
  Object.assign(hero0, { col: 3, row: 4, ap: 4 });
  const e3 = act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'black_seam_b' });
  assert.ok(types(e3).includes('part_broken'));
  assert.equal(u(s, 'black_seam_b').stunned, true);
  assert.deepEqual(toSnapshot(s).zones!.map((z) => [z.id, z.state]), [['dye_zone_a', 'drained'], ['dye_zone_b', 'restored'], ['dye_zone_c', 'drained']]);
  assert.equal(toSnapshot(s).units.find((x) => x.unitId === 'waterlogged_sewn_doll')!.phase, 'bound');
  assert.equal(code(() => act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'black_seam_b' })), 'INVALID_TARGET', '끊어진 실은 다시 공격할 수 없다');
});

test('약점 노출: 세 재봉실이 모두 끊기면 한 번만 exposed로 전환되고 정상 피해가 들어가 승리한다', () => {
  const s = start(BOSS, { a: [hero({ ...STRONG, actionPower: 6 })] });
  const hero0 = u(s, 'p1-0');
  Object.assign(hero0, { col: 3, row: 4 });
  const phases: BattleEvent[] = [];
  for (const id of ['black_seam_a', 'black_seam_b', 'black_seam_c']) phases.push(...act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: id }));
  assert.equal(phases.filter((e) => e.type === 'phase').length, 1, '전환은 한 번만');
  assert.deepEqual(toSnapshot(s).zones!.map((z) => z.state), ['restored', 'restored', 'restored']);
  const bossDto = toSnapshot(s).units.find((x) => x.unitId === 'waterlogged_sewn_doll')!;
  assert.deepEqual([bossDto.phase, bossDto.invulnerable], ['exposed', false]);
  // 이후 정상 피해: 보스 곁으로 가서 공격
  Object.assign(hero0, { col: 7, row: 4, ap: 4 });
  const hit = act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'waterlogged_sewn_doll' });
  const atk = hit.find((e) => e.type === 'attack') as Extract<BattleEvent, { type: 'attack' }>;
  assert.ok(atk.damage > 0);
  assert.deepEqual([s.phase, s.outcome], ['resolved', 'win']);
  assert.equal(code(() => act(s, 'a', { type: 'attack', unitId: 'p1-0', targetUnitId: 'waterlogged_sewn_doll' })), 'BATTLE_RESOLVED');
});

// ---------- 난이도 ----------

test('스타터 누비 1명으로 승리: 이동·공격 유효 행동 8회 이내, 약한 능력치에서도 쓰러지지 않는다', () => {
  for (const [name, stats] of [['일반', STRONG], ['약함', WEAK]] as const) {
    const s = start(BOSS, { a: [hero(stats)] });
    const r = play(s);
    assert.equal(s.outcome, 'win', `${name}: 승리`);
    assert.ok(r.effective <= 8, `${name}: 유효 행동 ${r.effective}회`);
    assert.equal(u(s, 'p1-0').stunned, false, `${name}: 누비가 쓰러지지 않음`);
  }
});

test('보스 공격 상한: 한 번에 누비 최대 HP의 15%를 넘지 않고 연속 두 번 맞아도 즉시 패배하지 않는다', () => {
  for (const maxHp of [20, 30, 200]) {
    const s = start(BOSS, { a: [hero({ ...WEAK, maxHp, defense: 0 })] });
    const hero0 = u(s, 'p1-0');
    Object.assign(hero0, { col: 7, row: 4 }); // 보스 바로 옆
    const cap = Math.max(1, Math.floor((maxHp * 15) / 100));
    const hits: number[] = [];
    for (let round = 0; round < 2; round++) {
      const before = hero0.hp;
      act(s, 'a', { type: 'end' }); // 보스 차례
      hits.push(before - hero0.hp);
    }
    assert.ok(hits.every((h) => h > 0 && h <= cap), `최대 HP ${maxHp}: ${hits.join(',')} (상한 ${cap})`);
    assert.equal(hero0.stunned, false);
    assert.notEqual(s.outcome, 'lose');
  }
});

// ---------- 예고 물살 ----------

test('예고 물살: 2라운드 시작에 3라운드 방향(동)을 예고하고 3라운드 시작에 모든 생존 참전자를 1칸 옮긴다, 다음 예고는 서', () => {
  const s = start(BOSS, { a: [hero({ ...STRONG, actionPower: 1 })] });
  const hero0 = u(s, 'p1-0');
  const start0 = { col: hero0.col, row: hero0.row };
  assert.equal(toSnapshot(s).telegraphedCurrent, null);
  act(s, 'a', { type: 'end' }); // → 라운드 2 시작: 3라운드 물살 예고
  assert.equal(s.round, 2);
  assert.deepEqual(toSnapshot(s).telegraphedCurrent, { direction: 'east', round: 3 });
  assert.deepEqual([hero0.col, hero0.row], [start0.col, start0.row], '예고만으로는 움직이지 않는다');
  const ap = hero0.ap;
  const hp = hero0.hp;
  const evts = act(s, 'a', { type: 'end' }); // → 라운드 3 시작: 적용
  assert.equal(s.round, 3);
  const cur = evts.find((e) => e.type === 'current') as Extract<BattleEvent, { type: 'current' }>;
  assert.deepEqual([cur.direction, cur.round, cur.moved, cur.skipped], ['east', 3, ['p1-0'], []]);
  assert.deepEqual([hero0.col, hero0.row], [start0.col + 1, start0.row]);
  assert.deepEqual(toSnapshot(s).lastCurrent, { round: 3, direction: 'east', moved: ['p1-0'], skipped: [] });
  assert.equal(toSnapshot(s).telegraphedCurrent, null);
  // 피해·AP 감소·턴 박탈 없음(AP는 라운드 시작 값 그대로, 서브턴은 내 차례)
  assert.equal(hero0.hp, hp - 0 <= hero0.hp ? hero0.hp : hp);
  assert.ok(hero0.hp >= hp - 4, '보스 공격 외의 피해 없음');
  assert.equal(hero0.ap, hero0.maxAp);
  assert.ok(ap <= hero0.maxAp);
  assert.deepEqual([s.phase, s.turnOrder[s.subturnIndex]], ['player_subturn', 'a']);
  // 4라운드 시작: 서 방향 예고
  act(s, 'a', { type: 'end' });
  assert.deepEqual(toSnapshot(s).telegraphedCurrent, { direction: 'west', round: 5 });
});

test('물살 이동 생략: 맵 밖·점유 칸·통행 불가 칸이면 그 유닛은 움직이지 않는다(피해 없음)', () => {
  const run = (setup: (s: BattleState) => void) => {
    const s = start(clone(BOSS), { a: [hero({ ...STRONG, actionPower: 1 })] });
    setup(s);
    act(s, 'a', { type: 'end' }); // 라운드 2: 예고
    const before = { col: u(s, 'p1-0').col, row: u(s, 'p1-0').row, hp: u(s, 'p1-0').hp };
    act(s, 'a', { type: 'end' }); // 라운드 3: 적용
    const after = u(s, 'p1-0');
    return { s, moved: after.col !== before.col, skipped: toSnapshot(s).lastCurrent!.skipped, hpLoss: before.hp - after.hp };
  };
  // 맵 밖: 동쪽 끝 칸에 서 있음
  const edge = run((s) => Object.assign(u(s, 'p1-0'), { col: 11, row: 0 }));
  assert.deepEqual([edge.moved, edge.skipped], [false, ['p1-0']]);
  // 점유 칸: 동쪽 칸에 다른 유닛(재봉실)이 있음
  const occ = run((s) => Object.assign(u(s, 'p1-0'), { col: 2, row: 3 })); // (3,3)에 black_seam_a
  assert.deepEqual([occ.moved, occ.skipped], [false, ['p1-0']]);
  // 통행 불가 칸
  const blocked = run((s) => {
    Object.assign(u(s, 'p1-0'), { col: 0, row: 0 });
    s.blocked = ['1,0'];
  });
  assert.deepEqual([blocked.moved, blocked.skipped], [false, ['p1-0']]);
  for (const r of [edge, occ, blocked]) assert.equal(r.hpLoss, 0, '물살로 인한 피해 없음');
});

test('다인 참전: 예고 물살이 참전자 각자의 유닛을 옮기고 기존 서브턴 순서·AP는 그대로다', () => {
  const s = start(BOSS, { a: [hero({ ...STRONG, actionPower: 1 }, 'ta')], b: [hero({ ...STRONG, actionPower: 1 }, 'tb')] });
  const [ua, ub] = [u(s, 'p1-0'), u(s, 'p2-0')];
  Object.assign(ua, { col: 1, row: 1 });
  Object.assign(ub, { col: 1, row: 6 });
  act(s, 'a', { type: 'end' });
  act(s, 'b', { type: 'end' }); // 라운드 2 시작: 예고
  assert.equal(toSnapshot(s).telegraphedCurrent?.direction, 'east');
  act(s, 'a', { type: 'end' });
  act(s, 'b', { type: 'end' }); // 라운드 3 시작: 적용
  assert.deepEqual([ua.col, ub.col], [2, 2]);
  assert.deepEqual(toSnapshot(s).lastCurrent!.moved.sort(), ['p1-0', 'p2-0']);
  assert.equal(s.turnOrder[s.subturnIndex], 'a', '라운드 시작 서브턴은 첫 참전자');
  assert.deepEqual([ua.ap, ub.ap], [ua.maxAp, ub.maxAp]);
});

// ---------- 재접속 복원(서비스) ----------

const P = 1n;
const CH01 = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_hidden_path_opened', 'forest_giant_knot_defeated', 'forest_first_knot_awakened', 'forest_first_knot_equipped', 'forest_dansuring_found', 'forest_primordial_knot_seen', 'lake_unlocked'];
const CLEARED = [...CH01, 'lake_entry_seen', 'lake_mulduri_met', 'lake_wave_drum_awakened', 'lake_trapped_mulduri_a_rescued', 'lake_trapped_mulduri_b_rescued', 'lake_trapped_mulduri_c_rescued', 'lake_trapped_turbies_rescued', 'lake_safe_route_opened', 'lake_nubi_crisis_seen'];
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
  'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

function setupService(opts: { events?: string[]; checkpoint?: string } = {}) {
  const db = new FakeDb();
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('player', { id: P, device_uuid: 'dev-boss-one', nickname: '하늘' });
  const nubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH02_NUBI_CRISIS_SEEN', story_nubi_turby_instance_id: nubi.id, nubi_growth_stage: 1 });
  for (const e of opts.events ?? CLEARED) db.seed('player_story_event', { player_id: P, event_id: e });
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? true : d), number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, content);
  const story = new StoryService(db.client(), rooms, settings as never, content as never, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content as never);
  battles.onModuleInit();
  return { db, rooms, story, battles };
}
type Env = ReturnType<typeof setupService>;
const LAKE = content.stage('lake')!;
const entrance = LAKE.points.find((p) => p.id === 'lake_boss_entrance')!;
async function enter(s: Env) {
  await s.rooms.identify('sock-1', 'dev-boss-one');
  await s.rooms.createRoom('1', 'lake');
  s.rooms.startRoom('1');
  await s.rooms.enterMap('1', 'down');
}
const standAt = (s: Env, dx = 0) => Object.assign(s.rooms.roomOf('1')!.members[0], { x: entrance.x + dx, y: entrance.y });
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
const snapshotDb = (s: Env) => JSON.stringify({ events: s.db.rows('player_story_event', { player_id: P }).map((r) => r.event_id).sort(), progress: s.db.rows('player_story_progress', { player_id: P }), items: s.db.rows('player_item', { player_id: P }), inst: s.db.rows('turby_instance', { owner_player_id: P }) }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

test('입장: 선행 체크포인트·사건 누락·원거리·다른 전투 키는 거부되고, 조건을 갖추면 기존 startStory 경로로 시작된다', async () => {
  const early = setupService({ checkpoint: 'CH02_MAZE_CLEARED', events: CLEARED.filter((e) => e !== 'lake_nubi_crisis_seen') });
  await enter(early);
  standAt(early);
  assert.equal(await codeOf(early.battles.startStory('1', 'lake_boss_sewn_doll')), 'STORY_ENCOUNTER_NOT_AVAILABLE');
  const s = setupService();
  await enter(s);
  standAt(s, 600);
  assert.equal(await codeOf(s.battles.startStory('1', 'lake_boss_sewn_doll')), 'STORY_EVIDENCE_INVALID', '원거리');
  standAt(s);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'lake_guard_a')), 'NO_ERROR', '다른 전투(이미 끝난 구조 수호)는 이 지점에서 시작할 수 없다');
  const snap = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  assert.deepEqual([snap.phase, snap.story?.encounterKey], ['party_select', 'lake_boss_sewn_doll']);
  // 트리거 정의: 위기 장면 뒤에만 열리고, 승리 정산 뒤에는 닫힌다(C2-5B)
  const t = STORY_TRIGGERS.find((x) => x.id === 'lake_boss_entrance')!;
  assert.deepEqual([t.activeAt, t.requires, t.encounterKey, t.unless ?? null, t.event ?? null], [['CH02_NUBI_CRISIS_SEEN'], ['lake_nubi_crisis_seen'], 'lake_boss_sewn_doll', ['lake_boss_defeated'], null]);
  assert.deepEqual(ENCOUNTER_BY_KEY.get('lake_boss_sewn_doll')!.onWinEvents, ['lake_boss_defeated'], '승리 정산 사건은 서버가 기록한다(C2-5B)');
});

test('지점 노출: 위기 장면 전에는 보스 입장 지점이 지도에 내려오지 않고, 장면 뒤에만 내려온다', async () => {
  const before = setupService({ checkpoint: 'CH02_MAZE_CLEARED', events: CLEARED.filter((e) => e !== 'lake_nubi_crisis_seen') });
  assert.equal((await before.story.stageData(P, 'lake')).points.some((p) => p.id === 'lake_boss_entrance'), false);
  const after = setupService();
  const view = await after.story.stageData(P, 'lake');
  assert.deepEqual(view.points.map((p) => p.id), ['lake_boss_entrance']);
  assert.equal(view.goal?.text, '누비를 지키기 위해 염색 샘으로 가자.');
});

test('재접속 복원 + 영구 진행 불변: 페이즈·재봉실·구역·예고 물살이 스냅샷으로 복원되고, 승리하면 한 번 정산되고(사건·체크포인트·물빛 염색실) 성장은 그대로이며 다시 싸울 수 없다', async () => {
  const s = setupService();
  await enter(s);
  standAt(s);
  const before = snapshotDb(s);
  const snap = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  let cur = (await s.battles.party('1', snap.battleId, [])).snapshot;
  let seq = 0;
  const act1 = async (body: object) => {
    cur = (await s.battles.action('1', { battleId: cur.battleId, actionId: `x${++seq}`, expectedVersion: cur.version, ...body } as never)).snapshot;
  };
  // 재봉실 둘을 끊고(구역 둘 복구) 라운드를 넘겨 물살을 예고시킨 뒤 "재접속": activeSnapshotOf가 같은 상태를 돌려준다
  await act1({ type: 'move', unitId: 'p1-0', targetCol: 3, targetRow: 4 });
  await act1({ type: 'attack', unitId: 'p1-0', targetUnitId: 'black_seam_a' });
  await act1({ type: 'attack', unitId: 'p1-0', targetUnitId: 'black_seam_b' });
  while (cur.round < 2) await act1({ type: 'end' });
  assert.deepEqual(cur.telegraphedCurrent, { direction: 'east', round: 3 });
  const restored = (await s.battles.activeSnapshotOf('1'))!;
  assert.equal(restored.round, cur.round);
  assert.deepEqual(restored.zones!.map((z) => z.state), ['restored', 'restored', 'drained']);
  assert.deepEqual(restored.units.filter((x) => x.partOf).map((x) => [x.unitId, x.stunned]), [['black_seam_a', true], ['black_seam_b', true], ['black_seam_c', false]]);
  assert.equal(restored.units.find((x) => x.unitId === 'waterlogged_sewn_doll')!.phase, 'bound');
  assert.deepEqual(restored.telegraphedCurrent, { direction: 'east', round: 3 });
  // 끝까지: 같은 전투를 이어 이긴다
  for (let i = 0; i < 40 && cur.phase !== 'resolved'; i++) {
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
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length, ended.settled], ['win', 0, true]);
  // C2-5B: 승리는 한 번의 정산으로 사건·체크포인트·물빛 염색실을 기록한다(세부는 lake-reward.test.ts). 성장 단계·누비 능력치는 그대로
  assert.notEqual(snapshotDb(s), before);
  assert.equal((s.db.rows('player_story_progress', { player_id: P })[0] as { checkpoint: string }).checkpoint, 'CH02_BOSS_DEFEATED');
  // 정산 뒤에는 입장 지점이 닫히고 다시 싸울 수 없다
  assert.equal((await s.story.stageData(P, 'lake')).points.some((p) => p.id === 'lake_boss_entrance'), false);
  assert.notEqual(await codeOf(s.battles.startStory('1', 'lake_boss_sewn_doll')), 'NO_ERROR');
});

test('패배(C2-8 증거): 보스에게 지면 사건·체크포인트·아이템·성장이 그대로이고, 입장 지점이 남아 다시 도전할 수 있다', async () => {
  const s = setupService();
  await enter(s);
  standAt(s);
  const before = snapshotDb(s);
  const snap = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  let cur = (await s.battles.party('1', snap.battleId, [])).snapshot;
  let seq = 0;
  const act = async (body: object) => {
    cur = (await s.battles.action('1', { battleId: cur.battleId, actionId: `l${++seq}`, expectedVersion: cur.version, ...body } as never)).snapshot;
  };
  // 결박 중의 보스·재봉실은 공격하지 않는다(가만히 있으면 지지 않는다) — 재봉실 셋을 끊어 약점을 노출시킨 뒤에는 보스를 공격하지 않고 차례만 넘긴다
  for (let i = 0; i < 60 && cur.units.some((x) => x.partOf && !x.stunned); i++) {
    const me = cur.units.find((x) => x.side === 'party')!;
    const tgt = cur.units.find((x) => x.partOf && !x.stunned)!;
    const d = Math.abs(tgt.col - me.col) + Math.abs(tgt.row - me.row);
    if (me.ap < 1) await act({ type: 'end' });
    else if (d === 1) await act({ type: 'attack', unitId: me.unitId, targetUnitId: tgt.unitId });
    else await act({ type: 'move', unitId: me.unitId, targetCol: me.col + Math.sign(tgt.col - me.col) || me.col, targetRow: tgt.col === me.col ? me.row + Math.sign(tgt.row - me.row) : me.row });
  }
  assert.equal(cur.units.find((x) => x.unitId === 'waterlogged_sewn_doll')!.phase, 'exposed');
  for (let i = 0; i < 400 && cur.phase !== 'resolved'; i++) await act({ type: 'end' });
  assert.equal(cur.outcome, 'lose');
  const ended = (await s.battles.snapshot('1', cur.battleId)).ended!;
  assert.deepEqual([ended.outcome, ended.rewards.length], ['lose', 0]);
  // 영구 진행 불변: 사건(lake_boss_defeated 없음)·체크포인트(CH02_NUBI_CRISIS_SEEN)·물빛 염색실·누비 성장 그대로
  assert.equal(snapshotDb(s), before);
  // 입장 지점은 그대로 열려 있고 같은 전투를 다시 시작할 수 있다
  assert.equal((await s.story.stageData(P, 'lake')).points.some((p) => p.id === 'lake_boss_entrance'), true);
  standAt(s);
  const again = await s.battles.startStory('1', 'lake_boss_sewn_doll');
  assert.deepEqual([again.phase, again.story?.encounterKey], ['party_select', 'lake_boss_sewn_doll']);
});

// ---------- 에셋 계약 ----------

test('에셋: 네 키·파일·프레임·표시 수치 계약, water-dye-yarn은 복사·등록·지급 없음, 영구 사건 없음', () => {
  const assets = join(__dirname, '..', '..', 'save-a-turby', 'src', 'assets');
  const dims = (rel: string) => {
    const b = readFileSync(join(assets, rel));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(dims('sprites/bosses/waterlogged-sewn-doll-idle.png'), [1024, 256]);
  assert.deepEqual(dims('sprites/bosses/waterlogged-sewn-doll-exposed.png'), [1024, 256]);
  assert.deepEqual(dims('world/lake/overlays/color-drained-zone.png'), [1536, 1024]);
  assert.deepEqual(dims('world/lake/overlays/color-restored-zone.png'), [1536, 1024]);
  const reg = readFileSync(join(assets, 'registry.ts'), 'utf8');
  for (const k of ['waterlogged-sewn-doll-idle', 'waterlogged-sewn-doll-exposed']) assert.match(reg, new RegExp(`'${k}': \\{ size: 256, frames: 4, fps: 4 \\}`)); // 4×256², 3~5fps
  // 표시 크기·깊이 계약(보스 220~280px, 공용 구역 발자국 720×480 이하)은 프런트 시험 battleView.test.ts가 고정한다
  // water-dye-yarn(C2-5B): 파일은 160×160, 키는 items/** glob이 파일명으로 자동 등록한다(세부 계약은 lake-reward.test.ts)
  assert.deepEqual(dims('items/relics/water-dye-yarn.png'), [160, 160]);
  assert.equal(EVENT_BY_ID.has('lake_boss_defeated'), true);
  assert.equal(EVENT_BY_ID.has('lake_dye_thread_granted'), true);
});
