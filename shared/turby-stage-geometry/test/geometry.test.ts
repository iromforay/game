// 공용 패키지 자체 시험(BE·프런트 없이 이 패키지만으로 돈다): 잘못된 데이터 거부와 경계 규칙.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyBlocked, CLIENT_BODY_HALF, checkMove, inLockedZone, parseStageGeometry, SERVER_BODY_HALF, StageGeometryError, stepWithSolids } from '../src/index.ts';

const SIZE = { width: 1000, height: 800 };
const base = () => ({
  size: { ...SIZE },
  spawnPoint: { x: 50, y: 50 },
  layout: {
    blockers: [{ id: 'b1', label: '', x: 300, y: 100, width: 100, height: 50 }],
    gates: [{ id: 'g1', label: '', x: 600, y: 100, width: 40, height: 100, openEvent: 'door_opened' }],
    zones: [{ id: 'z1', label: '', x: 700, y: 300, width: 200, height: 200, visibleAfter: 'door_opened' }],
  },
});

test('잘못된 지역 데이터는 어디가 왜 잘못인지 담아 거부한다', () => {
  assert.doesNotThrow(() => parseStageGeometry(base(), SIZE));
  for (const [mutate, expected] of [
    [(d: any) => (d.layout.blockers[0].width = 0), /0보다 커야/], // eslint-disable-line @typescript-eslint/no-explicit-any
    [(d: any) => (d.layout.blockers[0].shape = 'polygon'), /지원하지 않는 shape/], // eslint-disable-line @typescript-eslint/no-explicit-any
    [(d: any) => delete d.layout.gates[0].openEvent, /openEvent/], // eslint-disable-line @typescript-eslint/no-explicit-any
    [(d: any) => (d.spawnPoint = { x: 2000, y: 10 }), /spawnPoint: 지도 밖/], // eslint-disable-line @typescript-eslint/no-explicit-any
  ] as const) {
    const d = base();
    mutate(d);
    assert.throws(() => parseStageGeometry(d, SIZE, 'x'), (e: unknown) => e instanceof StageGeometryError && expected.test(e.message) && /x/.test(e.message));
  }
  assert.throws(() => parseStageGeometry([], SIZE), StageGeometryError);
});

test('경계 규칙: 서버 몸 ≤ 클라이언트 몸, 경계선 위는 바깥, 클라이언트가 설 수 있는 곳은 서버도 승인한다', () => {
  assert.ok(SERVER_BODY_HALF <= CLIENT_BODY_HALF);
  const g = parseStageGeometry(base(), SIZE);
  const r = g.blockers[0];
  assert.equal(bodyBlocked([r], { x: r.x - CLIENT_BODY_HALF, y: 120 }, CLIENT_BODY_HALF), false);
  assert.equal(bodyBlocked([r], { x: r.x - CLIENT_BODY_HALF + 1, y: 120 }, CLIENT_BODY_HALF), true);
  let at = { x: 350, y: 220 };
  for (let i = 0; i < 80; i++) {
    const next = stepWithSolids([r], at, { x: at.x, y: at.y - 2 });
    assert.equal(checkMove(g, [r], [], at, next), 'ok');
    at = next;
  }
  assert.equal(at.y, r.y + r.height + CLIENT_BODY_HALF);
});

test('잠긴 구역 안의 점 판정(야생 공개 규칙의 근거)', () => {
  const g = parseStageGeometry(base(), SIZE);
  const z = g.zones[0];
  assert.deepEqual([inLockedZone([z], { x: 800, y: 400 }), inLockedZone([z], { x: 100, y: 100 }), inLockedZone([z], { x: z.x, y: 400 })], [true, false, false], '경계선 위는 바깥');
  assert.equal(inLockedZone([], { x: 800, y: 400 }), false);
});
