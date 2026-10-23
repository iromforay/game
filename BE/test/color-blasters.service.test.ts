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
  service.move('S1', { x: 8, z: 9.5, facing: 0 });
  service.move('S2', { x: 8, z: -10.5, facing: 0 });
  const ys = [4.02, 2.72, 1.02, 1.02];
  const xs = [0, 0, -0.43, 0.43];
  let result = null;
  for (let index = 0; index < ys.length; index += 1) {
    result = service.fire('S2', { x: 8 + xs[index]!, y: ys[index]!, z: -10.5 }, { x: 0, y: 0, z: 1 }, 1_000 + index * 200);
  }
  assert.equal(result?.state.finished, true);
  assert.deepEqual(result?.result, { winnerId: 'P2', loserId: 'P1' });
});

test('방벽은 이동을 막고 방벽 뒤 대상에게 향한 페인트탄을 차단한다', () => {
  const service = new ColorBlastersService();
  service.joinQueue('P1', 'S1');
  service.joinQueue('P2', 'S2');
  const moved = service.move('S1', { x: 0, z: 6.2, facing: 0 });
  service.move('S2', { x: 0, z: -10.5, facing: 0 });
  assert.deepEqual(moved.players.find((player) => player.playerId === 'P1')?.position, { x: 0, z: 9.5, facing: 0 });

  const result = service.fire('S2', { x: 0, y: 2.72, z: -10.5 }, { x: 0, y: 0, z: 1 }, 1_000);
  assert.equal(result.hitZone, null);
  assert.deepEqual(result.state.players.find((player) => player.playerId === 'P1')?.paintedZones, []);
});

test('새 방벽의 시각 경계와 서버 이동 경계가 일치한다', () => {
  const blocked = new ColorBlastersService();
  blocked.joinQueue('P1', 'S1');
  blocked.joinQueue('P2', 'S2');
  blocked.move('S1', { x: 3.09, z: 9.5, facing: 0 });
  const blockedMove = blocked.move('S1', { x: 3.09, z: 6.2, facing: 0 });
  assert.equal(blockedMove.players.find((player) => player.playerId === 'P1')?.position.z, 9.5);

  const clear = new ColorBlastersService();
  clear.joinQueue('P1', 'S1');
  clear.joinQueue('P2', 'S2');
  clear.move('S1', { x: 3.11, z: 9.5, facing: 0 });
  const clearMove = clear.move('S1', { x: 3.11, z: 6.2, facing: 0 });
  assert.equal(clearMove.players.find((player) => player.playerId === 'P1')?.position.z, 6.2);
});

test('서버는 비정상적으로 빠른 연사를 거부한다', () => {
  const service = new ColorBlastersService();
  service.joinQueue('P1', 'S1');
  service.joinQueue('P2', 'S2');
  service.fire('S1', { x: 7, y: 2.72, z: 9.5 }, { x: 0, y: 0, z: -1 }, 1_000);
  assert.throws(() => service.fire('S1', { x: 7, y: 2.72, z: 9.5 }, { x: 0, y: 0, z: -1 }, 1_050), /FIRE_RATE_LIMIT/);
});
