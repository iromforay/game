import Phaser from 'phaser';
import { PAL, TEXT, feltPanel } from './kit';
import { displayScaleOf } from './responsive';
import { equipRelicToNubi, fetchInventory, fetchStory, markItemSeen } from '../api/client';
import { EMPTY_TEXT, NUBI_FIXED_NOTE, TABS, detailOf, filterItems, gridCells, inventoryLayout, nubiSlots, type InventoryItem, type InventoryLayout, type InventoryList, type TabFilter } from '../inventory/inventoryView';
import type { StoryPlay } from '../story/storyFlow';

type NubiState = { slots: { slotKey: string; itemCode: string; name: string }[] } | null;

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

  private readonly scene: Phaser.Scene;
  private readonly opts: { onClose?: () => void; onPlay?: (play: StoryPlay) => void };

  constructor(scene: Phaser.Scene, opts: { onClose?: () => void; onPlay?: (play: StoryPlay) => void } = {}) {
    this.scene = scene;
    this.opts = opts;
    this.layer = scene.add.container(0, 0).setScrollFactor(0).setDepth(6000).setVisible(false);
  }

  get isVisible() {
    return this.layer.visible;
  }

  async open(tab: TabFilter = 'all') {
    this.tab = tab;
    this.selected = null;
    this.message = null;
    this.layer.setVisible(true);
    await this.reload();
  }

  close() {
    this.layer.setVisible(false);
    this.layer.removeAll(true);
    this.opts.onClose?.();
  }

  private async reload() {
    this.state = 'loading';
    this.render();
    try {
      const [inv, story] = await Promise.all([fetchInventory(), fetchStory()]);
      this.data = inv;
      this.nubi = story.storyNubi ?? null;
      this.state = 'ready';
    } catch (err) {
      console.warn('[inventory]', err);
      this.state = 'error';
    }
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
    this.button({ x: h.x + h.w - closeW, y: h.y + 6, w: closeW, h: h.h - 12 }, '닫기', f.button, true, () => this.close(), PAL.lavender);

    // 탭
    TABS.forEach((t, i) => {
      const r = L.tabs[i];
      const active = t.key === this.tab;
      const bg = this.add(this.scene.add.rectangle(r.x, r.y, r.w, r.h, active ? PAL.pink : PAL.cream2).setOrigin(0, 0).setStrokeStyle(active ? 4 : 2, PAL.lavender));
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.tab = t.key;
        this.selected = null;
        this.message = null;
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
    this.renderGrid(items, L);
    const sel = this.data.items.find((i) => i.itemCode === this.selected) ?? null;
    this.renderDetail(sel, L);
  }

  private renderGrid(items: InventoryItem[], L: InventoryLayout) {
    const g = L.grid;
    if (items.length === 0) {
      this.text(g.x + g.w / 2, g.y + 80, EMPTY_TEXT[this.tab], L.font.body, TEXT.sub).setOrigin(0.5);
      return;
    }
    const cells = gridCells(items);
    const rows = Math.max(1, Math.floor((g.h + 8) / (L.cell + 8)));
    cells.slice(0, rows * L.cols).forEach((c, i) => {
      const x = g.x + (i % L.cols) * (L.cell + 8);
      const y = g.y + Math.floor(i / L.cols) * (L.cell + 8);
      const selected = c.item.itemCode === this.selected;
      const bg = this.add(this.scene.add.rectangle(x, y, L.cell, L.cell, 0xfffaf1).setOrigin(0, 0).setStrokeStyle(selected ? 5 : 2, selected ? 0xe58aa6 : PAL.lavender));
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.select(c.item));
      const iconKey = `item-${c.item.iconKey}`;
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
    if (cells.length > rows * L.cols) this.text(g.x, g.y + g.h - L.font.body, `외 ${cells.length - rows * L.cols}칸`, L.font.body, TEXT.sub);
  }

  private renderDetail(item: InventoryItem | null, L: InventoryLayout) {
    const d = L.detail;
    const f = L.font;
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
    const title = this.text(d.x + pad, y, view.title, f.title, TEXT.body, wrap);
    y += title.height + 8;
    const body = this.text(d.x + pad, y, view.lines.join('\n'), f.body, TEXT.sub, { ...wrap, lineSpacing: 4 });
    y += body.height + 10;
    if (view.lockNote) {
      const lock = this.text(d.x + pad, y, `잠김 · ${view.lockNote}`, f.body, '#8a5a7a', wrap);
      y += lock.height + 10;
    }
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
    if (showNubi) this.renderNubi(d.x + pad, y + 6, d.w - pad * 2);
  }

  // 누비 패널: 고정 동료 표시, 슬롯(장착 전 빈 슬롯 / 장착 후 유물과 "장착됨"), 해제 불가 이유
  private renderNubi(x: number, y: number, w: number) {
    const f = this.layout.font;
    const head = this.text(x, y, '누비 · 고정 동료', f.body, TEXT.body);
    let yy = y + head.height + 6;
    const slots = nubiSlots(this.nubi, this.data?.items ?? []);
    if (slots.length === 0) {
      const t = this.text(x, yy, '아직 장착할 이야기 유물이 없어요', f.body, TEXT.sub, { wordWrap: { width: w } });
      yy += t.height + 6;
    }
    for (const s of slots) {
      const h = f.body * 2.4;
      this.add(this.scene.add.rectangle(x, yy, w, h, s.equipped ? 0xcfeedd : 0xf3eefb).setOrigin(0, 0).setStrokeStyle(2, s.equipped ? 0x6fbf8a : PAL.lavender));
      this.text(x + 10, yy + h / 2, `${s.label} 슬롯`, f.body, TEXT.body).setOrigin(0, 0.5);
      this.text(x + w - 10, yy + h / 2, s.status, f.body, s.equipped ? TEXT.onMint : TEXT.sub).setOrigin(1, 0.5);
      yy += h + 6;
    }
    this.text(x, yy + 2, NUBI_FIXED_NOTE, f.body, TEXT.sub, { wordWrap: { width: w, useAdvancedWrap: true } });
  }

  private async select(item: InventoryItem) {
    this.selected = item.itemCode;
    this.message = null;
    this.render();
    // 상세를 실제로 연 아이템만 신규 해제(서버 정본). 실패하면 표시만 그대로 둔다
    if (item.isNew) {
      try {
        await markItemSeen(item.itemCode);
        item.isNew = false;
        if (this.layer.visible) this.render();
      } catch (err) {
        console.warn('[inventory] 읽음 처리 실패', err);
      }
    }
  }

  private async equip(item: InventoryItem) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      const res = await equipRelicToNubi(item.itemCode);
      this.busy = false;
      if (res.play) {
        this.close();
        this.opts.onPlay?.(res.play);
        return;
      }
      await this.reload();
    } catch (err) {
      this.busy = false;
      this.message = err instanceof Error && err.message ? err.message : '장착하지 못했어요';
      this.render();
    }
  }
}
