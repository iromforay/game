import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES } from '../assets/registry';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';

const MAX_PARTY_SIZE = 5; // 3.3: 파티 최대 인원 = 방 인원수(1~5인), 1인 로컬 기준 상한

interface PartySelectInitData {
  wildCharacterCode: string;
  spawnIndex: number;
  capturedIndices: number[];
  removedIndices: number[];
}

// 3.3: 조우 시 소지(가방) 중인 터비 중 최대 5마리를 골라 배틀그리드에 데려감.
export class PartySelectScene extends Phaser.Scene {
  private initData!: PartySelectInitData;
  private selected: Set<string> = new Set();
  private cardBorders = new Map<string, Phaser.GameObjects.Rectangle>();
  private countText!: Phaser.GameObjects.Text;

  constructor() {
    super('PartySelect');
  }

  init(data: PartySelectInitData) {
    this.initData = data;
    this.selected = new Set();
    this.cardBorders = new Map();
  }

  preload() {
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1030');

    this.add.text(CANVAS_WIDTH / 2, 30, '야생 터비와 조우!', { fontSize: '24px', color: '#ffe9a8' }).setOrigin(0.5);
    this.add.text(CANVAS_WIDTH / 2, 64, `원정 파티를 선택하세요 (최대 ${MAX_PARTY_SIZE}마리)`, { fontSize: '15px', color: '#cccccc' }).setOrigin(0.5);

    const bag = inventory.getBag();
    if (bag.length === 0) {
      this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, '가방이 비어있습니다.\n기지에서 선반의 터비를 가방으로 옮겨주세요.', { fontSize: '16px', color: '#ffb199', align: 'center' }).setOrigin(0.5);
      this.add
        .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 80, '맵으로 돌아가기', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 14, y: 8 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scene.start('Map', { capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices }));
      return;
    }

    this.renderBagGrid(bag);

    this.countText = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 92, `선택: 0/${MAX_PARTY_SIZE}`, { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);

    this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 50, '전투 시작', { fontSize: '20px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 20, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onStart(bag));

    // 시작할 때 항상 최소 1마리(가방의 첫 개체)를 기본 선택해둬서 빈 파티로 못 나가게 함
    this.toggleSelect(bag[0].id);
  }

  private renderBagGrid(bag: OwnedTurby[]) {
    const cols = 8;
    const cellSize = 90;
    const startX = 100;
    const startY = 130;

    bag.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellSize;
      const y = startY + row * cellSize;

      const border = this.add.rectangle(x, y, 64, 64).setStrokeStyle(3, 0x5a3a8a, 0);
      this.cardBorders.set(item.id, border);

      const hasImage = this.textures.exists(`turby-${item.characterCode}`);
      if (hasImage) this.add.image(x, y, `turby-${item.characterCode}`).setDisplaySize(48, 48);
      else this.add.circle(x, y, 22, 0x7fc8ff);

      this.add.text(x, y + 36, item.characterName, { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5, 0);
      this.add.text(x, y + 50, `공${item.stats.attack} 체${item.stats.maxHp}`, { fontSize: '9px', color: '#998866' }).setOrigin(0.5, 0);

      this.add
        .zone(x, y, 74, 90)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.toggleSelect(item.id));
    });
  }

  private toggleSelect(id: string) {
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      if (this.selected.size >= MAX_PARTY_SIZE) return; // 이미 최대 인원
      this.selected.add(id);
    }
    const border = this.cardBorders.get(id);
    border?.setStrokeStyle(3, 0x9fe58a, this.selected.has(id) ? 1 : 0);
    this.countText?.setText(`선택: ${this.selected.size}/${MAX_PARTY_SIZE}`);
  }

  private onStart(bag: OwnedTurby[]) {
    if (this.selected.size === 0) return;
    const partyTurbys = bag.filter((t) => this.selected.has(t.id));
    this.scene.start('Battle', { ...this.initData, partyTurbys });
  }
}
