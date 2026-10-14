import Phaser from 'phaser';
import { PAL, TEXT, feltPanel } from './kit';
import { displayScaleOf } from './responsive';
import { equipRelicToNubi, fetchInventory, fetchStory, markItemSeen } from '../api/client';
import { EMPTY_TEXT, NUBI_FIXED_NOTE, TABS, detailOf, filterItems, gridCells, inventoryLayout, itemIconCandidates, keepSelection, nubiSlots, pageCells, type InventoryItem, type InventoryLayout, type InventoryList, type TabFilter } from '../inventory/inventoryView';
import type { StoryPlay } from '../story/storyFlow';

type NubiState = { growthStage?: number; slots: { slotKey: string; itemCode: string; name: string }[] } | null;

const DESC_LINES = 3; // 설명 영역 줄 수(넘으면 "더 보기")
const LOCK_LABEL = '잠금 이유';
const NUBI_HEAD = '누비 · 고정 동료';

// 열려 있을 수 있는 창 목록(개발 도구·E2E 진단이 현재 탭·페이지·배치 모드를 읽는다). 씬이 끝나면 빠진다
export const liveInventoryWindows = new Set<InventoryWindow>();

// MMORPG형 인벤토리 창(v3 §2) — 마을·탐험 화면 공용, 화면 고정 오버레이. 전투 화면에는 두지 않는다.
// 수량·잠금·장착 가능 여부는 서버 응답 그대로. 배치는 실제 표시 배율에 따라 보통/작은 화면용을 고른다(inventoryLayout).
// 아이콘·패널은 임시 도형(에셋 확정 전).
export class InventoryWindow {
  private layer: Phaser.GameObjects.Container;
  private data: InventoryList | null = null;
  private nubi: NubiState = null;
  private tab: TabFilter = 'all';
  private selected: string | null = null;
  private state: 'loading' | 'ready' | 'error' = 'loading';
  private busy = false;
  private message: string | null = null;
  private page = 0;
  private detailView: 'item' | 'nubi' = 'item'; // 작은 화면에서 누비 영역을 따로 보는 중인지
  private descOpen = false; // 긴 설명 펼침
  private nubiCollapsed = false; // 이번에 그릴 때 누비 영역이 넘쳐 전환 버튼으로 바뀌었는지(진단용)
  private token = 0; // 열기·닫기·새로 받기마다 증가 — 그 전에 보낸 요청의 응답이 새 화면을 덮지 못하게
  private seenInFlight = new Set<string>();
  private onResize = () => {
    if (this.layer.visible) this.render(); // 열린 채 화면 크기가 바뀌면 다시 배치(v4 §4.2)
  };

  private readonly scene: Phaser.Scene;
  private readonly opts: { onClose?: () => void; onPlay?: (play: StoryPlay) => void };

  constructor(scene: Phaser.Scene, opts: { onClose?: () => void; onPlay?: (play: StoryPlay) => void } = {}) {
    this.scene = scene;
    this.opts = opts;
    this.layer = scene.add.container(0, 0).setScrollFactor(0).setDepth(6000).setVisible(false);
    scene.scale.on('resize', this.onResize);
    liveInventoryWindows.add(this);
    scene.events.once('shutdown', () => {
      scene.scale.off('resize', this.onResize);
      liveInventoryWindows.delete(this);
    });
  }

  get isVisible() {
    return this.layer.visible;
  }

  // 진단용 요약(화면 상태만 — 서버 값·식별 정보 없음)
  get debugState() {
    return { visible: this.layer.visible, state: this.state, tab: this.tab, page: this.page, selected: this.selected, mode: this.layout.mode, itemCount: this.data?.items.length ?? 0, busy: this.busy, detailView: this.detailView, descOpen: this.descOpen, nubiCollapsed: this.nubiCollapsed, detailIcon: this.detailIcon, cells: this.cellRects, nubiGrowth: this.nubi?.growthStage ?? null, nubiSlotKeys: (this.nubi?.slots ?? []).map((s) => s.slotKey) };
  }

  async open(tab: TabFilter = 'all') {
    this.tab = tab;
    this.selected = null;
    this.message = null;
    this.page = 0;
    this.detailView = 'item';
    this.descOpen = false;
    this.layer.setVisible(true);
    await this.reload();
  }

  close() {
    this.token++;
    this.layer.setVisible(false);
    this.layer.removeAll(true);
    this.opts.onClose?.();
  }

  private async reload() {
    const token = ++this.token;
    this.state = 'loading';
    this.render();
    let next: { data: InventoryList; nubi: NubiState } | null = null;
    try {
      const [inv, story] = await Promise.all([fetchInventory(), fetchStory()]);
      next = { data: inv, nubi: story.storyNubi ?? null };
    } catch (err) {
      console.warn('[inventory]', err);
    }
    // 기다리는 사이 닫았거나 다시 열어 더 새로운 요청이 나갔으면 이 응답은 버린다(오래된 응답이 새 화면을 덮지 않게)
    if (token !== this.token || !this.scene.sys.isActive()) return;
    if (next) {
      this.data = next.data;
      this.nubi = next.nubi;
      this.state = 'ready';
    } else this.state = 'error';
    if (this.layer.visible) this.render();
  }

  private get layout(): InventoryLayout {
    return inventoryLayout(displayScaleOf(this.scene.scale.displaySize.width));
  }

  // 모든 자식에 scrollFactor 0(카메라가 스크롤된 맵에서도 입력 판정이 맞도록)
  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    (o as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor?.(0);
    this.layer.add(o);
    return o;
  }

  private text(x: number, y: number, s: string, size: number, color: string, opts: Phaser.Types.GameObjects.Text.TextStyle = {}) {
    return this.add(this.scene.add.text(x, y, s, { fontSize: `${size}px`, color, ...opts }));
  }

  private button(r: { x: number; y: number; w: number; h: number }, label: string, size: number, enabled: boolean, onClick: () => void, fill: number = PAL.mint) {
    const bg = this.add(this.scene.add.rectangle(r.x, r.y, r.w, r.h, enabled ? fill : PAL.cream2).setOrigin(0, 0).setStrokeStyle(3, PAL.lavender));
    this.text(r.x + r.w / 2, r.y + r.h / 2, label, size, enabled ? TEXT.body : TEXT.disabled).setOrigin(0.5);
    if (enabled) bg.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    return bg;
  }

  private render() {
    this.layer.removeAll(true);
    const L = this.layout;
    const f = L.font;
    this.add(this.scene.add.rectangle(0, 0, 1280, 720, 0x000000, 0.55).setOrigin(0, 0).setInteractive()); // 뒤 화면 입력 막기
    const panel = feltPanel(this.scene, L.window.x, L.window.y, L.window.w, L.window.h, { radius: L.mode === 'compact' ? 0 : 28, fill: PAL.cream, stroke: PAL.lavender, strokeW: 5 });
    this.add(panel);

    // 상단: 제목 · 보유 칸 · 닫기
    const h = L.header;
    this.text(h.x + 8, h.y + h.h / 2, '인벤토리', f.title, TEXT.body).setOrigin(0, 0.5);
    if (this.data) this.text(h.x + 8 + f.title * 5, h.y + h.h / 2, `가방 ${this.data.bag.used}/${this.data.bag.capacity}칸`, f.body, TEXT.sub).setOrigin(0, 0.5);
    const closeW = Math.max(120, f.button * 4);
    this.button({ x: h.x + h.w - closeW, y: h.y + 6, w: closeW, h: h.h - 12 }, '닫기', f.button, !this.busy, () => this.close(), PAL.lavender); // 장착 요청 중에는 닫지 않는다(응답을 화면에 반영)

    // 탭
    TABS.forEach((t, i) => {
      const r = L.tabs[i];
      const active = t.key === this.tab;
      const bg = this.add(this.scene.add.rectangle(r.x, r.y, r.w, r.h, active ? PAL.pink : PAL.cream2).setOrigin(0, 0).setStrokeStyle(active ? 4 : 2, PAL.lavender));
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (this.busy) return; // 장착 요청 중에는 화면을 바꾸지 않는다
        this.tab = t.key;
        this.selected = null;
        this.message = null;
        this.page = 0;
        this.detailView = 'item';
        this.descOpen = false;
        this.render();
      });
      this.text(r.x + r.w / 2, r.y + r.h / 2, t.label, f.button, TEXT.body).setOrigin(0.5);
    });

    if (this.state !== 'ready' || !this.data) {
      const g = L.grid;
      this.text(g.x + g.w / 2, g.y + 80, this.state === 'loading' ? '불러오는 중…' : '인벤토리를 불러오지 못했어요', f.body, this.state === 'error' ? TEXT.error : TEXT.sub).setOrigin(0.5);
      if (this.state === 'error') this.button({ x: g.x + g.w / 2 - 110, y: g.y + 130, w: 220, h: f.button * 3 }, '다시 시도', f.button, true, () => void this.reload());
      return;
    }

    const items = filterItems(this.data.items, this.tab);
    const paging = pageCells(gridCells(items), L, this.page);
    this.page = paging.page;
    this.selected = keepSelection(this.selected, paging.cells); // 페이지를 바꿔 선택이 사라지면 상세를 비운다
    this.renderGrid(items, L, paging);
    const sel = this.data.items.find((i) => i.itemCode === this.selected) ?? null;
    this.renderDetail(sel, L);
  }

  private renderGrid(items: InventoryItem[], L: InventoryLayout, paging: ReturnType<typeof pageCells>) {
    const g = L.grid;
    if (items.length === 0) {
      this.text(g.x + g.w / 2, g.y + 80, EMPTY_TEXT[this.tab], L.font.body, TEXT.sub).setOrigin(0.5);
      return;
    }
    if (paging.pager) {
      const { prev, next, label } = paging.pager;
      const go = (d: number) => {
        if (this.busy) return;
        this.page = (paging.page + d + paging.pages) % paging.pages;
        this.message = null;
        this.render();
      };
      this.button(prev, '◀', L.font.button, true, () => go(-1), PAL.lavender);
      this.button(next, '▶', L.font.button, true, () => go(1), PAL.lavender);
      this.text(label.x, label.y, `${paging.page + 1} / ${paging.pages}`, L.font.body, TEXT.body).setOrigin(0.5);
    }
    this.cellRects = [];
    paging.cells.forEach((c, i) => {
      const x = g.x + (i % L.cols) * (L.cell + 8);
      const y = g.y + Math.floor(i / L.cols) * (L.cell + 8);
      this.cellRects.push({ code: c.item.itemCode, x: Math.round(x), y: Math.round(y), w: L.cell, h: L.cell });
      const selected = c.item.itemCode === this.selected;
      const bg = this.add(this.scene.add.rectangle(x, y, L.cell, L.cell, 0xfffaf1).setOrigin(0, 0).setStrokeStyle(selected ? 5 : 2, selected ? 0xe58aa6 : PAL.lavender));
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.select(c.item));
      const iconKey = this.iconOf(c.item) ?? '';
      const cx = x + L.cell / 2;
      const cy = y + L.cell / 2;
      if (this.scene.textures.exists(iconKey)) this.add(this.scene.add.image(cx, cy, iconKey).setDisplaySize(L.cell * 0.66, L.cell * 0.66));
      else {
        // 아이콘 에셋이 없을 때의 임시 도형: 분류 색 원 + 이름 첫 글자
        const color = { material: 0xcfe7c4, consumable: 0xf7d9b0, equipment: 0xc9d8f2, story: 0xf2c9dc }[c.item.tab];
        this.add(this.scene.add.circle(cx, cy, L.cell * 0.32, color).setStrokeStyle(2, PAL.lavender));
        this.text(cx, cy, [...c.item.name][0] ?? '?', L.font.title, TEXT.body).setOrigin(0.5);
      }
      if (c.badge) this.text(x + L.cell - 6, y + L.cell - 4, c.badge, L.font.badge, TEXT.body, { backgroundColor: '#fff4df', padding: { x: 4, y: 1 } }).setOrigin(1, 1);
      if (c.item.isNew) this.text(x + 6, y + 4, 'N', L.font.badge, '#ffffff', { backgroundColor: '#e5708f', padding: { x: 5, y: 1 } });
      if (c.item.isLocked) this.text(x + L.cell - 6, y + 4, '잠김', L.font.badge, '#ffffff', { backgroundColor: '#8a7aa8', padding: { x: 4, y: 1 } }).setOrigin(1, 0);
    });
  }

  private cellRects: { code: string; x: number; y: number; w: number; h: number }[] = []; // 진단용: 그린 격자 칸(캔버스 좌표)
  private detailIcon: { key: string; x: number; y: number; size: number } | null = null; // 진단용: 상세에 그린 아이콘(텍스처 키·위치·표시 크기)

  private iconOf(item: InventoryItem): string | null {
    return itemIconCandidates(item.iconKey).find((k) => this.scene.textures.exists(k)) ?? null;
  }

  private renderDetail(item: InventoryItem | null, L: InventoryLayout) {
    const d = L.detail;
    const f = L.font;
    this.detailIcon = null;
    this.add(this.scene.add.rectangle(d.x, d.y, d.w, d.h, 0xfffaf1).setOrigin(0, 0).setStrokeStyle(2, PAL.lavender));
    const pad = 14;
    let y = d.y + pad;
    const wrap = { wordWrap: { width: d.w - pad * 2, useAdvancedWrap: true } };
    const showNubi = this.tab === 'story' || !!item?.storySlot;

    if (!item) {
      this.text(d.x + pad, y, showNubi ? '이야기 누비' : '아이템을 눌러 자세히 보기', f.body, TEXT.sub, wrap);
      if (showNubi) this.renderNubi(d.x + pad, y + f.body * 2, d.w - pad * 2);
      return;
    }
    const view = detailOf(item);
    const inner = d.w - pad * 2;
    // 아이콘이 있는 아이템은 상세 오른쪽 위에 80×80으로 보여 준다(이름·배지는 그 왼쪽에 줄바꿈)
    const iconKey = this.iconOf(item);
    const ICON = 80;
    const iconRoom = iconKey ? ICON + 8 : 0;
    this.detailIcon = iconKey ? { key: iconKey, x: Math.round(d.x + d.w - pad - ICON), y: Math.round(y), size: ICON } : null;
    if (iconKey) this.add(this.scene.add.image(d.x + d.w - pad - ICON / 2, y + ICON / 2, iconKey).setDisplaySize(ICON, ICON));
    const bottom = d.y + d.h - pad; // 상세 영역 아래 끝 — 넘치면 누비 영역은 전환 버튼 뒤로 보낸다(문구는 지우지 않는다)
    // 1) 이름 + 상태 배지(이름 오른쪽, 자리가 모자라면 다음 줄)
    const title = this.text(d.x + pad, y, view.title, f.title, TEXT.body, { wordWrap: { width: d.w - pad * 2 - iconRoom, useAdvancedWrap: true } });
    let bx = d.x + pad + title.width + 10;
    let by = y + Math.max(0, (title.height - f.body * 1.4) / 2);
    const BADGE: Record<string, [string, string]> = { 신규: ['#ffffff', '#e0708a'], 잠김: ['#ffffff', '#8a6aa8'], 장착됨: [TEXT.onMint, '#cfeedd'] };
    for (const b of view.badges) {
      const [fg, bg] = BADGE[b] ?? [TEXT.body, '#eeeeee'];
      const t = this.text(bx, by, b, f.body, fg, { backgroundColor: bg, padding: { x: 6, y: 2 } });
      if (bx + t.width > d.x + d.w - pad - iconRoom) {
        by = y + title.height + 4;
        bx = d.x + pad;
        t.setPosition(bx, by);
      }
      bx += t.width + 6;
    }
    y = Math.max(y + title.height, by + f.body * 1.4, iconKey ? y + ICON : 0) + 10;

    // 누비 영역을 따로 보는 중(작은 화면에서 한 번에 다 들어가지 않을 때): 이름·배지 아래에 누비 영역만, 돌아가기 버튼과 함께
    if (showNubi && this.detailView === 'nubi') {
      const bh = f.button * 2;
      this.button({ x: d.x + pad, y, w: inner, h: bh }, '◂ 아이템 정보 보기', f.button, true, () => {
        this.detailView = 'item';
        this.render();
      }, PAL.lavender);
      this.renderNubi(d.x + pad, y + bh + 10, inner);
      return;
    }

    // 2) 설명: 정해진 영역(최대 3줄)에서 줄바꿈하고, 더 길면 "더 보기"로 펼친다(문구를 자르거나 줄이지 않는다)
    if (view.description) {
      const lineH = f.body + 4;
      const full = this.text(d.x + pad, y, view.description, f.body, TEXT.body, { ...wrap, lineSpacing: 4 });
      const long = full.height > lineH * DESC_LINES + 2;
      if (long && !this.descOpen) full.setStyle({ maxLines: DESC_LINES });
      y += full.height + 4;
      if (long) {
        const more = this.text(d.x + pad, y, this.descOpen ? '접기 ▴' : '더 보기 ▾', f.body, '#6a5a9a', { backgroundColor: '#ece6fb', padding: { x: 8, y: 3 } });
        more.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
          this.descOpen = !this.descOpen;
          this.render();
        });
        y += more.height + 4;
      }
      y += 4;
    }
    // 3) 수량·분류: 구분선 아래 보조 정보
    this.add(this.scene.add.rectangle(d.x + pad, y, inner, 2, PAL.lavender, 0.6).setOrigin(0, 0));
    y += 8;
    const meta = this.text(d.x + pad, y, view.meta.join('  ·  '), f.body, TEXT.sub, { ...wrap, lineSpacing: 4 });
    y += meta.height + 10;
    // 4) 잠금 이유: 이름표가 붙은 연보라 상자(아래 누비 안내와 다른 영역임을 이름표로 구분)
    if (view.lockNote) {
      const box = this.add(this.scene.add.rectangle(d.x + pad, y, inner, 10, 0xf3e6f3).setOrigin(0, 0).setStrokeStyle(2, 0xc9a6c9));
      const tag = this.text(d.x + pad + 10, y + 6, LOCK_LABEL, f.badge, '#ffffff', { backgroundColor: '#8a6aa8', padding: { x: 6, y: 2 } });
      const lock = this.text(d.x + pad + 10, y + 6 + tag.height + 4, view.lockNote, f.body, '#6a3f6a', { wordWrap: { width: inner - 20, useAdvancedWrap: true } });
      const bh = tag.height + 4 + lock.height + 12;
      box.setSize(inner, bh);
      y += bh + 10;
    }
    // 5) 누비 슬롯 또는 가능한 행동
    if (view.equippedLabel) {
      const eq = this.text(d.x + pad, y, view.equippedLabel, f.button, TEXT.onMint, { backgroundColor: '#cfeedd', padding: { x: 8, y: 4 } });
      y += eq.height + 10;
    } else if (view.equip) {
      const bh = f.button * 2.6;
      this.button({ x: d.x + pad, y, w: d.w - pad * 2, h: bh }, this.busy ? '장착 중…' : view.equip.label, f.button, view.equip.enabled && !this.busy, () => void this.equip(item));
      y += bh + 8;
      if (view.equip.note) {
        const note = this.text(d.x + pad, y, view.equip.note, f.body, TEXT.sub, wrap);
        y += note.height + 8;
      }
    }
    if (this.message) {
      const m = this.text(d.x + pad, y, this.message, f.body, TEXT.error, wrap);
      y += m.height + 8;
    }
    if (!showNubi) return;
    // 누비 영역: 들어가면 그대로 보여 주고, 넘치면(작은 화면) 전환 버튼만 두고 따로 보게 한다 — 문구는 그대로
    const mark = this.layer.length;
    const end = this.renderNubi(d.x + pad, y + 6, inner);
    this.nubiCollapsed = end > bottom;
    if (this.nubiCollapsed) {
      this.layer.list.slice(mark).forEach((o) => o.destroy());
      const bh = f.button * 2;
      this.button({ x: d.x + pad, y: Math.min(y + 4, bottom - bh), w: inner, h: bh }, `${NUBI_HEAD} 보기 ▸`, f.button, true, () => {
        this.detailView = 'nubi';
        this.render();
      }, PAL.lavender);
    }
  }

  // 누비 영역: 이름표(누비 · 고정 동료) 상자 안에 슬롯(장착 전 빈 슬롯 / 장착 후 유물과 "장착됨")과 해제 불가 안내. 그린 영역의 아래 끝을 돌려준다
  private renderNubi(x: number, y: number, w: number): number {
    const f = this.layout.font;
    const box = this.add(this.scene.add.rectangle(x, y, w, 10, 0xf6f9ff).setOrigin(0, 0).setStrokeStyle(2, 0xb9c8e6));
    const head = this.text(x + 10, y + 6, NUBI_HEAD, f.badge, '#ffffff', { backgroundColor: '#6f86b8', padding: { x: 6, y: 2 } });
    if (this.nubi) this.text(x + 10 + head.width + 8, y + 6, `성장 단계 ${this.nubi.growthStage ?? 1}`, f.badge, '#ffffff', { backgroundColor: '#7a9a6a', padding: { x: 6, y: 2 } });
    let yy = y + 6 + head.height + 6;
    const slots = nubiSlots(this.nubi, this.data?.items ?? []);
    if (slots.length === 0) {
      const t = this.text(x + 10, yy, '아직 장착할 이야기 유물이 없어요', f.body, TEXT.sub, { wordWrap: { width: w - 20, useAdvancedWrap: true } });
      yy += t.height + 6;
    }
    for (const s of slots) {
      const h = f.body * 2.2;
      this.add(this.scene.add.rectangle(x + 10, yy, w - 20, h, s.equipped ? 0xcfeedd : 0xf3eefb).setOrigin(0, 0).setStrokeStyle(2, s.equipped ? 0x6fbf8a : PAL.lavender));
      this.text(x + 20, yy + h / 2, `${s.label} 슬롯`, f.body, TEXT.body).setOrigin(0, 0.5);
      this.text(x + w - 20, yy + h / 2, s.status, f.body, s.equipped ? TEXT.onMint : TEXT.sub).setOrigin(1, 0.5);
      yy += h + 6;
    }
    const note = this.text(x + 10, yy, NUBI_FIXED_NOTE, f.body, TEXT.sub, { wordWrap: { width: w - 20, useAdvancedWrap: true } });
    const end = yy + note.height + 8;
    box.setSize(w, end - y);
    return end;
  }

  private async select(item: InventoryItem) {
    if (this.busy) return; // 장착 요청 중에는 선택을 바꾸지 않는다
    this.selected = item.itemCode;
    this.message = null;
    this.detailView = 'item';
    this.descOpen = false;
    this.render();
    // 상세를 실제로 연 아이템만 신규 해제(서버 정본). 실패하면 표시만 그대로 둔다.
    // 같은 아이템을 연달아 눌러도 요청은 한 번만 보낸다(응답 전 중복 방지)
    if (item.isNew && !this.seenInFlight.has(item.itemCode)) {
      const token = this.token;
      this.seenInFlight.add(item.itemCode);
      try {
        await markItemSeen(item.itemCode);
        item.isNew = false;
        // 기다리는 사이 창을 닫았거나 목록을 새로 받았으면 이 응답으로 다시 그리지 않는다(새 목록이 서버 값을 이미 담고 있다)
        if (token === this.token && this.layer.visible && this.scene.sys.isActive()) this.render();
      } catch (err) {
        console.warn('[inventory] 읽음 처리 실패', err);
      } finally {
        this.seenInFlight.delete(item.itemCode);
      }
    }
  }

  private async equip(item: InventoryItem) {
    if (this.busy) return; // 한 번의 탭으로 요청은 한 번만
    this.busy = true;
    this.render();
    try {
      const res = await equipRelicToNubi(item.itemCode);
      this.busy = false;
      if (!this.scene.sys.isActive()) return; // 기다리는 사이 화면이 바뀜(서버 진행은 저장됨 — 다음 접속 때 이어진다)
      if (res.play) {
        if (this.layer.visible) this.close();
        this.opts.onPlay?.(res.play);
        return;
      }
      if (this.layer.visible) await this.reload();
    } catch (err) {
      this.busy = false;
      if (!this.scene.sys.isActive() || !this.layer.visible) return;
      this.message = err instanceof Error && err.message ? err.message : '장착하지 못했어요';
      this.render();
    }
  }
}
