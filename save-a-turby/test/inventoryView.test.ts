// v3 M4-D 인벤토리·저해상도 배치 — 순수 판정 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMPTY_TEXT, detailOf, filterItems, gridCells, insideCanvas, inventoryLayout, nubiSlots, overlaps, type InventoryItem } from '../src/inventory/inventoryView.ts';
import { partySelectLayout } from '../src/battle/partySelectLayout.ts';
import { battleHudLayout, clampLabel, unitLabel } from '../src/battle/battleView.ts';
import { displayScaleOf, finalPx, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX } from '../src/ui/responsive.ts';
import { devFlags } from '../src/story/devFlags.ts';
import type { BattleUnit } from '../src/net/battleTypes.ts';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  recordId: '1', itemDefinitionId: 1, itemCode: 'x', iconKey: 'x', name: 'x', description: '', tab: 'material', tabLabel: '재료', category: 'material', storySlot: null,
  quantity: 1, maxStack: 1, stacks: [1], slotsUsed: 1, equipped: 0, equippedOnStoryNubi: false, isNew: false, isLocked: false, usedAt: null, firstAcquiredAt: null, lastAcquiredAt: null,
  permissions: { sell: true, discard: true, trade: true, consume: false, unequip: true }, lockReason: null, storyAction: null, ...over,
});

const dust = item({ itemCode: 'glowing_yarn_dust', name: '빛나는 실가루', tab: 'story', tabLabel: '스토리', category: 'mission', quantity: 150, maxStack: 99, stacks: [150], isLocked: true, isNew: true, lastAcquiredAt: '2026-09-30T02:00:00Z' });
const needle = item({ itemCode: 'knit_needle', name: '뜨개바늘', tab: 'equipment', tabLabel: '장비', category: 'equipment', lastAcquiredAt: '2026-09-29T00:00:00Z' });
const tonic = item({ itemCode: 'tonic', name: '회복 실타래', tab: 'consumable', tabLabel: '소비', quantity: 7, maxStack: 5, stacks: [5, 2] });
const knotAction = { kind: 'equip_story_nubi' as const, label: '누비에게 장착', available: true, reason: null };
const knot = item({ itemCode: 'first_knot', name: '첫 매듭', tab: 'story', tabLabel: '스토리', category: 'relic', storySlot: 'story_1', isLocked: true, lockReason: '이야기에 필요한 물건', storyAction: knotAction });

test('탭 필터·정렬(최근 획득 순, 신규 해제로 칸이 옮겨 가지 않음)·빈 상태 문구', () => {
  const all = [needle, tonic, dust, knot];
  assert.deepEqual(filterItems(all, 'all')[0].itemCode, 'glowing_yarn_dust', '최근 획득 먼저');
  const before = filterItems(all, 'story').map((i) => i.itemCode);
  assert.deepEqual(filterItems(all.map((i) => ({ ...i, isNew: false })), 'story').map((i) => i.itemCode), before, '신규 해제 뒤에도 같은 순서');
  assert.deepEqual(filterItems(all, 'story').map((i) => i.itemCode).sort(), ['first_knot', 'glowing_yarn_dust']);
  assert.deepEqual(filterItems(all, 'equipment').map((i) => i.itemCode), ['knit_needle']);
  assert.equal(filterItems(all, 'material').length, 0);
  assert.equal(EMPTY_TEXT.material, '재료가 없어요');
});

test('격자 칸: 서버가 나눈 묶음(max_stack)마다 한 칸, 수량 배지는 2개 이상만', () => {
  const cells = gridCells([tonic, needle]);
  assert.deepEqual(cells.map((c) => [c.item.itemCode, c.count, c.badge]), [['tonic', 5, '5'], ['tonic', 2, '2'], ['knit_needle', 1, null]]);
});

test('상세 패널과 첫 매듭 장착 버튼 조건: 서버가 가능하다고 할 때만 활성, 장착 후엔 버튼 대신 장착됨', () => {
  const d = detailOf(knot);
  assert.equal(d.title, '첫 매듭');
  assert.deepEqual(d.equip, { label: '누비에게 장착', enabled: true, note: null });
  assert.ok(d.lockNote);
  const notYet = detailOf({ ...knot, storyAction: { ...knotAction, available: false, reason: '아직 장착할 때가 아니에요' } });
  assert.deepEqual(notYet.equip, { label: '누비에게 장착', enabled: false, note: '아직 장착할 때가 아니에요' });
  const done = detailOf({ ...knot, storyAction: null, equippedOnStoryNubi: true });
  assert.deepEqual([done.equip, done.equippedLabel], [null, '누비에게 장착됨']);
  assert.equal(detailOf(needle).equip, null, '일반 아이템에는 누비 장착 없음');
});

test('누비 슬롯: 장착 전 빈 슬롯 → 장착 후 장착됨, 가진 적 없는 유물 슬롯은 보이지 않음', () => {
  assert.deepEqual(nubiSlots({ slots: [] }, [knot, dust]), [{ slotKey: 'story_1', label: '첫 매듭', equipped: false, status: '빈 슬롯' }]);
  assert.deepEqual(nubiSlots({ slots: [{ slotKey: 'story_1', itemCode: 'first_knot', name: '첫 매듭' }] }, [knot]), [{ slotKey: 'story_1', label: '첫 매듭', equipped: true, status: '장착됨' }]);
  assert.deepEqual(nubiSlots(null, [dust]), []);
});

test('640×360 실제 표시(배율 0.5): 작은 화면용 배치, 본문 12px·버튼 14px 이상, 영역이 화면 안·서로 겹치지 않음', () => {
  const scale = displayScaleOf(640);
  assert.equal(scale, 0.5);
  assert.equal(layoutModeOf(scale), 'compact');
  const L = inventoryLayout(scale);
  assert.ok(finalPx(L.font.body, scale) >= MIN_BODY_PX && finalPx(L.font.badge, scale) >= MIN_BODY_PX);
  assert.ok(finalPx(L.font.button, scale) >= MIN_BUTTON_PX);
  for (const r of [L.window, L.header, L.grid, L.detail, ...L.tabs]) assert.ok(insideCanvas(r), JSON.stringify(r));
  assert.ok(!overlaps(L.grid, L.detail));
  for (const t of L.tabs) assert.ok(!overlaps(t, L.detail) && !overlaps(t, L.grid));
  assert.ok(L.cols >= 3, '작은 화면에서도 한 줄 3칸 이상');
  // 보통 화면(1280)은 기존 크기 유지
  const R = inventoryLayout(1);
  assert.equal(R.mode, 'regular');
  assert.ok(R.font.body >= MIN_BODY_PX);
});

test('640×360 PartySelect: 카드·선택 수·완료 버튼이 한 흐름(카드 바로 아래 한 줄), 화면 안, 글자 기준', () => {
  const scale = 0.5;
  for (const n of [1, 2, 3, 6, 12]) {
    const L = partySelectLayout(scale, n);
    assert.equal(L.cards.length, Math.min(n, L.pageSize));
    assert.equal(L.pages, Math.ceil(n / L.pageSize), '넘치면 페이지로');
    if (L.pages > 1) for (const r of [L.prev!, L.next!]) assert.ok(insideCanvas(r) && r.y === L.button.y && !overlaps(r, L.count), '페이지 버튼도 같은 줄');
    for (const c of L.cards) {
      assert.ok(insideCanvas(c), `${n}: ${JSON.stringify(c)}`);
      assert.ok(!overlaps(c, L.button) && !overlaps(c, L.count));
    }
    assert.ok(insideCanvas(L.button));
    assert.equal(L.count.y, L.button.y, '선택 수와 완료 버튼은 같은 줄');
    const cardsBottom = Math.max(...L.cards.map((c) => c.y + c.h));
    assert.ok(L.button.y - cardsBottom <= 24, '카드 바로 아래');
    assert.ok(finalPx(L.font.body, scale) >= MIN_BODY_PX && finalPx(L.font.small, scale) >= MIN_BODY_PX);
    assert.ok(finalPx(L.font.button, scale) >= MIN_BUTTON_PX);
  }
  assert.ok(partySelectLayout(scale, 2).cards[0].w >= 200, '작은 화면에서는 카드를 키운다');
});

test('640×360 전투 HUD: 턴 > 안내 > 목표 크기 순, 목표는 접기, 라벨 글자 기준·짧은 한 줄, 라벨은 격자 안으로', () => {
  const H = battleHudLayout(0.5);
  assert.equal(H.objectivesCollapsible, true);
  assert.ok(H.font.status >= H.font.hint && H.font.hint >= H.font.panel);
  for (const px of [H.font.label, H.font.panel, H.font.hint]) assert.ok(finalPx(px, 0.5) >= MIN_BODY_PX);
  assert.ok(finalPx(H.font.button, 0.5) >= MIN_BUTTON_PX);
  const u = { name: '보풀이', hp: 20, maxHp: 20, side: 'neutral', stunned: false, inactive: false, statuses: [] } as unknown as BattleUnit;
  assert.equal(unitLabel(u, true), '보풀이 20/20\n보호');
  assert.equal(unitLabel(u, false), '보풀이 HP 20/20 (보호 대상)');
  const grid = { x: 160, y: 40, w: 960, h: 640 };
  assert.deepEqual(clampLabel(170, 10, 120, 40, grid), { cx: 220, top: 40 }, '왼쪽·위 경계 안으로');
  assert.deepEqual(clampLabel(1115, 700, 120, 40, grid), { cx: 1060, top: 640 }, '오른쪽·아래 경계 안으로');
  assert.equal(battleHudLayout(1).objectivesCollapsible, false);
});

test('운영 맵: 원격 전달 버튼은 개발 플래그가 꺼져 있으면(기본) 보이지 않는다', () => {
  assert.equal(devFlags.remoteDelivery, false, '운영 기본값');
  const map = readFileSync(fileURLToPath(new URL('../src/scenes/MapScene.ts', import.meta.url)), 'utf8');
  assert.match(map, /const withButton = devFlags\.remoteDelivery;/);
  assert.match(map, /if \(!withButton\) return;/, '추적 정보만 그리고 버튼 전에 종료');
  const src = readFileSync(fileURLToPath(new URL('../src/story/devFlags.ts', import.meta.url)), 'utf8');
  assert.match(src, /remoteDelivery: false/);
  // 운영 코드 어디에서도 플래그를 켜지 않는다(개발 미리보기만)
  for (const f of ['scenes/MapScene.ts', 'scenes/VillageScene.ts', 'game.ts']) assert.doesNotMatch(readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8'), /remoteDelivery\s*=\s*true/);
});
