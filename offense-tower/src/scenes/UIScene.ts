import Phaser from 'phaser';
import { CANVAS_WIDTH, GAME_HEIGHT, GAME_WIDTH } from 'tower-defense';
import { UNIT_DEFS } from '../config/units';
import type { UnitType } from '../config/units';
import { gameEvents, Events } from '../events';
import type { ScoreInfo, HeroState, HeroInfo, ClearInfo } from '../events';

const UNIT_ORDER: UnitType[] = ['swarm', 'tank', 'speed'];

export class UIScene extends Phaser.Scene {
  roundText!: Phaser.GameObjects.Text;
  scoreText!: Phaser.GameObjects.Text;
  aiGoldText!: Phaser.GameObjects.Text;

  spawnButtons: Record<UnitType, { bg: Phaser.GameObjects.Rectangle; cooldownOverlay: Phaser.GameObjects.Rectangle }> = {} as any;
  heroButton!: Phaser.GameObjects.Rectangle;
  heroButtonLabel!: Phaser.GameObjects.Text;
  clearOverlay!: Phaser.GameObjects.Container;

  // The resolved hero (name/color) arrives async via HeroInfoChanged, so the
  // button starts with a generic placeholder and fills in once it lands.
  heroName = '영웅';
  heroState: HeroState = { locked: true, used: false };

  constructor() {
    super({ key: 'UI', active: true });
  }

  create() {
    this.buildStatusBar();
    this.buildHud();
    this.buildClearOverlay();

    gameEvents.on(Events.ScoreChanged, (score: ScoreInfo) => {
      this.roundText.setText(score.roundName);
      this.scoreText.setText(`돌파 ${score.unitBreakthroughs}/${score.goal}   처치 ${score.kills}`);
      this.aiGoldText.setText(`AI 골드 ${score.aiGold}`);
    });

    gameEvents.on(Events.GameCleared, (info: ClearInfo) => this.showClearOverlay(info));

    gameEvents.on(Events.CooldownsChanged, (remaining: Record<UnitType, number>) => {
      UNIT_ORDER.forEach((type) => {
        const def = UNIT_DEFS[type];
        const ratio = Phaser.Math.Clamp(remaining[type] / def.spawnCooldown, 0, 1);
        const { cooldownOverlay } = this.spawnButtons[type];
        cooldownOverlay.setDisplaySize(175 * ratio, 64);
        cooldownOverlay.setVisible(ratio > 0);
      });
    });

    gameEvents.on(Events.HeroInfoChanged, (info: HeroInfo) => {
      this.heroName = info.name;
      this.heroButton.setStrokeStyle(2, info.color, 0.9);
      this.refreshHeroButton();
    });

    gameEvents.on(Events.HeroStateChanged, (state: HeroState) => {
      this.heroState = state;
      this.refreshHeroButton();
    });

    this.events.on('shutdown', () => {
      gameEvents.removeAllListeners(Events.ScoreChanged);
      gameEvents.removeAllListeners(Events.CooldownsChanged);
      gameEvents.removeAllListeners(Events.HeroInfoChanged);
      gameEvents.removeAllListeners(Events.HeroStateChanged);
      gameEvents.removeAllListeners(Events.GameCleared);
    });
  }

  private refreshHeroButton() {
    const { locked, used } = this.heroState;
    const usable = !locked && !used;
    this.heroButton.setFillStyle(usable ? 0x3a3020 : 0x2a2a2a, 1);
    this.heroButton.setAlpha(usable ? 1 : 0.45);
    this.heroButton.disableInteractive();
    if (usable) this.heroButton.setInteractive({ useHandCursor: true });

    const label = locked
      ? `${this.heroName}\n잠김 (영웅존 진입 시 해금)`
      : used
        ? `${this.heroName}\n전사함 (재소환 불가)`
        : `${this.heroName}\n영웅 소환`;
    this.heroButtonLabel.setText(label);
  }

  private buildStatusBar() {
    this.add.rectangle(0, 0, CANVAS_WIDTH, 32, 0x000000, 0.55).setOrigin(0, 0);
    this.roundText = this.add.text(12, 8, '', { fontSize: '15px', color: '#ffd166', fontStyle: 'bold' });
    this.scoreText = this.add.text(110, 8, '돌파 0/10   처치 0', { fontSize: '15px', color: '#8affb0' });
    this.aiGoldText = this.add.text(360, 8, 'AI 골드 0', { fontSize: '15px', color: '#ffb08a' });
  }

  private buildClearOverlay() {
    const bg = this.add.rectangle(0, 0, CANVAS_WIDTH, GAME_HEIGHT + 150, 0x000000, 0.75).setOrigin(0, 0);
    const title = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 - 30, '클리어!', { fontSize: '36px', color: '#ffd166' }).setOrigin(0.5);
    const subtitle = this.add
      .text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 + 20, '', { fontSize: '15px', color: '#cccccc' })
      .setOrigin(0.5);
    this.clearOverlay = this.add.container(0, 0, [bg, title, subtitle]);
    this.clearOverlay.setVisible(false);
    (this.clearOverlay as any).subtitleText = subtitle;
  }

  private showClearOverlay(info: ClearInfo) {
    (this.clearOverlay as any).subtitleText.setText(`+${info.reward} 코인 획득 (보유 코인 ${info.totalCoins})\n코인은 라운지에서 영웅 강화 / 아이템 구매에 쓸 수 있습니다.`);
    this.clearOverlay.setVisible(true);
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

    const hx = 16 + UNIT_ORDER.length * 190;
    const hy = hudTop + 14;
    // Starts locked with a placeholder name/color; HeroInfoChanged and
    // HeroStateChanged (emitted right after this in GameScene.create()) fill
    // in the real hero once it's loaded.
    this.heroButton = this.add
      .rectangle(hx, hy, 175, 64, 0x2a2a2a)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffd166, 0.9)
      .setAlpha(0.45);
    this.heroButtonLabel = this.add.text(hx + 8, hy + 6, `${this.heroName}\n잠김 (영웅존 진입 시 해금)`, {
      fontSize: '13px',
      color: '#ffffff',
      lineSpacing: 4,
    });
    this.heroButton.on('pointerdown', () => gameEvents.emit(Events.RequestSpawnHero));
  }
}
