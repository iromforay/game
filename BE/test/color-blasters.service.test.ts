import assert from 'node:assert/strict';
import test from 'node:test';
import { ColorBlastersService } from '../src/color-blasters/color-blasters.service';

test('두 대기 사용자를 하나의 컬러 블래스터즈 경기에 배정한다', () => {
  const service = new ColorBlastersService();
  assert.equal(service.joinQueue('P1', 'S1').status, 'waiting');
  const result = service.joinQueue('P2', 'S2');
  assert.equal(result.status, 'matched');
  if (result.status === 'matched') assert.equal(result.match.players.length, 2);
});

test('서버가 발사 벡터로 피격 부위를 판정하고 네 부위에서 승리를 확정한다', () => {
  const service = new ColorBlastersService();
  service.joinQueue('P1', 'S1');
  service.joinQueue('P2', 'S2');
  const ys = [4.02, 2.72, 1.02, 1.02];
  const xs = [0, 0, -0.43, 0.43];
  let result = null;
  for (let index = 0; index < ys.length; index += 1) {
    result = service.fire('S2', { x: xs[index]!, y: ys[index]!, z: -10.5 }, { x: 0, y: 0, z: 1 }, 1_000 + index * 200);
  }
  assert.equal(result?.state.finished, true);
  assert.deepEqual(result?.result, { winnerId: 'P2', loserId: 'P1' });
});

test('서버는 비정상적으로 빠른 연사를 거부한다', () => {
  const service = new ColorBlastersService();
  service.joinQueue('P1', 'S1');
  service.joinQueue('P2', 'S2');
  service.fire('S1', { x: 0, y: 2.72, z: 9.5 }, { x: 0, y: 0, z: -1 }, 1_000);
  assert.throws(() => service.fire('S1', { x: 0, y: 2.72, z: 9.5 }, { x: 0, y: 0, z: -1 }, 1_050), /FIRE_RATE_LIMIT/);
});
