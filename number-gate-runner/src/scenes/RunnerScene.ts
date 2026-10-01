import Phaser from 'phaser';
import { applyGate, gateLabel, swarmPenetration } from '../model';
import type { GateRule } from '../model';
import type { RunnerResult } from '../game';
import { RUNNER_STAGES, type RunnerStage } from '../stages';
import heroCommanderUrl from '../assets/units/hero-commander.png';
import advancingSquadUrl from '../assets/units/advancing-squad.png';
import numberGateUrl from '../assets/world/number-gate-3d.png';
import clockworkGruntUrl from '../assets/enemies/clockwork-grunt.png';
import siegeTankUrl from '../assets/enemies/siege-tank.png';
import playroomBackgroundUrl from '../assets/backgrounds/playroom-runner-v2.jpg';
import kitchenBackgroundUrl from '../assets/backgrounds/kitchen-runner-v2.jpg';
import spreadMagazineUrl from '../assets/items/spread-magazine.png';
import penetrationRoundUrl from '../assets/items/penetration-round.png';
import rapidDrumUrl from '../assets/items/rapid-drum.png';
import blockGateBossUrl from '../assets/bosses/boss-1-1-block-gate.png';

const WIDTH = 1280;
const HEIGHT = 720;
const PLAYER_X = 285;
const TRACK_TOP = 145;
const TRACK_BOTTOM = 610;
const RUN_SPEED = 210;
const FINISH_DISTANCE = 5200;
const POWER_UP_DURATION = 20_000;

type PowerUpType = 'spread' | 'penetration' | 'rapid';

const POWER_UP_META: Record<PowerUpType, { label: string; effect: string; texture: string; color: number }> = {
  spread: { label: '확산 탄창', effect: '세로 사격 범위 3배', texture: 'item-spread-magazine', color: 0x38bdf8 },
  penetration: { label: '관통탄', effect: '잡몹 관통력 3배', texture: 'item-penetration-round', color: 0xfacc15 },
  rapid: { label: '고속 장전', effect: '연사 속도 2배', texture: 'item-rapid-drum', color: 0xfb7185 },
};

interface GatePairDef {
  distance: number;
  upper: GateRule;
  lower: GateRule;
}

interface GateVisual {
  def: GatePairDef;
  upper: Phaser.GameObjects.Container;
  lower: Phaser.GameObjects.Container;
  upperText: Phaser.GameObjects.Text;
  lowerText: Phaser.GameObjects.Text;
  upperHits: number;
  lowerHits: number;
  used: boolean;
}

interface CombatDef {
  distance: number;
  strength: number;
  title: string;
  boss?: boolean;
  sprite?: 'clockwork-grunt' | 'siege-tank' | 'boss-block-gate-1-1';
}

interface CombatVisual {
  def: CombatDef;
  container: Phaser.GameObjects.Container;
  health: number;
  healthText: Phaser.GameObjects.Text;
  used: boolean;
}

interface SwarmUnit {
  sprite: Phaser.GameObjects.Image;
  distance: number;
  laneY: number;
  alive: boolean;
}

interface SwarmWave {
  title: string;
  units: SwarmUnit[];
  resolved: boolean;
}

interface PowerUpVisual {
  type: PowerUpType;
  distance: number;
  container: Phaser.GameObjects.Container;
  collected: boolean;
}

interface PowerUpHud {
  container: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Rectangle;
  timeText: Phaser.GameObjects.Text;
}

export class RunnerScene extends Phaser.Scene {
  private runDistance = 0;
  private squadY = 360;
  private targetY = 360;
  private actualCount = 100;
  private maxCount = 100;
  private state: 'running' | 'combat' | 'won' | 'failed' = 'running';
  private formation!: Phaser.GameObjects.Container;
  private countText!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private choiceText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private gates: GateVisual[] = [];
  private combats: CombatVisual[] = [];
  private swarms: SwarmWave[] = [];
  private obstacles: Phaser.GameObjects.Container[] = [];
  private powerUps: PowerUpVisual[] = [];
  private activePowerUps = new Map<PowerUpType, number>();
  private powerUpHud = new Map<PowerUpType, PowerUpHud>();
  private activeCombat: CombatVisual | null = null;
  private nextShotAt = 0;
  private fireMode: 'gate' | 'swarm' | 'combat' | null = null;
  private nextEnemyHitAt = 0;
  private dragging = false;
  private combo = 0;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly stage: RunnerStage;
  private readonly onComplete?: (result: RunnerResult) => void;
  private readonly onLeave?: () => void;

  constructor(stage: RunnerStage = RUNNER_STAGES[0], onComplete?: (result: RunnerResult) => void, onLeave?: () => void) {
    super('Runner');
    this.stage = stage;
    this.onComplete = onComplete;
    this.onLeave = onLeave;
  }

  preload() {
    this.load.image('hero-commander', heroCommanderUrl);
    this.load.image('advancing-squad', advancingSquadUrl);
    this.load.image('number-gate-3d', numberGateUrl);
    this.load.image('clockwork-grunt', clockworkGruntUrl);
    this.load.image('siege-tank', siegeTankUrl);
    this.load.image('background-playroom', playroomBackgroundUrl);
    this.load.image('background-kitchen', kitchenBackgroundUrl);
    this.load.image('item-spread-magazine', spreadMagazineUrl);
    this.load.image('item-penetration-round', penetrationRoundUrl);
    this.load.image('item-rapid-drum', rapidDrumUrl);
    this.load.image('boss-block-gate-1-1', blockGateBossUrl);
  }

  create() {
    this.runDistance = 0;
    this.squadY = 360;
    this.targetY = 360;
    this.actualCount = this.stage.startCount;
    this.maxCount = this.stage.startCount;
    this.state = 'running';
    this.gates = [];
    this.combats = [];
    this.swarms = [];
    this.obstacles = [];
    this.powerUps = [];
    this.activePowerUps.clear();
    this.powerUpHud.clear();
    this.activeCombat = null;
    this.nextShotAt = 0;
    this.fireMode = null;
    this.nextEnemyHitAt = 0;
    this.dragging = false;
    this.combo = 0;
    this.cursors = this.input.keyboard?.createCursorKeys();

    this.drawBackground();
    this.createCourse();
    this.createFormation();
    this.createHud();
    this.createPowerUpHud();
    this.bindInput();
  }

  private drawBackground() {
    this.cameras.main.setBackgroundColor('#0f172a');
    this.add.image(WIDTH / 2, HEIGHT / 2, this.stage.chapter === 1 ? 'background-playroom' : 'background-kitchen')
      .setDisplaySize(WIDTH, HEIGHT)
      .setDepth(0);
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0b1424, this.stage.chapter === 1 ? 0.14 : 0.2).setDepth(1);

    const track = this.add.graphics().setDepth(2);
    track.fillStyle(this.stage.chapter === 1 ? 0x172033 : 0x3b241c, 0.34);
    track.beginPath();
    track.moveTo(90, TRACK_BOTTOM);
    track.lineTo(1190, TRACK_BOTTOM - 45);
    track.lineTo(1190, TRACK_TOP + 45);
    track.lineTo(90, TRACK_TOP);
    track.closePath();
    track.fillPath();
    track.lineStyle(3, Phaser.Display.Color.HexStringToColor(this.stage.accent).color, 0.72);
    track.strokePath();
    track.lineStyle(2, 0xffffff, 0.12);
    track.lineBetween(90, 375, 1190, 375);
    this.add.text(1135, 115, `${this.stage.chapter}-${this.stage.stage}  ${this.stage.title}`, {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#0f172ab8', padding: { x: 12, y: 7 },
    }).setOrigin(1, 0).setDepth(4);
  }

  private createCourse() {
    const threat = this.stage.threat;
    const itemOrder: PowerUpType[] = ['spread', 'penetration', 'rapid'];
    const rotation = (this.stage.id - 1) % itemOrder.length;
    const stageItems = [...itemOrder.slice(rotation), ...itemOrder.slice(0, rotation)];
    this.addGatePair({ distance: 520, upper: { operation: 'add', value: 90 + threat * 15 }, lower: { operation: 'add', value: 45 + threat * 8 } });
    this.addPowerUp(820, 360, stageItems[0]);
    this.addSwarm(1050, 28 + threat * 3, `${this.stage.enemyGroup} 선발대`);
    this.addObstacle(1580, 490, 30 + threat * 4);
    this.addGatePair({ distance: 1980, upper: { operation: 'multiply', value: threat >= 8 ? 3 : 2 }, lower: { operation: 'add', value: 120 + threat * 18 } });
    this.addPowerUp(2240, this.stage.stage % 2 === 0 ? 270 : 470, stageItems[1]);
    this.addSwarm(2520, 42 + threat * 4, `${this.stage.enemyGroup} 대군`);
    this.addCombat({ distance: 3260, strength: 210 + threat * 42, title: `${this.stage.title} 중간 수문장`, sprite: 'siege-tank' });
    this.addSwarm(3850, 55 + threat * 5, `${this.stage.enemyGroup} 총공세`);
    this.addPowerUp(4080, this.stage.stage % 2 === 0 ? 470 : 270, stageItems[2]);
    this.addGatePair({ distance: 4300, upper: { operation: 'add', value: 220 + threat * 24 }, lower: { operation: 'multiply', value: threat >= 12 ? 3 : 2 } });
    this.addCombat({
      distance: 5000,
      strength: 500 + threat * 62,
      title: this.stage.bossName,
      boss: true,
      sprite: this.stage.id === 1 ? 'boss-block-gate-1-1' : undefined,
    });
  }

  private addPowerUp(distance: number, y: number, type: PowerUpType) {
    const meta = POWER_UP_META[type];
    const container = this.add.container(WIDTH + 200, y).setDepth(28);
    const glow = this.add.circle(0, 0, 53, meta.color, 0.18).setStrokeStyle(3, meta.color, 0.72);
    const itemImage = this.add.image(0, 0, meta.texture).setDisplaySize(96, 96);
    const label = this.add.text(0, 62, meta.label, {
      fontSize: '14px', color: '#ffffff', backgroundColor: '#0f172ad9', padding: { x: 8, y: 4 },
    }).setOrigin(0.5);
    container.add([glow, itemImage, label]);
    this.tweens.add({ targets: glow, scale: 1.18, alpha: 0.42, duration: 620, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: container, y: y - 8, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.powerUps.push({ type, distance, container, collected: false });
  }

  private addSwarm(distance: number, count: number, title: string) {
    const units: SwarmUnit[] = [];
    for (let i = 0; i < count; i += 1) {
      const column = Math.floor(i / 8);
      const row = i % 8;
      const laneY = 190 + row * 51 + Phaser.Math.Between(-12, 12);
      const unitDistance = distance + column * 54 + Phaser.Math.Between(-18, 18);
      const size = Phaser.Math.Between(30, 39);
      const sprite = this.add.image(WIDTH + 240, laneY, 'clockwork-grunt')
        .setDisplaySize(size, Math.round(size * 0.83))
        .setDepth(14 + row);
      units.push({ sprite, distance: unitDistance, laneY, alive: true });
    }
    this.swarms.push({ title, units, resolved: false });
  }

  private addGatePair(def: GatePairDef) {
    const upper = this.makeGate(def.upper, 245);
    const lower = this.makeGate(def.lower, 495);
    this.gates.push({
      def,
      upper: upper.container,
      lower: lower.container,
      upperText: upper.text,
      lowerText: lower.text,
      upperHits: 0,
      lowerHits: 0,
      used: false,
    });
  }

  private makeGate(rule: GateRule, y: number) {
    const container = this.add.container(WIDTH + 200, y);
    const shadow = this.add.ellipse(0, 70, 180, 27, 0x0f172a, 0.32);
    const gate = this.add.image(0, 0, 'number-gate-3d').setDisplaySize(190, 183);
    const text = this.add.text(0, -48, gateLabel(rule), {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '34px',
      color: '#ffffff',
      stroke: '#061b35',
      strokeThickness: 7,
    }).setOrigin(0.5);
    container.add([shadow, gate, text]);
    return { container, text };
  }

  private addObstacle(distance: number, y: number, loss: number) {
    const container = this.add.container(WIDTH + 200, y).setData({ distance, loss, used: false });
    const shadow = this.add.ellipse(0, 26, 145, 34, 0x0f172a, 0.3);
    const block = this.add.rectangle(0, 0, 120, 72, 0xf97316).setStrokeStyle(4, 0xffedd5);
    const stripeA = this.add.rectangle(-28, 0, 12, 70, 0x1f2937).setAngle(-20);
    const stripeB = this.add.rectangle(25, 0, 12, 70, 0x1f2937).setAngle(-20);
    const text = this.add.text(0, -55, `충돌 −${loss}`, { fontSize: '18px', color: '#7c2d12', backgroundColor: '#ffedd5', padding: { x: 8, y: 4 } }).setOrigin(0.5);
    container.add([shadow, block, stripeA, stripeB, text]);
    this.obstacles.push(container);
  }

  private addCombat(def: CombatDef) {
    const container = this.add.container(WIDTH + 240, 360);
    const scale = def.boss ? 1.45 : 1;
    const isBlockGateBoss = def.sprite === 'boss-block-gate-1-1';
    const shadowWidth = isBlockGateBoss ? 285 : def.sprite === 'siege-tank' ? 230 : 145;
    const shadow = this.add.ellipse(0, isBlockGateBoss ? 116 : 68 * scale, shadowWidth, isBlockGateBoss ? 45 : 34, 0x0f172a, 0.38);
    let enemy: Phaser.GameObjects.GameObject;
    if (def.sprite) {
      const enemyWidth = isBlockGateBoss ? 290 : def.sprite === 'siege-tank' ? 245 : 165;
      const enemyHeight = isBlockGateBoss ? 290 : def.sprite === 'siege-tank' ? 163 : 138;
      enemy = this.add.image(0, isBlockGateBoss ? -18 : 0, def.sprite).setDisplaySize(enemyWidth, enemyHeight);
    } else {
      enemy = this.add.rectangle(0, 0, 130 * scale, 120 * scale, 0x7c3aed).setStrokeStyle(5, 0xf8fafc, 0.7);
    }
    const title = this.add.text(0, -105 * scale, def.title, { fontSize: def.boss ? '24px' : '20px', color: '#3f1d1d', backgroundColor: '#fff7ed', padding: { x: 10, y: 5 } }).setOrigin(0.5);
    const healthText = this.add.text(0, 104 * scale, def.strength.toLocaleString('ko-KR'), { fontFamily: 'Arial Black, sans-serif', fontSize: def.boss ? '28px' : '22px', color: '#ffffff', stroke: '#111827', strokeThickness: 5 }).setOrigin(0.5);
    container.add([shadow, enemy, title, healthText]);
    this.combats.push({ def, container, health: def.strength, healthText, used: false });
  }

  private createFormation() {
    this.formation = this.add.container(PLAYER_X, this.squadY);
    this.redrawFormation();
  }

  private redrawFormation() {
    this.formation.removeAll(true);
    const growth = Phaser.Math.Clamp(Math.log2(this.actualCount / 80 + 1) / 4, 0, 1);
    const squadWidth = Phaser.Math.Linear(230, 325, growth);
    const squadHeight = squadWidth / 2;
    const squad = this.add.image(-28, 3, 'advancing-squad')
      .setDisplaySize(squadWidth, squadHeight)
      .setOrigin(0.5);
    this.formation.add(squad);
    this.addHeroToFormation(squadWidth / 2 + 34);
    this.formation.setDepth(20);
  }

  private addHeroToFormation(heroX: number) {
    const heroY = 0;
    const shadow = this.add.ellipse(heroX + 2, heroY + 39, 86, 23, 0x0f172a, 0.42);
    const hero = this.add.image(heroX, heroY - 8, 'hero-commander')
      .setDisplaySize(166, 138)
      .setOrigin(0.5, 0.58);
    this.formation.add([shadow, hero]);
  }

  private createHud() {
    this.add.rectangle(0, 0, WIDTH, 78, 0x0f172a, 0.9).setOrigin(0).setDepth(100);
    this.add.text(24, 14, `CHAPTER ${this.stage.chapter} · STAGE ${this.stage.chapter}-${this.stage.stage}`, { fontSize: '20px', color: '#f8fafc', fontStyle: 'bold' }).setDepth(101);
    this.add.text(24, 46, `${this.stage.title} · ${this.stage.route}`, { fontSize: '15px', color: this.stage.accent }).setDepth(101);
    this.countText = this.add.text(PLAYER_X, 92, this.stage.startCount.toLocaleString('ko-KR'), { fontFamily: 'Arial Black, sans-serif', fontSize: '34px', color: '#ffffff', stroke: '#1e3a8a', strokeThickness: 7 }).setOrigin(0.5).setDepth(101);
    this.add.rectangle(880, 30, 330, 12, 0x334155).setOrigin(0, 0.5).setDepth(101);
    this.progressBar = this.add.rectangle(880, 30, 0, 12, 0x38bdf8).setOrigin(0, 0.5).setDepth(102);
    this.statusText = this.add.text(1045, 51, `${this.stage.bossName}까지 전진`, { fontSize: '14px', color: '#cbd5e1' }).setOrigin(0.5).setDepth(102);
    this.choiceText = this.add.text(WIDTH / 2, 102, '', { fontSize: '24px', color: '#ffffff', backgroundColor: '#0f172acc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setDepth(110).setAlpha(0);
    this.comboText = this.add.text(1215, 105, '', { fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#fef08a', stroke: '#7c2d12', strokeThickness: 6 }).setOrigin(1, 0.5).setDepth(112);
  }

  private createPowerUpHud() {
    (Object.keys(POWER_UP_META) as PowerUpType[]).forEach((type, index) => {
      const meta = POWER_UP_META[type];
      const x = 24 + index * 265;
      const container = this.add.container(x, 665).setDepth(120).setVisible(false);
      const panel = this.add.rectangle(0, 0, 245, 38, 0x0f172a, 0.9).setOrigin(0).setStrokeStyle(2, meta.color, 0.8);
      const icon = this.add.image(20, 18, meta.texture).setDisplaySize(34, 34);
      const label = this.add.text(41, 7, meta.label, { fontSize: '14px', color: '#ffffff', fontStyle: 'bold' });
      const rail = this.add.rectangle(41, 30, 149, 5, 0x334155, 1).setOrigin(0, 0.5);
      const bar = this.add.rectangle(41, 30, 149, 5, meta.color, 1).setOrigin(0, 0.5);
      const timeText = this.add.text(230, 19, '20.0', { fontSize: '12px', color: '#ffffff' }).setOrigin(1, 0.5);
      container.add([panel, icon, label, rail, bar, timeText]);
      this.powerUpHud.set(type, { container, bar, timeText });
    });

  }

  private bindInput() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.state === 'won' || this.state === 'failed') return;
      this.dragging = true;
      this.targetY = Phaser.Math.Clamp(pointer.y, TRACK_TOP + 55, TRACK_BOTTOM - 55);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.targetY = Phaser.Math.Clamp(pointer.y, TRACK_TOP + 55, TRACK_BOTTOM - 55);
    });
    this.input.on('pointerup', () => {
      this.dragging = false;
    });
  }

  update(time: number, delta: number) {
    if (this.state === 'won' || this.state === 'failed') return;
    const dt = Math.min(delta, 50) / 1000;
    if (this.cursors?.up.isDown) this.targetY -= 260 * dt;
    if (this.cursors?.down.isDown) this.targetY += 260 * dt;
    this.targetY = Phaser.Math.Clamp(this.targetY, TRACK_TOP + 55, TRACK_BOTTOM - 55);
    this.squadY = Phaser.Math.Linear(this.squadY, this.targetY, Math.min(1, dt * 8));
    this.formation.y = this.squadY;
    this.countText.setPosition(PLAYER_X, this.squadY - 95);

    if (this.state === 'running') this.runDistance += RUN_SPEED * dt;
    else if (this.state === 'combat') this.runDistance += RUN_SPEED * (this.activeCombat?.def.boss ? 0.12 : 0.3) * dt;
    this.updateCoursePositions();
    if (this.state === 'running') {
      const gateEngaged = this.updateGateFire(time);
      if (!gateEngaged) this.updateSwarmFire(time);
    }
    this.checkGates();
    this.checkObstacles();
    this.checkSwarmCollisions();
    this.checkPowerUpPickups(time);
    this.checkCombatStart();
    if (this.state === 'combat') this.updateCombat(time);
    this.updatePowerUps(time);
    this.progressBar.width = 330 * Phaser.Math.Clamp(this.runDistance / FINISH_DISTANCE, 0, 1);
  }

  private updateCoursePositions() {
    for (const gate of this.gates) {
      if (gate.used) continue;
      const x = PLAYER_X + gate.def.distance - this.runDistance;
      gate.upper.x = x;
      gate.lower.x = x;
    }
    for (const obstacle of this.obstacles) obstacle.x = PLAYER_X + Number(obstacle.getData('distance')) - this.runDistance;
    for (const combat of this.combats) combat.container.x = PLAYER_X + combat.def.distance - this.runDistance;
    for (const item of this.powerUps) item.container.x = PLAYER_X + item.distance - this.runDistance;
    for (const wave of this.swarms) {
      for (const unit of wave.units) {
        if (!unit.alive) continue;
        unit.sprite.x = PLAYER_X + unit.distance - this.runDistance;
        unit.sprite.y = unit.laneY + Math.sin((this.runDistance + unit.distance) * 0.025) * 5;
      }
    }
  }

  private checkPowerUpPickups(time: number) {
    for (const item of this.powerUps) {
      if (item.collected) continue;
      if (item.container.x < PLAYER_X - 90) {
        item.collected = true;
        this.tweens.killTweensOf(item.container);
        item.container.setVisible(false);
        continue;
      }
      if (Math.abs(item.container.x - PLAYER_X) > 52 || Math.abs(item.container.y - this.squadY) > 78) continue;
      item.collected = true;
      this.activePowerUps.set(item.type, time + POWER_UP_DURATION);
      this.showPowerUpEvent(item.type);
      this.tweens.killTweensOf(item.container);
      this.tweens.add({
        targets: item.container,
        scale: 1.8,
        alpha: 0,
        duration: 180,
        onComplete: () => item.container.setVisible(false),
      });
      this.cameras.main.flash(90, 255, 245, 180, false);
    }
  }

  private updatePowerUps(time: number) {
    for (const type of Object.keys(POWER_UP_META) as PowerUpType[]) {
      const expiresAt = this.activePowerUps.get(type) ?? 0;
      const remaining = Math.max(0, expiresAt - time);
      const hud = this.powerUpHud.get(type);
      if (!hud) continue;
      if (remaining <= 0) {
        if (expiresAt > 0) this.activePowerUps.delete(type);
        hud.container.setVisible(false);
        continue;
      }
      hud.container.setVisible(true);
      hud.bar.width = 149 * (remaining / POWER_UP_DURATION);
      hud.timeText.setText((remaining / 1000).toFixed(1));
    }
  }

  private hasPowerUp(type: PowerUpType) {
    return this.activePowerUps.has(type);
  }

  private showPowerUpEvent(type: PowerUpType) {
    const meta = POWER_UP_META[type];
    const panel = this.add.container(WIDTH / 2, 150).setDepth(180).setScale(0.75).setAlpha(0);
    const glow = this.add.circle(-150, 0, 58, meta.color, 0.28);
    const bg = this.add.rectangle(0, 0, 470, 104, 0x0f172a, 0.95).setStrokeStyle(4, meta.color, 0.95);
    const icon = this.add.image(-150, 0, meta.texture).setDisplaySize(92, 92);
    const acquired = this.add.text(-82, -34, 'ITEM ACQUIRED', { fontSize: '12px', color: '#cbd5e1', fontStyle: 'bold', letterSpacing: 2 });
    const title = this.add.text(-82, -12, meta.label, { fontFamily: 'Arial Black, sans-serif', fontSize: '25px', color: '#ffffff' });
    const effect = this.add.text(-82, 24, `${meta.effect} · 20초`, { fontSize: '16px', color: Phaser.Display.Color.IntegerToColor(meta.color).rgba });
    panel.add([bg, glow, icon, acquired, title, effect]);
    this.tweens.add({
      targets: panel,
      scale: 1,
      alpha: 1,
      duration: 170,
      ease: 'Back.easeOut',
      onComplete: () => this.tweens.add({
        targets: panel,
        y: 125,
        alpha: 0,
        delay: 950,
        duration: 260,
        onComplete: () => panel.destroy(),
      }),
    });
    this.tweens.killTweensOf(this.formation);
    this.tweens.add({ targets: this.formation, scale: 1.12, duration: 100, yoyo: true, ease: 'Quad.easeOut' });
  }

  private checkGates() {
    for (const gate of this.gates) {
      if (gate.used || gate.upper.x > PLAYER_X + 18) continue;
      gate.used = true;
      const useUpper = this.squadY < 370;
      const rule = useUpper ? gate.def.upper : gate.def.lower;
      const before = this.actualCount;
      this.actualCount = applyGate(this.actualCount, rule);
      this.maxCount = Math.max(this.maxCount, this.actualCount);
      gate.upper.setAlpha(useUpper ? 1 : 0.22);
      gate.lower.setAlpha(useUpper ? 0.22 : 1);
      this.flashChoice(`${before.toLocaleString('ko-KR')} ${gateLabel(rule)} → ${this.actualCount.toLocaleString('ko-KR')}`);
      this.statusText.setText('다음 목표로 전진');
      this.refreshCount();
      this.animateGatePass(gate, useUpper);
    }
  }

  private animateGatePass(gate: GateVisual, useUpper: boolean) {
    const selected = useUpper ? gate.upper : gate.lower;
    const skipped = useUpper ? gate.lower : gate.upper;

    this.tweens.killTweensOf(this.formation);
    this.formation.setScale(1);
    this.tweens.add({
      targets: this.formation,
      scaleX: 1.09,
      scaleY: 1.09,
      duration: 95,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    this.tweens.add({
      targets: this.countText,
      scaleX: 1.24,
      scaleY: 1.24,
      duration: 110,
      yoyo: true,
      ease: 'Back.easeOut',
    });
    this.tweens.add({
      targets: selected,
      scaleX: 1.04,
      scaleY: 1.04,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeIn',
      onComplete: () => selected.destroy(true),
    });
    skipped.destroy(true);
  }

  private updateGateFire(time: number) {
    const gate = this.gates.find((item) => !item.used && item.upper.x >= PLAYER_X + 55 && item.upper.x <= 920);
    if (!gate) return false;

    const targets = [
      { upper: true, container: gate.upper, rule: gate.def.upper, text: gate.upperText },
      { upper: false, container: gate.lower, rule: gate.def.lower, text: gate.lowerText },
    ].sort((a, b) => Math.abs(this.squadY - a.container.y) - Math.abs(this.squadY - b.container.y));
    const selected = targets[0];
    if (Math.abs(this.squadY - selected.container.y) > 72) {
      this.statusText.setText('소대를 게이트 높이에 맞춰 전방 사격하세요');
      return false;
    }

    this.prepareFireMode('gate', time);
    if (time < this.nextShotAt) return true;

    const useUpper = selected.upper;
    const target = selected.container;
    const rule = selected.rule;
    const text = selected.text;
    const hitCount = useUpper ? ++gate.upperHits : ++gate.lowerHits;
    this.nextShotAt = time + (this.hasPowerUp('rapid') ? 42 : 90);
    this.statusText.setText(`${useUpper ? '상단' : '하단'} 게이트 집중사격`);

    if (rule.operation === 'add') rule.value += 10;
    else if (rule.operation === 'multiply' && hitCount % 8 === 0) rule.value += 1;
    else if (rule.operation === 'subtract') rule.value = Math.max(0, rule.value - 10);
    else if (rule.operation === 'divide' && hitCount % 8 === 0) rule.value = Math.max(1, rule.value - 1);

    text.setText(gateLabel(rule)).setScale(1.18).setColor('#fef08a');
    this.time.delayedCall(55, () => text.setScale(1).setColor('#ffffff'));
    this.spawnBullet(target.x - 8);
    return true;
  }

  private updateSwarmFire(time: number) {
    const candidates = this.swarms
      .flatMap((wave) => wave.units)
      .filter((unit) => (
        unit.alive
        && unit.sprite.x >= PLAYER_X + 70
        && unit.sprite.x <= 1020
        && Math.abs(unit.sprite.y - this.squadY) <= (this.hasPowerUp('spread') ? 126 : 42)
      ))
      .sort((a, b) => a.sprite.x - b.sprite.x);
    if (candidates.length === 0) return;

    this.prepareFireMode('swarm', time);
    if (time < this.nextShotAt) return;
    this.nextShotAt = time + (this.hasPowerUp('rapid') ? 39 : 82);
    const penetration = swarmPenetration(this.actualCount) * (this.hasPowerUp('penetration') ? 3 : 1);
    const victims = candidates.slice(0, penetration);
    const targetX = victims.reduce((sum, unit) => sum + unit.sprite.x, 0) / victims.length;
    this.spawnBullet(targetX);
    for (const victim of victims) this.destroySwarmUnit(victim);
    this.statusText.setText(`관통 사격  ${penetration}연속 파괴`);
  }

  private destroySwarmUnit(unit: SwarmUnit) {
    if (!unit.alive) return;
    unit.alive = false;
    this.combo += 1;
    this.comboText.setText(`${this.combo} COMBO`).setScale(1.18);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 90 });
    this.spawnToyDebris(unit.sprite.x, unit.sprite.y);
    this.tweens.add({
      targets: unit.sprite,
      scale: 1.8,
      angle: Phaser.Math.Between(-120, 120),
      alpha: 0,
      duration: 105,
      onComplete: () => unit.sprite.setVisible(false),
    });
  }

  private spawnToyDebris(x: number, y: number) {
    for (let i = 0; i < 4; i += 1) {
      const part = i % 2 === 0
        ? this.add.circle(x, y, Phaser.Math.Between(2, 4), 0xfbbf24).setDepth(45)
        : this.add.rectangle(x, y, Phaser.Math.Between(4, 8), 3, 0xb91c1c).setDepth(45);
      this.tweens.add({
        targets: part,
        x: x + Phaser.Math.Between(-34, 34),
        y: y + Phaser.Math.Between(-38, 32),
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: Phaser.Math.Between(160, 260),
        onComplete: () => part.destroy(),
      });
    }
  }

  private checkSwarmCollisions() {
    for (const wave of this.swarms) {
      if (wave.resolved) continue;
      const alive = wave.units.filter((unit) => unit.alive);
      if (alive.length === 0) {
        wave.resolved = true;
        this.flashChoice(`${wave.title} 완전 격파!  ${this.combo} COMBO`);
        this.cameras.main.flash(90, 255, 226, 120, false);
        continue;
      }
      const collided = alive.filter((unit) => unit.sprite.x <= PLAYER_X + 35);
      if (collided.length === 0) continue;
      const loss = alive.length;
      for (const unit of alive) {
        unit.alive = false;
        unit.sprite.setVisible(false);
      }
      wave.resolved = true;
      this.actualCount = Math.max(0, this.actualCount - loss);
      this.refreshCount();
    }
  }

  private checkObstacles() {
    for (const obstacle of this.obstacles) {
      if (obstacle.getData('used') || obstacle.x > PLAYER_X + 30) continue;
      obstacle.setData('used', true);
      if (Math.abs(this.squadY - obstacle.y) < 95) {
        const loss = Number(obstacle.getData('loss'));
        this.actualCount = Math.max(0, this.actualCount - loss);
        this.cameras.main.shake(140, 0.008);
        this.flashChoice(`장애물 충돌  −${loss}`);
        this.refreshCount();
      } else {
        obstacle.setAlpha(0.3);
      }
    }
  }

  private checkCombatStart() {
    if (this.state !== 'running') return;
    const combat = this.combats.find((item) => !item.used && item.container.x <= 790);
    if (!combat) return;
    this.activeCombat = combat;
    this.state = 'combat';
    this.statusText.setText(combat.def.boss ? '결승 요새 공격!' : '적 웨이브 교전');
  }

  private updateCombat(time: number) {
    const combat = this.activeCombat;
    if (!combat) return;
    const isAimed = Math.abs(this.squadY - combat.container.y) <= 68;
    if (!isAimed) this.statusText.setText('상하 이동으로 적을 조준하세요');
    if (isAimed) this.prepareFireMode('combat', time);
    if (time >= this.nextShotAt && isAimed) {
      this.nextShotAt = time + (this.hasPowerUp('rapid') ? 42 : 90);
      const damage = Math.max(3, Math.ceil(this.actualCount / 38));
      combat.health = Math.max(0, combat.health - damage);
      combat.healthText.setText(combat.health.toLocaleString('ko-KR'));
      this.spawnBullet(combat.container.x - 55);
      combat.container.setScale(0.98);
      this.time.delayedCall(45, () => combat.container.setScale(1));
      this.statusText.setText(combat.def.boss ? '결승 요새 집중사격!' : '정예 적 집중사격');
    }
    if (time >= this.nextEnemyHitAt && combat.health > 0) {
      this.nextEnemyHitAt = time + (combat.def.boss ? 420 : 650);
      const loss = combat.def.boss ? 7 : 3;
      this.actualCount = Math.max(0, this.actualCount - loss);
      this.refreshCount();
      this.cameras.main.shake(55, 0.0025);
    }
    if (this.actualCount <= 0) {
      this.finish(false);
      return;
    }
    if (combat.health <= 0) {
      combat.used = true;
      combat.container.setVisible(false);
      this.activeCombat = null;
      if (combat.def.boss) this.finish(true);
      else {
        this.state = 'running';
        this.statusText.setText('게이트를 선택하세요');
        this.flashChoice('태엽 잡병 격파!');
      }
    }
  }

  private spawnBullet(targetX: number) {
    const armyScale = Math.log2(Math.max(1, this.actualCount) / 50 + 1);
    const volleySize = Phaser.Math.Clamp(Math.ceil(6 + armyScale * 7), 8, 32);
    const muzzleCount = Phaser.Math.Clamp(Math.ceil(volleySize / 8), 2, 7);
    const spreadMultiplier = this.hasPowerUp('spread') ? 3 : 1;

    for (let i = 0; i < muzzleCount; i += 1) {
      const flash = this.add.circle(
        PLAYER_X + Phaser.Math.Between(22, 72),
        this.squadY + Phaser.Math.Between(-58, 58) * spreadMultiplier,
        Phaser.Math.Between(5, 10),
        0xfff7ae,
        0.95,
      ).setDepth(41);
      this.tweens.add({
        targets: flash,
        scale: 2.4,
        alpha: 0,
        duration: 65,
        onComplete: () => flash.destroy(),
      });
    }

    const impactRing = this.add.circle(targetX, this.squadY, 12, 0xffffff, 0)
      .setStrokeStyle(4, 0xfacc15, 0.9)
      .setDepth(42);
    this.tweens.add({
      targets: impactRing,
      scale: 2.8,
      alpha: 0,
      duration: 130,
      onComplete: () => impactRing.destroy(),
    });
    this.cameras.main.shake(35, 0.0012 + volleySize * 0.000015);

    for (let i = 0; i < volleySize; i += 1) {
      const rowSpread = ((i % 9) - 4) * 7 * spreadMultiplier;
      const fromX = PLAYER_X + Phaser.Math.Between(-48, 72);
      const fromY = this.squadY + rowSpread + Phaser.Math.Between(-4, 4);
      const tracer = this.add.rectangle(
        fromX,
        fromY,
        Phaser.Math.Between(18, 34),
        Phaser.Math.Between(2, 4),
        i % 9 === 0 ? 0xfb923c : 0xfef08a,
        Phaser.Math.FloatBetween(0.72, 1),
      )
        .setOrigin(0.5)
        .setDepth(40);
      this.tweens.add({
        targets: tracer,
        x: targetX,
        duration: Phaser.Math.Between(65, 115),
        delay: (i % 8) * 4,
        onComplete: () => {
          if (i % 7 === 0) this.spawnImpactSpark(targetX, fromY);
          tracer.destroy();
        },
      });
    }
  }

  private spawnImpactSpark(x: number, y: number) {
    const spark = this.add.star(x, y, 5, 3, Phaser.Math.Between(8, 14), 0xfef08a, 0.95).setDepth(43);
    this.tweens.add({
      targets: spark,
      scale: 2,
      angle: Phaser.Math.Between(-80, 80),
      alpha: 0,
      duration: 90,
      onComplete: () => spark.destroy(),
    });
  }

  private refreshCount() {
    this.countText.setText(this.actualCount.toLocaleString('ko-KR'));
    this.redrawFormation();
    if (this.actualCount <= 0) this.finish(false);
  }

  private flashChoice(message: string) {
    this.choiceText.setText(message).setAlpha(1).setScale(1.08);
    this.tweens.killTweensOf(this.choiceText);
    this.tweens.add({ targets: this.choiceText, alpha: 0, scale: 1, delay: 900, duration: 300 });
  }

  private finish(won: boolean) {
    if (this.state === 'won' || this.state === 'failed') return;
    this.state = won ? 'won' : 'failed';
    const overlay = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0f172a, 0.76).setDepth(200);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 580, 390, 0x172554, 0.97).setStrokeStyle(4, won ? 0xfacc15 : 0xf87171).setDepth(201);
    const title = this.add.text(WIDTH / 2, 215, won ? `${this.stage.bossName} 격파!` : '소대 전멸', { fontFamily: 'Arial Black, sans-serif', fontSize: '36px', color: won ? '#fde68a' : '#fecaca' }).setOrigin(0.5).setDepth(202);
    const summary = this.add.text(WIDTH / 2, 310, `${this.stage.chapter}-${this.stage.stage} ${this.stage.title}\n최종 병력  ${this.actualCount.toLocaleString('ko-KR')}명\n최대 병력  ${this.maxCount.toLocaleString('ko-KR')}명`, { fontSize: '21px', color: '#e2e8f0', align: 'center', lineSpacing: 10 }).setOrigin(0.5).setDepth(202);
    const retryButton = this.add.rectangle(WIDTH / 2 - 125, 470, 210, 58, won ? 0x22c55e : 0x2563eb).setStrokeStyle(3, 0xffffff, 0.75).setInteractive({ useHandCursor: true }).setDepth(202);
    const retryText = this.add.text(WIDTH / 2 - 125, 470, won ? '다시 도전' : '즉시 재시작', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(203);
    const leaveButton = this.add.rectangle(WIDTH / 2 + 125, 470, 210, 58, 0x475569).setStrokeStyle(3, 0xffffff, 0.75).setInteractive({ useHandCursor: true }).setDepth(202);
    const leaveText = this.add.text(WIDTH / 2 + 125, 470, '스테이지 선택', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(203);
    retryButton.on('pointerdown', () => this.scene.restart());
    leaveButton.on('pointerdown', () => this.onLeave?.());
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.restart());
    overlay.setInteractive();
    this.onComplete?.({ stageId: this.stage.id, won, finalCount: this.actualCount, maxCount: this.maxCount });
    void panel;
    void title;
    void summary;
    void retryText;
    void leaveText;
  }

  private prepareFireMode(mode: 'gate' | 'swarm' | 'combat', time: number) {
    if (this.fireMode === mode) return;
    this.fireMode = mode;
    // 새 표적군을 포착할 때 이전 표적의 발사 대기시간을 물려받지 않는다.
    // 12ms는 같은 프레임 중복 발사만 막고 체감상 즉시 사격을 이어 준다.
    this.nextShotAt = Math.min(this.nextShotAt, time + 12);
  }
}
