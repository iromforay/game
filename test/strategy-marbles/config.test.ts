import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllRoundMaps, fetchRoundMap, mapUrl } from '../../strategy-marbles/src/config/maps.ts';
import { PIECES_URL, fetchPieces, pieceColorNumber, pieceTextureKey } from '../../strategy-marbles/src/config/pieces.ts';
import { seededRandom } from '../../strategy-marbles/src/config/rng.ts';

test('같은 방 코드는 모든 클라이언트에서 같은 난수열을 만든다', () => {
  const first = seededRandom('ROOM-123');
  const second = seededRandom('ROOM-123');
  assert.deepEqual(Array.from({ length: 10 }, first), Array.from({ length: 10 }, second));
});

test('생성된 난수는 항상 0 이상 1 미만이다', () => {
  const random = seededRandom('range-check');
  assert.ok(Array.from({ length: 100 }, random).every((value) => value >= 0 && value < 1));
});

test('맵과 기물 리소스 경로를 규칙대로 만든다', () => {
  assert.equal(mapUrl(3), '/data/strategy-marbles/maps/round3.json');
  assert.equal(PIECES_URL, '/data/strategy-marbles/pieces.json');
  assert.equal(pieceTextureKey('/icons/rock.svg'), 'piece-icon-rock');
  assert.equal(pieceColorNumber({ id: 1, name: '돌', radius: 10, color: '#ff8800', image: null }), 0xff8800);
});

test('라운드 맵 조회는 응답 데이터를 반환하고 HTTP 실패를 알린다', async () => {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: true, status: 200, json: async () => ({ id: 2, name: '맵', floorFriction: 3, terrain: [], zones: [] }) }) });
  assert.equal((await fetchRoundMap(2)).id, 2);

  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(fetchRoundMap(99), /HTTP 404/);
});

test('전체 맵 조회는 인덱스의 모든 라운드를 불러온다', async () => {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => url.endsWith('index.json') ? [1, 2] : { id: Number(url.match(/round(\d+)/)?.[1]), name: '맵', floorFriction: 3, terrain: [], zones: [] },
    }),
  });
  assert.deepEqual((await fetchAllRoundMaps()).map((map) => map.id), [1, 2]);
});

test('기물 목록 조회는 서버 데이터를 그대로 반환한다', async () => {
  const pieces = [{ id: 1, name: '바위', radius: 20, color: '#ffffff', image: null }];
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: true, status: 200, json: async () => pieces }) });
  assert.deepEqual(await fetchPieces(), pieces);
});
