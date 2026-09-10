import Phaser from 'phaser';
import { CANVAS_WIDTH, GAME_HEIGHT, GAME_WIDTH, STARTING_GOLD, STARTING_LIVES } from '../config/constants';
import { TOWER_DEFS } from '../config/towers';
import type { TowerType } from '../config/towers';
import { WAVES } from '../config/enemies';
import { gameEvents, Events } from '../events';
import type { SelectedTowerInfo } from '../events';

const TOWER_ORDER: TowerType[] = ['basic', 'splash', 'slow'];

export class UIScene extends Phaser.Scene {
  gold = 0;
  lives = 0;
  buildType: TowerType | null = null;
  selectedInfo: SelectedTowerInfo | null = null;

  goldText!: Phaser.GameObjects.Text;
  livesText!: Phaser.GameObjects.Text;
  waveText!: Phaser.GameObjects.Text;

  buildButtons: Record<TowerType, { bg: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }> = {} as any;
  waveButton!: Phaser.GameObjects.Rectangle;
  waveButtonText!: Phaser.GameObjects.Text;
  waveButtonEnabled = true;

  infoPanel!: Phaser.GameObjects.Container;
  infoText!: Phaser.GameObjects.Text;
  upgradeBtn!: Phaser.GameObjects.Rectangle;
  upgradeBtnText!: Phaser.GameObjects.Text;
  sellBtn!: Phaser.GameObjects.Rectangle;

  overlay!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'UI', active: true });
  }

  create() {
    this.gold = STARTING_GOLD;
    this.lives = STARTING_LIVES;
    this.buildType = null;
    this.selectedInfo = null;
    this.buildStatusBar();
    this.buildHud();
    this.buildInfoPanel();
    this.buildOverlay();

    gameEvents.on(Events.GoldChanged, (gold: number) => {
      this.gold = gold;
      this.goldText.setText(`골드 ${gold}`);
      this.refreshBuildButtons();
      this.refreshInfoPanel();
    });
    gameEvents.on(Events.LivesChanged, (lives: number) => {
      this.lives = lives;
      this.livesText.setText(`라이프 ${lives}`);
    });
    gameEvents.on(Events.WaveChanged, (data: { current: number; total: number; inProgress: boolean }) => {
      this.waveText.setText(`웨이브 ${Math.max(data.current, 1)}/${data.total}`);
      this.waveButtonEnabled = !data.inProgress;
      this.refreshWaveButton();
    });
    gameEvents.on(Events.PlacedTowerSelected, (info: SelectedTowerInfo | null) => {
      this.selectedInfo = info;
      this.refreshInfoPanel();
    });
    gameEvents.on(Events.GameOver, () => this.showOverlay('패배', '몬스터가 라이프를 모두 소진시켰습니다.'));
    gameEvents.on(Events.GameWin, () => this.showOverlay('승리!', '모든 웨이브를 방어했습니다.'));

    this.events.on('shutdown', () => {
      gameEvents.removeAllListeners(Events.GoldChanged);
      gameEvents.removeAllListeners(Events.LivesChanged);
      gameEvents.removeAllListeners(Events.WaveChanged);
      gameEvents.removeAllListeners(Events.PlacedTowerSelected);
      gameEvents.removeAllListeners(Events.GameOver);
      gameEvents.removeAllListeners(Events.GameWin);
    });
  }

  private buildStatusBar() {
    this.add.rectangle(0, 0, CANVAS_WIDTH, 32, 0x000000, 0.55).setOrigin(0, 0);
    this.goldText = this.add.text(12, 8, `골드 ${this.gold}`, { fontSize: '15px', color: '#ffe08a' });
    this.livesText = this.add.text(140, 8, `라이프 ${this.lives}`, { fontSize: '15px', color: '#ff8a8a' });
    this.waveText = this.add.text(280, 8, `웨이브 1/${WAVES.length}`, { fontSize: '15px', color: '#8ad1ff' });
  }

  private buildHud() {
    const hudTop = GAME_HEIGHT;
    this.add.rectangle(0, hudTop, GAME_WIDTH, 150, 0x14141f).setOrigin(0, 0);

    TOWER_ORDER.forEach((type, i) => {
      const def = TOWER_DEFS[type];
      const x = 16 + i * 190;
      const y = hudTop + 14;
      const bg = this.add.rectangle(x, y, 175, 64, 0x24243a).setOrigin(0, 0).setStrokeStyle(2, def.color, 0.9).setInteractive({ useHandCursor: true });
      const label = this.add.text(x + 8, y + 6, `${def.name}\n${def.cost}G`, { fontSize: '13px', color: '#ffffff', lineSpacing: 4 });
      this.add.text(x + 8, y + 44, def.description, { fontSize: '10px', color: '#9aa0b4', wordWrap: { width: 160 } });

      bg.on('pointerdown', () => {
        const next = this.buildType === type ? null : type;
        this.buildType = next;
        gameEvents.emit(Events.BuildTypeSelected, next);
        this.refreshBuildButtons();
      });

      this.buildButtons[type] = { bg, label };
    });

    const wx = 16 + TOWER_ORDER.length * 190;
    this.waveButton = this.add
      .rectangle(wx, hudTop + 14, 150, 64, 0x2f5c3a)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    this.waveButtonText = this.add.text(wx + 12, hudTop + 34, '다음 웨이브 시작', { fontSize: '13px', color: '#ffffff', wordWrap: { width: 130 } });
    this.waveButton.on('pointerdown', () => {
      if (!this.waveButtonEnabled) return;
      gameEvents.emit(Events.RequestStartWave);
    });
  }

  private refreshBuildButtons() {
    TOWER_ORDER.forEach((type) => {
      const def = TOWER_DEFS[type];
      const { bg } = this.buildButtons[type];
      const selected = this.buildType === type;
      const affordable = this.gold >= def.cost;
      bg.setFillStyle(selected ? 0x3a5c3a : 0x24243a, 1);
      bg.setAlpha(affordable ? 1 : 0.45);
    });
  }

  private refreshWaveButton() {
    this.waveButton.setFillStyle(this.waveButtonEnabled ? 0x2f5c3a : 0x333333);
    this.waveButtonText.setText(this.waveButtonEnabled ? '다음 웨이브 시작' : '진행 중...');
  }

  private buildInfoPanel() {
    const hudTop = GAME_HEIGHT;
    const x = 16;
    const y = hudTop + 88;
    const bg = this.add.rectangle(x, y, GAME_WIDTH - 32, 52, 0x1c1c2c).setOrigin(0, 0);
    this.infoText = this.add.text(x + 10, y + 8, '타워를 클릭하면 업그레이드/판매할 수 있습니다.', { fontSize: '12px', color: '#cfd3e0' });

    this.upgradeBtn = this.add.rectangle(x + GAME_WIDTH - 32 - 220, y + 8, 100, 36, 0x3a5c8a).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.upgradeBtnText = this.add.text(x + GAME_WIDTH - 32 - 214, y + 20, '업그레이드', { fontSize: '11px', color: '#ffffff' });
    this.upgradeBtn.on('pointerdown', () => gameEvents.emit(Events.RequestUpgrade));

    this.sellBtn = this.add.rectangle(x + GAME_WIDTH - 32 - 110, y + 8, 100, 36, 0x8a3a3a).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.add.text(x + GAME_WIDTH - 32 - 90, y + 20, '판매', { fontSize: '11px', color: '#ffffff' });
    this.sellBtn.on('pointerdown', () => gameEvents.emit(Events.RequestSell));

    this.infoPanel = this.add.container(0, 0, [bg, this.infoText, this.upgradeBtn, this.upgradeBtnText, this.sellBtn]);
    this.setInfoControlsVisible(false);
  }

  private setInfoControlsVisible(visible: boolean) {
    this.upgradeBtn.setVisible(visible);
    this.upgradeBtnText.setVisible(visible);
    this.sellBtn.setVisible(visible);
  }

  private refreshInfoPanel() {
    if (!this.selectedInfo) {
      this.infoText.setText('타워를 클릭하면 업그레이드/판매할 수 있습니다.');
      this.setInfoControlsVisible(false);
      return;
    }
    const info = this.selectedInfo;
    const upgradeLabel = info.maxLevel ? '최대 레벨' : `업그레이드 (${info.upgradeCost}G)`;
    this.infoText.setText(`${info.typeName}  Lv${info.level}  |  판매가 ${info.sellValue}G`);
    this.upgradeBtnText.setText(upgradeLabel);
    this.upgradeBtn.setFillStyle(info.maxLevel || this.gold < (info.upgradeCost ?? Infinity) ? 0x444444 : 0x3a5c8a);
    this.setInfoControlsVisible(true);
  }

  private buildOverlay() {
    const bg = this.add.rectangle(0, 0, CANVAS_WIDTH, GAME_HEIGHT + 150, 0x000000, 0.75).setOrigin(0, 0);
    const title = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', { fontSize: '36px', color: '#ffffff' }).setOrigin(0.5);
    const subtitle = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2, '', { fontSize: '15px', color: '#cccccc' }).setOrigin(0.5);
    const restartBtn = this.add.rectangle(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 + 50, 160, 44, 0x3a5c8a).setInteractive({ useHandCursor: true });
    const restartText = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 + 50, '다시 시작', { fontSize: '15px', color: '#ffffff' }).setOrigin(0.5);
    restartBtn.on('pointerdown', () => {
      this.buildType = null;
      this.selectedInfo = null;
      this.refreshBuildButtons();
      this.refreshInfoPanel();
      gameEvents.emit(Events.Restart);
      this.overlay.setVisible(false);
    });

    this.overlay = this.add.container(0, 0, [bg, title, subtitle, restartBtn, restartText]);
    this.overlay.setVisible(false);
    (this.overlay as any).titleText = title;
    (this.overlay as any).subtitleText = subtitle;
  }

  private showOverlay(title: string, subtitle: string) {
    (this.overlay as any).titleText.setText(title);
    (this.overlay as any).subtitleText.setText(subtitle);
    this.overlay.setVisible(true);
  }
}
