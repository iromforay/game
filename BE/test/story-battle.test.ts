// M4-B 스토리 전투 어댑터 테스트(Codex v15 8.5) — 실제 RoomsService·BattleService·StoryService + 메모리 Prisma
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { SessionService } from '../src/turby/session.service';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { BattleError } from '../src/turby/battle/battle-types';
import { EquipmentService } from '../src/turby/equipment.service';
import { InventoryService } from '../src/turby/inventory.service';
import { applyAction, createBattle, submitParty, toSnapshot } from '../src/turby/battle/battle-engine';
import type { BattleDefinition, BattleRules, BattleState } from '../src/turby/battle/battle-types';

const P = 1n;
const OTHER = 2n;
const NUMBERS: Record<string, number> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 3, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 60, 'room.reconnectGraceMs': 45000, 'battle.encounterRadiusPx': 200,
};
const EASY: BattleDefinition = { key: 'forest_stitchling_ambush', cornerEscape: false, units: [{ unitId: 'weak', side: 'wild', characterCode: 'stitchling', name: '실밥이', col: 2, row: 4, attack: 1, defense: 0, actionPower: 0, maxHp: 1, canAct: false }] };

function setup(opts: { checkpoint?: string; events?: string[]; nubi?: 'mine' | 'other' | 'none'; easy?: boolean } = {}) {
  const db = new FakeDb();
  db.seed('player', { id: P, device_uuid: 'dev-test-story-battle', nickname: '하늘' });
  db.seed('player', { id: OTHER, device_uuid: 'dev-test-other', nickname: '남' });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 2000, map_height: 2000 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  const nubiChar = db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  const shelf = db.seed('player_base_slot', { player_id: P, slot_index: 0 });
  const myNubi = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, base_slot_id: shelf.id, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 }); // 선반 보관 중
  const bag1 = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'shop', atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  const bag2 = db.seed('turby_instance', { owner_player_id: P, character_id: nubiChar.id, acquired_via: 'shop', atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  const otherNubi = db.seed('turby_instance', { owner_player_id: OTHER, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true, atk_bonus: 0, def_bonus: 0, ap_bonus: 0, hp_bonus: 0 });
  const nubiLink = opts.nubi === 'none' ? null : opts.nubi === 'other' ? otherNubi.id : myNubi.id;
  db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint ?? 'CH01_STARTED', story_nubi_turby_instance_id: nubiLink, nubi_growth_stage: 0 });
  for (const e of opts.events ?? ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected']) db.seed('player_story_event', { player_id: P, event_id: e });

  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d, number: (k: string) => NUMBERS[k] };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access, new StoryContentService());
  const realContent = new StoryContentService();
  const content = opts.easy ? { ...realContent, stage: (code: string) => realContent.stage(code), dialogue: () => null, bannedNameWords: () => [], battle: (k: string) => (k === 'forest_stitchling_ambush' ? EASY : realContent.battle(k)) } : realContent;
  const story = new StoryService(db.client(), rooms, settings as never, content as never, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content as never);
  battles.onModuleInit();
  return { db, rooms, battles, story, ids: { myNubi: String(myNubi.id), bag1: String(bag1.id), bag2: String(bag2.id), otherNubi: String(otherNubi.id) } };
}

async function enterForest(s: ReturnType<typeof setup>, socket = 's1') {
  await s.rooms.identify(socket, 'dev-test-story-battle');
  await s.rooms.createRoom('1', 'forest');
  s.rooms.startRoom('1');
  await s.rooms.enterMap('1', 'down');
  standAt(s, 'forest_bopuli_ambush');
}

// 시험 준비: 서버가 아는 내 위치를 그 이야기 지점으로(걷는 과정은 stage-position.test.ts가 확인한다)
const FOREST_POINTS = (new StoryContentService().stage('forest')!).points;
function standAt(s: ReturnType<typeof setup>, pointId: string) {
  const p = FOREST_POINTS.find((x) => x.id === pointId)!;
  Object.assign(s.rooms.roomOf('1')!.members[0], { x: p.x, y: p.y });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}
const events = (s: ReturnType<typeof setup>, id: string) => s.db.rows('player_story_event', { player_id: P, event_id: id }).length;

test('1. 잘못된 체크포인트·알 수 없는 전투·탐험 세션 밖에서는 시작 거부', async () => {
  const outside = setup();
  assert.equal(await code(outside.battles.startStory('1', 'forest_stitchling_ambush')), 'NOT_IN_ROOM', '탐험 세션 안에서만');
  const s = setup();
  await enterForest(s);
  assert.equal(await code(s.battles.startStory('1', 'forest_giant_knot')), 'STORY_ENCOUNTER_NOT_AVAILABLE', 'CH01_STARTED에서 보스전 불가');
  assert.equal(await code(s.battles.startStory('1', 'no_such_battle')), 'STORY_ENCOUNTER_UNKNOWN');
  assert.equal(await code(s.battles.startStory('1', '../x')), 'INVALID_PAYLOAD');
  const late = setup({ checkpoint: 'CH01_BOPUL_RESCUED', events: ['story_nubi_granted', 'forest_first_path_started', 'forest_bopul_rescued', 'forest_dansuring_clue_learned'] });
  await enterForest(late);
  assert.equal(await code(late.battles.startStory('1', 'forest_stitchling_ambush')), 'STORY_ENCOUNTER_NOT_AVAILABLE', '이미 지난 체크포인트');
});

test('2·3. 이야기 누비 자동 편성(선반 보관 중이어도)·파티 한 칸 사용', async () => {
  const s = setup();
  await enterForest(s);
  const snap = await s.battles.startStory('1', 'forest_stitchling_ambush');
  assert.equal(snap.phase, 'party_select');
  const res = await s.battles.party('1', snap.battleId, [s.ids.bag1]);
  const party = res.snapshot.units.filter((u) => u.side === 'party');
  assert.equal(party.length, 2, '누비 + 고른 1마리');
  assert.equal(party[0].unitId, 'p1-0');
  assert.equal(res.snapshot.units.some((u) => u.unitId === 'bopuli' && u.side === 'neutral'), true, '정의 데이터의 보풀이 NPC');
  // 상한 3: 누비가 한 칸을 쓰므로 고를 수 있는 건 2마리
  const s2 = setup();
  await enterForest(s2);
  const snap2 = await s2.battles.startStory('1', 'forest_stitchling_ambush');
  assert.equal(await code(s2.battles.party('1', snap2.battleId, [s2.ids.bag1, s2.ids.bag2, s2.ids.myNubi])), 'NO_ERROR', '누비를 직접 골라도 한 칸');
  const s3 = setup();
  await enterForest(s3);
  const snap3 = await s3.battles.startStory('1', 'forest_stitchling_ambush');
  assert.equal(await code(s3.battles.party('1', snap3.battleId, [s3.ids.bag1, s3.ids.bag2, s3.ids.bag1 + '0'])), 'PARTY_NOT_OWNED');
});

test('4. 이야기 누비가 없거나 다른 사람 것이면 시작 거부, 남의 터비는 편성 거부', async () => {
  for (const nubi of ['none', 'other'] as const) {
    const s = setup({ nubi });
    await enterForest(s);
    assert.equal(await code(s.battles.startStory('1', 'forest_stitchling_ambush')), 'STORY_NUBI_MISSING', nubi);
  }
  const s = setup();
  await enterForest(s);
  const snap = await s.battles.startStory('1', 'forest_stitchling_ambush');
  assert.equal(await code(s.battles.party('1', snap.battleId, [s.ids.otherNubi])), 'PARTY_NOT_OWNED');
});

test('5·6. 승리하면 승리 이벤트를 서버 경로로 1회만 기록, 재요청해도 중복 없음, 포획·야생 보상 없음', async () => {
  const s = setup({ easy: true });
  await enterForest(s);
  const before = s.db.rows('turby_instance', { owner_player_id: P }).length;
  const snap = await s.battles.startStory('1', 'forest_stitchling_ambush');
  await s.battles.party('1', snap.battleId, []);
  const res = await s.battles.action('1', { battleId: snap.battleId, actionId: 'a1', expectedVersion: (await s.battles.snapshot('1', snap.battleId)).version, type: 'attack', unitId: 'p1-0', targetUnitId: 'weak' });
  assert.equal(res.snapshot.outcome, 'win');
  assert.deepEqual(res.ended, { outcome: 'win', rewards: [], settled: true }, '포획·보상 없음');
  assert.equal(events(s, 'forest_stitchling_battle_won'), 1);
  assert.equal(events(s, 'forest_bopul_rescued'), 1, '동반 이벤트');
  // 같은 행동 재전송·스냅샷 재요청(정산 재시도 경로)
  await s.battles.action('1', { battleId: snap.battleId, actionId: 'a1', expectedVersion: 0, type: 'attack', unitId: 'p1-0', targetUnitId: 'weak' });
  await s.battles.snapshot('1', snap.battleId);
  assert.equal(events(s, 'forest_stitchling_battle_won'), 1, '중복 기록 없음');
  assert.equal(s.db.rows('turby_instance', { owner_player_id: P }).length, before, '포획 터비 없음');
  assert.equal(await code(s.battles.startStory('1', 'forest_stitchling_ambush')), 'STORY_ENCOUNTER_DONE', '이긴 전투는 다시 시작 불가');
  s.rooms.leaveRoom('1');
  assert.equal(await code(s.battles.startStory('1', 'forest_stitchling_ambush')), 'STORY_ENCOUNTER_DONE', '새로고침 복원 중(맵 밖)에도 이긴 전투는 DONE — 대화가 다음으로 넘어가는 근거');
  assert.equal((await s.story.getState(P)).resume.segmentId, 'ch01.bopul_clue', '다음 재생 구간');
});

test('7. 접속이 끊겨도 유예 안에 돌아오면 같은 전투로 복귀, 세션이 만료되면 전투는 취소되고 전투 직전부터 다시 시작', async () => {
  const s = setup();
  await enterForest(s);
  const snap = await s.battles.startStory('1', 'forest_stitchling_ambush');
  await s.battles.party('1', snap.battleId, []);
  s.rooms.disconnect('s1');
  await s.rooms.identify('s2', 'dev-test-story-battle'); // 유예 시간 안 재접속
  assert.equal((await s.battles.activeSnapshotOf('1'))?.battleId, snap.battleId);
  assert.equal(await code(s.battles.startStory('1', 'forest_stitchling_ambush')), 'NO_ERROR', '재요청은 같은 전투');
  assert.equal((await s.battles.startStory('1', 'forest_stitchling_ambush')).battleId, snap.battleId);
  // 유예 만료와 같은 경로(방에서 제거) → 전투 취소, 이벤트 기록 없음
  s.rooms.leaveRoom('1');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await s.battles.activeSnapshotOf('1'), null);
  assert.equal(events(s, 'forest_stitchling_battle_won'), 0);
  await s.rooms.createRoom('1', 'forest');
  s.rooms.startRoom('1');
  await s.rooms.enterMap('1', 'down');
  standAt(s, 'forest_bopuli_ambush');
  const again = await s.battles.startStory('1', 'forest_stitchling_ambush');
  assert.notEqual(again.battleId, snap.battleId, '전투 직전부터 새 전투');
  s.rooms.leaveRoom('1');
});

// ---- 8. 임시 전투 정의가 M4-A 엔진 계약으로 끝까지 완료 가능한지(간단한 자동 플레이) ----
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 5, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };

function tryAct(s: BattleState, req: Parameters<typeof applyAction>[2]): boolean {
  try {
    applyAction(s, 'a', req);
    return true;
  } catch (e) {
    if (e instanceof BattleError) return false;
    throw e;
  }
}

// 매 차례: 공격 가능한 적이 인접하면 공격, 아니면 가장 가까운 적 옆 칸 중 갈 수 있는 곳으로 이동, 할 게 없으면 턴 종료
function autoPlay(s: BattleState, maxRounds = 60) {
  const d = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  while (s.phase === 'player_subturn' && s.round <= maxRounds) {
    const me = s.units.find((u) => u.side === 'party' && !u.stunned)!;
    let acted = false;
    // 지금 공격 규칙상 칠 수 있는 대상만 노린다(부위가 남은 중심부·순서가 아닌 부위는 제외 — 엔진 attack()과 같은 판정)
    const live = s.units.filter((u) => u.side === 'wild' && !u.stunned && u.targetable !== false);
    const nextOrder = (core: string) => Math.min(...live.filter((p) => p.partOf === core).map((p) => p.breakOrder ?? 0));
    const foes = live
      .filter((u) => (!u.partOf || (u.breakOrder ?? 0) === nextOrder(u.partOf)) && !live.some((p) => p.partOf === u.unitId))
      .sort((a, b) => d(me, a) - d(me, b));
    for (const f of foes) if (d(me, f) === 1 && tryAct(s, { type: 'attack', unitId: me.unitId, targetUnitId: f.unitId })) { acted = true; break; }
    if (!acted && me.ap > 0) {
      outer: for (const f of foes) {
        const cells = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => ({ col: f.col + dc, row: f.row + dr })).sort((a, b) => d(me, a) - d(me, b));
        for (const c of cells) {
          for (let step = me.ap; step >= 1; step--) {
            // 목표 칸까지 한 번에 못 가면 그 방향으로 가능한 만큼 다가간다
            const tc = me.col + Math.sign(c.col - me.col) * Math.min(Math.abs(c.col - me.col), step);
            const tr = me.row + Math.sign(c.row - me.row) * Math.min(Math.abs(c.row - me.row), Math.max(0, step - Math.abs(tc - me.col)));
            if ((tc !== me.col || tr !== me.row) && tryAct(s, { type: 'move', unitId: me.unitId, targetCol: tc, targetRow: tr })) { acted = true; break outer; }
          }
        }
      }
    }
    if (!acted && s.phase === 'player_subturn') applyAction(s, 'a', { type: 'end' });
  }
}

function runDefinition(def: BattleDefinition) {
  const s = createBattle({ battleId: 'b', roomCode: 'R', stageCode: 'forest', spawnIndex: -1, encounterPlayerId: 'a', wild: { code: def.key, name: def.key, stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 1 } }, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: def });
  submitParty(s, 'a', [{ turbyId: 'nubi', characterCode: 'nubi', name: '누비', attack: 30, defense: 6, actionPower: 4, maxHp: 200 }]);
  autoPlay(s);
  return s;
}

test('8. 두 임시 전투 정의(데이터 파일)가 엔진 계약으로 끝까지 완료 가능', () => {
  const content = new StoryContentService();
  const ambush = content.battle('forest_stitchling_ambush')!;
  const knot = content.battle('forest_giant_knot')!;
  assert.ok(ambush && knot, '정의 파일 로드');

  const a = runDefinition(ambush);
  assert.deepEqual([a.phase, a.outcome], ['resolved', 'win'], '매복 전투 승리');
  assert.equal(a.units.find((u) => u.unitId === 'bopuli')!.stunned, false, '보풀이 무사');
  assert.ok(a.units.some((u) => u.fled), '일부 도주 연출');

  const k = runDefinition(knot);
  assert.deepEqual([k.phase, k.outcome], ['resolved', 'win'], '거대 매듭 승리(부위 순서대로 → 중심부)');
  assert.ok(['outer_strand_1', 'outer_strand_2', 'outer_strand_3'].every((id) => k.units.find((u) => u.unitId === id)!.stunned));
});

test('9. 스냅샷에 스토리 전투 표식(포획·야생 보상 없음)과 기본값을 채운 목표가 실린다 — 일반 야생 전투에는 없음', async () => {
  const s = setup();
  await enterForest(s);
  const snap = await s.battles.startStory('1', 'forest_stitchling_ambush');
  assert.deepEqual(snap.story, { encounterKey: 'forest_stitchling_ambush', captureEnabled: false, wildRewards: false });
  assert.deepEqual(snap.objectives, { win: [{ kind: 'defeat_all' }], lose: [{ kind: 'party_down' }, { kind: 'protect', unitIds: ['bopuli'] }] });

  const knot = toSnapshot(createBattle({ battleId: 'k', roomCode: 'R', stageCode: 'forest', spawnIndex: -1, encounterPlayerId: 'a', wild: { code: 'x', name: 'x', stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 1 } }, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }], definition: new StoryContentService().battle('forest_giant_knot')!, story: { encounterKey: 'forest_giant_knot' } }));
  assert.deepEqual(knot.objectives!.win, [{ kind: 'defeat_units', unitIds: ['giant_knot'] }]);
  assert.equal(snap.cornerEscape, false, '정의 전투는 꼭짓점 퇴각 기본 꺼짐');

  const wild = toSnapshot(createBattle({ battleId: 'w', roomCode: 'R', stageCode: 'forest', spawnIndex: 0, encounterPlayerId: 'a', wild: { code: 'nubi', name: '누비', stats: { attack: 1, defense: 1, actionPower: 1, maxHp: 1 } }, rules: RULES, participants: [{ playerId: 'a', nickname: 'a', slot: 1, connected: true }] }));
  assert.equal('story' in wild || 'objectives' in wild, false, '일반 야생 전투 스냅샷은 기존 형태 그대로');
});

// ---------- v4 §3 회귀: 스토리 규칙이 일반 전투·장비에 섞이지 않는다 ----------

test('v4 회귀: 일반 야생 전투 — 누비 강제 참가 없음·스토리 표식 없음·승리 시 포획 보상 지급, 스토리 이벤트는 그대로', async () => {
  const s = setup({ checkpoint: 'CH01_FIRST_KNOT_EQUIPPED' });
  const weak = s.db.seed('turby_grade', { id: 2, name: '약함', base_attack: 1, base_defense: 0, base_action_power: 0, base_hp: 1 });
  s.db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: weak.id, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  s.db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 0, character_code: 'bopuli', x: 1250, y: 1010 }); // 시험이 서 있는 자리(공터 지점) 바로 옆
  await enterForest(s);
  const eventsBefore = s.db.rows('player_story_event', { player_id: P }).length;
  const snap = await s.battles.start('1', 0);
  assert.equal(snap.story, undefined, '일반 전투에는 스토리 표식 없음');
  assert.equal(snap.objectives, undefined);
  const res = await s.battles.party('1', snap.battleId, [s.ids.bag1]);
  const party = res.snapshot.units.filter((u) => u.side === 'party');
  assert.equal(party.length, 1, '고른 터비만(이야기 누비 자동 편성 없음)');
  assert.notEqual(party[0].unitId, undefined);
  // 야생을 바로 옆으로(테스트 편의) 옮겨 한 번에 이긴다
  const rec = (s.battles as unknown as { battles: Map<string, { state: { units: { side: string; col: number; row: number }[] } }> }).battles.get(snap.battleId)!;
  const wildUnit = rec.state.units.find((u) => u.side === 'wild')!;
  const me = rec.state.units.find((u) => u.side === 'party')!;
  wildUnit.col = me.col + 1;
  wildUnit.row = me.row;
  const win = await s.battles.action('1', { battleId: snap.battleId, actionId: 'w1', expectedVersion: res.snapshot.version, type: 'attack', unitId: party[0].unitId, targetUnitId: (wildUnit as unknown as { unitId: string }).unitId });
  const ended = win.ended ?? (await s.battles.snapshot('1', snap.battleId)).ended;
  assert.equal(ended?.outcome, 'win');
  const mine = ended!.rewards.find((r) => r.playerId === '1')!;
  assert.equal(mine.rewardStatus, 'granted', '포획 보상 유지');
  assert.equal(mine.capturedTurby?.characterCode, 'bopuli');
  assert.equal(s.db.rows('turby_instance', { owner_player_id: P, acquired_via: 'wild_capture' }).length, 1);
  assert.equal(s.db.rows('player_story_event', { player_id: P }).length, eventsBefore, '일반 전투는 스토리 진행을 바꾸지 않음');
});

test('v4 회귀: 일반 장비 슬롯 장착·해제 정상, 일반 아이템은 스토리 잠금으로 보이지 않음', async () => {
  const s = setup({ checkpoint: 'CH01_FIRST_KNOT_EQUIPPED' });
  const needle = s.db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2, def_bonus: 0, ap_bonus: 0, hp_bonus: 0, max_stack: 1 });
  s.db.seed('player_item', { player_id: P, item_definition_id: needle.id, quantity: 1, is_new: false });
  const eq = new EquipmentService(s.db.client());
  const t = await eq.equip('1', s.ids.bag1, 'knit_needle');
  assert.deepEqual(t.equipment.map((e: { slotKey: string; itemCode: string }) => [e.slotKey, e.itemCode]), [['weapon', 'knit_needle']]);
  const inv = new InventoryService(s.db.client(), { numberOr: (_k: string, d: number) => d } as never);
  const row = (await inv.list(P)).items.find((i) => i.itemCode === 'knit_needle')!;
  assert.deepEqual([row.tabLabel, row.isLocked, row.permissions.sell, row.permissions.unequip, row.storyAction, row.equipped], ['장비', false, true, true, null, 1]);
  const off = await eq.unequip('1', s.ids.bag1, 'weapon');
  assert.equal(off.equipment.length, 0, '일반 슬롯 해제 가능');
});

// ---------- 10-06 v3 §2: 일반 전투 결과 복원·명시적 확인(battle:result:ack) ----------

async function normalSetup(wilds: number[] = [0]) {
  const s = setup({ checkpoint: 'CH01_FIRST_KNOT_EQUIPPED' });
  const weak = s.db.seed('turby_grade', { id: 2, name: '약함', base_attack: 1, base_defense: 0, base_action_power: 0, base_hp: 1 });
  s.db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: weak.id, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  for (const i of wilds) s.db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: i, character_code: 'bopuli', x: 1250, y: 1010 + i * 4 });
  await enterForest(s);
  return s;
}
// 야생 spawn을 만나 한 번에 이긴다(정산 포함). failSettles만큼 정산을 실패시킬 수 있다
async function winNormal(s: Awaited<ReturnType<typeof normalSetup>>, spawn: number, failSettles = 0) {
  (s.battles as unknown as { injectedSettleFailures: number }).injectedSettleFailures = failSettles;
  const snap = await s.battles.start('1', spawn);
  const res = await s.battles.party('1', snap.battleId, [s.ids.bag1]);
  const party = res.snapshot.units.filter((u) => u.side === 'party');
  const rec = (s.battles as unknown as { battles: Map<string, { state: { units: { side: string; col: number; row: number; unitId: string }[] } }> }).battles.get(snap.battleId)!;
  const wildUnit = rec.state.units.find((u) => u.side === 'wild')!;
  const me = rec.state.units.find((u) => u.side === 'party')!;
  wildUnit.col = me.col + 1;
  wildUnit.row = me.row;
  await s.battles.action('1', { battleId: snap.battleId, actionId: `w${spawn}`, expectedVersion: res.snapshot.version, type: 'attack', unitId: party[0].unitId, targetUnitId: wildUnit.unitId });
  return snap.battleId;
}
const captures = (s: Awaited<ReturnType<typeof normalSetup>>) => s.db.rows('turby_instance', { owner_player_id: P, acquired_via: 'wild_capture' }).length;

test('결과 확인: 정산된 미확인 결과는 hello가 내려 주고(여러 번 받아도 확인되지 않음), 명시적 확인을 여러 번 해도 같은 성공·보상 1회, 확인 뒤에는 복원되지 않는다', async () => {
  const s = await normalSetup();
  const id = await winNormal(s, 0);
  assert.equal(captures(s), 1);
  for (let i = 0; i < 3; i++) {
    const snap = await s.battles.activeSnapshotOf('1');
    assert.deepEqual([snap?.battleId, snap?.phase], [id, 'resolved'], '내려 줬다는 사실만으로는 확인 처리되지 않는다');
  }
  assert.deepEqual(await s.battles.acknowledgeResult('1', id), { acknowledged: true });
  assert.deepEqual(await s.battles.acknowledgeResult('1', id), { acknowledged: true }, '두 번째도 같은 성공');
  assert.equal(await s.battles.activeSnapshotOf('1'), null, '확인한 결과는 다시 열리지 않는다');
  assert.deepEqual([captures(s), s.db.rows('battle_result', { player_id: P }).length], [1, 1], '보상·포획 기록 1회');
});

test('결과 확인: 존재하지 않는 전투·남의 전투·끝나지 않은 전투·정산 전 전투는 확인 처리하지 않는다. 미정산 종료 전투는 hello가 먼저 재정산한다(정산 성공 전 확인 불가)', async () => {
  const s = await normalSetup([0, 1]);
  assert.equal(await code(s.battles.acknowledgeResult('1', 'no-such-battle')), 'BATTLE_EXPIRED');
  assert.equal(await code(s.battles.acknowledgeResult('1', undefined)), 'BATTLE_NOT_FOUND');
  // 끝나지 않은 전투
  const live = await s.battles.start('1', 1);
  assert.equal(await code(s.battles.acknowledgeResult('1', live.battleId)), 'BATTLE_NOT_ENDED');
  await s.battles.leave('1', live.battleId); // 정리(취소로 끝남 — 일반 전투 취소는 파티 미제출이라 결과 복원 대상이 아니다)
  // 남의 전투
  const s2 = await normalSetup();
  const id = await winNormal(s2, 0, 2); // 종료 때 정산 1회 실패(+ 이후 재시도 1회 실패)
  assert.equal(captures(s2), 0, '아직 정산되지 않았다');
  assert.equal(await code(s2.battles.acknowledgeResult('1', id)), 'RESULT_NOT_SETTLED', '정산 전에는 확인 불가');
  assert.equal(await code(s2.battles.acknowledgeResult('2', id)), 'NOT_PARTICIPANT', '남의 전투');
  const first = await s2.battles.activeSnapshotOf('1'); // 재정산 시도(실패 1회 더 남아 있음)
  assert.deepEqual([first?.battleId, first?.phase], [id, 'resolved']);
  assert.equal(captures(s2), 0);
  const second = await s2.battles.activeSnapshotOf('1'); // 이번에는 정산 성공
  assert.equal(second?.battleId, id);
  assert.deepEqual([captures(s2), s2.db.rows('battle_result', { player_id: P }).length], [1, 1], '재정산으로 보상 한 번');
  assert.deepEqual(await s2.battles.acknowledgeResult('1', id), { acknowledged: true });
});

test('결과 복원 우선순위·보존 기간: 진행 중 전투가 오래된 종료 결과보다 우선하고, 보존 기간이 지난 결과는 복원하지 않는다', async () => {
  const s = await normalSetup([0, 1]);
  const done = await winNormal(s, 0);
  assert.equal((await s.battles.activeSnapshotOf('1'))?.battleId, done, '진행 중 전투가 없으면 종료 결과');
  const live = await s.battles.start('1', 1);
  const snap = await s.battles.activeSnapshotOf('1');
  assert.deepEqual([snap?.battleId, snap?.phase === 'resolved'], [live.battleId, false], '진행 중 전투 우선');
  await s.battles.leave('1', live.battleId);
  // 보존 기간(시험에서는 0.05초) 뒤에는 복원하지 않는다
  NUMBERS['battle.resolvedRetentionSeconds'] = 0.05;
  const s3 = await normalSetup();
  await winNormal(s3, 0);
  NUMBERS['battle.resolvedRetentionSeconds'] = 60;
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await s3.battles.activeSnapshotOf('1'), null, '보존 기간이 지난 결과');
  assert.equal(captures(s3), 1, '보상 자체는 DB에 남아 있다');
});
