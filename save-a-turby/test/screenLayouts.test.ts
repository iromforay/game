// 10-01 v1 §2: 지역 선택·상점·기지·장비 창·이름 입력 배치 — 1280×720과 640×360에서 화면 안, 서로 겹치지 않음, 글자·터치 기준
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPage, equipPanelLayout, homeLayout, marketLayout, nameInputLayout, pageOf, stageSelectLayout, toastFont, villageHudLayout, type Rect } from '../src/ui/screenLayouts.ts';
import { finalPx, MIN_BODY_PX, MIN_BUTTON_PX } from '../src/ui/responsive.ts';

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
