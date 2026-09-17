import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';

const SHELF_SLOT_COUNT = 40; // 4.4: 8열x5행 제안

// 4.4 기지(집) — 마을(Village) 안 "내 집"에서 진입. 가방(소지)/선반(전시) 구분 표시, 클릭으로 서로 이동 가능.
export class HomeScene extends Phaser.Scene {
  private busy = false;

  constructor() {
    super('Home');
  }

  preload() {
    this.load.image('bg-home', BACKGROUND_TILES.home);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.busy = false;
    this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'bg-home').setOrigin(0, 0);

    this.add.text(CANVAS_WIDTH / 2, 30, '터비 구하기 — 기지', { fontSize: '26px', color: '#ffe9a8' }).setOrigin(0.5);

    // 재접속해도 같은 플레이어로 인식되는지(=인벤토리가 휘발되지 않는지) 눈으로 바로 확인할 수 있게 표시
    this.add
      .text(CANVAS_WIDTH - 16, 16, `플레이어: ${inventory.getPlayerId().slice(0, 8)}`, { fontSize: '12px', color: '#998866' })
      .setOrigin(1, 0);

    // 4.1/4.5: 재화(타레)
    this.add
      .text(16, 16, `타레: ${inventory.getTareBalance()}`, { fontSize: '16px', color: '#ffe9a8', backgroundColor: '#00000060', padding: { x: 8, y: 4 } })
      .setOrigin(0, 0);

    this.renderRow('가방 (소지 — 원정 파티 후보)', inventory.getBag(), 70, '선반으로', (id) => this.onMoveToShelf(id));
    this.renderRow('선반 (기지 보관 — 전시)', inventory.getShelf(), 250, '가방으로', (id) => this.onMoveToBag(id));

    this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 50, '마을로 나가기', { fontSize: '20px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 20, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('Village'));
  }

  private renderRow(title: string, items: OwnedTurby[], y: number, actionLabel: string, onAction: (turbyId: string) => void) {
    this.add.text(60, y - 30, title, { fontSize: '16px', color: '#ffffff' });

    if (items.length === 0) {
      this.add.text(60, y, '비어있습니다.', { fontSize: '13px', color: '#cccccc' });
      return;
    }

    const startX = 100;
    const cellSize = 90;
    items.forEach((item, i) => {
      const x = startX + i * cellSize;
      const hasImage = this.textures.exists(`turby-${item.characterCode}`);
      if (hasImage) {
        this.add.image(x, y, `turby-${item.characterCode}`).setDisplaySize(48, 48);
      } else {
        this.add.circle(x, y, 22, 0x7fc8ff);
      }
      this.add.text(x, y + 28, item.characterName, { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5, 0);
      this.add
        .text(x, y + 44, actionLabel, { fontSize: '10px', color: '#ffe9a8', backgroundColor: '#00000080', padding: { x: 4, y: 2 } })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => onAction(item.id));
    });
  }

  private nextEmptySlotIndex(): number | null {
    const used = new Set(inventory.getShelf().map((t) => t.slotIndex));
    for (let i = 0; i < SHELF_SLOT_COUNT; i++) if (!used.has(i)) return i;
    return null; // 선반이 가득 참
  }

  private async onMoveToShelf(turbyId: string) {
    if (this.busy) return;
    const slotIndex = this.nextEmptySlotIndex();
    if (slotIndex === null) {
      this.showToast('선반이 가득 찼습니다.');
      return;
    }
    this.busy = true;
    const result = await inventory.moveToShelf(turbyId, slotIndex);
    this.busy = false;
    if (result.ok) this.scene.restart();
    else this.showToast('선반 이동 실패(오프라인?)');
  }

  private async onMoveToBag(turbyId: string) {
    if (this.busy) return;
    this.busy = true;
    const result = await inventory.moveToBag(turbyId);
    this.busy = false;
    if (result.ok) this.scene.restart();
    else this.showToast('가방 이동 실패(오프라인?)');
  }

  private showToast(message: string) {
    const toast = this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 100, message, { fontSize: '13px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 8, y: 4 } })
      .setOrigin(0.5);
    this.tweens.add({ targets: toast, alpha: 0, delay: 1000, duration: 500, onComplete: () => toast.destroy() });
  }
}
