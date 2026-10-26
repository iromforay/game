// 10-26 C5-3: 5장 전투 화면 표시 규칙 — 누비만 푸는 안쪽 연결(다른 유닛은 피해 0 대상), 금빛 연결점 "다시 꿰매짐"·"누비만" 표식, 작은 화면 줄인 이름,
// 2차 에셋(C5-4) 키 계약(시트 규격·보스·표적·바닥 칸 그림 키)이 지시서와 같은지 소스로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canAttack, resolveLabels, targetState, unitLabel, unitTags } from '../src/battle/battleView.ts';
import type { BattleSnapshot, BattleUnit } from '../src/net/battleTypes.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const unit = (o: Partial<BattleUnit>): BattleUnit => ({ unitId: 'x', side: 'wild', ownerPlayerId: null, participantSlot: 0, characterCode: 'inner_link', name: '안쪽 검은 연결', col: 7, row: 3, hp: 1, maxHp: 1, ap: 0, maxAp: 0, stunned: false, inactive: false, statuses: [], ...o }) as BattleUnit;
const snap = (units: BattleUnit[]) => ({ units }) as unknown as BattleSnapshot;

test('안쪽 검은 연결: 이야기 누비는 ok, 다른 유닛은 zero(공격은 되지만 피해 0), 공격자를 모르면 ok', () => {
  const inner = unit({ unitId: 'inner_link', nubiOnly: true, partOf: 'golden_doll', breakOrder: 2 });
  const nubi = unit({ unitId: 'p1-0', side: 'party', characterCode: 'nubi', col: 6, row: 3, ap: 3, storyNubi: true });
  const other = unit({ unitId: 'p1-1', side: 'party', characterCode: 'bopuli', col: 8, row: 3, ap: 3 });
  const s = snap([inner, nubi, other]);
  assert.equal(targetState(s, inner, nubi), 'ok');
  assert.equal(targetState(s, inner, other), 'zero');
  assert.equal(targetState(s, inner), 'ok');
  assert.equal(canAttack(s, other, inner), true, '피해 0이어도 누를 수는 있다(서버가 안내)');
  // 금빛 연결점이 남아 있으면 순서가 먼저
  const point = unit({ unitId: 'gold_point_1', characterCode: 'gold_point', partOf: 'golden_doll', breakOrder: 1, regen: true });
  assert.equal(targetState(snap([inner, point, nubi]), inner, nubi), 'part_order');
});

test('표식: 다시 꿰매지는 금빛 연결점은 "다시 꿰매짐"(파편 남음 아님), 안쪽 연결은 "누비만"', () => {
  assert.ok(unitTags(unit({ characterCode: 'gold_point', regen: true, stunned: true, reviving: true })).includes('다시 꿰매짐'));
  assert.deepEqual([unitTags(unit({ characterCode: 'golden_doll', phase: 'exposed' })), unitTags(unit({ characterCode: 'frost_machine', phase: 'exposed' }))], [['풀림'], ['약점 노출']], '재단인형은 풀림(이기는 순간), 다른 보스는 그대로');
  assert.ok(!unitTags(unit({ characterCode: 'gold_point', regen: true, stunned: true, reviving: true })).includes('파편 남음'));
  assert.ok(unitTags(unit({ nubiOnly: true })).includes('누비만'));
  assert.ok(unitTags(unit({ characterCode: 'frozen_sewn_doll', stunned: true, reviving: true })).includes('파편 남음'), '4장 그대로');
});

test('작은 화면 이름: 그을린 박음이·재단 실밥이·황금 재단인형·금빛 연결점·안쪽 검은 연결을 줄인다(큰 화면은 원래 이름)', () => {
  const cases: [string, string, string][] = [['scorched_sewn_doll', '그을린 박음이', '박음이'], ['cutting_stitch', '재단 실밥이', '실밥이'], ['gold_point', '금빛 연결점', '연결점'], ['inner_link', '안쪽 검은 연결', '안쪽 연결']];
  for (const [code, name, short] of cases) {
    const u = unit({ characterCode: code, name, hp: 5, maxHp: 5 });
    assert.ok(unitLabel(u, true).startsWith(`${short}\n`), `${code} 작은 화면`);
    assert.ok(unitLabel(u, false).startsWith(name), `${code} 큰 화면`);
  }
  assert.equal(unitLabel(unit({ characterCode: 'golden_doll', name: '황금 재단인형', targetable: false, phase: 'bound', maxHp: 1 }), true), '재단인형\n결박');
});

test('2차 에셋 키 계약(C5-4): 시트 규격·보스 두 상태·표적·바닥 칸 그림 키가 지시서와 같다', () => {
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  for (const [key, size] of [['scorched-sewn-doll-idle', 160], ['cutting-stitch-idle', 160], ['golden-doll-idle', 256], ['golden-doll-unraveled', 256]] as const) assert.match(reg, new RegExp(`'${key}': \\{ size: ${size}, frames: 4,`), key);
  for (const [code, key] of [['scorched_sewn_doll', 'scorched-sewn-doll-idle'], ['cutting_stitch', 'cutting-stitch-idle'], ['golden_doll', 'golden-doll-idle']]) assert.match(reg, new RegExp(`${code}: '${key}'`));
  const scene = readFileSync(here('../src/scenes/BattleScene.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(scene, /golden_doll: \{ idle: 'golden-doll-idle', exposed: 'golden-doll-unraveled', labelBelow: \d+ \}/);
  for (const [code, key, px] of [['heat_mirage', 'heat-mirage', 96], ['cut_knot', 'cut-knot', 72], ['gold_point', 'gold-point', 80], ['inner_link', 'inner-link', 80]] as const) assert.match(scene, new RegExp(`${code}: \\{ key: '${key}', px: ${px} \\}`));
  assert.match(scene, /const EMBER_KEY = 'ember-cell';\nconst WET_KEY = 'wet-cell';\nconst CUT_WARN_KEY = 'cut-warn';\nconst CUT_KEY = 'cut-cell';/);
});

test('C5-6 QA-03·04 라벨: 끊긴 연결점은 HP 없이 상태만(완전히 끊기면 숨김), 작은 화면의 HP 1 부위는 HP 생략, 자리가 차면 한 줄 바깥으로', () => {
  const point = (o: Partial<BattleUnit>) => unit({ unitId: 'gold_point_1', characterCode: 'gold_point', name: '금빛 연결점', partOf: 'golden_doll', regen: true, ...o });
  assert.equal(unitLabel(point({ stunned: true, hp: 0, reviving: true }), false), '금빛 연결점 (다시 꿰매짐)');
  assert.equal(unitLabel(point({ stunned: true, hp: 0, reviving: true }), true), '연결점\n다시 꿰매짐');
  assert.equal(unitLabel(point({ stunned: true, hp: 0 }), false), '', '다시 꿰매지지 않는 끊긴 부위는 라벨 없음');
  assert.equal(unitLabel(point({}), true), '연결점');
  assert.equal(unitLabel(unit({ nubiOnly: true, partOf: 'golden_doll' }), true), '안쪽 연결\n누비만');
  assert.equal(unitLabel(point({}), false), '금빛 연결점 HP 1/1', '큰 화면은 그대로');
  // 위·아래 바로 옆 자리가 모두 찼을 때 겹치지 않고 한 줄 바깥에 놓는다
  const bounds = { x: 0, y: 0, w: 400, h: 400 };
  const box = (id: string) => ({ id, cx: 200, anchorY: 200, w: 380, h: 20, pref: 'below' as const });
  const spots = resolveLabels([box('a'), box('b'), box('c')], bounds, 4);
  const tops = ['a', 'b', 'c'].map((id) => spots.get(id)!.top).sort((x, y) => x - y);
  assert.ok(tops[1] - tops[0] >= 20 && tops[2] - tops[1] >= 20, `세 라벨이 겹치지 않는다: ${tops.join(', ')}`);
});
