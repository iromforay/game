import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';
import slotData from '../data/equip-slots.json';
import { PAL, TEXT, feltPanel, pillButton, ellipsize, itemIconKey } from './kit';

// docs/save_a_turby_ui_spec.md 4절 좌표 — Codex QA(to_claude_v10)로 패널을 세로 중앙의 500px로 줄이고 칩을 20% 키웠다
const PANEL = { x: 180, y: 110, w: 920, h: 500 };
const HEADER_Y = PANEL.y + 20;
const SUMMARY = { x: 208, y: PANEL.y + 108, w: 190, h: 372 };
const LIST = { x: 420, y: PANEL.y + 108, w: 652 };
const ROW_H = 116;
const ROW_GAP = 12;
const CHIP = 68;
const DEPTH = 100;
const STAT_KEYS = [
  ['attack', '공격'],
  ['defense', '방어'],
  ['actionPower', '행동'],
  ['maxHp', '체력'],
] as const;

// 3.1: 터비별 장착 상태창 — 슬롯(무기/방어구/장신구)마다 장착·해제하고 서버가 계산한 최종 스탯을 바로 보여준다.
// 서버가 소유권·보유 수량·슬롯을 검증하므로 여기서는 결과 메시지만 표시. 도형 UI(에셋 적용 전).
export class EquipPanel {
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Container | null = null;
  private turbyId: string | null = null;
  private busySlot: string | null = null;
  private lastStats: Record<string, number> | null = null;
  private onClose: () => void;
  private escHandler = () => this.close();

  constructor(scene: Phaser.Scene, onClose: () => void = () => {}) {
    this.scene = scene;
    this.onClose = onClose;
  }

  get isOpen() {
    return this.layer !== null;
  }

  open(turbyId: string) {
    this.turbyId = turbyId;
    this.busySlot = null;
    this.lastStats = null;
    this.scene.input.keyboard?.on('keydown-ESC', this.escHandler);
    this.render();
  }

  close() {
    this.scene.input.keyboard?.off('keydown-ESC', this.escHandler);
    this.layer?.destroy();
    this.layer = null;
    this.turbyId = null;
    this.onClose();
  }

  private turby(): OwnedTurby | undefined {
    return inventory.getAll().find((t) => t.id === this.turbyId);
  }

  private render(message?: string, isError = false) {
    this.layer?.destroy();
    const turby = this.turby();
    if (!turby) return;
    const s = this.scene;
    const objs: Phaser.GameObjects.GameObject[] = [];

    // 모달 바깥을 눌러도 닫히지 않는다(입력만 막는다)
    objs.push(s.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x4a3a44, 0.68).setOrigin(0, 0).setInteractive());
    objs.push(feltPanel(s, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { radius: 28, strokeW: 6, image: 'equip-panel' }));

    // 헤더: 터비 이름 + 닫기
    objs.push(feltPanel(s, 208, HEADER_Y, 864, 76, { fill: PAL.cream2, strokeW: 4, radius: 22 }));
    objs.push(s.add.text(232, HEADER_Y + 38, `${ellipsize(turby.characterName, 12)} 장비`, { fontSize: '28px', color: TEXT.body }).setOrigin(0, 0.5));
    objs.push(pillButton(s, 1072 - 44, HEADER_Y + 38, 72, 60, 'X', 'back', () => this.close()));

    this.renderSummary(objs, turby);

    const items = inventory.getItems();
    slotData.forEach((slot, i) => {
      const y = LIST.y + i * (ROW_H + ROW_GAP);
      this.renderRow(objs, turby, slot, items, y);
    });

    if (message) {
      objs.push(s.add.text(CANVAS_WIDTH / 2, PANEL.y + PANEL.h - 20, message, { fontSize: '16px', color: isError ? TEXT.error : TEXT.onMint }).setOrigin(0.5));
    }
    this.layer = s.add.container(0, 0, objs).setDepth(DEPTH);
  }

  // 터비 요약: 이미지 + 최종 스탯 4개 알약(증가분은 민트 +N을 0.8초 표시)
  private renderSummary(objs: Phaser.GameObjects.GameObject[], turby: OwnedTurby) {
    const s = this.scene;
    objs.push(feltPanel(s, SUMMARY.x, SUMMARY.y, SUMMARY.w, SUMMARY.h, { fill: PAL.sky, strokeW: 4, radius: 22, image: 'turby-summary-frame' }));
    const cx = SUMMARY.x + SUMMARY.w / 2;
    if (s.textures.exists(`turby-${turby.characterCode}`)) {
      objs.push(s.add.image(cx, SUMMARY.y + 58, `turby-${turby.characterCode}`).setDisplaySize(100, 100));
    }
    const stats = turby.stats as unknown as Record<string, number>;
    STAT_KEYS.forEach(([key, label], i) => {
      const py = SUMMARY.y + 124 + i * 58;
      objs.push(feltPanel(s, SUMMARY.x + 12, py, 166, 48, { fill: PAL.cream, strokeW: 3, radius: 20, image: 'stat-pill' }));
      objs.push(s.add.text(SUMMARY.x + 30, py + 24, label, { fontSize: '15px', color: TEXT.sub }).setOrigin(0, 0.5));
      objs.push(s.add.text(SUMMARY.x + 110, py + 24, String(stats[key]), { fontSize: '20px', color: TEXT.body }).setOrigin(0.5));
      const gain = this.lastStats ? stats[key] - this.lastStats[key] : 0;
      if (gain > 0) {
        const plus = s.add.text(SUMMARY.x + 158, py + 24, `+${gain}`, { fontSize: '16px', color: TEXT.onMint }).setOrigin(0.5);
        objs.push(plus);
        s.tweens.add({ targets: plus, alpha: 0, delay: 800, duration: 300 });
      }
    });
    this.lastStats = { ...stats };
  }

  private renderRow(objs: Phaser.GameObjects.GameObject[], turby: OwnedTurby, slot: { key: string; label: string }, items: ReturnType<typeof inventory.getItems>, y: number) {
    const s = this.scene;
    const equipped = turby.equipment.find((e) => e.slotKey === slot.key);
    const busy = this.busySlot === slot.key;
    objs.push(feltPanel(s, LIST.x, y, LIST.w, ROW_H, { fill: PAL.cream, strokeW: 4, radius: 22, image: 'equip-row-frame' }));

    // 슬롯 아이콘 84x84
    const slotIcon = (slot as { iconKey?: string }).iconKey;
    if (slotIcon && s.textures.exists(slotIcon)) {
      objs.push(s.add.image(LIST.x + 56, y + ROW_H / 2, slotIcon).setDisplaySize(84, 84));
    } else {
      objs.push(feltPanel(s, LIST.x + 14, y + 16, 84, 84, { fill: PAL.lavender, stroke: PAL.cream, strokeW: 3, radius: 20 }));
      objs.push(s.add.text(LIST.x + 56, y + ROW_H / 2, slot.label, { fontSize: '18px', color: TEXT.body }).setOrigin(0.5));
    }

    // 중앙 설명 영역: 현재 장착 + 칩 상태(장착 가능/다른 터비 사용 중)를 글자로 알린다 — 칩 안에는 아이콘만 둔다
    const nameX = LIST.x + 114;
    const slotItems = items.filter((it) => it.equipSlot === slot.key && it.quantity > 0);
    const available = slotItems.filter((it) => it.code !== equipped?.itemCode && it.available > 0);
    const usedElsewhere = slotItems.filter((it) => it.code !== equipped?.itemCode && it.available <= 0);
    objs.push(s.add.text(nameX, y + 8, equipped ? `장착 중: ${ellipsize(equipped.itemName, 10)}` : '비어 있음', { fontSize: '16px', color: equipped ? TEXT.body : TEXT.sub }));
    const notes = [
      ...available.map((it) => `장착 가능: ${ellipsize(it.name, 8)} (남음 ${it.available})`),
      ...usedElsewhere.map((it) => `다른 터비 사용 중: ${ellipsize(it.name, 8)}`),
    ].join('  ·  ');
    if (notes) objs.push(s.add.text(nameX, y + 29, notes, { fontSize: '14px', color: TEXT.sub, wordWrap: { width: LIST.w - 114 - 160 } }));

    // 아이템 칩 68x68(기존 56에서 20% 확대) — 장착 중=체크, 장착 가능=민트 점, 다른 터비 사용 중=잠금
    slotItems.forEach((it, idx) => {
      const cx = nameX + CHIP / 2 + idx * (CHIP + 12);
      const cy = y + ROW_H - CHIP / 2 - 6;
      const isCurrent = equipped?.itemCode === it.code;
      const usable = !isCurrent && it.available > 0 && !busy;
      const inUseElsewhere = !isCurrent && it.available <= 0;
      const frameKey = isCurrent ? 'item-chip-equipped' : inUseElsewhere ? 'item-chip-locked' : 'item-chip';
      if (s.textures.exists(frameKey)) {
        objs.push(s.add.image(cx, cy, frameKey).setDisplaySize(CHIP, CHIP));
      } else {
        const g = s.add.graphics();
        g.fillStyle(isCurrent ? PAL.lavender : inUseElsewhere ? PAL.cream2 : PAL.cream, 1);
        g.fillRoundedRect(cx - CHIP / 2, cy - CHIP / 2, CHIP, CHIP, 16);
        g.lineStyle(isCurrent ? 4 : 3, isCurrent ? PAL.lavender : PAL.disabled, 1);
        g.strokeRoundedRect(cx - CHIP / 2, cy - CHIP / 2, CHIP, CHIP, 16);
        objs.push(g);
      }
      const iconKey = itemIconKey(s, it.code);
      const icon = iconKey
        ? s.add.image(cx, cy, iconKey).setDisplaySize(42, 42)
        : s.add.text(cx, cy, ellipsize(it.name, 3), { fontSize: '14px', color: TEXT.body }).setOrigin(0.5);
      if (inUseElsewhere) icon.setAlpha(0.45);
      objs.push(icon);
      if (isCurrent) objs.push(s.add.text(cx + 24, cy - 24, '✓', { fontSize: '16px', color: TEXT.onMint }).setOrigin(0.5));
      if (usable) objs.push(s.add.circle(cx + 24, cy - 24, 6, PAL.mint).setStrokeStyle(2, PAL.lavender));
      if (inUseElsewhere) {
        const lock = s.add.graphics();
        lock.lineStyle(3, PAL.disabled, 1);
        lock.strokeCircle(cx + 24, cy - 27, 5);
        lock.fillStyle(PAL.disabled, 1);
        lock.fillRoundedRect(cx + 17, cy - 24, 14, 11, 3);
        objs.push(lock);
      }
      if (usable) {
        objs.push(
          s.add
            .rectangle(cx, cy, CHIP, CHIP, 0xffffff, 0)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.act(slot.key, () => inventory.equip(turby.id, it.code))),
        );
      }
    });

    // 해제 버튼(폭 고정)
    if (equipped) {
      objs.push(pillButton(s, LIST.x + LIST.w - 16 - 70, y + ROW_H / 2, 132, 48, busy ? '처리 중' : '해제', busy ? 'disabled' : 'secondary', () => this.act(slot.key, () => inventory.unequip(turby.id, slot.key))));
    }
  }

  private async act(slotKey: string, run: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (this.busySlot) return;
    this.busySlot = slotKey;
    this.render();
    const result = await run();
    this.busySlot = null;
    if (!this.layer) return;
    this.render(result.ok ? undefined : result.message, !result.ok);
  }
}
