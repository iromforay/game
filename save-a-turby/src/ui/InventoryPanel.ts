import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { inventory } from '../state/inventory';
import charactersData from '../data/characters.json';
import { displayScaleOf, fontPx, layoutModeOf, MIN_BODY_PX, MIN_BUTTON_PX } from './responsive';

// 4.2/4.4: 보유 터비(인벤토리) 확인 창 — 맵에서 쓰는 화면 고정(scrollFactor 0) 오버레이.
// 크기·글자는 표시 배율에 맞춘다(작은 화면: 창을 화면 가까이 넓히고 칸·글자·닫기 버튼을 키움). 열 때마다, 그리고 relayout() 때 다시 그린다.
export class InventoryPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private onCloseCb?: () => void;

  constructor(scene: Phaser.Scene, onClose?: () => void) {
    this.scene = scene;
    this.onCloseCb = onClose;
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(5000).setVisible(false);
  }

  show() {
    this.render();
    this.container.setVisible(true);
  }

  hide() {
    this.container.setVisible(false);
    this.container.removeAll(true);
    this.onCloseCb?.();
  }

  toggle() {
    if (this.container.visible) this.hide();
    else this.show();
  }

  get isVisible() {
    return this.container.visible;
  }

  // 창 크기가 바뀌면 열려 있을 때만 새 배율로 다시 그린다
  relayout() {
    if (this.container.visible) this.render();
  }

  private render() {
    const scene = this.scene;
    this.container.removeAll(true);
    const scale = displayScaleOf(scene.scale.displaySize.width);
    const compact = layoutModeOf(scale) === 'compact';
    const font = { title: fontPx(scale, 20, 15), body: fontPx(scale, 14, MIN_BODY_PX), button: fontPx(scale, 18, MIN_BUTTON_PX) };
    const W = compact ? 1200 : 760;
    const H = compact ? 660 : 480;
    const X = CANVAS_WIDTH / 2;
    const Y = CANVAS_HEIGHT / 2;
    // 컨테이너의 scrollFactor(0)는 렌더링에는 적용되지만 입력 히트테스트는 각 자식 오브젝트 자신의
    // scrollFactor를 기준으로 계산됨 — 자식에도 명시적으로 0을 줘야 카메라가 스크롤된 상태에서도 클릭이 맞음.
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      (o as unknown as Phaser.GameObjects.Image).setScrollFactor(0);
      this.container.add(o);
      return o;
    };
    add(scene.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.5).setOrigin(0, 0).setInteractive());
    add(scene.add.rectangle(X, Y, W, H, 0x241a3d, 0.97).setStrokeStyle(3, 0x5a3a8a));
    add(scene.add.text(X, Y - H / 2 + 16 + font.title / 2, '보유 터비 (인벤토리)', { fontSize: `${font.title}px`, color: '#ffe9a8' }).setOrigin(0.5));
    const closeH = compact ? Math.max(64, Math.ceil(36 / scale)) : 44;
    const closeW = Math.round(font.button * 4.5);
    const close = add(scene.add.rectangle(X + W / 2 - 12 - closeW, Y - H / 2 + 10, closeW, closeH, 0x5a3a8a).setOrigin(0, 0).setStrokeStyle(2, 0xffffff, 0.4));
    add(scene.add.text(X + W / 2 - 12 - closeW / 2, Y - H / 2 + 10 + closeH / 2, '닫기 ✕', { fontSize: `${font.button}px`, color: '#ffffff' }).setOrigin(0.5));
    close.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.hide());

    const counts = new Map<string, number>();
    for (const owned of inventory.getAll()) counts.set(owned.characterCode, (counts.get(owned.characterCode) ?? 0) + 1);
    const characters = charactersData as { code: string; name: string }[];
    if (counts.size === 0) {
      add(scene.add.text(X, Y, '보유한 터비가 없습니다.', { fontSize: `${font.body}px`, color: '#cccccc' }).setOrigin(0.5));
      return;
    }
    const cellW = compact ? 190 : 110;
    const cellH = compact ? 170 : 104;
    const icon = compact ? 96 : 52;
    const cols = Math.max(1, Math.floor((W - 40) / cellW));
    const startY = Y - H / 2 + 20 + Math.max(closeH, font.title) + 16 + icon / 2;
    let i = 0;
    for (const [code, count] of counts.entries()) {
      const character = characters.find((c) => c.code === code);
      const x = X - ((cols - 1) * cellW) / 2 + (i % cols) * cellW;
      const y = startY + Math.floor(i / cols) * cellH;
      add(scene.textures.exists(`turby-${code}`) ? scene.add.image(x, y, `turby-${code}`).setDisplaySize(icon, icon) : scene.add.circle(x, y, icon / 2 - 2, 0x7fc8ff));
      add(scene.add.text(x, y + icon / 2 + 6, `${character?.name ?? code} x${count}`, { fontSize: `${font.body}px`, color: '#ffffff' }).setOrigin(0.5, 0));
      i += 1;
    }
  }
}
