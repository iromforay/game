// 10-06 v1 §2·§3: 잠긴 구역 안의 야생은 그 플레이어에게 응답으로 나가지 않고(ID·종류·좌표 모두), 구역이 열리면 재접속 없이 공개된다.
// 조우 반경은 서버 설정 하나가 Map 계약(map:enter·presence:hello)으로 내려간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { RoomsService } from '../src/turby/rooms/rooms.service';
import { SessionService } from '../src/turby/session.service';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryContentService } from '../src/turby/story/story-content.service';
import { encounterRadiusPx } from '../src/turby/rooms/encounter-radius';
import type { Room, WildRuntime } from '../src/turby/rooms/types';

const COMPASS = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_cut_thread_inspected', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted'];
const OPENED = [...COMPASS, 'forest_hidden_path_opened'];
const OPEN_WILD = { index: 0, x: 1650, y: 2080 }; // 처음부터 열려 있는 곳
const HIDDEN_WILD = { index: 9, x: 2300, y: 1000 }; // 숨은 길 너머 구역(forest_hidden_path_opened 전에는 잠김)
let radius: unknown = 120;

function setup(players: { id: bigint; device: string; events: string[] }[]) {
  const db = new FakeDb();
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  for (const w of [OPEN_WILD, HIDDEN_WILD]) db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: w.index, character_code: 'bopuli', x: w.x, y: w.y });
  for (const p of players) {
    db.seed('player', { id: p.id, device_uuid: p.device, nickname: `p${p.id}` });
    db.seed('player_story_progress', { player_id: p.id, checkpoint: 'CH01_COMPASS_ACQUIRED', nubi_growth_stage: 0 });
    for (const e of p.events) db.seed('player_story_event', { player_id: p.id, event_id: e });
  }
  const settings = { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d, number: (k: string) => (k === 'battle.encounterRadiusPx' ? (radius as number) : 1000) };
  const content = new StoryContentService();
  const access = new StageAccessService(db.client(), settings as never);
  const rooms = new RoomsService(db.client(), settings as never, new SessionService(db.client(), settings as never), access, content);
  const enter = async (p: { id: bigint; device: string }) => {
    await rooms.identify(`sock-${p.id}`, p.device);
    await rooms.createRoom(p.id.toString(), 'forest');
    rooms.startRoom(p.id.toString());
    return rooms.enterMap(p.id.toString(), 'down');
  };
  return { rooms, enter };
}

const A = { id: 1n, device: 'dev-wild-vis-a', events: COMPASS }; // 구역이 아직 잠겨 있다
const B = { id: 2n, device: 'dev-wild-vis-b', events: OPENED }; // 구역이 열려 있다

test('잠긴 구역의 야생: 응답에 ID·종류·좌표가 실리지 않는다 — 플레이어마다 따로 판정된다', async () => {
  const { rooms, enter } = setup([A, B]);
  const a = await enter(A);
  const b = await enter(B);
  assert.deepEqual(a.wilds.map((w) => w.index), [0], '잠긴 구역의 야생(9)은 목록에 없다');
  assert.deepEqual(b.wilds.map((w) => w.index), [0, 9], '구역이 열린 플레이어에게는 보인다');
  // 숨겨진 야생의 어떤 정보도 응답 어디에도 없다(visible:false로 같이 보내지 않는다)
  const json = JSON.stringify({ self: a.self, corrected: a.corrected, players: a.others, wilds: a.wilds, encounterRadiusPx: a.encounterRadiusPx }); // 게이트웨이가 클라이언트에 보내는 필드 그대로
  assert.doesNotMatch(json, /"index":9|"x":2300|"y":1000/);
  // 재접속(presence:hello)이 쓰는 목록도 같다
  assert.deepEqual(rooms.wildsFor(rooms.roomOf('1')!, '1').map((w) => w.index), [0]);
  assert.deepEqual(rooms.wildsFor(rooms.roomOf('2')!, '2').map((w) => w.index), [0, 9]);
  // 한 플레이어가 숨은 야생에 접근하는 요청도 서버에는 없는 것과 같다
  const room = rooms.roomOf('1')!;
  assert.equal(rooms.wildVisibleTo(room, '1', room.wilds[1]), false);
  assert.equal(rooms.wildVisibleTo(rooms.roomOf('2')!, '2', rooms.roomOf('2')!.wilds[1]), true);
});

test('구역이 열리면(이벤트 기록) 재접속 없이 그 야생이 공개되고 그 플레이어에게만 알린다. 이미 보이던 야생은 다시 알리지 않는다', async () => {
  const { rooms, enter } = setup([A, B]);
  await enter(A);
  await enter(B);
  const revealed: [string, number][] = [];
  rooms.events.on('wild:revealed', (_room: Room, playerId: string, w: WildRuntime) => revealed.push([playerId, w.index]));
  rooms.noteStoryEvents('1', ['forest_hidden_path_opened']);
  assert.deepEqual(revealed, [['1', 9]], 'A에게만, 새로 보이게 된 야생만');
  assert.deepEqual(rooms.wildsFor(rooms.roomOf('1')!, '1').map((w) => w.index), [0, 9], '다음 조회부터 목록에 있다(별도 재접속 없음)');
  rooms.noteStoryEvents('1', ['forest_hidden_path_opened']);
  assert.equal(revealed.length, 1, '같은 이벤트를 다시 기록해도 알림은 한 번');
  assert.deepEqual(rooms.wildsFor(rooms.roomOf('2')!, '2').map((w) => w.index), [0, 9]);
});

test('조우 반경: 입장 계약에 서버 설정값이 실리고, 설정을 바꾸면 다음 입장 응답에 바뀐 값이 실린다. 0 이하·숫자 아님은 설정 오류', async () => {
  radius = 120;
  const first = setup([A]);
  assert.equal((await first.enter(A)).encounterRadiusPx, 120);
  radius = 25; // 40보다 작은 조건
  const second = setup([A]);
  assert.equal((await second.enter(A)).encounterRadiusPx, 25);
  radius = 400; // 40보다 큰 조건
  const third = setup([A]);
  assert.equal((await third.enter(A)).encounterRadiusPx, 400);
  for (const bad of [0, -5, Number.NaN]) assert.throws(() => encounterRadiusPx({ number: () => bad }), /positive number/);
  assert.throws(() => encounterRadiusPx({ number: () => { throw new Error('missing'); } }), /missing/);
  assert.equal(encounterRadiusPx({ number: () => 40 }), 40);
  radius = 120;
});
