import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAFE_FACILITIES,
  MAP_COLUMNS,
  MAP_ROWS,
  TILE_SIZE,
  findPath,
  isWalkable,
  nearestWalkable,
  tileCenter,
  worldToTile,
} from '../../sweet-shop/src/cafeMap.ts';

test('모든 시설 출입 위치는 이동 가능한 타일이다', () => {
  for (const facility of CAFE_FACILITIES) assert.equal(isWalkable(facility.access), true, facility.id);
});

test('벽과 시설 내부는 이동할 수 없다', () => {
  assert.equal(isWalkable({ x: 0, y: 0 }), false);
  for (const facility of CAFE_FACILITIES) assert.equal(isWalkable({ x: facility.x, y: facility.y }), false, facility.id);
});

test('월드 좌표와 타일 중심 좌표를 안정적으로 변환한다', () => {
  assert.deepEqual(worldToTile(-100, -20), { x: 0, y: 0 });
  assert.deepEqual(worldToTile(2.5 * TILE_SIZE, 3.5 * TILE_SIZE), { x: 2, y: 3 });
  assert.deepEqual(worldToTile(99999, 99999), { x: MAP_COLUMNS - 1, y: MAP_ROWS - 1 });
  assert.deepEqual(tileCenter({ x: 2, y: 3 }), { x: 180, y: 252 });
});

test('막힌 목표에서는 가장 가까운 이동 가능 타일을 찾는다', () => {
  const target = CAFE_FACILITIES[0];
  const nearest = nearestWalkable({ x: target.x, y: target.y });
  assert.ok(nearest);
  assert.equal(isWalkable(nearest), true);
});

test('카페 출입문에서 모든 시설 출입 위치까지 연속 경로가 존재한다', () => {
  const door = CAFE_FACILITIES.find((facility) => facility.id === 'cafe-door')!;
  for (const facility of CAFE_FACILITIES) {
    const path = findPath(door.access, facility.access);
    if (facility.id !== door.id) assert.ok(path.length > 0, facility.id);
    let previous = door.access;
    for (const point of path) {
      assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 1);
      assert.equal(isWalkable(point), true);
      previous = point;
    }
  }
});
