import Phaser from 'phaser';
import { CANVAS_WIDTH, GAME_HEIGHT, GAME_WIDTH } from 'tower-defense';
import { UNIT_DEFS } from '../config/units';
import type { UnitType } from '../config/units';
import { gameEvents, Events } from '../events';
import type { ScoreInfo } from '../events';

const UNIT_ORDER: UnitType[] = ['swarm', 'tank', 'speed'];

export class UIScene extends Phaser.Scene {
  scoreText!: Phaser.GameObjects.Text;
  aiGoldText!: Phaser.GameObjects.Text;

  spawnButtons: Record<UnitType, { bg: Phaser.GameObjects.Rectangle; cooldownOverlay: Phaser.GameObjects.Rectangle }> = {} as any;

  constructor() {
    super({ key: 'UI', active: true });
  }

  create() {
    this.buildStatusBar();
    this.buildHud();

    gameEvents.on(Events.ScoreChanged, (score: ScoreInfo) => {
      this.scoreText.setText(`돌파 ${score.breakthroughs}   처치 ${score.kills}`);
      this.aiGoldText.setText(`AI 골드 ${score.aiGold}`);
    });

    gameEvents.on(Events.CooldownsChanged, (remaining: Record<UnitType, number>) => {
      UNIT_ORDER.forEach((type) => {
        const def = UNIT_DEFS[type];
        const ratio = Phaser.Math.Clamp(remaining[type] / def.spawnCooldown, 0, 1);
        const { cooldownOverlay } = this.spawnButtons[type];
        cooldownOverlay.setDisplaySize(175 * ratio, 64);
        cooldownOverlay.setVisible(ratio > 0);
      });
    });

    this.events.on('shutdown', () => {
      gameEvents.removeAllListeners(Events.ScoreChanged);
      gameEvents.removeAllListeners(Events.CooldownsChanged);
    });
  }

  private buildStatusBar() {
    this.add.rectangle(0, 0, CANVAS_WIDTH, 32, 0x000000, 0.55).setOrigin(0, 0);
    this.scoreText = this.add.text(12, 8, '돌파 0   처치 0', { fontSize: '15px', color: '#8affb0' });
    this.aiGoldText = this.add.text(280, 8, 'AI 골드 0', { fontSize: '15px', color: '#ffb08a' });
  }

  private buildHud() {
    const hudTop = GAME_HEIGHT;
    this.add.rectangle(0, hudTop, GAME_WIDTH, 150, 0x1f1414).setOrigin(0, 0);
    this.add.text(16, hudTop - 20, '유닛 소환 (쿨타임만 있음, 자원 소모 없음)', { fontSize: '12px', color: '#9aa0b4' });

    UNIT_ORDER.forEach((type, i) => {
      const def = UNIT_DEFS[type];
      const x = 16 + i * 190;
      const y = hudTop + 14;
      const bg = this.add
        .rectangle(x, y, 175, 64, 0x2a2438)
        .setOrigin(0, 0)
        .setStrokeStyle(2, def.color, 0.9)
        .setInteractive({ useHandCursor: true });
      this.add.text(x + 8, y + 6, `${def.name}\nHP${def.hp} / 속도${def.speed}`, { fontSize: '13px', color: '#ffffff', lineSpacing: 4 });

      const cooldownOverlay = this.add.rectangle(x, y, 0, 64, 0x000000, 0.55).setOrigin(0, 0);
      cooldownOverlay.setVisible(false);

      bg.on('pointerdown', () => gameEvents.emit(Events.RequestSpawn, type));

      this.spawnButtons[type] = { bg, cooldownOverlay };
    });
  }
}
