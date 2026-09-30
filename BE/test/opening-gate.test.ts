// v15(사용자 확정): 오프닝 완료 전에는 신규·기존 계정 모두 마을 밖·사냥 불가 — 서버 방어 지점별 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { SessionService } from '../src/turby/session.service';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { BattleService } from '../src/turby/battle/battle.service';
import { RoomError } from '../src/turby/rooms/types';
import { BattleError } from '../src/turby/battle/battle-types';

const P = 1n;
const CHAPTERS: [number, string, string, string][] = [
  [1, 'forest', 'nubi', '1장 — 숲'],
  [2, 'lake', 'muldeuli', '2장 — 호수'],
  [3, 'underground', 'pokshini', '3장 — 지하'],
];

function setup(opts: { legacy?: boolean; v2?: boolean; checkpoint?: string } = {}) {
  const db = new FakeDb();
  db.seed('player', { id: P, device_uuid: 'dev-test-gate', nickname: opts.legacy ? '옛날유저' : '터비 탐험가', session_token: null });
  const charId = new Map<string, unknown>();
  for (const [order, stage, code, title] of CHAPTERS) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 2000, map_height: 2000 });
    charId.set(code, db.seed('turby_character', { code, name: code }).id);
  }
  if (opts.legacy) {
    db.seed('turby_instance', { owner_player_id: P, character_id: charId.get('nubi'), acquired_via: 'starter', created_at: new Date(2026, 0, 1) });
    db.seed('turby_instance', { owner_player_id: P, character_id: charId.get('nubi'), acquired_via: 'starter', created_at: new Date(2026, 0, 5) });
    db.seed('turby_instance', { owner_player_id: P, character_id: charId.get('nubi'), acquired_via: 'wild_capture', created_at: new Date(2026, 0, 9) }); // 1장 대표 포획 → 호수 권한
    const knit = db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon' });
    db.seed('player_item', { player_id: P, item_definition_id: knit.id, quantity: 2 });
    db.seed('player_story_progress', { player_id: P, origin: 'legacy_backfill', checkpoint: opts.checkpoint ?? 'OPENING_NOT_STARTED' });
  } else if (opts.checkpoint) {
    db.seed('player_story_progress', { player_id: P, checkpoint: opts.checkpoint });
  }
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? !!opts.v2 : d), number: () => 45000 };
  const access = new StageAccessService(db.client(), settings as never);
  const session = new SessionService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, session, access);
  const content = { stage: () => null, dialogue: () => null, battle: () => null, bannedNameWords: () => [] };
  const story = new StoryService(db.client(), rooms, settings as never, content as never, access);
  const battles = new BattleService(db.client(), settings as never, rooms, access, story, content as never);
  return { db, access, rooms, battles, story };
}

async function roomCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RoomError || e instanceof BattleError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

async function finishOpening(s: ReturnType<typeof setup>, legacy: boolean) {
  await s.story.completeEvent(P, 'opening_fall_completed');
  if (legacy) await s.story.completeEvent(P, 'opening_name_saved');
  else await s.story.saveName(P, '하늘');
  await s.story.completeEvent(P, 'story_nubi_granted');
}

test('1. 신규 계정: 오프닝 완료 전 숲 입장 거부(지역 상태도 전부 잠김·안내 문구)', async () => {
  const s = setup();
  assert.equal(await roomCode(s.rooms.createRoom('1', 'forest')), 'OPENING_REQUIRED');
  const st = await s.access.statuses(P);
  assert.ok(st.every((x) => !x.canEnter && x.state === 'locked' && x.lockedReason === 'OPENING_REQUIRED' && x.hint === '먼저 누비와 이야기를 마쳐 주세요.'));
  const state = await s.story.getState(P);
  assert.equal(state.openingRequired, true);
});

test('2. 기존 계정도 오프닝 완료 전 숲 입장 거부(오프닝 필수)', async () => {
  const s = setup({ legacy: true });
  assert.equal(await roomCode(s.rooms.createRoom('1', 'forest')), 'OPENING_REQUIRED');
  const state = await s.story.getState(P);
  assert.deepEqual([state.origin, state.openingRequired], ['legacy_backfill', true]);
});

test('3. 포획 기록·백필 입장 권한이 있어도 오프닝 미완료면 거부(신·구 판정 모두, 롤백 경로도 우회 불가)', async () => {
  for (const v2 of [false, true]) {
    const s = setup({ legacy: true, v2 });
    s.db.seed('player_story_event', { player_id: P, event_id: 'legacy_access_lake', source: 'legacy_backfill' });
    assert.equal(await s.access.entryDenial(P, 'lake', 2), 'OPENING_REQUIRED', `v2=${v2}`);
    assert.equal(await roomCode(s.rooms.createRoom('1', 'lake')), 'OPENING_REQUIRED', `v2=${v2}`);
  }
});

test('4. 탐험 세션 API 직접 호출(방 시작·맵 입장)도 거부', async () => {
  const s = setup({ checkpoint: 'OPENING_NAME_SAVED' });
  assert.equal(await roomCode(s.rooms.requireOpening('1')), 'OPENING_REQUIRED');
});

test('5. 남아 있던 탐험 세션은 재접속시키지 않고 마을 복귀 상태 반환(진행 데이터는 보존)', async () => {
  const s = setup({ checkpoint: 'OPENING_COMPLETE' });
  await s.rooms.identify('sock-1', 'dev-test-gate');
  await s.rooms.createRoom('1', 'forest');
  assert.ok(s.rooms.roomOf('1'));
  // 게이트 도입 전에 만들어진 세션을 흉내: 진행이 오프닝 미완료인 채로 세션만 남음
  s.db.rows('player_story_progress', { player_id: P })[0].checkpoint = 'OPENING_FALL_COMPLETE';
  const res = await s.rooms.identify('sock-2', 'dev-test-gate');
  assert.deepEqual([res.room, res.returnToVillage], [null, true]);
  assert.equal(s.rooms.roomOf('1'), undefined);
  assert.equal(s.db.rows('player_story_progress', { player_id: P })[0].checkpoint, 'OPENING_FALL_COMPLETE', '진행 데이터 삭제 없음');
});

test('6. 야생 조우·전투 시작 API 직접 호출도 거부', async () => {
  const s = setup({ legacy: true });
  assert.equal(await roomCode(s.battles.start('1', 0)), 'OPENING_REQUIRED');
});

test('7. 오프닝 완료 직후 숲 입장 가능', async () => {
  const s = setup();
  await finishOpening(s, false);
  await s.rooms.identify('sock-1', 'dev-test-gate');
  const room = await s.rooms.createRoom('1', 'forest');
  assert.equal(room.stageCode, 'forest');
  assert.equal((await s.access.statuses(P)).find((x) => x.stageCode === 'forest')!.canEnter, true);
});

test('8. 기존 계정은 오프닝 뒤 기존 지역 권한 복원(구 판정: 1장 대표 포획 → 호수)', async () => {
  const s = setup({ legacy: true });
  assert.equal(await s.access.canEnter(P, 'lake', 2), false);
  await finishOpening(s, true);
  assert.equal(await s.access.canEnter(P, 'lake', 2), true);
  assert.equal((await s.access.statuses(P)).find((x) => x.stageCode === 'lake')!.canEnter, true);
});

test('9. 기존 스타터·아이템·지역 기록 보존, 가장 오래된 스타터를 이야기 누비로(복제 없음)', async () => {
  const s = setup({ legacy: true });
  s.db.seed('player_story_event', { player_id: P, event_id: 'legacy_access_lake', source: 'legacy_backfill' });
  const before = s.db.rows('turby_instance', { owner_player_id: P }).length;
  await finishOpening(s, true);
  const turbys = s.db.rows('turby_instance', { owner_player_id: P });
  assert.equal(turbys.length, before, '새로 만들거나 지우지 않음');
  const companion = turbys.filter((x) => x.is_story_companion);
  assert.equal(companion.length, 1);
  assert.equal((companion[0].created_at as Date).getDate(), 1, '가장 오래된 스타터');
  const knit = s.db.rows('item_definition', { code: 'knit_needle' })[0];
  assert.equal(s.db.rows('player_item', { player_id: P, item_definition_id: knit.id })[0].quantity, 2, '아이템 보존');
  assert.equal(s.db.rows('player_story_event', { player_id: P, event_id: 'legacy_access_lake' }).length, 1, '백필 권한 보존');
  assert.equal(s.db.rows('player', { id: P })[0].nickname, '옛날유저', '기존 이름 보존');
});
