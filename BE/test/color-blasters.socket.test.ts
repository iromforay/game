import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { COLOR_BLASTERS_EVENTS } from '../src/color-blasters/color-blasters.types';

type Ack = { ok: boolean; status?: 'waiting' | 'matched'; error?: string };
type Snapshot = {
  matchId: string;
  finished: boolean;
  players: Array<{
    playerId: string;
    position: { x: number; z: number; facing: number };
    paintedZones: string[];
  }>;
};

let app: INestApplication;
let serverUrl = '';
const sockets: Socket[] = [];

function onceEvent<T>(socket: Socket, event: string, timeoutMs = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`${event} event timeout`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

function emitAck<T = Ack>(socket: Socket, event: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 2_000);
    socket.emit(event, body, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function connectClient() {
  const socket = io(serverUrl, { forceNew: true, reconnection: false, timeout: 2_000 });
  sockets.push(socket);
  if (!socket.connected) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('connect event timeout')), 2_000);
      const onConnect = () => finish();
      const onError = (error: Error) => finish(error);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        if (error) reject(error);
        else resolve();
      };
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
  }
  return socket;
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('테스트 서버 포트를 확인할 수 없습니다.');
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await app.close();
});

test('u1과 u2가 동시에 입장해 같은 경기에 배정되고 이동 상태가 전파된다', async () => {
  const u1 = await connectClient();
  const u2 = await connectClient();
  const u1Matched = onceEvent<Snapshot>(u1, COLOR_BLASTERS_EVENTS.matchFound);
  const u2Matched = onceEvent<Snapshot>(u2, COLOR_BLASTERS_EVENTS.matchFound);
  const [u1Join, u2Join, u1Match, u2Match] = await Promise.all([
    emitAck(u1, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'u1' }),
    emitAck(u2, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'u2' }),
    u1Matched,
    u2Matched,
  ]);
  assert.deepEqual([u1Join.status, u2Join.status].sort(), ['matched', 'waiting']);
  assert.equal(u1Match.matchId, u2Match.matchId);
  assert.deepEqual(u1Match.players.map((player) => player.playerId).sort(), ['u1', 'u2']);

  const stateReceived = onceEvent<Snapshot>(u2, COLOR_BLASTERS_EVENTS.state);
  assert.deepEqual(await emitAck(u1, COLOR_BLASTERS_EVENTS.move, { x: 999, z: -999, facing: 99 }), { ok: true });
  const moved = await stateReceived;
  const player = moved.players.find((member) => member.playerId === 'u1')!;
  assert.deepEqual(player.position, { x: 10.5, z: -13.5, facing: Math.PI });

  u1.disconnect();
  u2.disconnect();
});

test('u1이 발사하면 BE가 u2의 피격 부위를 판정하고 4부위 승리를 전파한다', async () => {
  const u1 = await connectClient();
  const u2 = await connectClient();
  const u1Matched = onceEvent<Snapshot>(u1, COLOR_BLASTERS_EVENTS.matchFound);
  const u2Matched = onceEvent<Snapshot>(u2, COLOR_BLASTERS_EVENTS.matchFound);
  const [, , match] = await Promise.all([
    emitAck(u1, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'u1-hit' }),
    emitAck(u2, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'u2-hit' }),
    u1Matched,
    u2Matched,
  ]);
  const attacker = match.players.find((player) => player.playerId === 'u1-hit')!;
  const target = match.players.find((player) => player.playerId === 'u2-hit')!;
  await emitAck(u1, COLOR_BLASTERS_EVENTS.move, { x: 8, z: attacker.position.z, facing: 0 });
  await emitAck(u2, COLOR_BLASTERS_EVENTS.move, { x: 8, z: target.position.z, facing: Math.PI });

  const shots = [
    { x: 0, y: 4.02, expected: 'head' },
    { x: 0, y: 2.72, expected: 'torso' },
    { x: -0.43, y: 1.02, expected: 'leftLeg' },
    { x: 0.43, y: 1.02, expected: 'rightLeg' },
  ];
  const resultEvent = onceEvent<{ winnerId: string; loserId: string }>(u1, COLOR_BLASTERS_EVENTS.result, 4_000);
  for (const [index, shot] of shots.entries()) {
    if (index > 0) await delay(155);
    const stateEvent = onceEvent<Snapshot>(u2, COLOR_BLASTERS_EVENTS.state);
    const origin = { x: 8 + shot.x, y: shot.y, z: attacker.position.z };
    const direction = { x: 0, y: 0, z: target.position.z - origin.z };
    assert.deepEqual(await emitAck(u1, COLOR_BLASTERS_EVENTS.fire, {
      origin,
      direction,
    }), { ok: true });
    const state = await stateEvent;
    const u2State = state.players.find((player) => player.playerId === 'u2-hit')!;
    assert.equal(u2State.paintedZones.includes(shot.expected), true);
  }
  assert.deepEqual(await resultEvent, { winnerId: 'u1-hit', loserId: 'u2-hit' });

  u1.disconnect();
  u2.disconnect();
});

test('BE가 소켓 연사 조작을 거부하고 상대 이탈 승리를 전파한다', async () => {
  const first = await connectClient();
  const second = await connectClient();
  await emitAck(first, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'LIMIT-P1' });
  const firstMatched = onceEvent<Snapshot>(first, COLOR_BLASTERS_EVENTS.matchFound);
  const secondMatched = onceEvent<Snapshot>(second, COLOR_BLASTERS_EVENTS.matchFound);
  await emitAck(second, COLOR_BLASTERS_EVENTS.queueJoin, { playerId: 'LIMIT-P2' });
  await Promise.all([firstMatched, secondMatched]);

  const payload = { origin: { x: 7, y: 2.72, z: 9.5 }, direction: { x: 0, y: 0, z: -1 } };
  assert.deepEqual(await emitAck(first, COLOR_BLASTERS_EVENTS.fire, payload), { ok: true });
  const errorEvent = onceEvent<{ message: string }>(first, COLOR_BLASTERS_EVENTS.error);
  assert.deepEqual(await emitAck(first, COLOR_BLASTERS_EVENTS.fire, payload), { ok: false, error: 'FIRE_RATE_LIMIT' });
  assert.deepEqual(await errorEvent, { message: 'FIRE_RATE_LIMIT' });

  const leaveResult = onceEvent<{ winnerId: string; reason: string }>(first, COLOR_BLASTERS_EVENTS.result);
  second.disconnect();
  assert.deepEqual(await leaveResult, { winnerId: 'LIMIT-P1', reason: 'opponent-left' });
  first.disconnect();
});
