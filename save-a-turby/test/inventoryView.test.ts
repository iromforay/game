// v3 M4-D 인벤토리·저해상도 배치 — 순수 판정 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { EMPTY_TEXT, RELIC_CATEGORY_LABEL, RELIC_LOCK_LABEL, detailOf, filterItems, itemIconCandidates, gridCells, insideCanvas, inventoryLayout, keepSelection, nubiSlots, overlaps, pageCells, type InventoryItem } from '../src/inventory/inventoryView.ts';
import { partySelectLayout } from '../src/battle/partySelectLayout.ts';
import { actionHint, battleHudLayout, clampLabel, goalSummary, resultLayout, unitLabel } from '../src/battle/battleView.ts';
import { displayScaleOf, finalPx, layoutKey, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX } from '../src/ui/responsive.ts';
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
  assert.equal(unitLabel(u, true), '보풀이\n20/20 · 보호', '이름 한 줄 + HP·상태 한 줄(10-22 C3-6 R1-01)');
  assert.ok(H.labelWrap >= 200, '작은 화면 라벨 폭: 이름 한 줄(약 24px 글자 7자)이 쪼개지지 않는다');
  assert.equal(unitLabel(u, false), '보풀이 HP 20/20 (보호 대상)');
  const grid = { x: 160, y: 40, w: 960, h: 640 };
  assert.deepEqual(clampLabel(170, 10, 120, 40, grid), { cx: 220, top: 40 }, '왼쪽·위 경계 안으로');
  assert.deepEqual(clampLabel(1115, 700, 120, 40, grid), { cx: 1060, top: 640 }, '오른쪽·아래 경계 안으로');
  assert.equal(battleHudLayout(1).objectivesCollapsible, false);
});

test('운영 맵: 원격 전달 버튼과 그 개발 플래그·1장 개발 미리보기는 제거됐다(전달은 보풀이 지점의 안내 버튼으로만)', () => {
  const root = new URL('../', import.meta.url);
  for (const f of ['src/story/devFlags.ts', 'dev/ch01Preview.ts', 'dev/ch01-preview.html']) assert.equal(existsSync(fileURLToPath(new URL(f, root))), false, `${f} 제거`);
  for (const f of ['src/scenes/MapScene.ts', 'src/scenes/VillageScene.ts', 'src/game.ts', 'dev/captureHelper.ts']) {
    assert.doesNotMatch(readFileSync(fileURLToPath(new URL(f, root)), 'utf8'), /remoteDelivery|devFlags|ch01Preview/, f);
  }
});

test('v4 전투 HUD(640×360·1280×720): 턴·목표·턴 종료·나가기·안내 영역이 화면 안에서 서로 겹치지 않고, 작은 화면 안내는 한 줄 폭 안, 펼친 목표는 오른쪽 위', () => {
  for (const scale of [0.5, 1]) {
    const H = battleHudLayout(scale);
    const r = H.rects;
    const all = [r.endTurn, r.turn, r.leave, r.hint, ...(r.goalButton ? [r.goalButton] : [])];
    for (const a of all) assert.ok(insideCanvas(a), `${scale}: ${JSON.stringify(a)}`);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!overlaps(all[i], all[j]), `${scale}: ${JSON.stringify(all[i])} × ${JSON.stringify(all[j])}`);
  }
  const C = battleHudLayout(0.5);
  // 한 줄 폭: 한글 한 글자 ≈ 글자 크기(보수적으로 1.0배)
  const text = actionHint('보풀이', true);
  assert.ok([...text].length * C.font.hint <= C.rects.hint.w, `${text} (${[...text].length * C.font.hint} > ${C.rects.hint.w})`);
  assert.ok(C.rects.goalPanel!.x >= 640, '펼친 목표는 오른쪽(아군이 시작하는 왼쪽 전장을 가리지 않음)');
  assert.ok(insideCanvas(C.rects.goalPanel!));
  assert.ok(!overlaps(C.rects.goalPanel!, C.rects.endTurn) && !overlaps(C.rects.goalPanel!, C.rects.goalButton!));
  assert.equal(goalSummary(['적을 모두 물리치기', '보풀이 지키기 — 쓰러지면 패배']), '목표: 적을 모두 물리치기 외 1 ▾');
  assert.ok([...goalSummary(['적을 모두 물리치기', 'x'])].length * C.font.button <= C.rects.goalButton!.w + C.font.button * 2, '요약이 버튼 폭 안');
});

test('v4 인벤토리 페이지: 한 화면을 넘으면 페이지로 나누고 이동 버튼은 격자 안·겹치지 않음, 범위 밖 페이지는 맞춤, 페이지 전환 뒤 사라진 선택은 초기화', () => {
  for (const scale of [0.5, 1]) {
    const L = inventoryLayout(scale);
    const many = Array.from({ length: 40 }, (_, i) => item({ itemCode: `it${i}`, name: `아이템${i}`, stacks: [1] }));
    const cells = gridCells(many);
    const p0 = pageCells(cells, L, 0);
    assert.ok(p0.pages > 1 && p0.pager, `${scale}: 여러 페이지`);
    assert.equal(p0.cells.length, p0.perPage);
    const lastRowBottom = L.grid.y + Math.ceil(p0.perPage / L.cols) * (L.cell + 8) - 8;
    assert.ok(lastRowBottom <= p0.pager!.prev.y, '칸이 페이지 버튼 줄을 침범하지 않음');
    for (const r of [p0.pager!.prev, p0.pager!.next]) assert.ok(insideCanvas(r) && !overlaps(r, L.detail));
    assert.ok(!overlaps(p0.pager!.prev, p0.pager!.next));
    const last = pageCells(cells, L, 99);
    assert.equal(last.page, last.pages - 1, '범위 밖 페이지는 마지막으로');
    assert.equal(p0.cells.length * (last.pages - 1) + last.cells.length, 40, '모든 칸이 어느 한 페이지에');
    // 선택 유지/초기화
    assert.equal(keepSelection('it0', p0.cells), 'it0');
    assert.equal(keepSelection('it0', last.cells), null, '다른 페이지로 가면 상세 초기화');
    // 한 페이지에 들어가면 이동 줄 없음
    assert.equal(pageCells(gridCells(many.slice(0, 3)), L, 0).pager, null);
  }
});

test('v4 PartySelect: 여러 페이지에서도 완료·나가기·페이지 버튼이 서로 겹치지 않음(640×360)', () => {
  const L = partySelectLayout(0.5, 13);
  assert.ok(L.pages > 1);
  for (const a of [L.button, L.count, L.prev!, L.next!]) assert.ok(!overlaps(a, L.leaveRect), JSON.stringify(a));
  assert.ok(insideCanvas(L.leaveRect));
});

// ---------- v5 §4·§5 ----------

const inside = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

test('v5 결과창: 640×360은 화면 거의 전체·읽을 수 있는 글자·터치 높이, 보상 행 0~5개 모두 패널 안에서 겹치지 않음', () => {
  for (const scale of [0.5, 0.6, 1]) {
    for (const [n, framed] of [[0, false], [1, false], [3, true], [5, true], [5, false]] as const) {
      const R = resultLayout(scale, n, framed);
      const tag = `${scale}/${n}행/${framed ? '테두리' : '도형'}`;
      assert.ok(insideCanvas(R.panel) && inside(R.button, R.panel), tag);
      const imageBox = { x: 640 - R.image.size / 2, y: R.image.cy - R.image.size / 2, w: R.image.size, h: R.image.size };
      const subBox = { x: R.rows.x, y: R.subY - R.font.sub * 0.7, w: R.rows.w, h: R.font.sub * 1.4 };
      const titleBox = { x: R.rows.x, y: R.titleY - R.font.title * 0.6, w: R.rows.w, h: R.font.title * 1.2 };
      const rowBoxes = Array.from({ length: n }, (_, i) => ({ x: R.rows.x, y: R.rows.y0 + i * (R.rows.h + R.rows.gap), w: R.rows.w, h: R.rows.h }));
      const boxes = [titleBox, ...(R.image.size > 0 ? [imageBox] : []), subBox, ...rowBoxes, R.button];
      for (const b of boxes) assert.ok(inside(b, R.panel), `${tag}: 패널 밖 ${JSON.stringify(b)}`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `${tag}: 겹침 ${i}×${j}`);
      assert.ok(finalPx(R.font.sub, scale) >= MIN_BODY_PX && finalPx(R.font.row, scale) >= MIN_BODY_PX && finalPx(R.font.button, scale) >= MIN_BUTTON_PX, `${tag}: 글자 기준`);
    }
  }
  const C = resultLayout(0.5, 1);
  assert.equal(C.mode, 'compact');
  assert.ok(C.panel.w >= 1200 && C.panel.h >= 680, '작은 화면은 바깥 여백을 줄여 화면 거의 전체');
  assert.ok(finalPx(C.font.title, 0.5) >= 20 && finalPx(C.font.sub, 0.5) >= 15, '제목·핵심 결과가 본문 기준보다 크게');
  assert.ok(finalPx(C.button.h, 0.5) >= 40 && finalPx(C.button.w, 0.5) >= 150, '버튼 터치 영역(최종 40px 이상 높이)');
  assert.ok(C.image.size >= 120, '포획 대상 그림이 크게');
});

test('v5 목표 패널: 닫기 버튼은 펼친 패널 안 오른쪽 위, 요약 버튼·턴 종료와 겹치지 않음, 요약은 열림/닫힘 표시', () => {
  const H = battleHudLayout(0.5);
  const r = H.rects;
  assert.ok(inside(r.goalClose!, r.goalPanel!));
  for (const o of [r.goalButton!, r.endTurn, r.turn]) assert.ok(!overlaps(r.goalClose!, o) && !overlaps(r.goalPanel!, o));
  assert.ok(finalPx(r.goalClose!.h, 0.5) >= 24, '닫기 터치 높이');
  assert.match(goalSummary(['적을 모두 물리치기'], true), /▴$/);
  assert.match(goalSummary(['적을 모두 물리치기'], false), /▾$/);
  assert.equal(battleHudLayout(1).rects.goalClose, null, '보통 화면은 목표가 항상 펼쳐져 있어 닫기 없음');
});

test('v5 인벤토리 상세 위계: 이름·배지 → 설명 → 수량·분류 → 잠금 이유 → 행동, 문구는 기존 그대로', () => {
  const d = detailOf({ ...knot, description: '누비의 첫 기억', isNew: true, lastAcquiredAt: '2026-09-30T01:00:00Z' });
  assert.deepEqual(d.badges, ['신규', '잠김']);
  assert.equal(d.description, '누비의 첫 기억');
  assert.deepEqual(d.meta, ['수량: 1', '분류: 이야기 유물', '최근 획득: 2026-09-30']);
  assert.equal(d.lockNote, '이야기 동료 전용 · 이야기에 필요한 물건');
  assert.equal(d.equip?.label, '누비에게 장착');
  assert.deepEqual(detailOf({ ...knot, equippedOnStoryNubi: true, storyAction: null }).badges, ['잠김', '장착됨']);
  assert.deepEqual(detailOf(needle).badges, [], '일반 장비는 배지 없음');
});

test('v5 크기 변경 기준(layoutKey): 배율 1 이상은 하나로, 모드·글자 구간이 바뀔 때만 다시 배치', () => {
  assert.equal(layoutKey(1), layoutKey(1.6), '큰 화면끼리는 다시 배치 안 함');
  assert.notEqual(layoutKey(0.5), layoutKey(1));
  assert.notEqual(layoutKey(0.74), layoutKey(0.76), '작은 화면용 배치 경계');
  assert.equal(layoutKey(0.5), layoutKey(0.5 + 1e-6 * 0), '같은 배율은 같은 키');
});

test('v5 독립 실행 페이지: #app이 창 전체를 차지(창을 키우면 캔버스도 커짐), 캔버스 크기로 줄어드는 옛 방식 아님', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  assert.match(html, /#app\s*\{[^}]*width:\s*100vw[^}]*height:\s*100vh/);
  assert.match(html, /overflow:\s*hidden/, '스크롤바로 화면 밖 넘침 없음');
  const game = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
  assert.match(game, /mode:\s*Phaser\.Scale\.FIT/, '종횡비 유지(FIT)');
});

test('v5 개발 도구 격리: 게임 소스(src)가 dev/ 도우미를 import하지 않음', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
  for (const f of walk(dir)) assert.doesNotMatch(readFileSync(f, 'utf8'), /from ['"][^'"]*\/dev\/|import\(['"][^'"]*\/dev\//, f);
});

// ---------- 10-14 C2-5B: 물빛 염색실 ----------
const dye = item({
  itemCode: 'water_dye_yarn', iconKey: 'water_dye_yarn', name: '물빛 염색실', description: '푸른 물빛 염색실', tab: 'story', tabLabel: '스토리', category: 'relic', storySlot: 'story_2',
  isLocked: true, isNew: true, lockReason: '이야기에 필요한 물건이라 팔거나 버리거나 해제할 수 없어요', storyAction: null,
  permissions: { sell: false, discard: false, trade: false, consume: false, unequip: false },
});

test('물빛 염색실 상세: 이름·분류(이야기 유물)·수량 1·신규·잠금(이야기 동료 전용)이 보이고 판매·버리기·분해·사용·장착 행동은 없다', () => {
  const d = detailOf(dye);
  assert.equal(d.title, '물빛 염색실');
  assert.deepEqual(d.badges, ['신규', '잠김']);
  assert.deepEqual(d.meta, ['수량: 1', '분류: 이야기 유물']);
  assert.equal(RELIC_CATEGORY_LABEL, '이야기 유물');
  assert.equal(RELIC_LOCK_LABEL, '이야기 동료 전용');
  assert.match(d.lockNote ?? '', /^이야기 동료 전용/);
  assert.equal(d.equip, null, '누비에게 장착은 C2-6 전까지 열리지 않는다');
  assert.equal(d.equippedLabel, null);
  assert.deepEqual(Object.values(dye.permissions), [false, false, false, false, false]);
  assert.deepEqual(filterItems([needle, dye], 'story').map((i) => i.itemCode), ['water_dye_yarn']);
  // 아이콘 후보: item-<코드> → items/** 파일명(kebab)
  assert.deepEqual(itemIconCandidates('water_dye_yarn'), ['item-water_dye_yarn', 'water-dye-yarn']);
  // 한 칸 격자: 수량 배지 없음(1개)
  assert.deepEqual(gridCells([dye]).map((c) => [c.item.itemCode, c.count, c.badge]), [['water_dye_yarn', 1, null]]);
});

// PNG(8비트 RGBA, 비인터레이스) 디코드 — 시험 전용
function decodePng(bytes: Buffer) {
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 6);
  const idat: Buffer[] = [];
  for (let o = 8; o < bytes.length; ) {
    const len = bytes.readUInt32BE(o);
    if (bytes.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(bytes.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth)) & 255;
    }
  }
  return { w, h, px: out };
}

test('물빛 염색실 에셋: 160×160 투명 PNG·원본 해시 일치, 80×80으로 줄여도 투명 여백 안에 아쿠아 색 실체가 남는다', () => {
  const file = fileURLToPath(new URL('../src/assets/items/relics/water-dye-yarn.png', import.meta.url));
  assert.ok(existsSync(file));
  const bytes = readFileSync(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), 'EFA8EAD2B45AC1F1CF3EFB9100CA30F04EF6E96A1EBA7070A8ADFDE7D706081F');
  const { w, h, px } = decodePng(bytes);
  assert.deepEqual([w, h], [160, 160]);
  // 80×80 축소(2×2 평균): 불투명 칸 비율·아쿠아(청록) 우세·네 모서리 투명
  let opaque = 0;
  let aqua = 0;
  const cell = (x: number, y: number) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = ((y * 2 + dy) * w + x * 2 + dx) * 4;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
    }
    return { r: r / 4, g: g / 4, b: b / 4, a: a / 4 };
  };
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      const c = cell(x, y);
      if (c.a > 128) {
        opaque++;
        if (c.b > c.r + 20 && c.g > c.r) aqua++;
      }
    }
  }
  assert.ok(opaque >= 80 * 80 * 0.12 && opaque <= 80 * 80 * 0.75, `불투명 비율 ${opaque / 6400}`);
  assert.ok(aqua / opaque >= 0.5, `아쿠아 색 비율 ${aqua / opaque}`);
  for (const [x, y] of [[0, 0], [79, 0], [0, 79], [79, 79]]) assert.ok(cell(x, y).a < 16, '모서리 투명');
});

test('승리 장면 연출: water-dye-yarn-rise cue는 화면 중앙(대화창·건너뛰기 밖)에 160×160 한 번 그리고 에셋이 없으면 무연출이다', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/scenes/OpeningScene.ts', import.meta.url)), 'utf8');
  assert.match(src, /cam === 'water-dye-yarn-rise'\) this\.playRelicRise\(\)/);
  assert.match(src, /if \(this\.fxRelic\) return;/, '한 번만');
  assert.match(src, /relicBounds = \{ x: cx - 80, y: cy - 80, w: 160, h: 160 \}/);
  assert.match(src, /if \(!this\.textures\.exists\('water-dye-yarn'\)\) return;/);
  // 대화창 상단 y=488, 건너뛰기 버튼 y<=104, 유물 영역 y 220~380 — 서로 겹치지 않는다
  const b = { x: 640 - 80, y: 300 - 80, w: 160, h: 160 };
  const box = { x: 40, y: 488, w: 1200, h: 200 };
  const skip = { x: 1280 - 130 - 110, y: 60 - 44, w: 220, h: 88 };
  assert.ok(!overlaps(b, box) && !overlaps(b, skip));
});
