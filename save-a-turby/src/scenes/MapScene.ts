import Phaser from 'phaser';
import { AVATAR_SPEED, ENCOUNTER_RADIUS, CANVAS_WIDTH } from '../config/constants';
import { getStage } from '../config/stages';
import type { WildSpawn } from '../config/stages';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { InventoryPanel } from '../ui/InventoryPanel';
import charactersData from '../data/characters.json';
import { AVATAR_IMAGE, CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';

interface WildMarker {
  spawn: WildSpawn;
  index: number;
  gfx: Phaser.GameObjects.Container;
  encountered: boolean;
}

interface MapInitData {
  capturedIndices?: number[];
  removedIndices?: number[];
}

const STAGE_CODE = 'forest';

// 3.5.1 맵(탐험) 자유이동 프로토타입(7-5) — 아바타 이동 + 카메라 추적 + 조우 시 배틀그리드(7-6) 진입까지.
// 아트는 최소 플레이스홀더(assets/registry.ts) — 원화 완성되면 이미지만 교체(3.1.1).
// 파티/인벤토리 시스템 이전이라 획득 결과는 capturedIndices로만 임시 추적(7-7에서 실제 보유 터비로 대체 예정).
export class MapScene extends Phaser.Scene {
  private joystick!: VirtualJoystick;
  private inventoryPanel!: InventoryPanel;
  private avatar!: Phaser.GameObjects.Image;
  private markers: WildMarker[] = [];
  private stageWidth = 0;
  private stageHeight = 0;
  private capturedIndices: number[] = [];
  private removedIndices: number[] = [];
  private encounterLocked = false;

  constructor() {
    super('Map');
  }

  init(data: MapInitData) {
    this.capturedIndices = data.capturedIndices ?? [];
    this.removedIndices = data.removedIndices ?? [];
    this.encounterLocked = false;
  }

  preload() {
    // WebGL은 <img> 소스로 직접 SVG를 텍스처 업로드하면 검게 나오는 경우가 있어(래스터화 안 됨),
    // load.image 대신 load.svg로 명시적 크기를 줘서 내부적으로 캔버스에 먼저 그려서 텍스처화함.
    this.load.image('avatar', AVATAR_IMAGE);
    this.load.image(`bg-${STAGE_CODE}`, BACKGROUND_TILES[STAGE_CODE]);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    // Phaser는 scene.start()로 재진입해도 같은 씬 인스턴스를 재사용하므로, 여기서 초기화 안 하면
    // 맵 복귀할 때마다(전투 후 등) 마커가 중복 누적됨(실제로 겪은 버그) — 매번 새로 채움
    this.markers = [];

    const stage = getStage(STAGE_CODE);
    this.stageWidth = stage.width;
    this.stageHeight = stage.height;

    this.cameras.main.setBackgroundColor('#20301c');
    this.cameras.main.setBounds(0, 0, stage.width, stage.height);

    this.add.tileSprite(0, 0, stage.width, stage.height, `bg-${stage.code}`).setOrigin(0, 0);

    this.avatar = this.add.image(stage.width / 2, stage.height / 2, 'avatar').setDisplaySize(44, 44);
    this.cameras.main.startFollow(this.avatar, true, 0.1, 0.1);

    stage.wildSpawns.forEach((spawn, index) => {
      if (this.removedIndices.includes(index)) return; // 3.4: 포획 성공/야생 도주(패배)한 개체는 재등장하지 않음
      this.markers.push(this.createMarker(spawn, index));
    });

    this.joystick = new VirtualJoystick(this);

    this.add
      .text(16, 16, `포획: ${this.capturedIndices.length}`, { fontSize: '18px', color: '#ffffff', backgroundColor: '#00000080', padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(2000);

    // 4.1: 마을(입구) — 야생 맵에서 언제든 안전지대로 복귀 가능
    this.add
      .text(16, 54, '마을로', { fontSize: '14px', color: '#ffffff', backgroundColor: '#4a7a3a', padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('Village'));

    this.inventoryPanel = new InventoryPanel(this, () => this.joystick.setEnabled(true));
    this.add
      .text(CANVAS_WIDTH - 16, 16, '인벤토리', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const opening = !this.inventoryPanel.isVisible;
        this.inventoryPanel.toggle();
        if (opening) this.joystick.setEnabled(false); // 닫을 때는 InventoryPanel의 onClose 콜백이 다시 켜줌
      });
  }

  private createMarker(spawn: WildSpawn, index: number): WildMarker {
    const character = (charactersData as { code: string; name: string }[]).find((c) => c.code === spawn.characterCode);
    const container = this.add.container(spawn.x, spawn.y);
    const hasImage = this.textures.exists(`turby-${spawn.characterCode}`);
    const sprite = hasImage
      ? this.add.image(0, 0, `turby-${spawn.characterCode}`).setDisplaySize(40, 40)
      : this.add.circle(0, 0, 18, 0x7fc8ff).setStrokeStyle(2, 0x2d6fa3);
    const label = this.add.text(0, -34, character?.name ?? spawn.characterCode, { fontSize: '13px', color: '#eaf6ff' }).setOrigin(0.5, 1);
    container.add([sprite, label]);
    return { spawn, index, gfx: container, encountered: false };
  }

  update(_time: number, delta: number) {
    if (this.encounterLocked || this.inventoryPanel.isVisible) return;

    const { x, y, magnitude } = this.joystick.getVector();
    if (magnitude > 0) {
      const dt = delta / 1000;
      const nextX = Phaser.Math.Clamp(this.avatar.x + x * AVATAR_SPEED * magnitude * dt, 0, this.stageWidth);
      const nextY = Phaser.Math.Clamp(this.avatar.y + y * AVATAR_SPEED * magnitude * dt, 0, this.stageHeight);
      this.avatar.setPosition(nextX, nextY);
    }

    for (const marker of this.markers) {
      if (marker.encountered) continue;
      const dist = Phaser.Math.Distance.Between(this.avatar.x, this.avatar.y, marker.spawn.x, marker.spawn.y);
      if (dist <= ENCOUNTER_RADIUS) {
        this.triggerEncounter(marker);
        break;
      }
    }
  }

  private triggerEncounter(marker: WildMarker) {
    marker.encountered = true;
    this.encounterLocked = true;

    // 3.2/3.3: 조우 시 파티 선택(3.3)을 먼저 거쳐 배틀그리드(7-6)로 전환 — 승패 결과는 BattleScene이 처리 후 이 씬으로 복귀
    this.scene.start('PartySelect', {
      wildCharacterCode: marker.spawn.characterCode,
      spawnIndex: marker.index,
      capturedIndices: this.capturedIndices,
      removedIndices: this.removedIndices,
    });
  }
}
