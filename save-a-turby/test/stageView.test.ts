// M2 프런트 지역 상태 — 판정은 서버, 화면은 결과만. 서버 상태가 없으면 아무 지역도 열지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCards, currentCard, STAGE_LOAD_ERROR_HINT, type ServerStageStatus } from '../src/state/stageView.ts';

const CHAPTERS = [
  { order: 2, stageCode: 'lake', titleKo: '2장 — 호수' },
  { order: 1, stageCode: 'forest', titleKo: '1장 — 숲' },
];

const stage = (s: Partial<ServerStageStatus> & Pick<ServerStageStatus, 'stageCode' | 'order' | 'state'>): ServerStageStatus => ({
  title: s.stageCode,
  canEnter: s.state !== 'locked',
  canProgress: s.state === 'current' || s.state === 'cleared',
  lockedReason: null,
  hint: null,
  legacyTargetCode: null,
  ...s,
});

test('서버 상태를 받지 못하면 숲까지 포함해 모두 잠김, 다시 시도 안내', () => {
  const cards = toCards({ status: 'error' }, CHAPTERS);
  assert.deepEqual(cards.map((c) => [c.stageCode, c.state, c.enterable]), [
    ['forest', 'locked', false],
    ['lake', 'locked', false],
  ]);
  assert.ok(cards.every((c) => c.hint === STAGE_LOAD_ERROR_HINT));
  assert.equal(currentCard(cards), null, '현재 장도 추측하지 않음');
});

test('서버 상태를 그대로 표시: 로컬 포획 기록으로 판정하지 않음(입력에 포획 정보가 없다)', () => {
  const cards = toCards(
    {
      status: 'ready',
      stages: [
        stage({ stageCode: 'lake', order: 2, state: 'locked', canEnter: false, hint: '1장 — 숲의 이야기를 마치면 열립니다' }),
        stage({ stageCode: 'forest', order: 1, state: 'current' }),
      ],
    },
    CHAPTERS,
  );
  assert.deepEqual(cards.map((c) => [c.stageCode, c.state, c.enterable]), [
    ['forest', 'current', true],
    ['lake', 'locked', false],
  ]);
  assert.equal(currentCard(cards)?.stageCode, 'forest');
});

test('백필 지역(open): 들어갈 수는 있지만 현재 장은 아님, 안내 문구 유지', () => {
  const cards = toCards(
    {
      status: 'ready',
      stages: [
        stage({ stageCode: 'forest', order: 1, state: 'current' }),
        stage({ stageCode: 'lake', order: 2, state: 'open', canEnter: true, canProgress: false, lockedReason: 'PREVIOUS_CHAPTER', hint: '이전 장 이야기를 마치면 이 지역의 이야기가 시작됩니다' }),
      ],
    },
    CHAPTERS,
  );
  const lake = cards.find((c) => c.stageCode === 'lake')!;
  assert.deepEqual([lake.state, lake.enterable, lake.hint], ['open', true, '이전 장 이야기를 마치면 이 지역의 이야기가 시작됩니다']);
  assert.equal(currentCard(cards)?.stageCode, 'forest');
});

test('구 판정(롤백) 상태에서만 대표 터비 목적지가 전달된다', () => {
  const legacy = toCards({ status: 'ready', stages: [stage({ stageCode: 'forest', order: 1, state: 'current', legacyTargetCode: 'nubi' })] }, CHAPTERS);
  const v2 = toCards({ status: 'ready', stages: [stage({ stageCode: 'forest', order: 1, state: 'current' })] }, CHAPTERS);
  assert.equal(legacy[0].legacyTargetCode, 'nubi');
  assert.equal(v2[0].legacyTargetCode, null);
});
