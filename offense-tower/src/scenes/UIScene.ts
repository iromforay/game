import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT, GAME_WIDTH, SIDEBAR_WIDTH } from 'tower-defense';
import { UNIT_DEFS } from '../config/units';
import type { UnitType } from '../config/units';
import { gameEvents, Events } from '../events';
import type { ScoreInfo, HeroState, HeroInfo, ClearInfo } from '../events';

const UNIT_ORDER: UnitType[] = ['swarm', 'tank', 'speed'];

// Fantasy/gold theme shared with the hub and tower-defense - dark violet
// panels, gold accents. Kept as a local copy (not imported) since offense-tower
// already keeps its own decoupled config/map rather than sharing internals.
const PANEL_BG = 0x171029;
const PANEL_BORDER = 0xffd166;
const PANEL_TOP = 0x241a3d;

// The sidebar sits to the right of the board (not a strip below it) so the
// overall canvas is wide instead of tall - mirrors tower-defense's UIScene.
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

/** Rounded panel with a subtle top-sheen highlight and a bright border - mirrors tower-defense's UIScene so both games' HUDs read as one consistent style. */
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

// No unit art exists yet, so each spawn button gets a small hand-drawn vector
// glyph instead of a flat color dot - reads at a glance without needing real
// sprites (same idea as tower-defense's upgrade/sell icons).
function drawSwarmIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number) {
  g.fillStyle(color, 1);
  g.fillCircle(cx - 7, cy + 5, 6);
  g.fillCircle(cx + 7, cy + 5, 6);
  g.fillCircle(cx, cy - 6, 7);
  g.lineStyle(1.5, 0x000000, 0.25);
  g.strokeCircle(cx - 7, cy + 5, 6);
  g.strokeCircle(cx + 7, cy + 5, 6);
  g.strokeCircle(cx, cy - 6, 7);
}

function drawTankIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number) {
  const w = 15;
  const h = 17;
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(cx - w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy - h / 2);
  g.lineTo(cx + w / 2, cy + h * 0.1);
  g.lineTo(cx, cy + h / 2);
  g.lineTo(cx - w / 2, cy + h * 0.1);
  g.closePath();
  g.fillPath();
  g.lineStyle(1.5, 0xffffff, 0.4);
  g.strokePath();
}

function drawSpeedIcon(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number) {
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(cx - 3, cy - 9);
  g.lineTo(cx + 5, cy - 9);
  g.lineTo(cx - 1, cy - 1);
  g.lineTo(cx + 5, cy - 1);
  g.lineTo(cx - 5, cy + 9);
  g.lineTo(cx - 1, cy + 1);
  g.lineTo(cx - 7, cy + 1);
  g.closePath();
  g.fillPath();
}

const UNIT_ICON_DRAWERS: Record<UnitType, (g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number) => void> = {
  swarm: drawSwarmIcon,
  tank: drawTankIcon,
  speed: drawSpeedIcon,
};

export class UIScene extends Phaser.Scene {
  roundText!: Phaser.GameObjects.Text;
  scoreText!: Phaser.GameObjects.Text;
  aiGoldText!: Phaser.GameObjects.Text;

  spawnButtons: Record<UnitType, { g: Phaser.GameObjects.Graphics; cooldownOverlay: Phaser.GameObjects.Graphics; w: number; h: number }> = {} as any;
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
    this.buildSidebarPanel();
    this.buildStatusBlock();
    this.buildHud();
    this.buildClearOverlay();

    gameEvents.on(Events.ScoreChanged, (score: ScoreInfo) => {
      this.roundText.setText(score.roundName);
      this.scoreText.setText(`돌파 ${score.unitBreakthroughs}/${score.goal}`);
      this.aiGoldText.setText(`AI 골드 ${score.aiGold} · 처치 ${score.kills}`);
    });

    gameEvents.on(Events.GameCleared, (info: ClearInfo) => this.showClearOverlay(info));

    gameEvents.on(Events.CooldownsChanged, (remaining: Record<UnitType, number>) => {
      UNIT_ORDER.forEach((type) => {
        const def = UNIT_DEFS[type];
        const ratio = Phaser.Math.Clamp(remaining[type] / def.spawnCooldown, 0, 1);
        const { cooldownOverlay, w, h } = this.spawnButtons[type];
        cooldownOverlay.clear();
        if (ratio > 0) {
          cooldownOverlay.fillStyle(0x000000, 0.6);
          cooldownOverlay.fillRoundedRect(0, 0, w * ratio, h, { tl: 10, bl: 10, tr: ratio > 0.97 ? 10 : 0, br: ratio > 0.97 ? 10 : 0 });
        }
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

  private buildSidebarPanel() {
    const panel = this.add.graphics();
    panel.fillGradientStyle(PANEL_TOP, PANEL_TOP, PANEL_BG, PANEL_BG, 1);
    panel.fillRect(SIDEBAR_X, 0, SIDEBAR_WIDTH, CANVAS_HEIGHT);
    panel.lineStyle(2, PANEL_BORDER, 0.4);
    panel.lineBetween(SIDEBAR_X, 0, SIDEBAR_X, CANVAS_HEIGHT);
  }

  private buildStatusBlock() {
    this.roundText = this.add.text(CONTENT_X, 12, '', { fontSize: '14px', color: '#ffd166', fontStyle: 'bold' });
    this.scoreText = this.add.text(CONTENT_X, 34, '돌파 0/10', { fontSize: '13px', color: '#8affb0' });
    this.aiGoldText = this.add.text(CONTENT_X, 56, 'AI 골드 0 · 처치 0', { fontSize: '12px', color: '#ffb08a' });
    const div = this.add.graphics();
    div.lineStyle(1, PANEL_BORDER, 0.25);
    div.lineBetween(CONTENT_X, 84, SIDEBAR_X + SIDEBAR_WIDTH - PAD, 84);
  }

  private buildClearOverlay() {
    const bg = this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.75).setOrigin(0, 0);
    const title = this.add.text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 - 30, '클리어!', { fontSize: '36px', color: '#ffe9a8' }).setOrigin(0.5);
    title.setShadow(0, 0, '#ffd166', 12);
    const subtitle = this.add
      .text(GAME_WIDTH / 2, CANVAS_HEIGHT / 2 + 20, '', { fontSize: '15px', color: '#cccccc', align: 'center' })
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
    const startY = 96;
    const rowH = 72;
    const gap = 8;

    UNIT_ORDER.forEach((type, i) => {
      const def = UNIT_DEFS[type];
      const x = CONTENT_X;
      const y = startY + i * (rowH + gap);
      const w = CONTENT_W;
      const h = rowH;

      const g = this.add.graphics({ x, y });
      paintButton(g, w, h, { base: 0x2a2438, border: def.color });
      g.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

      this.add.circle(x + 26, y + h / 2, 15, def.color, 0.18);
      const iconG = this.add.graphics({ x, y });
      UNIT_ICON_DRAWERS[type](iconG, 26, h / 2, def.color);
      this.add.text(x + 50, y + 7, `${def.name}`, { fontSize: '12px', color: '#ffffff' });
      this.add.text(x + 50, y + 26, `HP${def.hp} / 속도${def.speed}`, { fontSize: '10px', color: '#b9aee0' });

      const cooldownOverlay = this.add.graphics({ x, y });
      cooldownOverlay.setVisible(true);

      g.on('pointerover', () => g.setAlpha(0.88));
      g.on('pointerout', () => g.setAlpha(1));
      g.on('pointerdown', () => gameEvents.emit(Events.RequestSpawn, type));

      this.spawnButtons[type] = { g, cooldownOverlay, w, h };
    });

    const hx = CONTENT_X;
    const hy = startY + UNIT_ORDER.length * (rowH + gap) + 4;
    const hw = CONTENT_W;
    const hh = 70;
    // Hero button intentionally left in its original plain style for now -
    // hero UI is being redesigned separately, not part of this HUD pass.
    this.heroButton = this.add
      .rectangle(hx, hy, hw, hh, 0x2a2a2a)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffd166, 0.9)
      .setAlpha(0.45);
    this.heroButtonLabel = this.add.text(hx + 8, hy + 8, `${this.heroName}\n잠김 (영웅존 진입 시 해금)`, {
      fontSize: '11px',
      color: '#ffffff',
      lineSpacing: 4,
      wordWrap: { width: hw - 16 },
    });
    this.heroButton.on('pointerdown', () => gameEvents.emit(Events.RequestSpawnHero));
  }
}
