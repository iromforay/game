import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bagRoomFor,
  canEnterStage,
  canProgressChapter,
  chapterCodeOf,
  checkEvent,
  checkObjective,
  nextCheckpoint,
  resumeOf,
  slotsOf,
  toCheckpoint,
  validatePlayerName,
  type StorySnapshot,
} from '../src/turby/story/story-rules';
import { CHECKPOINTS, EVENT_BY_ID, OBJECTIVE_BY_KEY, STORY_EVENTS, type Checkpoint } from '../src/turby/story/story-data';

const snap = (checkpoint: Checkpoint, events: string[] = [], objectives: Record<string, string[]> = {}, growthStage = 0): StorySnapshot => ({
  checkpoint,
  events: new Set(events),
  objectives: new Map(Object.entries(objectives).map(([k, v]) => [k, new Set(v)])),
  growthStage,
});
const ev = (id: string) => EVENT_BY_ID.get(id)!;

test('전이표 무결성: 도착 체크포인트는 허용 시작보다 뒤, 선행·동반 이벤트는 모두 정의됨', () => {
  for (const e of STORY_EVENTS) {
    for (const r of [...e.requires, ...(e.alsoComplete ?? [])]) assert.ok(EVENT_BY_ID.has(r), `${e.id} → ${r}`);
    if (e.to) for (const a of e.allowedAt) assert.ok(CHECKPOINTS.indexOf(e.to) > CHECKPOINTS.indexOf(a), `${e.id}: ${a} → ${e.to}`);
  }
  // 전투 승리 계열은 서버 전용(REST로 위조 불가)
  for (const id of ['forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_giant_knot_defeated', 'lake_unlocked']) assert.equal(ev(id).serverOnly, true, id);
});

test('체크포인트 순서와 알 수 없는 값', () => {
  assert.equal(toCheckpoint('CH01_STARTED'), 'CH01_STARTED');
  assert.equal(toCheckpoint('HACKED'), 'OPENING_NOT_STARTED');
  assert.equal(nextCheckpoint('CH01_STARTED', 'CH01_BOPUL_RESCUED'), 'CH01_BOPUL_RESCUED');
  assert.equal(nextCheckpoint('CH01_COMPLETE', 'CH01_STARTED'), null, '뒤로 가지 않는다');
  assert.equal(nextCheckpoint('CH01_STARTED', undefined), null);
  assert.equal(chapterCodeOf('OPENING_NAME_SAVED'), 'opening');
  assert.equal(chapterCodeOf('OPENING_COMPLETE'), 'ch01');
  assert.equal(chapterCodeOf('CH01_COMPLETE'), 'ch02');
});

test('장 진행 판정: 백필 입장 권한이 있어도 이전 장 완료 전에는 진행 불가', () => {
  assert.equal(canProgressChapter(1, 'OPENING_NAME_SAVED'), false);
  assert.equal(canProgressChapter(1, 'OPENING_COMPLETE'), true);
  assert.equal(canProgressChapter(2, 'CH01_FIRST_KNOT_EQUIPPED'), false);
  assert.equal(canProgressChapter(2, 'CH01_COMPLETE'), true);
  const events = new Set(['legacy_access_lake']);
  assert.equal(canEnterStage('lake', events), true);
  assert.equal(canEnterStage('underground', events), false);
  assert.equal(canEnterStage('forest', new Set()), true);
  assert.equal(canEnterStage('ice', new Set(['fridge_unlocked'])), true, '정본 이벤트 ID ↔ 내부 stage_code(C4)');
});

test('이벤트 허용: 시작 상태·선행 이벤트·목표·성장 단계', () => {
  assert.equal(checkEvent(ev('opening_fall_completed'), snap('OPENING_NOT_STARTED')), null);
  assert.equal(checkEvent(ev('story_nubi_granted'), snap('OPENING_NOT_STARTED'))?.code, 'STORY_EVENT_NOT_ALLOWED');
  assert.equal(checkEvent(ev('forest_first_path_started'), snap('OPENING_NAME_SAVED'))?.code, 'CHAPTER_LOCKED');
  assert.equal(checkEvent(ev('forest_dansuring_clue_learned'), snap('CH01_STARTED', ['forest_first_path_started']))?.code, 'STORY_PREREQUISITE_MISSING');
  const nine = Array.from({ length: 9 }, (_, i) => `dust_0${i + 1}`);
  assert.equal(checkEvent(ev('forest_compass_granted'), snap('CH01_BOPUL_RESCUED', ['forest_dansuring_clue_learned'], { forest_glowing_dust: nine }))?.code, 'STORY_PREREQUISITE_MISSING');
  assert.equal(checkEvent(ev('forest_compass_granted'), snap('CH01_BOPUL_RESCUED', ['forest_dansuring_clue_learned'], { forest_glowing_dust: [...nine, 'dust_10'] })), null);
  assert.equal(checkEvent(ev('forest_primordial_knot_seen'), snap('CH01_FIRST_KNOT_EQUIPPED', ['forest_dansuring_found'], {}, 0))?.code, 'STORY_PREREQUISITE_MISSING', '장 완료는 성장 단계 1 확인');
  assert.equal(checkEvent(ev('forest_primordial_knot_seen'), snap('CH01_FIRST_KNOT_EQUIPPED', ['forest_dansuring_found'], {}, 1)), null);
});

test('수집 목표 활성 구간: 단서 전·나침판 뒤에는 비활성', () => {
  const dust = OBJECTIVE_BY_KEY.get('forest_glowing_dust')!;
  assert.equal(checkObjective(dust, snap('CH01_STARTED', ['forest_bopul_rescued'])) !== null, true);
  assert.equal(checkObjective(dust, snap('CH01_BOPUL_RESCUED', ['forest_dansuring_clue_learned'])), null);
  assert.equal(checkObjective(dust, snap('CH01_COMPASS_ACQUIRED', ['forest_dansuring_clue_learned'])) !== null, true);
  assert.deepEqual(dust.objectIds, ['dust_01', 'dust_02', 'dust_03', 'dust_04', 'dust_05', 'dust_06', 'dust_07', 'dust_08', 'dust_09', 'dust_10']);
});

test('재접속 위치: 오프닝 구간, 유물 장착 튜토리얼', () => {
  assert.deepEqual(resumeOf(snap('OPENING_NOT_STARTED')), { segmentId: 'opening.fall', tutorial: null });
  assert.deepEqual(resumeOf(snap('OPENING_NAME_SAVED')), { segmentId: 'opening.promise', tutorial: null }, '이름 되뇌기 구간은 재생하지 않는다');
  assert.deepEqual(resumeOf(snap('CH01_COMPASS_ACQUIRED', ['forest_giant_knot_defeated'])), { segmentId: 'ch01.first_knot_awaken', tutorial: null });
  assert.deepEqual(resumeOf(snap('CH01_COMPASS_ACQUIRED', ['forest_giant_knot_defeated', 'forest_first_knot_awakened'])), { segmentId: null, tutorial: 'relic_equip' });
});

test('이름 규칙(Codex D5)', () => {
  const ok = (s: unknown) => validatePlayerName(s, ['나쁜말']);
  assert.deepEqual(ok('  하늘  '), { ok: true, name: '하늘' });
  assert.deepEqual(ok('Kim 하늘 2'), { ok: true, name: 'Kim 하늘 2' });
  assert.equal(ok('가나다라마바사아자차').ok, true, '10자');
  assert.equal(ok('가나다라마바사아자차카').ok, false, '11자');
  assert.equal(ok('').ok, false);
  assert.equal(ok('   ').ok, false);
  assert.equal(ok('하  늘').ok, false, '연속 공백');
  assert.equal(ok('하늘!').ok, false, '특수문자');
  assert.equal(ok('ㅎㅎ').ok, false, '자모만');
  assert.equal(ok('터비 탐험가').ok, false, '기본값');
  assert.equal(ok('나 쁜말').ok, false, '금칙어(공백 무시)');
  assert.equal(ok(123).ok, false);
});

test('가방 칸 계산: 장비 1칸 1개, 중첩 아이템은 남은 자리부터', () => {
  assert.equal(slotsOf(0, 1), 0);
  assert.equal(slotsOf(3, 1), 3);
  assert.equal(slotsOf(100, 99), 2);
  assert.equal(bagRoomFor(0, 1, 40, 40), 0);
  assert.equal(bagRoomFor(0, 1, 39, 40), 1);
  assert.equal(bagRoomFor(5, 99, 40, 40), 94, '가득 찬 가방이어도 기존 칸의 남은 자리');
  assert.equal(bagRoomFor(0, 99, 45, 40), 0, '이미 초과한 기존 계정');
});
