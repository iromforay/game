// M4-B 전투 화면 판정 — 실제 임시 전투 정의(BE/story-data/save-a-turby/battles/*.json)로 스냅샷을 만들어 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canAttack, isStoryBattle, labelPlacement, moveAllowance, objectiveLines, reachableCells, showsCornerEscape, storyResultText, targetState, unitTags, STORY_NOTICE } from '../src/battle/battleView.ts';
import type { BattleSnapshot, BattleUnit } from '../src/net/battleTypes.ts';

interface DefUnit {
  unitId: string;
  side: 'wild' | 'neutral';
  characterCode: string;
  name: string;
  col: number;
  row: number;
  maxHp: number;
  targetable?: boolean;
  partOf?: string | null;
  breakOrder?: number | null;
}
interface Def {
  key: string;
  units: DefUnit[];
  objectives?: BattleSnapshot['objectives'] extends infer O ? Partial<NonNullable<O>> : never;
  blocked?: { col: number; row: number }[];
}

const load = (key: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../BE/story-data/save-a-turby/battles/${key}.json`, import.meta.url)), 'utf8')) as Def;

const hero = (col: number, row: number, extra: Partial<BattleUnit> = {}): BattleUnit => ({ unitId: 'p1-0', side: 'party', ownerPlayerId: '1', participantSlot: 1, characterCode: 'nubi', name: '누비', col, row, hp: 30, maxHp: 30, ap: 4, maxAp: 4, stunned: false, inactive: false, statuses: [], ...extra });

// 서버 toSnapshot()과 같은 모양(정의 전투 필드 포함)
function snapshotOf(def: Def, party: BattleUnit[]): BattleSnapshot {
  const units: BattleUnit[] = def.units.map((u) => ({
    unitId: u.unitId,
    side: u.side,
    ownerPlayerId: null,
    participantSlot: 0,
    characterCode: u.characterCode,
    name: u.name,
    col: u.col,
    row: u.row,
    hp: u.maxHp,
    maxHp: u.maxHp,
    ap: 0,
    maxAp: 0,
    stunned: false,
    inactive: false,
    statuses: [],
    targetable: u.targetable ?? u.side !== 'neutral',
    partOf: u.partOf ?? null,
    breakOrder: u.breakOrder ?? null,
    fled: false,
  }));
  for (const core of units) if (units.some((p) => p.partOf === core.unitId)) core.invulnerable = true;
  return {
    battleId: 'b',
    version: 1,
    phase: 'player_subturn',
    round: 1,
    stageCode: 'forest',
    spawnIndex: -1,
    wildCharacterCode: def.key,
    wildName: def.key,
    encounterPlayerId: '1',
    grid: { cols: 12, rows: 8 },
    partyLimit: 3,
    currentPlayerId: '1',
    expiresAt: null,
    serverNow: 0,
    outcome: null,
    participants: [],
    units: [...party, ...units],
    blocked: (def.blocked ?? []).map((c) => `${c.col},${c.row}`),
    objectives: { win: def.objectives?.win ?? [{ kind: 'defeat_all' }], lose: [{ kind: 'party_down' }, ...(def.objectives?.lose ?? [])] },
    cornerEscape: false,
    story: { encounterKey: def.key, captureEnabled: false, wildRewards: false },
  };
}

const unit = (s: BattleSnapshot, id: string) => s.units.find((u) => u.unitId === id)!;

test('스토리 표식·목표 문구·보호 대상 — 매복 전투', () => {
  const s = snapshotOf(load('forest_stitchling_ambush'), [hero(1, 4)]);
  assert.equal(isStoryBattle(s), true);
  assert.equal(showsCornerEscape(s), false, '정의 전투는 퇴각존 없음');
  assert.deepEqual(objectiveLines(s), ['적을 모두 물리치기', '보풀이 지키기 — 쓰러지면 패배']);
  const bopuli = unit(s, 'bopuli');
  assert.deepEqual(unitTags(bopuli), ['보호 대상']);
  assert.equal(targetState(s, bopuli), 'not_target', '보호 대상은 공격 불가');
  assert.equal(STORY_NOTICE, '포획과 야생 보상이 없는 전투예요');
});

test('부위 순서와 중심부 보호 — 거대 매듭 전투', () => {
  const s = snapshotOf(load('forest_giant_knot'), [hero(8, 3)]);
  assert.deepEqual(objectiveLines(s), ['거대 실밥 매듭 쓰러뜨리기']);
  const parts = s.units.filter((u) => u.partOf === 'giant_knot').sort((a, b) => (a.breakOrder ?? 0) - (b.breakOrder ?? 0));
  assert.equal(parts.length, 3);
  assert.equal(targetState(s, parts[0]), 'ok', '첫 부위만 열림');
  assert.equal(targetState(s, parts[1]), 'part_order');
  assert.equal(targetState(s, unit(s, 'giant_knot')), 'protected');
  assert.deepEqual(unitTags(unit(s, 'giant_knot')), ['부위 먼저']);
  // 첫 부위를 끊으면 다음 부위가 열린다, 모두 끊으면 중심부가 열린다
  parts[0].stunned = true;
  assert.equal(targetState(s, parts[1]), 'ok');
  parts[1].stunned = true;
  parts[2].stunned = true;
  unit(s, 'giant_knot').invulnerable = false;
  assert.equal(targetState(s, unit(s, 'giant_knot')), 'ok');
  const h = unit(s, 'p1-0');
  h.col = 8;
  h.row = 4;
  assert.equal(canAttack(s, h, unit(s, 'giant_knot')), true, '인접 + 열린 중심부');
});

test('이동: 막힌 칸 우회·속박 감소량 반영·다른 유닛 칸 제외', () => {
  const s = snapshotOf({ key: 't', units: [{ unitId: 'w', side: 'wild', characterCode: 'x', name: 'x', col: 3, row: 0, maxHp: 1 }] }, [hero(0, 0, { ap: 3 })]);
  s.blocked = ['1,0'];
  const h = unit(s, 'p1-0');
  const cells = new Map(reachableCells(s, h).map((c) => [`${c.col},${c.row}`, c.cost]));
  assert.equal(cells.has('1,0'), false, '막힌 칸');
  assert.equal(cells.get('2,0'), undefined, '막힌 칸을 돌아가면 4칸 → AP 3으로 불가');
  assert.equal(cells.get('1,1'), 2);
  h.statuses = [{ kind: 'bind', turnsLeft: 2, movePenalty: 1, sourceUnitId: 'w', appliedRound: 1 }];
  assert.equal(moveAllowance(h), 2);
  assert.deepEqual(unitTags(h), ['속박 2']);
  assert.equal(reachableCells(s, h).some((c) => c.cost > 2), false);
  s.blocked = [];
  h.statuses = [];
  assert.equal(reachableCells(s, h).some((c) => c.col === 3 && c.row === 0), false, '다른 유닛이 있는 칸 제외');
});

test('스토리 결과 문구에는 포획 문구가 없다', () => {
  for (const o of ['win', 'lose', 'draw', 'cancelled'] as const) {
    const t = storyResultText(o);
    assert.ok(!/포획 성공|가방/.test(t.title + t.sub + t.btn), o);
  }
  assert.equal(storyResultText('win').sub, STORY_NOTICE);
});

test('라벨 배치: 같은 줄에 붙은 유닛은 아래·위로 엇갈리고, 바로 위 칸 라벨과 부딪히면 아래로 — 매복 전투 보풀이·실밥이', () => {
  const s = snapshotOf({ key: 't', units: [] }, [hero(3, 2), hero(4, 2, { unitId: 'b' }), hero(5, 2, { unitId: 'c' })]);
  assert.deepEqual(s.units.map((u) => labelPlacement(s, u)), ['below', 'above', 'below']);
  s.units.push(hero(4, 1, { unitId: 'up' }));
  assert.equal(labelPlacement(s, unit(s, 'b')), 'below', '위 칸 유닛 라벨(아래)과 부딪히지 않게');
  const fled = snapshotOf({ key: 't', units: [] }, [hero(3, 2, { fled: true }), hero(4, 2, { unitId: 'b' })]);
  assert.equal(labelPlacement(fled, unit(fled, 'b')), 'below', '도주해 사라진 유닛은 이웃으로 보지 않음');

  const a = snapshotOf(load('forest_stitchling_ambush'), [hero(1, 4)]);
  const bop = unit(a, 'bopuli');
  const left = a.units.find((u) => u.col === bop.col - 1 && u.row === bop.row);
  if (left) assert.notEqual(labelPlacement(a, bop), labelPlacement(a, left), '보풀이와 바로 옆 실밥이 라벨은 반대편');
});

// ---------- 10-13 C2-3: 젖은 속박(wet_bind) 화면 판정 — 서버 엔진과 같은 규칙 ----------
const unitOf = (over: Partial<BattleUnit>): BattleUnit => ({ unitId: 'p1-0', side: 'party', ownerPlayerId: 'a', participantSlot: 1, characterCode: 'nubi', name: '누비', col: 1, row: 4, hp: 10, maxHp: 10, ap: 4, maxAp: 4, stunned: false, inactive: false, ...over });
const wet = { kind: 'wet_bind' as const, turnsLeft: 1, movePenalty: 1, sourceUnitId: 'e', appliedRound: 1 };

test('젖은 속박: 이동 가능 거리 1칸 감소·최소 1칸, 태그 표시', () => {
  assert.equal(moveAllowance(unitOf({ ap: 4, statuses: [wet] })), 3);
  assert.equal(moveAllowance(unitOf({ ap: 1, statuses: [wet] })), 1, 'AP 1이면 줄지 않는다');
  assert.equal(moveAllowance(unitOf({ ap: 0, statuses: [wet] })), 0);
  // 기존 bind와 함께: bind -1, wet_bind -1
  assert.equal(moveAllowance(unitOf({ ap: 5, statuses: [wet, { kind: 'bind', turnsLeft: 2, movePenalty: 1, sourceUnitId: 'e', appliedRound: 1 }] })), 3);
  assert.deepEqual(unitTags(unitOf({ statuses: [wet] })), ['젖은 속박']);
});

test('호수 일반 적 시트 계약: 젖은 실밥이 512×128(4×128), 젖은 박음이 640×160(4×160), 키↔캐릭터 코드 연결', () => {
  const root = fileURLToPath(new URL('../src/assets/sprites/enemies/', import.meta.url));
  const dims = (f: string) => {
    const b = readFileSync(root + f);
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(dims('wet-stitchling-idle.png'), [512, 128]);
  assert.deepEqual(dims('wet-sewn-doll-idle.png'), [640, 160]);
  const reg = readFileSync(fileURLToPath(new URL('../src/assets/registry.ts', import.meta.url)), 'utf8');
  assert.match(reg, /'wet-stitchling-idle': \{ size: 128, frames: 4, fps: 6 \}/);
  assert.match(reg, /'wet-sewn-doll-idle': \{ size: 160, frames: 4, fps: 5 \}/);
  assert.match(reg, /wet_stitchling: 'wet-stitchling-idle'/);
  const trap = readFileSync(fileURLToPath(new URL('../src/assets/world/lake/props/black-thread-trap.png', import.meta.url)));
  assert.deepEqual([trap.readUInt32BE(16), trap.readUInt32BE(20)], [1536, 1024]);
});
