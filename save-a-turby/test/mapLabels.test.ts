// 10-12 v4: 전체 지도 이름표 선택·배치 순수 함수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containedIn, intersectionArea, placeMapLabel, selectMapLabels, type LabelMarker } from '../src/ui/mapLabels.ts';

const dust = (n: number): LabelMarker[] => Array.from({ length: n }, (_, i) => ({ id: `forest_dust_${String(i + 1).padStart(2, '0')}`, type: 'dust' as const }));

test('실가루 10개 → 이름표 0, 아이콘 10', () => {
  const r = selectMapLabels(dust(10));
  assert.equal(r.labelId, null);
  assert.equal(r.iconOnlyIds.length, 10);
});

test('야생 터비 여러 개 → 이름표 0', () => {
  const r = selectMapLabels([{ id: 'wild-0', type: 'wild' }, { id: 'wild-1', type: 'wild' }, { id: 'wild-2', type: 'wild' }]);
  assert.equal(r.labelId, null);
  assert.deepEqual(r.iconOnlyIds, ['wild-0', 'wild-1', 'wild-2']);
});

test('활성 이야기 1개 → 이름표 1(실가루·야생은 아이콘만)', () => {
  const r = selectMapLabels([...dust(3), { id: 'wild-0', type: 'wild' }, { id: 'forest_bopuli_return', type: 'story' }]);
  assert.equal(r.labelId, 'forest_bopuli_return');
  assert.equal(r.iconOnlyIds.includes('forest_bopuli_return'), false);
  assert.equal(r.iconOnlyIds.length, 4);
});

test('활성 이야기가 여러 개여도 우선순위 1개: 명시적 목표 → 진행 순서 → id', () => {
  const m: LabelMarker[] = [{ id: 'c', type: 'story', order: 1 }, { id: 'a', type: 'story', order: 2 }, { id: 'b', type: 'story', order: 1 }];
  assert.equal(selectMapLabels(m).labelId, 'b', '같은 순서면 id 정렬');
  assert.equal(selectMapLabels(m, { targetId: 'a' }).labelId, 'a', '명시적 목표가 먼저');
  assert.equal(selectMapLabels([{ id: 'z', type: 'target' }, ...m]).labelId, 'z', 'target 종류 마커는 명시적 목표');
  assert.equal(selectMapLabels([{ id: 'z', type: 'target' }, ...m], { targetId: 'a' }).labelId, 'a', '선택한 목적지가 가장 먼저');
  assert.deepEqual(selectMapLabels(m).iconOnlyIds, ['a', 'c']);
});

test('활성 이야기가 없으면(완료·비활성만) 이름표 0', () => {
  const r = selectMapLabels([{ id: 's1', type: 'story', active: false }, { id: 's2', type: 'story', active: false }, ...dust(2)]);
  assert.equal(r.labelId, null);
  assert.equal(r.iconOnlyIds.length, 4);
});

test('입력 순서가 달라도 같은 결과', () => {
  const base: LabelMarker[] = [...dust(4), { id: 'w1', type: 'wild' }, { id: 's2', type: 'story', order: 2 }, { id: 's1', type: 'story', order: 1 }, { id: 's3', type: 'story', active: false }];
  const expected = JSON.stringify(selectMapLabels(base));
  for (let i = 0; i < base.length; i += 1) {
    const rotated = [...base.slice(i), ...base.slice(0, i)];
    assert.equal(JSON.stringify(selectMapLabels(rotated)), expected);
    assert.equal(JSON.stringify(selectMapLabels([...rotated].reverse())), expected);
  }
});

test('이름표 배치: 지도 안에 완전히 포함되고 마커 중심을 덮지 않으며 마커 아래(가장자리면 위)에 놓인다', () => {
  const map = { x: 160, y: 110, width: 600, height: 450 };
  const label = { width: 110, height: 26 };
  const cases = [{ x: 400, y: 300 }, { x: 165, y: 300 }, { x: 755, y: 300 }, { x: 400, y: 112 }, { x: 400, y: 555 }, { x: 162, y: 556 }];
  for (const anchor of cases) {
    const p = placeMapLabel(anchor, 44, label, map);
    const rect = { x: p.x, y: p.y, width: label.width, height: label.height };
    assert.ok(containedIn(rect, map), `${JSON.stringify(anchor)}: 지도 안`);
    assert.equal(intersectionArea(rect, { x: anchor.x - 1, y: anchor.y - 1, width: 2, height: 2 }), 0, `${JSON.stringify(anchor)}: 마커 중심을 덮지 않음`);
  }
  assert.equal(placeMapLabel({ x: 400, y: 300 }, 44, label, map).y, 300 + 22 + 8, '기본은 마커 아래');
  // 아래에 다른 마커가 있으면 위로, 위·아래 모두 있으면 옆으로 — 다른 마커를 덮지 않는다
  const below = { x: 380, y: 340, width: 40, height: 40 };
  const above = { x: 380, y: 240, width: 40, height: 40 };
  const p1 = placeMapLabel({ x: 400, y: 300 }, 44, label, map, 8, [below]);
  assert.equal(intersectionArea({ x: p1.x, y: p1.y, ...label }, below), 0);
  assert.ok(p1.y < 300, '아래가 막히면 위');
  const p2 = placeMapLabel({ x: 400, y: 300 }, 44, label, map, 8, [below, above]);
  for (const o of [below, above]) assert.equal(intersectionArea({ x: p2.x, y: p2.y, ...label }, o), 0);
  assert.ok(p2.x > 400, '위·아래가 막히면 오른쪽');
  assert.ok(placeMapLabel({ x: 400, y: 555 }, 44, label, map).y < 555, '아래가 지도 밖이면 위');
});
