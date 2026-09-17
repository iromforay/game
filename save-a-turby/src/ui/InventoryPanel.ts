import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { inventory } from '../state/inventory';
import charactersData from '../data/characters.json';

const PANEL_W = 760;
const PANEL_H = 480;
const PANEL_X = CANVAS_WIDTH / 2;
const PANEL_Y = CANVAS_HEIGHT / 2;

// 4.2/4.4: 보유 터비(인벤토리) 확인 창 — 맵/기지 등 여러 씬에서 재사용하는 화면 고정(scrollFactor 0) 오버레이.
export class InventoryPanel {
  private container: Phaser.GameObjects.Container;
  private itemsLayer: Phaser.GameObjects.Container;
  private onCloseCb?: () => void;

  constructor(scene: Phaser.Scene, onClose?: () => void) {
    this.onCloseCb = onClose;

    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(5000).setVisible(false);

    // 컨테이너의 scrollFactor(0)는 렌더링에는 적용되지만 입력 히트테스트는 각 자식 오브젝트 자신의
    // scrollFactor를 기준으로 계산됨 — 자식에도 명시적으로 0을 줘야 카메라가 스크롤된 상태에서도 클릭이 맞음.
    const dim = scene.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.5).setOrigin(0, 0).setScrollFactor(0).setInteractive();
    const panel = scene.add.rectangle(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 0x241a3d, 0.97).setStrokeStyle(3, 0x5a3a8a).setScrollFactor(0);
    const title = scene.add
      .text(PANEL_X, PANEL_Y - PANEL_H / 2 + 24, '보유 터비 (인벤토리)', { fontSize: '20px', color: '#ffe9a8' })
      .setOrigin(0.5)
      .setScrollFactor(0);

    const closeBtn = scene.add
      .text(PANEL_X + PANEL_W / 2 - 20, PANEL_Y - PANEL_H / 2 + 16, '✕', { fontSize: '20px', color: '#ffffff' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.hide());

    this.itemsLayer = scene.add.container(0, 0).setScrollFactor(0);

    this.container.add([dim, panel, title, closeBtn, this.itemsLayer]);
  }

  show() {
    this.refreshItems();
    this.container.setVisible(true);
  }

  hide() {
    this.container.setVisible(false);
    this.onCloseCb?.();
  }

  toggle() {
    if (this.container.visible) this.hide();
    else this.show();
  }

  get isVisible() {
    return this.container.visible;
  }

  private refreshItems() {
    this.itemsLayer.removeAll(true);

    const scene = this.itemsLayer.scene;
    const counts = new Map<string, number>();
    for (const owned of inventory.getAll()) counts.set(owned.characterCode, (counts.get(owned.characterCode) ?? 0) + 1);
    const characters = charactersData as { code: string; name: string }[];

    const cols = 6;
    const cellSize = 100;
    const startY = PANEL_Y - PANEL_H / 2 + 100;

    if (counts.size === 0) {
      this.itemsLayer.add(scene.add.text(PANEL_X, PANEL_Y, '보유한 터비가 없습니다.', { fontSize: '14px', color: '#cccccc' }).setOrigin(0.5));
      return;
    }

    let i = 0;
    for (const [code, count] of counts.entries()) {
      const character = characters.find((c) => c.code === code);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = PANEL_X - ((cols - 1) * cellSize) / 2 + col * cellSize;
      const y = startY + row * cellSize;

      const hasImage = scene.textures.exists(`turby-${code}`);
      const icon = hasImage ? scene.add.image(x, y, `turby-${code}`).setDisplaySize(52, 52) : scene.add.circle(x, y, 24, 0x7fc8ff);
      const label = scene.add.text(x, y + 32, `${character?.name ?? code} x${count}`, { fontSize: '12px', color: '#ffffff' }).setOrigin(0.5, 0);
      this.itemsLayer.add([icon, label]);
      i += 1;
    }
  }
}
