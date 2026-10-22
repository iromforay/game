// M4-B 전투 화면 판정 — 실제 임시 전투 정의(BE/story-data/save-a-turby/battles/*.json)로 스냅샷을 만들어 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canAttack, isHiddenUnit, isRemovedSeam, isSeam, isStoryBattle, labelPlacement, resolveLabels, unitLabel as unitLabelOf, zoneFootprintOrigin, zoneRegion, ZONE_ALPHA, ZONE_FOOTPRINT, type LabelBox, moveAllowance, objectiveLines, reachableCells, showsCornerEscape, storyResultText, targetState, unitTags, STORY_NOTICE } from '../src/battle/battleView.ts';
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

// ---------- 10-14 C2-5A: 보스 표시 판정(서버 스냅샷 값만 쓴다) ----------
const boss = (over: Partial<BattleUnit> = {}): BattleUnit => ({ unitId: 'waterlogged_sewn_doll', side: 'wild', ownerPlayerId: null, participantSlot: 0, characterCode: 'waterlogged_sewn_doll', name: '물먹은 박음이', col: 8, row: 4, hp: 10, maxHp: 10, ap: 1, maxAp: 1, stunned: false, inactive: false, targetable: true, ...over });
const bossSnap = (units: BattleUnit[]) => ({ units, grid: { cols: 12, rows: 8 } }) as unknown as BattleSnapshot;

test('보스: 결박 중 중심부는 공격은 되지만 피해 0(zero), 약점이 드러나면 ok, 예전 보호 방식(protected)은 그대로', () => {
  const me = unitOf({ col: 7, row: 4 });
  const bound = boss({ phase: 'bound', invulnerable: true, zeroDamage: true });
  assert.equal(targetState(bossSnap([me, bound]), bound), 'zero');
  assert.equal(canAttack(bossSnap([me, bound]), me, bound), true, '결박 중에도 행동은 쓸 수 있다(서버가 피해 0·안내 1회)');
  const exposed = boss({ phase: 'exposed', invulnerable: false, zeroDamage: true });
  assert.equal(targetState(bossSnap([me, exposed]), exposed), 'ok');
  const legacy = boss({ invulnerable: true });
  assert.equal(targetState(bossSnap([me, legacy]), legacy), 'protected');
  assert.deepEqual([unitTags(bound), unitTags(exposed)], [['결박'], ['약점 노출']]);
});

test('보스 표시 계약: 시트 키 연결, 구역 상태 교체(같은 객체·크기), 예고 물살 문구·곡선, 안내는 처음 스냅샷에 있으면 다시 띄우지 않는다', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scene = readFileSync(root + 'src/scenes/BattleScene.ts', 'utf8');
  const reg = readFileSync(root + 'src/assets/registry.ts', 'utf8');
  assert.match(reg, /waterlogged_sewn_doll: 'waterlogged-sewn-doll-idle'/);
  assert.match(scene, /BOSS_SHEETS: Record<string, \{ idle: string; exposed: string; labelBelow\?: number \}>/);
  assert.match(scene, /sprite\.play\(\{ key: this\.sheetAnim\(want\), startFrame: frame \}\)/); // 같은 프레임 인덱스로 교체
  assert.match(scene, /다음 물살: \$\{east \? '→' : '←'\}/); // 방향을 글자(화살표)로도 표시 — 색에만 의존하지 않는다
  assert.match(scene, /this\.hintsSeen = new Set\(shown\.map/); // 복원 때 이미 낸 안내는 반복하지 않는다
  // 화면이 페이즈·물살·승리를 정하지 않는다: 스냅샷 필드만 읽는다
  assert.match(scene, /this\.snap\.telegraphedCurrent/);
  assert.match(scene, /this\.snap\.zones/);
  assert.doesNotMatch(scene, /Math\.random\(/);
});

// ---------- 10-14 v1a: 전투 가독성 보완 ----------
const gridOf = { cols: 12, rows: 8 };
const BOARD = { x: 160, y: 40, w: 960, h: 640 };

test('색 구역: 세 영역이 겹치지 않고 합이 공용 발자국(720×480) 한 장 크기이며 전투판 안에 들어가고 알파는 0.32~0.48', () => {
  const origin = zoneFootprintOrigin(BOARD);
  const rects = [
    { col: 3.5, row: 2.2 },
    { col: 3.5, row: 5.8 },
    { col: 8.2, row: 4.0 },
  ].map((z) => {
    const r = zoneRegion(z, gridOf);
    return { x: origin.x + r.fx * ZONE_FOOTPRINT.w, y: origin.y + r.fy * ZONE_FOOTPRINT.h, w: r.fw * ZONE_FOOTPRINT.w, h: r.fh * ZONE_FOOTPRINT.h };
  });
  const inter = (a: (typeof rects)[number], b: (typeof rects)[number]) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal(inter(rects[i], rects[j]), 0, `영역 ${i}-${j} 교차 면적`);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  assert.ok(x1 - x0 <= 720 && y1 - y0 <= 480, `합성 외곽 ${x1 - x0}×${y1 - y0}`);
  assert.equal(rects.reduce((s, r) => s + r.w * r.h, 0), 720 * 480, '세 영역의 합 = 발자국 한 장');
  assert.ok(x0 >= BOARD.x && y0 >= BOARD.y && x1 <= BOARD.x + BOARD.w && y1 <= BOARD.y + BOARD.h, '전투판 안');
  assert.ok(ZONE_ALPHA >= 0.32 && ZONE_ALPHA <= 0.48);
  assert.ok(ZONE_FOOTPRINT.w <= 720 && ZONE_FOOTPRINT.h <= 480);
});

test('제거된 재봉실: 렌더 계획·이름표에서 빠지고 exposed 상태에서 재봉실 이름표 0개', () => {
  const seam = (id: string, stunned: boolean, col: number, row: number): BattleUnit => ({ unitId: id, side: 'wild', ownerPlayerId: null, participantSlot: 0, characterCode: 'black_seam', name: '검은 재봉실', col, row, hp: stunned ? 0 : 1, maxHp: 1, ap: 0, maxAp: 0, stunned, inactive: false, partOf: 'waterlogged_sewn_doll' });
  const alive = seam('black_seam_a', false, 3, 3);
  const dead = seam('black_seam_b', true, 3, 5);
  assert.deepEqual([isRemovedSeam(alive), isRemovedSeam(dead), isHiddenUnit(dead)], [false, true, true]);
  const units = [seam('black_seam_a', true, 3, 3), seam('black_seam_b', true, 3, 5), seam('black_seam_c', true, 4, 4), boss({ phase: 'exposed', invulnerable: false })];
  assert.equal(units.filter((u) => !isHiddenUnit(u) && isSeam(u)).length, 0, 'exposed 상태의 재봉실 이름표');
  assert.equal(units.filter((u) => !isHiddenUnit(u)).length, 1);
  // 라벨 문구: 모바일은 한 줄 "검은 실 A"(HP 생략), 보통 화면은 글자로 구분
  assert.equal(unitLabelOf(alive, true), '검은 실 A');
  assert.equal(unitLabelOf(alive, false), '검은 재봉실 A HP 1/1');
  assert.equal(unitLabelOf(boss({ phase: 'bound', invulnerable: true }), true).split('\n').length <= 2, true, '보스 이름표는 두 줄 이내');
});

test('640×360 이름표: 가까이 붙은 누비·재봉실·보스 라벨이 서로 겹치지 않는다(모든 배치 후보 검사)', () => {
  const BOUNDS = { x: 160, y: 40, w: 960, h: 640 };
  // 보통 좌표계의 라벨 크기(작은 화면은 글자를 키우므로 같은 좌표계에서 더 크게 잡는다)
  const sizes = { nubi: { w: 150, h: 54 }, seam: { w: 118, h: 34 }, boss: { w: 150, h: 60 } };
  const cell = (c: number, r: number) => ({ x: 160 + c * 80 + 40, y: 40 + r * 80 + 40 });
  const boxes: LabelBox[] = [
    { id: 'nubi', ...sizes.nubi, cx: cell(4, 5).x, anchorY: cell(4, 5).y, pref: 'below' },
    { id: 'boss', ...sizes.boss, cx: cell(8, 4).x, anchorY: cell(8, 4).y, pref: 'below' },
    { id: 'a', ...sizes.seam, cx: cell(3, 3).x, anchorY: cell(3, 3).y, pref: 'above' },
    { id: 'b', ...sizes.seam, cx: cell(3, 5).x, anchorY: cell(3, 5).y, pref: 'below' },
    { id: 'c', ...sizes.seam, cx: cell(4, 4).x, anchorY: cell(4, 4).y, pref: 'above' },
  ];
  const out = resolveLabels(boxes, BOUNDS, 30);
  const rect = (b: LabelBox) => ({ x0: out.get(b.id)!.cx - b.w / 2, y0: out.get(b.id)!.top, x1: out.get(b.id)!.cx + b.w / 2, y1: out.get(b.id)!.top + b.h });
  for (let i = 0; i < boxes.length; i++) {
    const a = rect(boxes[i]);
    assert.ok(a.x0 >= BOUNDS.x && a.x1 <= BOUNDS.x + BOUNDS.w && a.y0 >= BOUNDS.y && a.y1 <= BOUNDS.y + BOUNDS.h, `${boxes[i].id} 격자 안`);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = rect(boxes[j]);
      const crossing = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
      assert.equal(crossing, false, `${boxes[i].id}↔${boxes[j].id} 라벨 교차`);
    }
  }
});

test('깊이: 격자 선(3)·이동 칸·현재 유닛 윤곽(4)은 구역 오버레이(2) 위, 유닛(10)·HUD(2000) 아래이고 보스 표시 크기는 220~280px', () => {
  const scene = readFileSync(fileURLToPath(new URL('../src/scenes/BattleScene.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n'); // CRLF 체크아웃에서도 같은 정규식(c4dbd46과 같은 이유)
  assert.match(scene, /const lines = this\.add\.graphics\(\)\.setDepth\(3\)/);
  assert.match(scene, /\.setDepth\(2\)\.setAlpha\(ZONE_ALPHA\)/);
  assert.match(scene, /setStrokeStyle\(3, 0xffe9a8, 1\)\.setDepth\(4\)/);
  assert.match(scene, /\.setDepth\(4\)\n\s*\.setInteractive/);
  const px = Number(/const BOSS_DISPLAY_PX = (\d+);/.exec(scene)![1]);
  assert.ok(px >= 220 && px <= 280, `보스 ${px}px`);
  // 같은 객체의 텍스처 교체 + 같은 crop → 복구 전후 외곽·중심 차이 0
  assert.match(scene, /img\.setTexture\(key\)\.setDisplaySize\(ZONE_FOOTPRINT\.w, ZONE_FOOTPRINT\.h\);\n\s*crop\(img\);/);
});
