import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT, GAME_WIDTH, SIDEBAR_WIDTH, STARTING_GOLD, STARTING_LIVES } from '../config/constants';
import { TOWER_DEFS } from '../config/towers';
import type { TowerType } from '../config/towers';
import { WAVES } from '../config/enemies';
import { gameEvents, Events } from '../events';
import type { SelectedTowerInfo } from '../events';

const TOWER_ORDER: TowerType[] = ['basic', 'splash', 'slow', 'storm'];

// Fantasy/gold theme shared with the hub - dark violet panels, gold accents.
const PANEL_BG = 0x171029;
const PANEL_BORDER = 0xffd166;
const PANEL_TOP = 0x241a3d;
const GOLD_LIGHT = 0xffe9a8;
const GOLD = 0xffd166;
const DISABLED_GREY = 0x3a3a45;

// The sidebar sits to the right of the board (not a strip below it) so the
// overall canvas is wide instead of tall - see SIDEBAR_WIDTH's comment.
const SIDEBAR_X = GAME_WIDTH;
const PAD = 12;
const CONTENT_X = SIDEBAR_X + PAD;
const CONTENT_W = SIDEBAR_WIDTH - PAD * 2;

interface ButtonStyle {
  base: number;
  border: number;
  borderAlpha?: number;
  borderWidth?: number;
  radius?: number;
  sheenAlpha?: number;
}

/** Rounded panel with a subtle top-sheen highlight and a bright border - reused for every button so the whole HUD reads as one consistent, "gilded" style instead of flat rectangles. */
function paintButton(g: Phaser.GameObjects.Graphics, w: number, h: number, style: ButtonStyle) {
  const radius = style.radius ?? 10;
  g.clear();
  g.fillStyle(style.base, 1);
  g.fillRoundedRect(0, 0, w, h, radius);
  g.fillStyle(0xffffff, style.sheenAlpha ?? 0.06);
  g.fillRoundedRect(2, 2, w - 4, Math.max(h * 0.42, 1), { tl: radius - 2, tr: radius - 2, bl: 0, br: 0 });
  g.lineStyle(style.borderWidth ?? 2, style.border, style.borderAlpha ?? 0.9);
  g.strokeRoundedRect(1, 1, w - 2, h - 2, radius);
}

function scaleToFit(img: Phaser.GameObjects.Image, target: number) {
  img.setScale(target / Math.max(img.width, img.height));
}

/** Small up-arrow glyph so the upgrade button reads at a glance, not just by color. */
function drawUpgradeIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size = 7, color = 0xffffff) {
  g.fillStyle(color, 1);
  g.fillTriangle(cx - size, cy + size * 0.35, cx + size, cy + size * 0.35, cx, cy - size * 0.9);
  g.fillRect(cx - size * 0.32, cy + size * 0.2, size * 0.64, size * 0.9);
}

/** Small gold-coin glyph for the sell button - makes "판매" read as "cash out" rather than a generic red action. */
function drawCoinIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r = 8) {
  g.fillStyle(GOLD, 1);
  g.fillCircle(cx, cy, r);
  g.lineStyle(1.5, 0xc89a3f, 1);
  g.strokeCircle(cx, cy, r);
  g.fillStyle(0xfff3d6, 0.55);
  g.fillCircle(cx - r * 0.32, cy - r * 0.32, r * 0.4);
}

export class UIScene extends Phaser.Scene {
  gold = 0;
  lives = 0;
  buildType: TowerType | null = null;
  selectedInfo: SelectedTowerInfo | null = null;

  goldText!: Phaser.GameObjects.Text;
  livesText!: Phaser.GameObjects.Text;
  waveText!: Phaser.GameObjects.Text;

  buildButtons: Record<
    TowerType,
    {
      g: Phaser.GameObjects.Graphics;
      glow: Phaser.GameObjects.Graphics;
      affordable: boolean;
      selected: boolean;
      w: number;
      h: number;
      iconPlaceholder: Phaser.GameObjects.Arc | null;
      iconX: number;
      iconY: number;
    }
  > = {} as any;
  waveButton!: Phaser.GameObjects.Graphics;
  waveButtonText!: Phaser.GameObjects.Text;
  waveButtonEnabled = true;
  waveButtonW = 0;
  waveButtonH = 0;

  infoPanel!: Phaser.GameObjects.Container;
  infoText!: Phaser.GameObjects.Text;
  upgradeBtn!: Phaser.GameObjects.Graphics;
  upgradeBtnIcon!: Phaser.GameObjects.Graphics;
  upgradeBtnText!: Phaser.GameObjects.Text;
  sellBtn!: Phaser.GameObjects.Graphics;
  sellBtnIcon!: Phaser.GameObjects.Graphics;
  sellBtnText!: Phaser.GameObjects.Text;

  overlay!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'UI', active: true });
  }

  create() {
    this.gold = STARTING_GOLD;
    this.lives = STARTING_LIVES;
    this.buildType = null;
    this.selectedInfo = null;
    this.buildSidebarPanel();
    this.buildStatusBlock();
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
      this.textures.off(Phaser.Textures.Events.ADD);
    });
  }

  private buildSidebarPanel() {
    const panel = this.add.graphics();
    panel.fillGradientStyle(PANEL_TOP, PANEL_TOP, PANEL_BG, PANEL_BG, 1);
    panel.fillRect(SIDEBAR_X, 0, SIDEBAR_WIDTH, CANVAS_HEIGHT);
    panel.lineStyle(2, PANEL_BORDER, 0.4);
    panel.lineBetween(SIDEBAR_X, 0, SIDEBAR_X, CANVAS_HEIGHT);
  }

  private buildStatusBlock() {
    this.goldText = this.add.text(CONTENT_X, 12, `골드 ${this.gold}`, { fontSize: '14px', color: '#ffe08a' });
    this.livesText = this.add.text(CONTENT_X, 34, `라이프 ${this.lives}`, { fontSize: '14px', color: '#ff8a8a' });
    this.waveText = this.add.text(CONTENT_X, 56, `웨이브 1/${WAVES.length}`, { fontSize: '14px', color: '#8ad1ff' });
    const div = this.add.graphics();
    div.lineStyle(1, PANEL_BORDER, 0.25);
    div.lineBetween(CONTENT_X, 84, SIDEBAR_X + SIDEBAR_WIDTH - PAD, 84);
  }

  private buildHud() {
    const startY = 90;
    const rowH = 58;
    const gap = 6;

    TOWER_ORDER.forEach((type, i) => {
      const def = TOWER_DEFS[type];
      const x = CONTENT_X;
      const y = startY + i * (rowH + gap);
      const w = CONTENT_W;
      const h = rowH;

      const glow = this.add.graphics({ x, y });
      glow.fillStyle(def.color, 0.3);
      glow.fillRoundedRect(-4, -4, w + 8, h + 8, 14);
      glow.setVisible(false);

      const g = this.add.graphics({ x, y });
      paintButton(g, w, h, { base: 0x24243a, border: def.color });
      g.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

      const iconKey = `tower-${type}-lv1`;
      const iconX = x + 28;
      const iconY = y + h / 2;
      let iconPlaceholder: Phaser.GameObjects.Arc | null = null;
      if (this.textures.exists(iconKey)) {
        const icon = this.add.image(iconX, iconY, iconKey);
        scaleToFit(icon, 44);
      } else {
        // GameScene loads the real art asynchronously and may not be done
        // yet when this scene boots - fall back to a color dot until the
        // 'addtexture' listener below swaps it for the real icon.
        iconPlaceholder = this.add.circle(iconX, iconY, 15, def.color);
      }

      this.add.text(x + 52, y + 5, `${def.name}  ${def.cost}G`, { fontSize: '12px', color: '#ffffff' });
      this.add.text(x + 52, y + 23, def.description, { fontSize: '9px', color: '#b9aee0', lineSpacing: 2, wordWrap: { width: CONTENT_W - 52 } });

      g.on('pointerover', () => {
        if (this.buildType !== type) g.setAlpha(0.85);
      });
      g.on('pointerout', () => g.setAlpha(1));
      g.on('pointerdown', () => {
        const next = this.buildType === type ? null : type;
        this.buildType = next;
        gameEvents.emit(Events.BuildTypeSelected, next);
        this.refreshBuildButtons();
      });

      this.buildButtons[type] = { g, glow, affordable: true, selected: false, w, h, iconPlaceholder, iconX, iconY };
    });

    this.textures.on(Phaser.Textures.Events.ADD, (key: string) => {
      const type = TOWER_ORDER.find((t) => `tower-${t}-lv1` === key);
      if (!type) return;
      const btn = this.buildButtons[type];
      if (!btn.iconPlaceholder) return;
      btn.iconPlaceholder.destroy();
      btn.iconPlaceholder = null;
      const icon = this.add.image(btn.iconX, btn.iconY, key);
      scaleToFit(icon, 44);
    });
  }

  private refreshBuildButtons() {
    TOWER_ORDER.forEach((type) => {
      const def = TOWER_DEFS[type];
      const btn = this.buildButtons[type];
      const selected = this.buildType === type;
      const affordable = this.gold >= def.cost;
      btn.selected = selected;
      btn.affordable = affordable;
      btn.glow.setVisible(selected);
      paintButton(btn.g, btn.w, btn.h, {
        base: selected ? 0x3a3560 : 0x24243a,
        border: def.color,
        borderWidth: selected ? 3 : 2,
      });
      btn.g.setAlpha(affordable ? 1 : 0.4);
    });
  }

  private refreshWaveButton() {
    paintButton(this.waveButton, this.waveButtonW, this.waveButtonH, this.waveButtonEnabled
      ? { base: GOLD, border: GOLD_LIGHT, sheenAlpha: 0.22 }
      : { base: DISABLED_GREY, border: 0x55555f, sheenAlpha: 0.05 });
    this.waveButtonText.setText(this.waveButtonEnabled ? '다음 웨이브 시작' : '진행 중...');
    this.waveButtonText.setColor(this.waveButtonEnabled ? '#241a3d' : '#9a9aa5');
  }

  private buildInfoPanel() {
    const x = CONTENT_X;
    const y = 90 + 4 * (58 + 6) + 4; // just below the four build buttons
    const panelW = CONTENT_W;
    const panelH = 82;

    const bg = this.add.graphics({ x, y });
    bg.fillStyle(0x120c22, 0.85);
    bg.fillRoundedRect(0, 0, panelW, panelH, 8);
    bg.lineStyle(1, PANEL_BORDER, 0.25);
    bg.strokeRoundedRect(0.5, 0.5, panelW - 1, panelH - 1, 8);

    this.infoText = this.add.text(x + 8, y + 7, '타워를 클릭하면\n업그레이드/판매할 수 있습니다.', {
      fontSize: '11px',
      color: '#cfd3e0',
      lineSpacing: 3,
    });

    const btnW = (panelW - 8 * 2 - 8) / 2;
    const btnH = 38;
    const btnY = y + panelH - btnH - 8;
    const upgradeX = x + 8;
    const sellX = x + 8 + btnW + 8;

    this.upgradeBtn = this.add.graphics({ x: upgradeX, y: btnY });
    paintButton(this.upgradeBtn, btnW, btnH, { base: 0x3a5c8a, border: 0x8ec7ff, radius: 8 });
    this.upgradeBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, btnW, btnH), Phaser.Geom.Rectangle.Contains);
    this.upgradeBtnIcon = this.add.graphics({ x: upgradeX, y: btnY });
    drawUpgradeIcon(this.upgradeBtnIcon, 18, btnH / 2);
    this.upgradeBtnText = this.add
      .text(upgradeX + 30, btnY + btnH / 2, '업그레이드', { fontSize: '10px', color: '#ffffff', lineSpacing: 2, align: 'left' })
      .setOrigin(0, 0.5);
    this.upgradeBtn.on('pointerdown', () => gameEvents.emit(Events.RequestUpgrade));

    this.sellBtn = this.add.graphics({ x: sellX, y: btnY });
    paintButton(this.sellBtn, btnW, btnH, { base: 0x8a3a3a, border: 0xff9a9a, radius: 8 });
    this.sellBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, btnW, btnH), Phaser.Geom.Rectangle.Contains);
    this.sellBtnIcon = this.add.graphics({ x: sellX, y: btnY });
    drawCoinIcon(this.sellBtnIcon, 18, btnH / 2);
    this.sellBtnText = this.add.text(sellX + 30, btnY + btnH / 2, '판매', { fontSize: '10px', color: '#ffffff' }).setOrigin(0, 0.5);
    this.sellBtn.on('pointerdown', () => gameEvents.emit(Events.RequestSell));

    this.infoPanel = this.add.container(0, 0, [
      bg,
      this.infoText,
      this.upgradeBtn,
      this.upgradeBtnIcon,
      this.upgradeBtnText,
      this.sellBtn,
      this.sellBtnIcon,
      this.sellBtnText,
    ]);
    this.setInfoControlsVisible(false);

    // Wave button goes right below the info panel, at the bottom of the sidebar.
    const wx = x;
    const wy = y + panelH + 8;
    const ww = panelW;
    const wh = CANVAS_HEIGHT - wy - 12;
    this.waveButtonW = ww;
    this.waveButtonH = wh;
    this.waveButton = this.add.graphics({ x: wx, y: wy });
    paintButton(this.waveButton, ww, wh, { base: GOLD, border: GOLD_LIGHT, sheenAlpha: 0.22 });
    this.waveButton.setInteractive(new Phaser.Geom.Rectangle(0, 0, ww, wh), Phaser.Geom.Rectangle.Contains);
    this.waveButtonText = this.add
      .text(wx + ww / 2, wy + wh / 2, '다음 웨이브 시작', {
        fontSize: '13px',
        color: '#241a3d',
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: ww - 16 },
      })
      .setOrigin(0.5);
    this.waveButton.on('pointerover', () => {
      if (this.waveButtonEnabled) this.waveButton.setAlpha(0.88);
    });
    this.waveButton.on('pointerout', () => this.waveButton.setAlpha(1));
    this.waveButton.on('pointerdown', () => {
      if (!this.waveButtonEnabled) return;
      gameEvents.emit(Events.RequestStartWave);
    });
  }

  private setInfoControlsVisible(visible: boolean) {
    this.upgradeBtn.setVisible(visible);
    this.upgradeBtnIcon.setVisible(visible);
    this.upgradeBtnText.setVisible(visible);
    this.sellBtn.setVisible(visible);
    this.sellBtnIcon.setVisible(visible);
    this.sellBtnText.setVisible(visible);
  }

  private refreshInfoPanel() {
    if (!this.selectedInfo) {
      this.infoText.setText('타워를 클릭하면\n업그레이드/판매할 수 있습니다.');
      this.setInfoControlsVisible(false);
      return;
    }
    const info = this.selectedInfo;
    const upgradeLabel = info.maxLevel ? '최대 레벨' : `업그레이드\n${info.upgradeCost}G`;
    this.infoText.setText(`${info.typeName} Lv${info.level}\n판매가 ${info.sellValue}G`);
    this.upgradeBtnText.setText(upgradeLabel);
    this.sellBtnText.setText(`판매 ${info.sellValue}G`);
    const canUpgrade = !info.maxLevel && this.gold >= (info.upgradeCost ?? Infinity);
    paintButton(
      this.upgradeBtn,
      (CONTENT_W - 8 * 2 - 8) / 2,
      38,
      canUpgrade ? { base: 0x3a5c8a, border: 0x8ec7ff, radius: 8 } : { base: DISABLED_GREY, border: 0x55555f, radius: 8, sheenAlpha: 0.05 },
    );
    this.upgradeBtnIcon.setAlpha(canUpgrade ? 1 : 0.4);
    this.setInfoControlsVisible(true);
  }

  private buildOverlay() {
    const bg = this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.75).setOrigin(0, 0);
    const title = this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 - 40, '', { fontSize: '36px', color: '#ffe9a8' }).setOrigin(0.5);
    title.setShadow(0, 0, '#ffd166', 12);
    const subtitle = this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2, '', { fontSize: '15px', color: '#cccccc' }).setOrigin(0.5);

    const btnW = 160;
    const btnH = 44;
    const restartBtn = this.add.graphics({ x: GAME_WIDTH / 2 - btnW / 2, y: CANVAS_HEIGHT / 2 + 50 - btnH / 2 });
    paintButton(restartBtn, btnW, btnH, { base: GOLD, border: GOLD_LIGHT, radius: 12, sheenAlpha: 0.22 });
    restartBtn.setInteractive(new Phaser.Geom.Rectangle(0, 0, btnW, btnH), Phaser.Geom.Rectangle.Contains);
    const restartText = this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 + 50, '다시 시작', { fontSize: '15px', color: '#241a3d', fontStyle: 'bold' }).setOrigin(0.5);
    restartBtn.on('pointerover', () => restartBtn.setAlpha(0.88));
    restartBtn.on('pointerout', () => restartBtn.setAlpha(1));
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
