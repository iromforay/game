import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT, AVATAR_SPEED, VILLAGE_INTERACT_RADIUS } from '../config/constants';
import { AVATAR_IMAGE, BACKGROUND_TILES, VILLAGE_BUILDING_IMAGES } from '../assets/registry';
import { getVillageLayout } from '../config/village';
import type { VillageBuilding, VillageLayout } from '../config/village';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { inventory } from '../state/inventory';

interface BuildingEntry {
  def: VillageBuilding;
  wasNear: boolean;
}

// 4.1: 마을 — 야생 터비가 없는 안전지대. 3.5.1의 맵(탐험)과 같은 자유이동 방식으로 통일(2026-09-16 확정) —
// 아바타가 걸어서 건물에 다가가면 입장, 출구에 닿으면 야생 맵으로 전환. 배치는 data/village.json(청사진).
export class VillageScene extends Phaser.Scene {
  private joystick!: VirtualJoystick;
  private avatar!: Phaser.GameObjects.Image;
  private layout!: VillageLayout;
  private buildingEntries: BuildingEntry[] = [];
  private locked = false;

  constructor() {
    super('Village');
  }

  preload() {
    this.load.image('bg-village', BACKGROUND_TILES.village);
    this.load.image('avatar', AVATAR_IMAGE);
    for (const [type, url] of Object.entries(VILLAGE_BUILDING_IMAGES)) {
      this.load.image(`village-building-${type}`, url);
    }
  }

  async create() {
    this.locked = false;
    this.layout = await getVillageLayout();
    this.buildingEntries = this.layout.buildings.map((def) => ({ def, wasNear: false }));

    this.cameras.main.setBackgroundColor('#3a3626');
    this.add.tileSprite(0, 0, this.layout.width, this.layout.height, 'bg-village').setOrigin(0, 0);

    this.buildingEntries.forEach((entry) => this.drawBuilding(entry.def));

    this.avatar = this.add
      .image(this.layout.avatarStart.x, this.layout.avatarStart.y, 'avatar')
      .setDisplaySize(44, 44)
      .setDepth(10);

    this.add.text(CANVAS_WIDTH / 2, 30, '터비 구하기 — 마을', { fontSize: '26px', color: '#ffe9a8' }).setOrigin(0.5).setScrollFactor(0).setDepth(2000);
    this.add
      .text(CANVAS_WIDTH / 2, 62, '(안전지대 — 야생 터비가 나타나지 않아요)', { fontSize: '13px', color: '#cccccc' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2000);
    this.add
      .text(CANVAS_WIDTH - 16, 16, `플레이어: ${inventory.getPlayerId().slice(0, 8)}`, { fontSize: '12px', color: '#998866' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000);
    this.add
      .text(16, 16, `타레: ${inventory.getTareBalance()}`, { fontSize: '16px', color: '#ffe9a8', backgroundColor: '#00000060', padding: { x: 8, y: 4 } })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    this.joystick = new VirtualJoystick(this);
  }

  private drawBuilding(building: VillageBuilding) {
    const imageKey = `village-building-${building.type}`;
    if (this.textures.exists(imageKey)) {
      // 4.1: 타일이 아니라 실제 건물 실루엣 스프라이트로 배치(유저 요청, 2026-09-16)
      this.add.image(building.x, building.y, imageKey).setDisplaySize(building.w, building.h);
      this.add
        .text(building.x, building.y + building.h / 2 + 6, building.name, { fontSize: '13px', color: '#ffffff', backgroundColor: '#00000080', padding: { x: 4, y: 2 } })
        .setOrigin(0.5, 0);
    } else {
      // 이미지 없는 타입(예: 출구 게이트)은 기존처럼 단순 사각형으로 표시
      const color = Phaser.Display.Color.HexStringToColor(building.color).color;
      this.add.rectangle(building.x, building.y, building.w, building.h, color).setStrokeStyle(3, 0xffe9a8);
      this.add.text(building.x, building.y, building.name, { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    }
  }

  update(_time: number, delta: number) {
    if (this.locked) return;

    const { x, y, magnitude } = this.joystick.getVector();
    if (magnitude > 0) {
      const dt = delta / 1000;
      const nextX = Phaser.Math.Clamp(this.avatar.x + x * AVATAR_SPEED * magnitude * dt, 0, this.layout.width);
      const nextY = Phaser.Math.Clamp(this.avatar.y + y * AVATAR_SPEED * magnitude * dt, 0, this.layout.height);
      this.avatar.setPosition(nextX, nextY);
    }

    for (const entry of this.buildingEntries) {
      const dist = Phaser.Math.Distance.Between(this.avatar.x, this.avatar.y, entry.def.x, entry.def.y);
      const isNear = dist <= VILLAGE_INTERACT_RADIUS;
      if (isNear && !entry.wasNear) this.onEnterBuilding(entry.def);
      entry.wasNear = isNear;
    }
  }

  private onEnterBuilding(building: VillageBuilding) {
    if (building.type === 'home') {
      this.locked = true;
      this.scene.start('Home');
    } else if (building.type === 'exit') {
      this.locked = true;
      this.scene.start('Map', { capturedIndices: [], removedIndices: [] });
    } else {
      this.showToast('장터는 아직 준비 중입니다. (7-8)');
    }
  }

  private showToast(message: string) {
    const toast = this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 110, message, { fontSize: '13px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 8, y: 4 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2000);
    this.tweens.add({ targets: toast, alpha: 0, delay: 1200, duration: 500, onComplete: () => toast.destroy() });
  }
}
