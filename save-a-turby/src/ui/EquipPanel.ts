import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';
import slotData from '../data/equip-slots.json';
import { NUBI_FIXED_NOTE } from '../inventory/inventoryView';
import { PAL, TEXT, feltPanel, pillButton, ellipsize, itemIconKey } from './kit';
import { displayScaleOf } from './responsive';
import { equipPanelLayout, type EquipPanelLayout } from './screenLayouts';

const DEPTH = 100;
const STAT_KEYS = [
  ['attack', '공격'],
  ['defense', '방어'],
  ['actionPower', '행동'],
  ['maxHp', '체력'],
] as const;

// 장비 창에 그릴 줄: 일반 슬롯(무기·방어구·장신구) + 이야기 슬롯(누비가 장착한 이야기 유물만 — 장착 전 슬롯은 보이지 않음)
// 순수 판정: 테스트 대상(test/screenLayouts.test.ts)
export type EquipRowKind = { kind: 'general'; slotKey: string; label: string; iconKey?: string } | { kind: 'story'; slotKey: string; itemName: string };
export const isStorySlot = (slotKey: string) => slotKey.startsWith('story_');
export function equipRows(equipment: { slotKey: string; itemName: string }[], slots: { key: string; label: string; iconKey?: string }[]): EquipRowKind[] {
  const general: EquipRowKind[] = slots.map((s) => ({ kind: 'general', slotKey: s.key, label: s.label, iconKey: s.iconKey }));
  const story: EquipRowKind[] = equipment.filter((e) => isStorySlot(e.slotKey)).map((e) => ({ kind: 'story', slotKey: e.slotKey, itemName: e.itemName }));
  return [...general, ...story];
}
export const STORY_SLOT_LABEL = '이야기 슬롯';
export const STORY_SLOT_LOCK = '해제 불가';

// 3.1: 터비별 장착 상태창 — 슬롯(무기/방어구/장신구)마다 장착·해제하고 서버가 계산한 최종 스탯을 바로 보여준다.
// 서버가 소유권·보유 수량·슬롯을 검증하므로 여기서는 결과 메시지만 표시. 좌표·글자는 equipPanelLayout(표시 배율별).
// 누비의 이야기 슬롯은 일반 슬롯과 다른 색·이름표·"해제 불가"로 구분하고, 해제 버튼을 두지 않는다(이유 문구 표시).
export class EquipPanel {
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container | null = null;
  private turbyId: string | null = null;
  private busySlot: string | null = null;
  private lastStats: Record<string, number> | null = null;
  private onClose: () => void;
  private escHandler = () => this.close();
  private token = 0; // 요청마다 증가 — 닫았다 다시 열거나 다른 터비를 연 뒤 도착한 응답은 버린다

  constructor(scene: Phaser.Scene, onClose: () => void = () => {}) {
    this.scene = scene;
    this.onClose = onClose;
    scene.events.once('shutdown', () => {
      // 씬이 끝나면 열려 있던 창의 키 입력 연결도 함께 푼다(재시작 때 중복 등록 방지)
      scene.input.keyboard?.off('keydown-ESC', this.escHandler);
      this.layer = null;
      this.token++;
    });
  }

  get isOpen() {
    return this.layer !== null;
  }
  get isBusy() {
    return this.busySlot !== null;
  }
  get openTurbyId() {
    return this.layer ? this.turbyId : null;
  }
  // 진단용 요약(화면 상태만)
  get debugState() {
    const t = this.turby();
    return { open: this.isOpen, busy: this.isBusy, turbyId: this.openTurbyId, equipment: t?.equipment.map((e) => e.slotKey).sort() ?? [], mode: this.layout?.mode };
  }

  open(turbyId: string) {
    if (this.layer) this.close();
    this.turbyId = turbyId;
    this.busySlot = null;
    this.lastStats = null;
    this.token++;
    this.scene.input.keyboard?.on('keydown-ESC', this.escHandler);
    this.render();
  }

  close() {
    if (this.busySlot) return; // 장착·해제 요청 중에는 닫지 않는다(응답을 화면에 반영해야 한다)
    this.scene.input.keyboard?.off('keydown-ESC', this.escHandler);
    this.layer?.destroy();
    this.layer = null;
    this.turbyId = null;
    this.token++;
    this.onClose();
  }

  private turby(): OwnedTurby | undefined {
    return inventory.getAll().find((t) => t.id === this.turbyId);
  }

  private layout: EquipPanelLayout | null = null;

  private render(message?: string, isError = false) {
    this.layer?.destroy();
    this.layer = null;
    const turby = this.turby();
    if (!turby) return;
    const s = this.scene;
    const rows = equipRows(turby.equipment, slotData);
    const L = (this.layout = equipPanelLayout(displayScaleOf(s.scale.displaySize.width), rows.length));
    const objs: Phaser.GameObjects.GameObject[] = [];

    // 모달 바깥을 눌러도 닫히지 않는다(입력만 막는다)
    objs.push(s.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x4a3a44, 0.68).setOrigin(0, 0).setInteractive());
    objs.push(feltPanel(s, L.panel.x, L.panel.y, L.panel.w, L.panel.h, { radius: 28, strokeW: 6, image: 'equip-panel' }));

    // 헤더: 터비 이름 + 닫기
    const H = L.header;
    objs.push(feltPanel(s, H.x, H.y, H.w, H.h, { fill: PAL.cream2, strokeW: 4, radius: 22 }));
    objs.push(s.add.text(H.x + 24, H.y + H.h / 2, `${ellipsize(turby.characterName, 12)} 장비`, { fontSize: `${L.font.header}px`, color: TEXT.body }).setOrigin(0, 0.5));
    const C = L.close;
    objs.push(pillButton(s, C.x + C.w / 2, C.y + C.h / 2, C.w, C.h, '닫기', this.busySlot ? 'disabled' : 'back', () => this.close(), undefined, L.font.button));

    this.renderSummary(objs, turby, L);

    const items = inventory.getItems();
    rows.forEach((row, i) => {
      if (row.kind === 'general') this.renderRow(objs, turby, row, items, L.rows[i], L);
      else this.renderStoryRow(objs, row, L.rows[i], L);
    });

    if (message) objs.push(s.add.text(CANVAS_WIDTH / 2, L.messageY, message, { fontSize: `${L.font.note}px`, color: isError ? TEXT.error : TEXT.onMint }).setOrigin(0.5));
    this.layer = s.add.container(0, 0, objs).setDepth(DEPTH);
  }

  // 터비 요약: 이미지 + 최종 스탯 4개 알약(증가분은 민트 +N을 0.8초 표시)
  private renderSummary(objs: Phaser.GameObjects.GameObject[], turby: OwnedTurby, L: EquipPanelLayout) {
    const s = this.scene;
    const S = L.summary;
    objs.push(feltPanel(s, S.x, S.y, S.w, S.h, { fill: PAL.sky, strokeW: 4, radius: 22, image: 'turby-summary-frame' }));
    const cx = S.x + S.w / 2;
    if (s.textures.exists(`turby-${turby.characterCode}`)) objs.push(s.add.image(cx, S.y + 8 + L.summaryImage / 2, `turby-${turby.characterCode}`).setDisplaySize(L.summaryImage, L.summaryImage));
    const stats = turby.stats as unknown as Record<string, number>;
    const P = L.statPill;
    STAT_KEYS.forEach(([key, label], i) => {
      const py = P.y0 + i * (P.h + P.gap);
      objs.push(feltPanel(s, P.x, py, P.w, P.h, { fill: PAL.cream, strokeW: 3, radius: 20, image: 'stat-pill' }));
      objs.push(s.add.text(P.x + 18, py + P.h / 2, label, { fontSize: `${L.font.label}px`, color: TEXT.sub }).setOrigin(0, 0.5));
      objs.push(s.add.text(P.x + P.w * 0.62, py + P.h / 2, String(stats[key]), { fontSize: `${L.font.value}px`, color: TEXT.body }).setOrigin(0.5));
      const gain = this.lastStats ? stats[key] - this.lastStats[key] : 0;
      if (gain > 0) {
        const plus = s.add.text(P.x + P.w - 8, py + P.h / 2, `+${gain}`, { fontSize: `${L.font.label}px`, color: TEXT.onMint }).setOrigin(1, 0.5);
        objs.push(plus);
        s.tweens.add({ targets: plus, alpha: 0, delay: 800, duration: 300 });
      }
    });
    this.lastStats = { ...stats };
  }

  private renderRow(objs: Phaser.GameObjects.GameObject[], turby: OwnedTurby, slot: { slotKey: string; label: string; iconKey?: string }, items: ReturnType<typeof inventory.getItems>, r: { x: number; y: number; w: number; h: number }, L: EquipPanelLayout) {
    const s = this.scene;
    const R = L.row;
    const equipped = turby.equipment.find((e) => e.slotKey === slot.slotKey);
    const busy = this.busySlot === slot.slotKey;
    const locked = this.busySlot !== null; // 한 요청이 끝날 때까지 다른 슬롯도 누를 수 없다
    objs.push(feltPanel(s, r.x, r.y, r.w, r.h, { fill: PAL.cream, strokeW: 4, radius: 22, image: 'equip-row-frame' }));

    // 슬롯 아이콘
    if (slot.iconKey && s.textures.exists(slot.iconKey)) {
      objs.push(s.add.image(r.x + 14 + R.icon / 2, r.y + r.h / 2, slot.iconKey).setDisplaySize(R.icon, R.icon));
    } else {
      objs.push(feltPanel(s, r.x + 14, r.y + (r.h - R.icon) / 2, R.icon, R.icon, { fill: PAL.lavender, stroke: PAL.cream, strokeW: 3, radius: 20 }));
      objs.push(s.add.text(r.x + 14 + R.icon / 2, r.y + r.h / 2, slot.label, { fontSize: `${L.font.row}px`, color: TEXT.body }).setOrigin(0.5));
    }

    // 가운데: 현재 장착 + 칩 상태(장착 가능/다른 터비 사용 중)를 글자로 알린다 — 칩 안에는 아이콘만 둔다
    const nameX = r.x + R.nameX;
    const slotItems = items.filter((it) => it.equipSlot === slot.slotKey && it.quantity > 0);
    const available = slotItems.filter((it) => it.code !== equipped?.itemCode && it.available > 0);
    const usedElsewhere = slotItems.filter((it) => it.code !== equipped?.itemCode && it.available <= 0);
    objs.push(s.add.text(nameX, r.y + 6, `${slot.label} · ${equipped ? `장착 중: ${ellipsize(equipped.itemName, 10)}` : '비어 있음'}`, { fontSize: `${L.font.row}px`, color: equipped ? TEXT.body : TEXT.sub }));
    const notes = [...available.map((it) => `장착 가능: ${ellipsize(it.name, 8)} (남음 ${it.available})`), ...usedElsewhere.map((it) => `다른 터비 사용 중: ${ellipsize(it.name, 8)}`)].join('  ·  ');
    // 아이템 칩 — 장착 중=체크, 장착 가능=민트 점, 다른 터비 사용 중=잠금. 칩 상태 설명은 칩 오른쪽(줄 테두리와 겹치지 않게 칩과 같은 높이)
    const chip = Math.min(R.chip, r.h - (10 + L.font.row * 1.25) - 8);
    const notesX = nameX + slotItems.length * (chip + 12) + 4;
    const notesW = r.x + R.action.x - 12 - notesX;
    if (notes && notesW > 120) objs.push(s.add.text(notesX, r.y + r.h - chip / 2 - 6, notes, { fontSize: `${L.font.note}px`, color: TEXT.sub, wordWrap: { width: notesW, useAdvancedWrap: true }, maxLines: 2 }).setOrigin(0, 0.5));
    slotItems.forEach((it, idx) => {
      const cx = nameX + chip / 2 + idx * (chip + 12);
      const cy = r.y + r.h - chip / 2 - 6;
      if (cx + chip / 2 > r.x + R.action.x - 8) return; // 행동 버튼 영역을 침범하지 않는다
      const isCurrent = equipped?.itemCode === it.code;
      const usable = !isCurrent && it.available > 0 && !locked;
      const inUseElsewhere = !isCurrent && it.available <= 0;
      const frameKey = isCurrent ? 'item-chip-equipped' : inUseElsewhere ? 'item-chip-locked' : 'item-chip';
      if (s.textures.exists(frameKey)) {
        objs.push(s.add.image(cx, cy, frameKey).setDisplaySize(chip, chip));
      } else {
        const g = s.add.graphics();
        g.fillStyle(isCurrent ? PAL.lavender : inUseElsewhere ? PAL.cream2 : PAL.cream, 1);
        g.fillRoundedRect(cx - chip / 2, cy - chip / 2, chip, chip, 16);
        g.lineStyle(isCurrent ? 4 : 3, isCurrent ? PAL.lavender : PAL.disabled, 1);
        g.strokeRoundedRect(cx - chip / 2, cy - chip / 2, chip, chip, 16);
        objs.push(g);
      }
      const iconKey = itemIconKey(s, it.code);
      const icon = iconKey ? s.add.image(cx, cy, iconKey).setDisplaySize(chip * 0.62, chip * 0.62) : s.add.text(cx, cy, ellipsize(it.name, 3), { fontSize: `${L.font.note}px`, color: TEXT.body }).setOrigin(0.5);
      if (inUseElsewhere) icon.setAlpha(0.45);
      objs.push(icon);
      const mark = chip * 0.36;
      if (isCurrent) objs.push(s.add.text(cx + mark, cy - mark, '✓', { fontSize: `${L.font.row}px`, color: TEXT.onMint }).setOrigin(0.5));
      if (usable) objs.push(s.add.circle(cx + mark, cy - mark, 6, PAL.mint).setStrokeStyle(2, PAL.lavender));
      if (inUseElsewhere) {
        const lock = s.add.graphics();
        lock.lineStyle(3, PAL.disabled, 1);
        lock.strokeCircle(cx + mark, cy - mark - 3, 5);
        lock.fillStyle(PAL.disabled, 1);
        lock.fillRoundedRect(cx + mark - 7, cy - mark, 14, 11, 3);
        objs.push(lock);
      }
      if (usable) {
        objs.push(
          s.add
            .rectangle(cx, cy, chip, chip, 0xffffff, 0)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.act(slot.slotKey, () => inventory.equip(turby.id, it.code))),
        );
      }
    });

    // 오른쪽 행동: 장착 중이면 해제(요청 중이면 "처리 중" 표시)
    const A = R.action;
    if (busy) objs.push(pillButton(s, r.x + A.x + A.w / 2, r.y + A.y + A.h / 2, A.w, A.h, '처리 중…', 'disabled', () => undefined, undefined, L.font.button));
    else if (equipped) objs.push(pillButton(s, r.x + A.x + A.w / 2, r.y + A.y + A.h / 2, A.w, A.h, '해제', locked ? 'disabled' : 'secondary', () => this.act(slot.slotKey, () => inventory.unequip(turby.id, slot.slotKey)), undefined, L.font.button));
  }

  // 이야기 슬롯: 일반 슬롯과 다른 바탕색·이름표, 해제 버튼 없음, 해제할 수 없는 이유 표시
  private renderStoryRow(objs: Phaser.GameObjects.GameObject[], row: { slotKey: string; itemName: string }, r: { x: number; y: number; w: number; h: number }, L: EquipPanelLayout) {
    const s = this.scene;
    const R = L.row;
    const g = s.add.graphics();
    g.fillStyle(0xf3e6f3, 1);
    g.fillRoundedRect(r.x, r.y, r.w, r.h, 22);
    g.lineStyle(4, 0xc9a6c9, 1);
    g.strokeRoundedRect(r.x, r.y, r.w, r.h, 22);
    objs.push(g);
    objs.push(feltPanel(s, r.x + 14, r.y + (r.h - R.icon) / 2, R.icon, R.icon, { fill: 0xe6c9e6, stroke: PAL.cream, strokeW: 3, radius: 20 }));
    objs.push(s.add.text(r.x + 14 + R.icon / 2, r.y + r.h / 2, '이야기', { fontSize: `${L.font.note}px`, color: '#6a3f6a' }).setOrigin(0.5));
    const nameX = r.x + R.nameX;
    objs.push(s.add.text(nameX, r.y + 6, `${STORY_SLOT_LABEL} · 장착됨: ${ellipsize(row.itemName, 10)}`, { fontSize: `${L.font.row}px`, color: '#6a3f6a' }));
    objs.push(s.add.text(nameX, r.y + 10 + L.font.row * 1.25, NUBI_FIXED_NOTE, { fontSize: `${L.font.note}px`, color: '#6a3f6a', wordWrap: { width: R.noteW, useAdvancedWrap: true }, lineSpacing: 2 }));
    // 해제 버튼 자리에는 누를 수 없는 상태 표시(자물쇠 글자 + "해제 불가")
    const A = R.action;
    const box = s.add.graphics();
    box.fillStyle(0xe9dcee, 1);
    box.fillRoundedRect(r.x + A.x, r.y + A.y, A.w, A.h, Math.min(20, A.h / 2));
    box.lineStyle(3, 0xc9a6c9, 1);
    box.strokeRoundedRect(r.x + A.x, r.y + A.y, A.w, A.h, Math.min(20, A.h / 2));
    objs.push(box);
    objs.push(s.add.text(r.x + A.x + A.w / 2, r.y + A.y + A.h / 2, STORY_SLOT_LOCK, { fontSize: `${L.font.button}px`, color: '#6a3f6a' }).setOrigin(0.5));
  }

  private async act(slotKey: string, run: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (this.busySlot) return; // 요청 중 — 한 번의 탭으로 요청은 한 번만
    const token = this.token;
    this.busySlot = slotKey;
    this.render();
    const result = await run();
    if (token !== this.token) return; // 기다리는 사이 닫히거나 씬이 끝남 — 이 응답으로 화면을 건드리지 않는다
    this.busySlot = null;
    this.render(result.ok ? undefined : result.message, !result.ok);
  }
}
