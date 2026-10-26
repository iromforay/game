// 10-26 C5-1: 5장 보일러 옆 사막 화면 쪽 계산 — 뜨거운 모래(서리 구역 규칙, kind heat)의 속도 배율·종류, 아지랑이 가짜 길의 불투명도 주기를
// 지역 데이터 수치로 확인한다. 지역 선택에서 사막이 더 이상 "준비 중"이 아닌 것도 소스로 확인한다(Phaser 없이 node에서 실행).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { frostFactorAt, mirageAlphaAt, slowZoneKindAt } from '../src/story/fridgeHazards.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const DESERT = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/desert.json'), 'utf8')) as {
  frostZones: { id: string; x: number; y: number; width: number; height: number; slowFactor: number; kind: 'frost' | 'heat' }[];
  mirages: { id: string; x: number; y: number; width: number; height: number; periodMs: number; showMs: number; offsetMs: number }[];
};
const ICE = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/ice.json'), 'utf8')) as { frostZones: { id: string; x: number; y: number; width: number; height: number; slowFactor: number }[] };

test('뜨거운 모래: 안에서는 0.7배·종류 heat, 밖에서는 1·null. 4장 서리 구역(kind 없음)은 frost로 읽는다', () => {
  const hot = DESERT.frostZones[0];
  const inside = { x: hot.x + hot.width / 2, y: hot.y + hot.height / 2 };
  assert.equal(frostFactorAt(DESERT.frostZones, inside), 0.7);
  assert.equal(slowZoneKindAt(DESERT.frostZones, inside), 'heat');
  assert.equal(slowZoneKindAt(DESERT.frostZones, { x: 400, y: 2020 }), null);
  assert.equal(frostFactorAt(DESERT.frostZones, { x: 400, y: 2020 }), 1);
  const frost = ICE.frostZones[0];
  assert.equal(slowZoneKindAt(ICE.frostZones, { x: frost.x + 10, y: frost.y + 10 }), 'frost');
});

test('아지랑이: 주기 시작부터 showMs 동안 0 → 1 → 0으로 떠올랐다 사라지고 나머지는 0, 두 자리는 2초 엇갈린다', () => {
  const [a, b] = DESERT.mirages;
  assert.deepEqual([a.periodMs, a.showMs, a.offsetMs, b.offsetMs], [4000, 1600, 0, 2000]);
  const t0 = 400_000; // 주기의 배수
  assert.equal(mirageAlphaAt(a, t0), 0);
  assert.ok(Math.abs(mirageAlphaAt(a, t0 + 800) - 1) < 1e-9, '가운데에서 가장 진하다');
  assert.ok(mirageAlphaAt(a, t0 + 400) > 0.6 && mirageAlphaAt(a, t0 + 400) < 0.8);
  for (const t of [1600, 2500, 3999]) assert.equal(mirageAlphaAt(a, t0 + t), 0, `${t}ms 쉼`);
  // b는 2초 엇갈려 있다: a가 쉬는 2000~3600ms에 b가 떠오른다(2800ms에서 가장 진함)
  assert.ok(Math.abs(mirageAlphaAt(b, t0 + 2800) - 1) < 1e-9);
  assert.equal(mirageAlphaAt(b, t0 + 800), 0);
  const both = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((t) => [mirageAlphaAt(a, t0 + t) > 0, mirageAlphaAt(b, t0 + t) > 0]);
  assert.ok(both.every(([x, y]) => !(x && y)), '두 자리가 동시에 보이지 않는다');
  assert.ok(both.some(([, y]) => y), 'b도 주기 안에서 떠오른다');
});

test('지역 선택: 사막(5장)이 "준비 중" 목록에서 빠졌다', () => {
  const src = readFileSync(here('../src/scenes/StageSelectScene.ts'), 'utf8');
  assert.match(src, /const STORY_PREPARING = new Set<string>\(\[\]\);/);
});
