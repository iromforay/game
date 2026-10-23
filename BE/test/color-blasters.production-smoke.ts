import assert from 'node:assert/strict';
import test from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { COLOR_BLASTERS_EVENTS } from '../src/color-blasters/color-blasters.types';

type Snapshot = {
  matchId: string;
  players: Array<{
    playerId: string;
    position: { x: number; z: number; facing: number };
    paintedZones: string[];
  }>;
};

const productionUrl = process.env.COLOR_BLASTERS_PRODUCTION_URL?.trim();
const productionAllowed = process.env.ALLOW_COLOR_BLASTERS_PRODUCTION_TEST === 'true';

function event<T>(socket: Socket, name: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs);
    socket.once(name, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}

function ack<T>(socket: Socket, name: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} ack timeout`)), 5_000);
    socket.emit(name, payload, (response: T) => { clearTimeout(timer); resolve(response); });
  });
}

async function connect(url: string) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 5_000 });
  if (!socket.connected) await event(socket, 'connect');
  return socket;
}

test('운영: u1·u2 동시 입장 후 u1 발사로 u2 몸통 피격을 BE가 확정한다', async () => {
  assert.equal(productionAllowed, true, '운영 스모크 테스트는 ALLOW_COLOR_BLASTERS_PRODUCTION_TEST=true가 필요합니다.');
  assert.ok(productionUrl, 'COLOR_BLASTERS_PRODUCTION_URL이 필요합니다.');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const u1Id = `smoke-u1-${suffix}`;
  const u2Id = `smoke-u2-${suffix}`;
  const u1 = await connect(productionUrl);
  const u2 = await connect(productionUrl);
  try {
    const u1Matched = event<Snapshot>(u1, COLOR_BLASTERS_EVENTS.matchFound);
    const u2Matched = event<Snapshot>(u2, COLOR_BLASTERS_EVENTS.matchFound);
    const [, , match1, match2] = await Promise.all([
      ack(u1, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: u1Id }),
      ack(u2, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: u2Id }),
      u1Matched,
      u2Matched,
    ]);
    assert.equal(match1.matchId, match2.matchId);
    assert.deepEqual(match1.players.map((player) => player.playerId).sort(), [u1Id, u2Id].sort());

    const attacker = match1.players.find((player) => player.playerId === u1Id)!;
    const target = match1.players.find((player) => player.playerId === u2Id)!;
    const stateEvent = event<Snapshot>(u2, COLOR_BLASTERS_EVENTS.state);
    assert.deepEqual(await ack(u1, COLOR_BLASTERS_EVENTS.fire, {
      origin: { x: attacker.position.x, y: 2.72, z: attacker.position.z },
      direction: { x: target.position.x - attacker.position.x, y: 0, z: target.position.z - attacker.position.z },
    }), { ok: true });
    const state = await stateEvent;
    const hitU2 = state.players.find((player) => player.playerId === u2Id)!;
    assert.equal(hitU2.paintedZones.includes('torso'), true);
  } finally {
    u1.emit(COLOR_BLASTERS_EVENTS.queueLeave, {});
    u2.emit(COLOR_BLASTERS_EVENTS.queueLeave, {});
    u1.disconnect();
    u2.disconnect();
  }
});
