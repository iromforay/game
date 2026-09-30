// M2 지역 개방 판정 테스트 — 신 판정(이벤트)·구 판정(포획, 롤백)·백필 입장 권한과 이야기 진행 분리
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { FakeDb } from './helpers/fake-prisma';
import { StageAccessService } from '../src/turby/story/stage-access.service';
import { StoryService } from '../src/turby/story/story.service';
import { legacyReachedOrder, legacyServerCanEnter, v2Statuses, type ChapterRow } from '../src/turby/story/stage-access';
import { checkEvent } from '../src/turby/story/story-rules';
import type { StoryEventDef } from '../src/turby/story/story-data';

const P = 1n;
const CHAPTERS: [number, string, string, string][] = [
  [1, 'forest', 'nubi', '1장 — 숲'],
  [2, 'lake', 'muldeuli', '2장 — 호수'],
  [3, 'underground', 'pokshini', '3장 — 지하'],
  [4, 'ice', 'ganeuri', '4장 — 얼음'],
  [5, 'desert', 'geumbiti', '5장 — 사막'],
];
const ROWS: ChapterRow[] = CHAPTERS.map(([order, stageCode, , title]) => ({ order, stageCode, title }));
const CLEAR = new Map(CHAPTERS.map(([order, , code]) => [order, code]));

function setup(v2: boolean) {
  const db = new FakeDb();
  db.seed('player', { id: P, device_uuid: 'dev-test-stage', nickname: '하늘' });
  const charId = new Map<string, unknown>();
  for (const [order, stage, code, title] of CHAPTERS) {
    db.seed('story_chapter', { chapter_order: order, stage_code: stage, clear_character_code: code, title, map_width: 1000, map_height: 1000 });
    charId.set(code, db.seed('turby_character', { code, name: code === 'nubi' ? '누비' : code }).id);
  }
  const settings = { numberOr: (_k: string, d: number) => d, flag: (k: string, d: boolean) => (k === 'story.stageAccessV2' ? v2 : d) };
  const access = new StageAccessService(db.client(), settings as never);
  const capture = (code: string) => db.seed('turby_instance', { owner_player_id: P, character_id: charId.get(code), acquired_via: 'wild_capture' });
  const event = (id: string, source = 'story') => db.seed('player_story_event', { player_id: P, event_id: id, source });
  // 지역 판정 테스트는 오프닝을 마친 계정을 기준으로 한다(v15: 미완료면 모든 야생 지역 잠김 — 별도 테스트)
  const progress = db.seed('player_story_progress', { player_id: P, checkpoint: 'OPENING_COMPLETE' });
  const checkpoint = (cp: string) => void (progress.checkpoint = cp);
  return { db, access, settings, capture, event, checkpoint };
}

const stage = async (access: StageAccessService, code: string) => (await access.statuses(P)).find((s) => s.stageCode === code)!;

test('신 판정: 장 개방 이벤트가 있으면 입장 가능', async () => {
  const s = setup(true);
  s.checkpoint('CH01_COMPLETE');
  s.event('lake_unlocked');
  assert.equal(await s.access.canEnter(P, 'lake', 2), true);
  assert.deepEqual([(await stage(s.access, 'lake')).state, (await stage(s.access, 'forest')).state], ['current', 'cleared']);
  assert.equal(await s.access.canEnter(P, 'underground', 3), false);
  assert.equal(await s.access.canEnter(P, 'forest', 1), true, '숲은 항상');
});

test('신 판정: 대표 터비를 새로 포획해도 이벤트가 없으면 열리지 않음', async () => {
  const s = setup(true);
  s.capture('nubi');
  s.capture('muldeuli');
  assert.equal(await s.access.canEnter(P, 'lake', 2), false);
  assert.equal(await s.access.canEnter(P, 'underground', 3), false);
  const lake = await stage(s.access, 'lake');
  assert.deepEqual([lake.state, lake.lockedReason, lake.legacyTargetCode], ['locked', 'STAGE_LOCKED', null]);
  await assert.rejects(s.access.requireEnter(P, 'lake', 2), (e: HttpException) => (e.getResponse() as { code: string }).code === 'STAGE_LOCKED');
});

test('백필 입장 권한: 지역에는 들어가지만 이전 장 완료 전 이야기 진행은 거부', async () => {
  const s = setup(true);
  s.checkpoint('CH01_STARTED');
  s.event('legacy_access_lake', 'legacy_backfill');
  const lake = await stage(s.access, 'lake');
  assert.deepEqual([lake.canEnter, lake.canProgress, lake.state, lake.lockedReason], [true, false, 'open', 'PREVIOUS_CHAPTER']);
  assert.equal(lake.hint, '이전 장 이야기를 마치면 이 지역의 이야기가 시작됩니다');
  assert.equal((await stage(s.access, 'forest')).state, 'current', '현재 장은 아직 숲');
  // 2장 스토리 이벤트(가상 정의)는 1장 완료 전 거부
  const ch2Event: StoryEventDef = { id: 'lake_entry_seen', chapter: 2, allowedAt: ['CH01_COMPLETE'], requires: [], evidence: { kind: 'none' } };
  const snap = { checkpoint: 'CH01_STARTED' as const, events: new Set(['legacy_access_lake']), objectives: new Map(), growthStage: 0 };
  assert.equal(checkEvent(ch2Event, snap)?.code, 'CHAPTER_LOCKED');
  // 2장 대화 파일도 내려주지 않는다(스포일러 방지)
  const content = { dialogue: () => ({}), stage: () => null, bannedNameWords: () => [] };
  const story = new StoryService(s.db.client(), { roomOf: () => undefined, memberPosition: () => null } as never, s.settings as never, content as never, s.access);
  await assert.rejects(story.dialogue(P, 'ch02'), (e: HttpException) => (e.getResponse() as { code: string }).code === 'CHAPTER_LOCKED');
});

test('구 규칙 보존: 연속 포획한 기존 계정은 가장 먼 개방 지역이 그대로', () => {
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set()), 1);
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set(['nubi'])), 2);
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set(['nubi', 'muldeuli', 'pokshini'])), 4);
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set(['nubi', 'muldeuli', 'pokshini', 'ganeuri', 'geumbiti'])), 5, '마지막 장에서 멈춤');
});

test('중간 포획 기록이 빠진 계정은 뒤 지역이 잘못 열리지 않음', () => {
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set(['muldeuli', 'pokshini'])), 1, '1장 대표가 없으면 호수부터 잠김');
  assert.equal(legacyReachedOrder(ROWS, CLEAR, new Set(['nubi', 'pokshini'])), 2, '2장 대표가 없으면 지하부터 잠김');
});

test('플래그 false(롤백): 구 서버 판정과 구 화면 규칙이 그대로 동작', async () => {
  const s = setup(false);
  s.capture('nubi');
  assert.equal(await s.access.canEnter(P, 'lake', 2), true, '이전 장 대표 포획으로 입장(구 requireUnlocked와 동일)');
  assert.equal(await s.access.canEnter(P, 'underground', 3), false);
  const statuses = await s.access.statuses(P);
  assert.deepEqual(statuses.map((x) => x.state), ['cleared', 'current', 'locked', 'locked', 'locked']);
  assert.equal(statuses[1].legacyTargetCode, 'muldeuli', '구 규칙에서만 맵 목적지(대표 터비) 제공');
  assert.equal(statuses[2].hint, "2장 — 호수의 대표 터비 'muldeuli'를 직접 포획하면 열립니다");
  // 구 서버 입장 검사는 "이전 장 대표"만 봤다(연속 여부는 화면 규칙) — 롤백 시 동작을 바꾸지 않는다
  assert.equal(legacyServerCanEnter(3, CLEAR, new Set(['muldeuli'])), true);
});

test('같은 계정을 플래그만 바꿔 신·구 판정 전환(데이터 변경 없이 롤백 가능)', async () => {
  const on = setup(true);
  on.capture('nubi');
  assert.equal(await on.access.canEnter(P, 'lake', 2), false);
  const off = new StageAccessService(on.db.client(), { numberOr: (_k: string, d: number) => d, flag: (_k: string, d: boolean) => d } as never);
  assert.equal(await off.canEnter(P, 'lake', 2), true);
});

test('신 판정 상태 계산: 완료·현재·잠김 표시와 잠금 안내', () => {
  const list = v2Statuses(ROWS, new Set(['lake_unlocked']), 'CH01_COMPLETE');
  assert.deepEqual(list.map((x) => x.state), ['cleared', 'current', 'locked', 'locked', 'locked']);
  assert.equal(list[2].hint, '2장 — 호수의 이야기를 마치면 열립니다');
});
