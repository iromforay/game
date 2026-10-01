// 10-01 v1 §2: 지역 선택·상점·기지·장비 창·이름 입력 배치 — 1280×720과 640×360에서 화면 안, 서로 겹치지 않음, 글자·터치 기준
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPage, equipPanelLayout, homeLayout, keyboardShift, mapHudLayout, marketLayout, miniMapLayout, nameInputLayout, pageOf, stageSelectLayout, toastFont, villageHudLayout, type Rect } from '../src/ui/screenLayouts.ts';
import { finalPx, MIN_BODY_PX, MIN_BUTTON_PX } from '../src/ui/responsive.ts';
import { compareDrawPaths } from '../src/ui/drawOrder.ts';
import { VERIFIED_PHASER_VERSION, inputInternalsProblem } from '../src/ui/phaserCompat.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { LEGEND_LABEL, buyLabel, buyStateOf, capturedLabel, equipRows, legendEntries, stageBadgeLabel } from '../src/ui/screenStates.ts';

const inCanvas = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const abs = (card: Rect, r: Rect): Rect => ({ x: card.x + r.x, y: card.y + r.y, w: r.w, h: r.h });
const noOverlap = (list: Rect[], tag: string) => {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${tag}: 겹침 ${JSON.stringify(list[i])} × ${JSON.stringify(list[j])}`);
};
const SCALES = [0.5, 1];

test('지역 선택: 카드·돌아가기·페이지 버튼이 화면 안에서 겹치지 않고, 작은 화면은 페이지로 나눔, 글자·터치 기준', () => {
  for (const scale of SCALES) {
    for (const count of [1, 5, 9]) {
      const L = stageSelectLayout(scale, count);
      const tag = `${scale}/${count}`;
      const all = [L.header, ...L.cards, L.back, ...(L.pager ? [L.pager.prev, L.pager.next] : [])];
      for (const r of all) assert.ok(inCanvas(r), `${tag}: 화면 밖 ${JSON.stringify(r)}`);
      noOverlap(all, tag);
      // 카드 안: 미리보기 → 이름 → 대표 터비 → 잠금 이유 → 상태 배지 순서로 위에서 아래
      const c = L.cards[0];
      const I = L.inner;
      assert.ok(I.titleY < I.preview.y && I.preview.y + I.preview.h <= I.nameY && I.nameY < I.rep.y && I.rep.y + I.rep.size <= I.hintY && I.hintY < I.badge.y, `${tag}: 카드 안 순서`);
      assert.ok(I.nameH >= L.font.name * 2.2, `${tag}: 지역 이름 두 줄 자리(${I.nameH})`);
      // 구 판정 안내 1줄 + 가장 긴 잠금 이유가 안쪽 폭에서 차지하는 줄 수까지 들어간다(한글 1자 ≈ 글자 크기)
      const longest = "3장 — 지하의 대표 터비 '폭신이'를 직접 포획하면 열립니다";
      const needLines = 1 + Math.ceil([...longest].length / Math.floor(I.preview.w / L.font.small));
      assert.ok(I.hintLines >= needLines, `${tag}: 잠금 이유 ${needLines}줄 자리(${I.hintLines})`);
      assert.ok(I.badge.y + I.badge.h <= c.h && I.badge.x + I.badge.w <= c.w, `${tag}: 배지가 카드 안`);
      assert.ok(I.hintLines >= 2, `${tag}: 잠금 이유 2줄 이상(${I.hintLines})`);
      assert.ok(finalPx(L.font.small, scale) >= MIN_BODY_PX && finalPx(L.font.name, scale) >= MIN_BODY_PX && finalPx(L.font.button, scale) >= MIN_BUTTON_PX, `${tag}: 글자`);
      assert.ok(finalPx(L.back.h, scale) >= 40 && finalPx(I.badge.h, scale) >= 23, `${tag}: 터치 높이`);
      const perPage = L.pager?.perPage ?? L.cards.length;
      assert.equal(L.pager ? L.pager.pages : 1, Math.ceil(count / perPage), `${tag}: 모든 카드가 어느 한 페이지에`);
    }
  }
  assert.equal(stageSelectLayout(1, 5).pager, null, '보통 화면은 5개가 한 화면');
  const C = stageSelectLayout(0.5, 5);
  assert.ok(C.pager && C.cards.length === 3 && C.pager.pages === 2, '640×360은 3장씩 2쪽');
  // "먼저 누비와 이야기를 마쳐 주세요." 같은 잠금 이유가 카드 안쪽 폭에서 주어진 줄 수 안에 들어간다(한글 1자 ≈ 글자 크기)
  for (const reason of ['먼저 누비와 이야기를 마쳐 주세요.', '이전 지역의 이야기를 마치면 열려요.', '아직 열리지 않았습니다.']) {
    const perLine = Math.floor(C.inner.preview.w / C.font.small);
    assert.ok(Math.ceil([...reason].length / perLine) <= C.inner.hintLines, `${reason}: ${C.inner.hintLines}줄 안`);
  }
});

test('상점: 카드·잔액·돌아가기·페이지 버튼이 화면 안에서 겹치지 않고, 카드 안 요소가 카드 안, 상품이 많으면 페이지', () => {
  for (const scale of SCALES) {
    for (const count of [0, 1, 6, 13]) {
      const L = marketLayout(scale, count);
      const tag = `${scale}/${count}`;
      const all = [L.header, L.tare, ...L.cards, L.back, ...(L.pager ? [L.pager.prev, L.pager.next] : [])];
      for (const r of all) assert.ok(inCanvas(r), `${tag}: 화면 밖 ${JSON.stringify(r)}`);
      noOverlap(all, tag);
      if (L.cards[0]) {
        const c = L.cards[0];
        const I = L.inner;
        for (const r of [I.icon, I.chip, I.buy]) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= c.w && r.y + r.h <= c.h, `${tag}: 카드 밖 ${JSON.stringify(r)}`);
        const descBottom = I.descY + I.descLines * L.font.body * 1.2;
        assert.ok(I.nameY < I.chip.y && I.chip.y + I.chip.h <= I.descY && descBottom <= I.buy.y + 1, `${tag}: 이름 → 종류 → 설명 → 구매 순서(${descBottom} > ${I.buy.y})`);
        // 능력치 줄: 설명과 겹치지 않고(같은 줄이면 구매 버튼 왼쪽 폭 안) 카드 안
        assert.ok(I.statY + 1 >= descBottom && I.statY + L.font.body * 1.25 <= c.h && I.statW > 100, `${tag}: 능력치 줄`);
        assert.ok(I.textX + I.textW <= c.w && I.owned.x > I.chip.x + I.chip.w, `${tag}: 글 폭·보유 표시`);
        assert.ok(!overlap(abs(c, I.icon), abs(c, I.buy)));
      }
      assert.ok(finalPx(L.font.body, scale) >= MIN_BODY_PX && finalPx(L.font.button, scale) >= MIN_BUTTON_PX, `${tag}: 글자`);
      if (scale < 0.75) assert.ok(finalPx(L.inner.buy.h, scale) >= 40, `${tag}: 구매 버튼 터치 높이`);
      assert.equal(L.pager ? L.pager.pages : 1, Math.max(1, Math.ceil(count / (L.pager?.perPage ?? Math.max(1, L.cards.length || 6)))), `${tag}: 페이지 수`);
    }
  }
  assert.equal(marketLayout(1, 6).pager, null, '보통 화면: 6개 한 화면');
  assert.equal(marketLayout(0.5, 6).pager?.pages, 2, '640×360: 4개씩 2쪽');
});

test('기지: 가방·선반 두 구역과 나가기 버튼이 화면 안에서 겹치지 않고, 칸 안 이동·장비 버튼이 서로 떨어져 있음', () => {
  for (const scale of SCALES) {
    const L = homeLayout(scale);
    const cells = L.sections.flatMap((s) => s.cells);
    const pagers = L.sections.flatMap((s) => [s.pager.prev, s.pager.next]);
    for (const r of [...cells, ...pagers, L.exit]) assert.ok(inCanvas(r), `${scale}: 화면 밖 ${JSON.stringify(r)}`);
    noOverlap([...cells, ...pagers, L.exit], String(scale));
    const c = cells[0];
    const move = abs(c, L.cell.move);
    const equip = abs(c, L.cell.equip);
    assert.ok(!overlap(move, equip) && equip.y + equip.h <= c.y + c.h + 1, `${scale}: 칸 안 버튼`);
    assert.ok(finalPx(L.font.button, scale) >= MIN_BUTTON_PX && finalPx(L.font.name, scale) >= MIN_BODY_PX, `${scale}: 글자`);
    assert.ok(finalPx(L.cell.move.h, scale) >= (scale < 0.75 ? 22 : 24), `${scale}: 버튼 높이`);
    assert.ok(L.perRow >= 4, `${scale}: 한 줄 ${L.perRow}칸`);
  }
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 1, 2), [3, 4]);
  assert.equal(clampPage(9, 3), 2);
  assert.equal(clampPage(-1, 3), 0);
});

test('장비 창: 일반 슬롯 3줄과 이야기 슬롯 줄(4줄)까지 창 안, 요약·줄·닫기가 겹치지 않음, 해제 버튼 터치 높이', () => {
  for (const scale of SCALES) {
    for (const rows of [3, 4]) {
      const L = equipPanelLayout(scale, rows);
      const tag = `${scale}/${rows}줄`;
      assert.ok(inCanvas(L.panel), `${tag}: 창이 화면 안`);
      const inside = (r: Rect) => r.x >= L.panel.x && r.y >= L.panel.y && r.x + r.w <= L.panel.x + L.panel.w && r.y + r.h <= L.panel.y + L.panel.h;
      for (const r of [L.header, L.close, L.summary, ...L.rows]) assert.ok(inside(r), `${tag}: 창 밖 ${JSON.stringify(r)}`);
      noOverlap([L.summary, ...L.rows], tag);
      assert.ok(!overlap(L.header, L.summary) && L.rows.every((r) => !overlap(L.header, r)), `${tag}: 헤더와 본문`);
      const last = L.rows[L.rows.length - 1];
      assert.ok(last.y + last.h < L.messageY, `${tag}: 결과 문구 자리`);
      const pillsBottom = L.statPill.y0 + 4 * L.statPill.h + 3 * L.statPill.gap;
      assert.ok(pillsBottom <= L.summary.y + L.summary.h + 1, `${tag}: 능력치 4개가 요약 안(${pillsBottom} > ${L.summary.y + L.summary.h})`);
      assert.ok(L.row.action.x + L.row.action.w <= L.rows[0].w && L.row.noteW > 200, `${tag}: 줄 안 행동 버튼·설명 폭`);
      assert.ok(finalPx(L.font.note, scale) >= MIN_BODY_PX && finalPx(L.font.button, scale) >= MIN_BUTTON_PX, `${tag}: 글자`);
      if (scale < 0.75) assert.ok(finalPx(L.row.action.h, scale) >= 40 && finalPx(L.close.h, scale) >= 30, `${tag}: 터치 높이`);
    }
  }
});

test('이름 입력: 입력창·규칙·오류·확인 버튼이 모두 화면 위쪽 절반 안(가상 키보드가 아래를 가려도 보임), 서로 겹치지 않음', () => {
  for (const scale of SCALES) {
    const L = nameInputLayout(scale);
    assert.ok(L.visibleBottom <= 360, `${scale}: 위쪽 절반(${L.visibleBottom})`);
    assert.ok(inCanvas(L.panel) && inCanvas(L.input) && inCanvas(L.button));
    assert.ok(!overlap(L.input, L.button));
    assert.ok(L.promptY + L.font.prompt * 0.6 <= L.input.y && L.input.y + L.input.h < L.ruleY - L.font.rule * 0.6 && L.ruleY < L.errorY, `${scale}: 안내 → 입력 → 규칙 → 오류 순서`);
    assert.ok(L.errorY + L.font.rule * 1.3 <= L.visibleBottom, `${scale}: 오류 문구 두 줄까지 패널 안`);
    assert.ok(finalPx(L.input.h, scale) >= 40 && finalPx(L.button.h, scale) >= 40, `${scale}: 입력창·버튼 터치 높이`);
    assert.ok(finalPx(L.font.rule, scale) >= MIN_BODY_PX && finalPx(L.font.button, scale) >= MIN_BUTTON_PX);
  }
  assert.ok(finalPx(toastFont(0.5), 0.5) >= 13, '토스트 글자');
});

test('마을 HUD: 재화·인벤토리 버튼·지역 이름·미니맵이 화면 안에서 서로 겹치지 않고, 안내 버튼·글자가 기준 이상', () => {
  for (const scale of SCALES) {
    const L = villageHudLayout(scale);
    const all = [L.coin, L.inventory, L.title, L.miniMap];
    for (const r of all) assert.ok(inCanvas(r), `${scale}: 화면 밖 ${JSON.stringify(r)}`);
    noOverlap(all, String(scale));
    assert.ok(finalPx(L.font.coin, scale) >= MIN_BODY_PX && finalPx(L.font.button, scale) >= MIN_BUTTON_PX && finalPx(L.font.prompt, scale) >= MIN_BUTTON_PX, `${scale}: 글자`);
    assert.ok(finalPx(L.prompt.h, scale) >= (scale < 0.75 ? 40 : 48), `${scale}: 안내 버튼 터치 높이`);
    // 버튼 글자("인벤토리" 4자)가 버튼 폭 안
    assert.ok(4 * L.font.button <= L.inventory.w - 16, `${scale}: 인벤토리 버튼 폭`);
  }
});

test('입력 맨 위 판정(그리기 순서): 뒤에 그려진 것이 위, 같은 컨테이너에서는 뒤 자식이 위, 컨테이너와 그 자식이면 자식이 위 — 한 번도 그려지지 않은 새 대상도 같은 기준', () => {
  const order = (paths: number[][]) => [...paths].sort(compareDrawPaths);
  // 창(컨테이너 7) 안의 뒤판[7,0]·탭[7,3]·칸[7,9]과, 그 아래 HUD 버튼[4]
  assert.deepEqual(order([[7, 0], [4], [7, 9], [7, 3]])[0], [7, 9], '가장 나중에 그려진 창 안 요소가 맨 위');
  assert.deepEqual(order([[4], [7, 0]])[0], [7, 0], '창 뒤판이 그 아래 HUD 버튼보다 위(뒤 화면 입력을 막는다)');
  assert.deepEqual(order([[7], [7, 2]])[0], [7, 2], '컨테이너 자체보다 그 안의 자식이 위');
  assert.deepEqual(order([[2, 1, 5], [2, 1, 4], [2, 0, 9]])[0], [2, 1, 5]);
  assert.equal(compareDrawPaths([3], [3]), 0);
});

test('화면 상태 글자: 지역 배지(입장 가능·잠김), 상점 구매 버튼(구매 중·잔액 부족·다른 구매 중), 장비 창 줄(이야기 슬롯은 장착한 유물만)', () => {
  assert.equal(stageBadgeLabel('current', true), '진행 중 · 입장');
  assert.equal(stageBadgeLabel('cleared', true), '완료 · 입장');
  assert.equal(stageBadgeLabel('locked', false), '잠김');
  assert.equal(buyStateOf(1, 30, 100, null), 'ready');
  assert.equal(buyStateOf(1, 150, 100, null), 'short');
  assert.equal(buyStateOf(1, 30, 100, 1), 'buying');
  assert.equal(buyStateOf(2, 30, 100, 1), 'locked', '다른 상품 구매 중에는 누를 수 없음');
  assert.equal(buyLabel(150, 'short'), '150 타레 · 부족');
  assert.equal(buyLabel(30, 'ready'), '30 타레');
  const slots = [{ key: 'weapon', label: '무기' }, { key: 'armor', label: '방어구' }];
  assert.deepEqual(equipRows([], slots).map((r) => r.kind), ['general', 'general'], '일반 터비·유물 장착 전 누비: 이야기 줄 없음');
  const rows = equipRows([{ slotKey: 'weapon', itemName: '뜨개바늘' }, { slotKey: 'story_1', itemName: '첫 매듭' }], slots);
  assert.deepEqual(rows.map((r) => [r.kind, r.slotKey]), [['general', 'weapon'], ['general', 'armor'], ['story', 'story_1']]);
});

// ---------- 10-01 v2 §2: Phaser 내부 API 의존성 고정 ----------

test('Phaser 버전 고정: package.json은 범위 표기 없는 정확한 버전, lockfile·실제 설치본·확인한 버전이 모두 같다', () => {
  const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  const pkg = read('../package.json');
  assert.equal(pkg.dependencies.phaser, VERIFIED_PHASER_VERSION, 'package.json: ^·~ 없이 정확한 버전');
  assert.match(pkg.dependencies.phaser, /^\d+\.\d+\.\d+$/);
  const lock = read('../../package-lock.json');
  assert.equal(lock.packages['save-a-turby'].dependencies.phaser, VERIFIED_PHASER_VERSION, 'lockfile의 save-a-turby 요구 버전');
  assert.equal(lock.packages['node_modules/phaser'].version, VERIFIED_PHASER_VERSION, 'lockfile의 설치 버전');
  const require = createRequire(import.meta.url);
  const installed = JSON.parse(readFileSync(require.resolve('phaser/package.json'), 'utf8')).version;
  assert.equal(installed, VERIFIED_PHASER_VERSION, `실제 설치본(${installed}) — 버전을 올렸다면 ui/phaserCompat.ts의 절차를 따른다`);
});

test('Phaser 내부 구조 검사: 필드가 없거나 배열·함수가 아니면 문제를 알려 패치를 설치하지 않게 한다', () => {
  const ok = { _list: [], _pendingInsertion: [], _pendingRemoval: [], clear() {}, update() {}, sortGameObjects() {} };
  assert.equal(inputInternalsProblem(ok), null);
  assert.match(inputInternalsProblem(undefined)!, /InputPlugin이 없습니다/);
  assert.match(inputInternalsProblem({ ...ok, _pendingInsertion: undefined })!, /_pendingInsertion/);
  assert.match(inputInternalsProblem({ ...ok, _list: new Set() })!, /_list.*배열이 아닙니다/);
  assert.match(inputInternalsProblem({ ...ok, _pendingRemoval: {} })!, /_pendingRemoval/);
  assert.match(inputInternalsProblem({ ...ok, sortGameObjects: null })!, /sortGameObjects.*함수가 아닙니다/);
  assert.match(inputInternalsProblem({ ...ok, clear: 1 })!, /clear/);
});

// ---------- 10-01 v2 §3·§4·§5 ----------

test('탐험 맵 HUD: 지역 이름·포획·마을로·방 상태·목표·미니맵·인벤토리·터비가 화면 안에서 겹치지 않고, 조이스틱 영역(아래쪽)을 침범하지 않음', () => {
  for (const scale of SCALES) {
    const L = mapHudLayout(scale);
    const all = [L.area, L.captured, L.home, L.room, L.goal, L.miniMap, L.inventory, L.turbys];
    for (const r of all) assert.ok(inCanvas(r), `${scale}: 화면 밖 ${JSON.stringify(r)}`);
    noOverlap(all, String(scale));
    for (const r of all) assert.ok(!overlap(r, L.joystickZone), `${scale}: 조이스틱 영역 침범 ${JSON.stringify(r)}`);
    assert.ok(L.joystickZone.h >= 300 && L.joystickZone.w === 1280, `${scale}: 조이스틱 영역 높이(${L.joystickZone.h})`);
    assert.ok(finalPx(L.font.button, scale) >= MIN_BUTTON_PX && finalPx(L.font.goal, scale) >= 13 && finalPx(L.font.room, scale) >= MIN_BODY_PX && finalPx(L.font.area, scale) >= 13, `${scale}: 글자`);
    if (scale < 0.75) for (const r of [L.home, L.inventory, L.turbys]) assert.ok(finalPx(r.h, scale) >= 40, `${scale}: 버튼 터치 높이`);
    // 목표 문구: 3줄까지 영역 안(긴 문구는 줄바꿈)
    assert.ok(L.goal.h >= L.font.goal * 1.3 * 3 && L.goal.w >= 600, `${scale}: 목표 영역`);
    assert.ok(L.toastY > L.joystickZone.y, '토스트는 아래쪽(누르는 대상이 아님)');
  }
  assert.equal(capturedLabel(3), '포획: 3');
});

test('미니맵·전체 지도: 작은 화면은 미니맵·마커·닫기 버튼을 키우고 지도 위 이름표 대신 범례(접기/펼치기), 영역은 화면 안·서로 겹치지 않음', () => {
  for (const scale of SCALES) {
    const L = miniMapLayout(scale);
    const F = L.full;
    assert.ok(inCanvas(L.mini.rect) && inCanvas(F.map) && inCanvas(F.info) && inCanvas(F.close), `${scale}: 화면 안`);
    assert.ok(!overlap(F.map, F.info), `${scale}: 지도와 정보 영역`);
    const inInfo = (r: Rect) => r.x >= F.info.x && r.x + r.w <= F.info.x + F.info.w && r.y + r.h <= F.info.y + F.info.h + 1;
    assert.ok(inInfo(F.close), `${scale}: 닫기 버튼은 정보 영역 안`);
    assert.ok(finalPx(F.font.body, scale) >= MIN_BODY_PX && finalPx(F.font.label, scale) >= MIN_BODY_PX && finalPx(F.font.hint, scale) >= MIN_BODY_PX, `${scale}: 글자`);
    assert.ok(finalPx(F.close.h, scale) >= 40 && finalPx(F.marker, scale) >= 30, `${scale}: 닫기·마커 터치 크기`);
    assert.ok(finalPx(L.mini.open.size, scale) >= 30, `${scale}: 확대 버튼`);
    const openBox = { x: L.mini.open.x - L.mini.open.size / 2, y: L.mini.open.y - L.mini.open.size / 2, w: L.mini.open.size, h: L.mini.open.size };
    assert.ok(openBox.y + openBox.h <= L.mini.rect.y + L.mini.rect.h + 1 && openBox.x + openBox.w <= 1280, `${scale}: 확대 버튼이 미니맵 영역 안`);
  }
  const C = miniMapLayout(0.5);
  const R = miniMapLayout(1);
  assert.ok(C.mini.diameter > R.mini.diameter && C.full.marker > R.full.marker, '작은 화면은 더 크게');
  assert.deepEqual([C.full.labelsOnMap, C.full.legendAlways, !!C.full.legendToggle], [false, false, true], '640×360: 이름표는 지도에서 빼고 범례는 접기/펼치기');
  assert.deepEqual([R.full.labelsOnMap, R.full.legendAlways, R.full.legendToggle], [true, true, null], '1280×720: 이름표와 범례를 늘 표시');
  assert.ok(!overlap(C.full.legendToggle!, C.full.close) && C.full.legendToggle!.y + C.full.legendToggle!.h <= C.full.info.y + C.full.info.h);
  assert.ok(finalPx(C.full.legendToggle!.h, 0.5) >= 40);
  // 범례 6줄(내 위치·친구·목적지·집·장터·출구)이 정보 영역에 들어간다
  for (const L of [C, R]) assert.ok(6 * L.full.legendRow + L.full.font.label * 1.6 < L.full.info.h - L.full.close.h - 40);
});

test('지도 범례: 색이 아니라 모양·표식 설명, 지도에 있는 종류만(친구는 함께 있을 때만)', () => {
  assert.deepEqual(legendEntries(['home', 'market', 'exit'], false), ['player', 'home', 'market', 'exit']);
  assert.deepEqual(legendEntries(['target'], true), ['player', 'peer', 'target']);
  assert.deepEqual(legendEntries([], false), ['player']);
  assert.match(LEGEND_LABEL.player, /화살표/);
  assert.match(LEGEND_LABEL.peer, /동그라미와 번호/);
  assert.match(LEGEND_LABEL.target, /별/);
});

test('가상 키보드: 입력 줄이 보이는 영역 아래로 가려지면 그만큼만 위로, 이미 보이면 그대로, 위로 넘치지는 않게', () => {
  assert.equal(keyboardShift(37, 77, 0, 360), 0, '키보드 없음');
  assert.equal(keyboardShift(37, 77, 0, 140), 0, '키보드가 화면 61%를 가려도 위쪽 배치라 그대로 보임');
  assert.equal(keyboardShift(37, 77, 0, 60), 23, '보이는 영역 60px: 줄 아래 끝(77)+여백 6이 60 안으로');
  assert.equal(keyboardShift(37, 77, 0, 20), 31, '줄 위쪽이 화면 밖으로 나가지 않는 만큼만(37-6)');
  assert.equal(keyboardShift(137, 177, 100, 160), 23, '보이는 영역이 아래로 밀린 경우(offsetTop)');
  assert.equal(keyboardShift(37, 77, 0, 0), 0, '보이는 영역 정보가 비정상이면 옮기지 않음');
  // 이름 입력 배치의 줄은 640×360에서 보이는 높이 100px(키보드 72%)까지 옮기지 않아도 보인다
  const L = nameInputLayout(0.5);
  const bottom = Math.max(L.input.y + L.input.h, L.button.y + L.button.h) * 0.5;
  assert.ok(bottom + 6 <= 100, `입력 줄 아래 끝 ${bottom}px`);
});
