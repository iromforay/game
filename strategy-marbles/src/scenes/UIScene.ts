import Phaser from 'phaser';
import { CANVAS_HEIGHT, CANVAS_WIDTH, GAME_HEIGHT, GAME_WIDTH, PLAYER_COLORS, uiTextColor } from '../config/constants';
import { gameEvents, Events } from '../events';
import type { GameOverInfo, MapInfo, ScoreEntry, TurnInfo } from '../events';

// Real nicknames arrive only in network mode (see Events.PlayersChanged);
// local hotseat play never fires it, so every label falls back to this.

const PHASE_BADGE = {
  aiming: { label: '예약 중', color: 0x2a6fdb },
  waiting: { label: '대기 중', color: 0x6a6a6a },
  resolving: { label: '실행 중', color: 0xff5a3c },
  eliminated: { label: '탈락', color: 0x4a4a52 },
} as const;

export class UIScene extends Phaser.Scene {
  turnText!: Phaser.GameObjects.Text;
  timerText!: Phaser.GameObjects.Text;
  mapText!: Phaser.GameObjects.Text;
  scoreTexts: Phaser.GameObjects.Text[] = [];
  overlay!: Phaser.GameObjects.Container;

  phaseBadgeBg!: Phaser.GameObjects.Rectangle;
  phaseBadgeText!: Phaser.GameObjects.Text;
  phaseTween: Phaser.Tweens.Tween | null = null;

  phaseBanner!: Phaser.GameObjects.Container;
  phaseBannerBg!: Phaser.GameObjects.Rectangle;
  phaseBannerText!: Phaser.GameObjects.Text;
  phaseBannerTween: Phaser.Tweens.Tween | null = null;

  playerNames: string[] = [];

  constructor() {
    super({ key: 'UI', active: true });
  }

  create() {
    this.buildHud();
    this.buildPhaseBanner();
    this.buildOverlay();

    this.playerNames = [];
    gameEvents.on(Events.PlayersChanged, (names: string[]) => {
      this.playerNames = names;
    });
    gameEvents.on(Events.TurnChanged, (info: TurnInfo) => this.onTurnChanged(info));
    gameEvents.on(Events.TimerTick, (seconds: number) => {
      this.timerText.setText(seconds > 0 ? `남은 시간 ${seconds}초` : '');
    });
    gameEvents.on(Events.ScoreChanged, (entries: ScoreEntry[]) => this.onScoreChanged(entries));
    gameEvents.on(Events.MapChanged, (info: MapInfo) => this.onMapChanged(info));
    gameEvents.on(Events.GameOver, (info: GameOverInfo) => this.onGameOver(info));

    this.events.on('shutdown', () => {
      gameEvents.removeAllListeners(Events.TurnChanged);
      gameEvents.removeAllListeners(Events.TimerTick);
      gameEvents.removeAllListeners(Events.ScoreChanged);
      gameEvents.removeAllListeners(Events.MapChanged);
      gameEvents.removeAllListeners(Events.GameOver);
      gameEvents.removeAllListeners(Events.PlayersChanged);
    });
  }

  private playerLabel(index: number): string {
    return this.playerNames[index] ?? `Player ${index + 1}`;
  }

  private buildHud() {
    const hudTop = GAME_HEIGHT;
    this.add.rectangle(0, hudTop, GAME_WIDTH, 110, 0x14141f).setOrigin(0, 0);

    this.phaseBadgeBg = this.add.rectangle(16, hudTop + 12, 78, 24, PHASE_BADGE.aiming.color).setOrigin(0, 0);
    this.phaseBadgeText = this.add
      .text(16 + 39, hudTop + 24, PHASE_BADGE.aiming.label, { fontSize: '13px', color: '#ffffff' })
      .setOrigin(0.5);

    this.turnText = this.add.text(104, hudTop + 15, '', { fontSize: '16px', color: '#ffffff' });
    this.mapText = this.add.text(104, hudTop + 37, '', { fontSize: '11px', color: '#9aa0b4' });
    this.timerText = this.add.text(16, hudTop + 44, '', { fontSize: '13px', color: '#ffd75a' });

    this.add.text(16, hudTop + 66, '내 알을 클릭하고 반대 방향으로 당겼다 놓으면 예약됩니다. 전원이 예약을 마치면 한 번에 실행됩니다.', {
      fontSize: '11px',
      color: '#9aa0b4',
      wordWrap: { width: GAME_WIDTH - 32 },
    });
    this.add.text(16, hudTop + 88, '무게는 본인 알에만, 자기 차례에만 표시됩니다.', {
      fontSize: '11px',
      color: '#9aa0b4',
    });
  }

  private buildPhaseBanner() {
    this.phaseBannerBg = this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.55).setOrigin(0, 0);
    this.phaseBannerText = this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, '', {
        fontSize: '40px',
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5);

    this.phaseBanner = this.add.container(0, 0, [this.phaseBannerBg, this.phaseBannerText]);
    this.phaseBanner.setDepth(200);
    this.phaseBanner.setAlpha(0);
  }

  private showPhaseBanner(text: string, color: string) {
    this.phaseBannerTween?.remove();
    this.phaseBannerText.setText(text).setColor(color);
    this.phaseBanner.setAlpha(1);
    this.phaseBannerTween = this.tweens.add({
      targets: this.phaseBanner,
      alpha: 0,
      duration: 350,
      delay: 550,
    });
  }

  private setPhaseBadge(phase: 'aiming' | 'waiting' | 'resolving' | 'eliminated') {
    const def = PHASE_BADGE[phase];
    this.phaseBadgeBg.setFillStyle(def.color, 1);
    this.phaseBadgeText.setText(def.label);

    this.phaseTween?.remove();
    this.phaseTween = null;
    this.phaseBadgeBg.setAlpha(1);

    if (phase === 'resolving') {
      this.phaseTween = this.tweens.add({
        targets: this.phaseBadgeBg,
        alpha: { from: 1, to: 0.4 },
        duration: 350,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private onTurnChanged(info: TurnInfo) {
    if (info.phase === 'resolving') {
      this.showPhaseBanner('행동개시!', '#ff5a3c');
      this.setPhaseBadge('resolving');
      this.turnText.setText(`${info.turn}/${info.maxTurns}턴 - 예약된 알이 동시에 발사됩니다`);
      this.turnText.setColor('#ffffff');
      this.timerText.setText('');
      return;
    }
    if (info.phase === 'waiting') {
      this.setPhaseBadge('waiting');
      this.turnText.setText(`${info.turn}/${info.maxTurns}턴 - 다른 플레이어를 기다리는 중...`);
      this.turnText.setColor('#ffffff');
      this.timerText.setText('');
      return;
    }
    if (info.phase === 'eliminated') {
      this.setPhaseBadge('eliminated');
      this.turnText.setText(`${info.turn}/${info.maxTurns}턴 - 당신의 알이 모두 제거되어 관전 중입니다`);
      this.turnText.setColor('#9aa0b4');
      this.timerText.setText('');
      return;
    }
    if (info.activePlayerIndex === null) return;

    const color = Phaser.Display.Color.IntegerToRGB(uiTextColor(PLAYER_COLORS[info.activePlayerIndex % PLAYER_COLORS.length]));
    const colorString = Phaser.Display.Color.RGBToString(color.r, color.g, color.b, 0, '#');
    const name = this.playerLabel(info.activePlayerIndex);
    this.showPhaseBanner(`${info.turn}턴 · ${name} 행동예약`, colorString);

    this.setPhaseBadge('aiming');
    this.turnText.setText(`${info.turn}/${info.maxTurns}턴 - ${name} 행동 예약 대기`);
    this.turnText.setColor(colorString);
  }

  private onMapChanged(info: MapInfo) {
    this.mapText.setText(`맵: ${info.name}`);
  }

  private onScoreChanged(entries: ScoreEntry[]) {
    for (const t of this.scoreTexts) t.destroy();
    this.scoreTexts = [];

    entries.forEach((entry, i) => {
      const color = uiTextColor(PLAYER_COLORS[entry.playerIndex % PLAYER_COLORS.length]);
      const text = this.add.text(
        CANVAS_WIDTH - 190,
        GAME_HEIGHT + 12 + i * 20,
        `${this.playerLabel(entry.playerIndex)}  점수 ${entry.score}  알 ${entry.eggsAlive}`,
        { fontSize: '13px', color: Phaser.Display.Color.IntegerToColor(color).rgba },
      );
      this.scoreTexts.push(text);
    });
  }

  private buildOverlay() {
    const bg = this.add.rectangle(0, 0, CANVAS_WIDTH, GAME_HEIGHT + 110, 0x000000, 0.78).setOrigin(0, 0);
    const title = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 - 40, '', { fontSize: '32px', color: '#ffffff' }).setOrigin(0.5);
    const subtitle = this.add
      .text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2, '', { fontSize: '15px', color: '#cccccc', align: 'center' })
      .setOrigin(0.5);
    const restartBtn = this.add
      .rectangle(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 + 50, 160, 44, 0x3a5c8a)
      .setInteractive({ useHandCursor: true });
    const restartText = this.add.text(CANVAS_WIDTH / 2, GAME_HEIGHT / 2 + 50, '다시 시작', { fontSize: '15px', color: '#ffffff' }).setOrigin(0.5);
    restartBtn.on('pointerdown', () => {
      gameEvents.emit(Events.RequestRestart);
      this.overlay.setVisible(false);
    });

    this.overlay = this.add.container(0, 0, [bg, title, subtitle, restartBtn, restartText]);
    this.overlay.setVisible(false);
    (this.overlay as unknown as { titleText: Phaser.GameObjects.Text }).titleText = title;
    (this.overlay as unknown as { subtitleText: Phaser.GameObjects.Text }).subtitleText = subtitle;
  }

  private onGameOver(info: GameOverInfo) {
    const winnerLabel =
      info.winnerIndexes.length > 1
        ? `무승부 (${info.winnerIndexes.map((i) => this.playerLabel(i)).join(', ')})`
        : `${this.playerLabel(info.winnerIndexes[0])} 승리!`;
    const detail = info.scores.map((s) => `${this.playerLabel(s.playerIndex)}: ${s.score}점`).join('   ');

    const overlay = this.overlay as unknown as { titleText: Phaser.GameObjects.Text; subtitleText: Phaser.GameObjects.Text };
    overlay.titleText.setText(winnerLabel);
    overlay.subtitleText.setText(detail);
    this.overlay.setVisible(true);
  }
}
