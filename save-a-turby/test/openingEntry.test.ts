// v15(사용자 확정): 오프닝 완료 전에는 신규·기존 계정 모두 오프닝으로 가고, 마을 밖 이동은 서버 잠금 사유로 막는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootRoute, openingLocked, OPENING_REQUIRED_MESSAGE, type OpeningStoryState } from '../src/story/storyClient.ts';
import { toCards } from '../src/state/stageView.ts';

const st = (p: Partial<OpeningStoryState>): OpeningStoryState => ({
  checkpoint: 'OPENING_NOT_STARTED',
  needsName: true,
  playerName: '터비 탐험가',
  resume: { segmentId: 'opening.fall' },
  openingRequired: true,
  openingAvailable: true,
  openingStarted: false,
  ...p,
});

test('오프닝 미완료면 신규·기존 구분 없이 오프닝으로(서버의 openingRequired만 따름)', () => {
  assert.equal(bootRoute(st({})), 'opening', '신규');
  assert.equal(bootRoute(st({ needsName: false, playerName: '옛날유저' })), 'opening', '기존 계정(이름 있음)도 필수');
  assert.equal(bootRoute(st({ checkpoint: 'OPENING_NAME_SAVED', openingStarted: true })), 'opening', '진행 중');
});

test('오프닝을 마치면 마을로', () => {
  assert.equal(bootRoute(st({ checkpoint: 'OPENING_COMPLETE', openingRequired: false, openingAvailable: false, openingStarted: true })), 'village');
});

test('오프닝 잠금은 서버 지역 상태의 잠금 사유로만 판단하고, 모든 지역 카드가 들어갈 수 없게 표시된다', () => {
  const stages = ['forest', 'lake'].map((stageCode, i) => ({
    stageCode,
    order: i + 1,
    title: stageCode,
    state: 'locked' as const,
    canEnter: false,
    canProgress: false,
    lockedReason: 'OPENING_REQUIRED' as const,
    hint: OPENING_REQUIRED_MESSAGE,
    legacyTargetCode: null,
  }));
  assert.equal(openingLocked(stages), true);
  const cards = toCards({ status: 'ready', stages }, [
    { order: 1, stageCode: 'forest', titleKo: '숲' },
    { order: 2, stageCode: 'lake', titleKo: '호수' },
  ]);
  assert.ok(cards.every((c) => !c.enterable && c.hint === '먼저 누비와 이야기를 마쳐 주세요.'), '숲 포함 전부 잠김');
  assert.equal(openingLocked([{ lockedReason: 'STAGE_LOCKED' }, { lockedReason: null }]), false);
});

test('지역 상태를 못 받으면 마을 밖 이동을 허용하지 않음(전부 잠김)', () => {
  const cards = toCards({ status: 'error' }, [{ order: 1, stageCode: 'forest', titleKo: '숲' }]);
  assert.equal(cards[0].enterable, false);
});
