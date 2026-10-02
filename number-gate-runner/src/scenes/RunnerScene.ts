import Phaser from 'phaser';
import { applyGate, gateLabel, swarmPenetration } from '../model';
import type { GateRule } from '../model';
import type { RunnerResult } from '../game';
import { RUNNER_STAGES, type RunnerStage } from '../stages';
import heroCommanderUrl from '../assets/units/hero-commander-back.png';
import squadRiflemanUrl from '../assets/units/squad-rifleman-back.png';
import numberGateUrl from '../assets/world/number-gate-3d.png';
import clockworkGruntUrl from '../assets/enemies/clockwork-grunt.png';
import siegeTankUrl from '../assets/enemies/siege-tank.png';
import playroomBackgroundUrl from '../assets/backgrounds/playroom-runner-v2.jpg';
import kitchenBackgroundUrl from '../assets/backgrounds/kitchen-runner-v2.jpg';
import spreadMagazineUrl from '../assets/items/spread-magazine.png';
import penetrationRoundUrl from '../assets/items/penetration-round.png';
import rapidDrumUrl from '../assets/items/rapid-drum.png';
import blockGateBossUrl from '../assets/bosses/boss-1-1-block-gate.png';
import giantTeddyBossUrl from '../assets/bosses/boss-1-2-giant-teddy.png';
import locomotiveFortressBossUrl from '../assets/bosses/boss-1-3-locomotive-fortress.png';
import championTruckBossUrl from '../assets/bosses/boss-1-4-champion-truck.png';
import mechaTiranoBossUrl from '../assets/bosses/boss-1-5-mecha-tirano.png';
import pirateCannonBossUrl from '../assets/bosses/boss-1-6-pirate-cannon.png';
import tyrantTrexBossUrl from '../assets/bosses/boss-1-7-tyrant-trex.png';
import carouselFortressBossUrl from '../assets/bosses/boss-1-8-carousel-fortress.png';
import goldenGolemBossUrl from '../assets/bosses/boss-1-9-golden-golem.png';
import toyKingGateBossUrl from '../assets/bosses/boss-1-10-toy-king-gate.png';

const WIDTH = 720;
const HEIGHT = 1280;
const PLAYER_Y = 1030;
const TRACK_LEFT = 75;
const TRACK_RIGHT = 645;
const LANE_X = [150, 360, 570] as const;
const RUN_SPEED = 210;
const FINISH_DISTANCE = 5200;
const POWER_UP_DURATION = 20_000;
const PLAYROOM_BOSS_TEXTURES = [
  'boss-1-1-block-gate',
  'boss-1-2-giant-teddy',
  'boss-1-3-locomotive-fortress',
  'boss-1-4-champion-truck',
  'boss-1-5-mecha-tirano',
  'boss-1-6-pirate-cannon',
  'boss-1-7-tyrant-trex',
  'boss-1-8-carousel-fortress',
  'boss-1-9-golden-golem',
  'boss-1-10-toy-king-gate',
] as const;
type PlayroomBossTexture = typeof PLAYROOM_BOSS_TEXTURES[number];

type PowerUpType = 'spread' | 'penetration' | 'rapid';

const POWER_UP_META: Record<PowerUpType, { label: string; effect: string; texture: string; color: number }> = {
  spread: { label: '확산 탄창', effect: '가로 사격 범위 3배', texture: 'item-spread-magazine', color: 0x38bdf8 },
  penetration: { label: '관통탄', effect: '잡몹 관통력 3배', texture: 'item-penetration-round', color: 0xfacc15 },
  rapid: { label: '고속 장전', effect: '연사 속도 2배', texture: 'item-rapid-drum', color: 0xfb7185 },
};

interface GatePairDef {
  distance: number;
  left: GateRule;
  center: GateRule;
  right: GateRule;
}

interface GateVisual {
  def: GatePairDef;
  lanes: Array<{ container: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text; rule: GateRule; hits: number }>;
  used: boolean;
}

interface CombatDef {
  distance: number;
  strength: number;
  title: string;
  boss?: boolean;
  sprite?: 'clockwork-grunt' | 'siege-tank' | PlayroomBossTexture;
  lane?: 0 | 1 | 2;
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
  laneX: number;
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
  private squadX = WIDTH / 2;
  private targetX = WIDTH / 2;
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
    this.load.image('squad-rifleman', squadRiflemanUrl);
    this.load.image('number-gate-3d', numberGateUrl);
    this.load.image('clockwork-grunt', clockworkGruntUrl);
    this.load.image('siege-tank', siegeTankUrl);
    this.load.image('background-playroom', playroomBackgroundUrl);
    this.load.image('background-kitchen', kitchenBackgroundUrl);
    this.load.image('item-spread-magazine', spreadMagazineUrl);
    this.load.image('item-penetration-round', penetrationRoundUrl);
    this.load.image('item-rapid-drum', rapidDrumUrl);
    this.load.image('boss-1-1-block-gate', blockGateBossUrl);
    this.load.image('boss-1-2-giant-teddy', giantTeddyBossUrl);
    this.load.image('boss-1-3-locomotive-fortress', locomotiveFortressBossUrl);
    this.load.image('boss-1-4-champion-truck', championTruckBossUrl);
    this.load.image('boss-1-5-mecha-tirano', mechaTiranoBossUrl);
    this.load.image('boss-1-6-pirate-cannon', pirateCannonBossUrl);
    this.load.image('boss-1-7-tyrant-trex', tyrantTrexBossUrl);
    this.load.image('boss-1-8-carousel-fortress', carouselFortressBossUrl);
    this.load.image('boss-1-9-golden-golem', goldenGolemBossUrl);
    this.load.image('boss-1-10-toy-king-gate', toyKingGateBossUrl);
  }

  create() {
    this.runDistance = 0;
    this.squadX = WIDTH / 2;
    this.targetX = WIDTH / 2;
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
      .setDisplaySize(1280, 1280)
      .setDepth(0);
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0b1424, this.stage.chapter === 1 ? 0.14 : 0.2).setDepth(1);

    const track = this.add.graphics().setDepth(2);
    track.fillStyle(this.stage.chapter === 1 ? 0x172033 : 0x3b241c, 0.14);
    track.beginPath();
    track.moveTo(TRACK_LEFT, 1180);
    track.lineTo(TRACK_RIGHT, 1180);
    track.lineTo(565, 115);
    track.lineTo(155, 115);
    track.closePath();
    track.fillPath();
    track.lineStyle(3, Phaser.Display.Color.HexStringToColor(this.stage.accent).color, 0.72);
    track.strokePath();
    this.add.text(WIDTH - 24, 94, `${this.stage.chapter}-${this.stage.stage}  ${this.stage.title}`, {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#ffffff',
      backgroundColor: '#0f172ab8', padding: { x: 12, y: 7 },
    }).setOrigin(1, 0).setDepth(4);
  }

  private createCourse() {
    const threat = this.stage.threat;
    const itemOrder: PowerUpType[] = ['spread', 'penetration', 'rapid'];
    const rotation = (this.stage.id - 1) % itemOrder.length;
    const stageItems = [...itemOrder.slice(rotation), ...itemOrder.slice(0, rotation)];
    this.addGatePair({ distance: 520, left: { operation: 'add', value: 45 + threat * 8 }, center: { operation: 'add', value: 70 + threat * 11 }, right: { operation: 'add', value: 90 + threat * 15 } });
    this.addPowerUp(820, LANE_X[1], stageItems[0]);
    this.addSwarm(1050, 28 + threat * 3, `${this.stage.enemyGroup} 선발대`);
    this.addObstacle(1580, LANE_X[2], 30 + threat * 4);
    this.addGatePair({ distance: 1980, left: { operation: 'add', value: 120 + threat * 18 }, center: { operation: 'multiply', value: 2 }, right: { operation: 'multiply', value: threat >= 8 ? 3 : 2 } });
    this.addPowerUp(2240, this.stage.stage % 2 === 0 ? LANE_X[0] : LANE_X[2], stageItems[1]);
    this.addSwarm(2520, 42 + threat * 4, `${this.stage.enemyGroup} 대군`);
    this.addCombat({ distance: 3260, strength: 210 + threat * 42, title: `${this.stage.title} 중간 수문장`, sprite: 'siege-tank', lane: (this.stage.id % 3) as 0 | 1 | 2 });
    this.addSwarm(3850, 55 + threat * 5, `${this.stage.enemyGroup} 총공세`);
    this.addPowerUp(4080, this.stage.stage % 2 === 0 ? LANE_X[2] : LANE_X[0], stageItems[2]);
    this.addGatePair({ distance: 4300, left: { operation: 'add', value: 220 + threat * 24 }, center: { operation: 'multiply', value: 2 }, right: { operation: 'multiply', value: threat >= 12 ? 3 : 2 } });
    this.addCombat({
      distance: 5000,
      strength: 500 + threat * 62,
      title: this.stage.bossName,
      boss: true,
      sprite: this.stage.chapter === 1 ? PLAYROOM_BOSS_TEXTURES[this.stage.stage - 1] : undefined,
      lane: 1,
    });
  }

  private addPowerUp(distance: number, x: number, type: PowerUpType) {
    const meta = POWER_UP_META[type];
    const container = this.add.container(x, -180).setDepth(28);
    const glow = this.add.circle(0, 0, 53, meta.color, 0.18).setStrokeStyle(3, meta.color, 0.72);
    const itemImage = this.add.image(0, 0, meta.texture).setDisplaySize(96, 96);
    const label = this.add.text(0, 62, meta.label, {
      fontSize: '14px', color: '#ffffff', backgroundColor: '#0f172ad9', padding: { x: 8, y: 4 },
    }).setOrigin(0.5);
    container.add([glow, itemImage, label]);
    this.tweens.add({ targets: glow, scale: 1.18, alpha: 0.42, duration: 620, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: container, x: x - 8, duration: 760, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.powerUps.push({ type, distance, container, collected: false });
  }

  private addSwarm(distance: number, count: number, title: string) {
    const units: SwarmUnit[] = [];
    for (let i = 0; i < count; i += 1) {
      const column = Math.floor(i / 3);
      const row = i % 3;
      const laneX = LANE_X[row] + Phaser.Math.Between(-34, 34);
      const unitDistance = distance + column * 54 + Phaser.Math.Between(-18, 18);
      const size = Phaser.Math.Between(30, 39);
      const sprite = this.add.image(laneX, -180, 'clockwork-grunt')
        .setDisplaySize(size, Math.round(size * 0.83))
        .setDepth(14 + row);
      units.push({ sprite, distance: unitDistance, laneX, alive: true });
    }
    this.swarms.push({ title, units, resolved: false });
  }

  private addGatePair(def: GatePairDef) {
    const rules = [def.left, def.center, def.right];
    const lanes = rules.map((rule, index) => {
      const gate = this.makeGate(rule, LANE_X[index]);
      return { container: gate.container, text: gate.text, rule, hits: 0 };
    });
    this.gates.push({
      def,
      lanes,
      used: false,
    });
  }

  private makeGate(rule: GateRule, x: number) {
    const container = this.add.container(x, -180);
    const shadow = this.add.ellipse(0, 70, 180, 27, 0x0f172a, 0.32);
    const gate = this.add.image(0, 0, 'number-gate-3d').setDisplaySize(160, 154);
    const text = this.add.text(0, -48, gateLabel(rule), {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '29px',
      color: '#ffffff',
      stroke: '#061b35',
      strokeThickness: 7,
    }).setOrigin(0.5);
    container.add([shadow, gate, text]);
    return { container, text };
  }

  private addObstacle(distance: number, x: number, loss: number) {
    const container = this.add.container(x, -180).setData({ distance, loss, used: false });
    const shadow = this.add.ellipse(0, 26, 145, 34, 0x0f172a, 0.3);
    const block = this.add.rectangle(0, 0, 120, 72, 0xf97316).setStrokeStyle(4, 0xffedd5);
    const stripeA = this.add.rectangle(-28, 0, 12, 70, 0x1f2937).setAngle(-20);
    const stripeB = this.add.rectangle(25, 0, 12, 70, 0x1f2937).setAngle(-20);
    const text = this.add.text(0, -55, `충돌 −${loss}`, { fontSize: '18px', color: '#7c2d12', backgroundColor: '#ffedd5', padding: { x: 8, y: 4 } }).setOrigin(0.5);
    container.add([shadow, block, stripeA, stripeB, text]);
    this.obstacles.push(container);
  }

  private addCombat(def: CombatDef) {
    const container = this.add.container(LANE_X[def.lane ?? 1], -220);
    const scale = def.boss ? 1.45 : 1;
    const isPlayroomBoss = def.sprite?.startsWith('boss-1-') ?? false;
    const shadowWidth = isPlayroomBoss ? 285 : def.sprite === 'siege-tank' ? 230 : 145;
    const shadow = this.add.ellipse(0, isPlayroomBoss ? 116 : 68 * scale, shadowWidth, isPlayroomBoss ? 45 : 34, 0x0f172a, 0.38);
    let enemy: Phaser.GameObjects.GameObject;
    if (def.sprite) {
      const enemyWidth = isPlayroomBoss ? 290 : def.sprite === 'siege-tank' ? 245 : 165;
      const enemyHeight = isPlayroomBoss ? 290 : def.sprite === 'siege-tank' ? 163 : 138;
      enemy = this.add.image(0, isPlayroomBoss ? -18 : 0, def.sprite).setDisplaySize(enemyWidth, enemyHeight);
    } else {
      enemy = this.add.rectangle(0, 0, 130 * scale, 120 * scale, 0x7c3aed).setStrokeStyle(5, 0xf8fafc, 0.7);
    }
    const title = this.add.text(0, -105 * scale, def.title, { fontSize: def.boss ? '24px' : '20px', color: '#3f1d1d', backgroundColor: '#fff7ed', padding: { x: 10, y: 5 } }).setOrigin(0.5);
    const healthText = this.add.text(0, 104 * scale, def.strength.toLocaleString('ko-KR'), { fontFamily: 'Arial Black, sans-serif', fontSize: def.boss ? '28px' : '22px', color: '#ffffff', stroke: '#111827', strokeThickness: 5 }).setOrigin(0.5);
    container.add([shadow, enemy, title, healthText]);
    this.combats.push({ def, container, health: def.strength, healthText, used: false });
  }

  private createFormation() {
    this.formation = this.add.container(this.squadX, PLAYER_Y);
    this.redrawFormation();
  }

  private redrawFormation() {
    this.formation.removeAll(true);
    // 실제 병력 20명당 화면에는 대표 소대원 1명을 표시한다.
    // 전투 계산은 실제 병력을 그대로 사용하고 시각 밀도만 축소한다.
    const visibleUnits = Phaser.Math.Clamp(Math.ceil(this.actualCount / 20), 1, 30);
    const formationProgress = Phaser.Math.Clamp(this.actualCount / 50, 0, 1);
    const soldierSize = 140; // 영웅(175px)의 80%
    const outerCount = Math.min(visibleUnits, 14);
    const outerRadius = visibleUnits <= 6 ? 158 : visibleUnits <= 10 ? 215 : 270;

    for (let i = 0; i < outerCount; i += 1) {
      const denominator = formationProgress >= 1 ? outerCount : Math.max(1, outerCount - 1);
      const angle = -Math.PI / 2 + (i / denominator) * Math.PI * 2 * formationProgress;
      this.addFormationSoldier(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius + 8, soldierSize);
    }

    const remaining = visibleUnits - outerCount;
    const ringCapacities = [10, 6];
    const ringRadii = [175, 108];
    let placed = 0;
    for (let ring = 0; ring < ringCapacities.length && placed < remaining; ring += 1) {
      const count = Math.min(ringCapacities[ring], remaining - placed);
      const radius = ringRadii[ring];
      for (let slot = 0; slot < count; slot += 1) {
        const angle = -Math.PI / 2 + (slot / count) * Math.PI * 2 + (ring % 2) * 0.14;
        this.addFormationSoldier(Math.cos(angle) * radius, Math.sin(angle) * radius + 8, soldierSize);
      }
      placed += count;
    }
    this.addHeroToFormation(0);
    this.formation.setDepth(20);
  }

  private addFormationSoldier(x: number, y: number, size: number) {
    const soldier = this.add.image(x, y, 'squad-rifleman')
      .setDisplaySize(size, size)
      .setOrigin(0.5);
    this.formation.add(soldier);
  }

  private addHeroToFormation(heroX: number) {
    const heroY = 0;
    const shadow = this.add.ellipse(heroX + 2, heroY + 48, 112, 30, 0x0f172a, 0.42);
    const hero = this.add.image(heroX, heroY - 8, 'hero-commander')
      .setDisplaySize(175, 175)
      .setOrigin(0.5, 0.58);
    this.formation.add([shadow, hero]);
  }

  private createHud() {
    this.add.rectangle(0, 0, WIDTH, 108, 0x0f172a, 0.9).setOrigin(0).setDepth(100);
    this.add.text(24, 14, `CHAPTER ${this.stage.chapter} · STAGE ${this.stage.chapter}-${this.stage.stage}`, { fontSize: '20px', color: '#f8fafc', fontStyle: 'bold' }).setDepth(101);
    this.add.text(24, 46, `${this.stage.title} · ${this.stage.route}`, { fontSize: '15px', color: this.stage.accent }).setDepth(101);
    this.countText = this.add.text(WIDTH / 2, PLAYER_Y - 155, this.stage.startCount.toLocaleString('ko-KR'), { fontFamily: 'Arial Black, sans-serif', fontSize: '34px', color: '#ffffff', stroke: '#1e3a8a', strokeThickness: 7 }).setOrigin(0.5).setDepth(101);
    this.add.rectangle(370, 29, 320, 12, 0x334155).setOrigin(0, 0.5).setDepth(101);
    this.progressBar = this.add.rectangle(370, 29, 0, 12, 0x38bdf8).setOrigin(0, 0.5).setDepth(102);
    this.statusText = this.add.text(530, 55, `${this.stage.bossName}까지 전진`, { fontSize: '14px', color: '#cbd5e1' }).setOrigin(0.5).setDepth(102);
    this.choiceText = this.add.text(WIDTH / 2, 140, '', { fontSize: '22px', color: '#ffffff', backgroundColor: '#0f172acc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setDepth(110).setAlpha(0);
    this.comboText = this.add.text(WIDTH - 24, 132, '', { fontFamily: 'Arial Black, sans-serif', fontSize: '24px', color: '#fef08a', stroke: '#7c2d12', strokeThickness: 6 }).setOrigin(1, 0.5).setDepth(112);
  }

  private createPowerUpHud() {
    (Object.keys(POWER_UP_META) as PowerUpType[]).forEach((type, index) => {
      const meta = POWER_UP_META[type];
      const x = 12 + index * 235;
      const container = this.add.container(x, 1228).setDepth(120).setVisible(false);
      const panel = this.add.rectangle(0, 0, 225, 38, 0x0f172a, 0.9).setOrigin(0).setStrokeStyle(2, meta.color, 0.8);
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
      this.targetX = this.nearestLane(pointer.x);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      this.targetX = this.nearestLane(pointer.x);
    });
    this.input.on('pointerup', () => {
      this.dragging = false;
    });
  }

  update(time: number, delta: number) {
    if (this.state === 'won' || this.state === 'failed') return;
    const dt = Math.min(delta, 50) / 1000;
    if (this.cursors && Phaser.Input.Keyboard.JustDown(this.cursors.left)) this.targetX = LANE_X[Math.max(0, this.currentLaneIndex() - 1)];
    if (this.cursors && Phaser.Input.Keyboard.JustDown(this.cursors.right)) this.targetX = LANE_X[Math.min(2, this.currentLaneIndex() + 1)];
    this.squadX = Phaser.Math.Linear(this.squadX, this.targetX, Math.min(1, dt * 10));
    this.formation.x = this.squadX;
    this.countText.setPosition(this.squadX, PLAYER_Y - 155);

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
    this.progressBar.width = 320 * Phaser.Math.Clamp(this.runDistance / FINISH_DISTANCE, 0, 1);
  }

  private nearestLane(x: number) {
    return LANE_X.reduce((nearest, lane) => Math.abs(lane - x) < Math.abs(nearest - x) ? lane : nearest, LANE_X[0]);
  }

  private currentLaneIndex() {
    return LANE_X.reduce((best, lane, index) => Math.abs(lane - this.targetX) < Math.abs(LANE_X[best] - this.targetX) ? index : best, 0);
  }

  private updateCoursePositions() {
    for (const gate of this.gates) {
      if (gate.used) continue;
      const y = PLAYER_Y - gate.def.distance + this.runDistance;
      for (const lane of gate.lanes) {
        lane.container.y = y;
        lane.container.setScale(this.approachScale(y));
      }
    }
    for (const obstacle of this.obstacles) {
      obstacle.y = PLAYER_Y - Number(obstacle.getData('distance')) + this.runDistance;
      if (!obstacle.getData('used')) obstacle.setScale(this.approachScale(obstacle.y));
    }
    for (const combat of this.combats) {
      combat.container.y = PLAYER_Y - combat.def.distance + this.runDistance;
      if (!combat.used) combat.container.setScale(this.approachScale(combat.container.y, combat.def.boss ? 1.08 : 1));
    }
    for (const item of this.powerUps) {
      if (item.collected) continue;
      item.container.y = PLAYER_Y - item.distance + this.runDistance;
      item.container.setScale(this.approachScale(item.container.y, 0.92));
    }
    for (const wave of this.swarms) {
      for (const unit of wave.units) {
        if (!unit.alive) continue;
        unit.sprite.x = unit.laneX + Math.sin((this.runDistance + unit.distance) * 0.025) * 5;
        unit.sprite.y = PLAYER_Y - unit.distance + this.runDistance;
        unit.sprite.setScale(this.approachScale(unit.sprite.y, 0.95));
      }
    }
  }

  private approachScale(y: number, maximum = 1) {
    const progress = Phaser.Math.Clamp((y - 110) / (PLAYER_Y - 110), 0, 1);
    return Phaser.Math.Linear(0.48, maximum, progress);
  }

  private checkPowerUpPickups(time: number) {
    for (const item of this.powerUps) {
      if (item.collected) continue;
      if (item.container.y > PLAYER_Y + 90) {
        item.collected = true;
        this.tweens.killTweensOf(item.container);
        item.container.setVisible(false);
        continue;
      }
      if (Math.abs(item.container.y - PLAYER_Y) > 60 || Math.abs(item.container.x - this.squadX) > 82) continue;
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
      const gateY = gate.lanes[0].container.y;
      if (gate.used || gateY < PLAYER_Y - 18) continue;
      gate.used = true;
      const laneIndex = this.currentLaneIndex();
      const rule = gate.lanes[laneIndex].rule;
      const before = this.actualCount;
      this.actualCount = applyGate(this.actualCount, rule);
      this.maxCount = Math.max(this.maxCount, this.actualCount);
      gate.lanes.forEach((lane, index) => lane.container.setAlpha(index === laneIndex ? 1 : 0.22));
      this.flashChoice(`${before.toLocaleString('ko-KR')} ${gateLabel(rule)} → ${this.actualCount.toLocaleString('ko-KR')}`);
      this.statusText.setText('다음 목표로 전진');
      this.refreshCount();
      this.animateGatePass(gate, laneIndex);
    }
  }

  private animateGatePass(gate: GateVisual, laneIndex: number) {
    const selected = gate.lanes[laneIndex].container;

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
    gate.lanes.forEach((lane, index) => {
      if (index !== laneIndex) lane.container.destroy(true);
    });
  }

  private updateGateFire(time: number) {
    const gate = this.gates.find((item) => {
      const y = item.lanes[0].container.y;
      return !item.used && y >= 160 && y <= PLAYER_Y - 70;
    });
    if (!gate) return false;

    const selected = [...gate.lanes].sort((a, b) => Math.abs(this.squadX - a.container.x) - Math.abs(this.squadX - b.container.x))[0];
    if (Math.abs(this.squadX - selected.container.x) > 82) {
      this.statusText.setText('좌·중앙·우 구획을 선택해 전방 사격하세요');
      return false;
    }

    this.prepareFireMode('gate', time);
    if (time < this.nextShotAt) return true;

    const target = selected.container;
    const rule = selected.rule;
    const text = selected.text;
    const hitCount = ++selected.hits;
    this.nextShotAt = time + (this.hasPowerUp('rapid') ? 42 : 90);
    this.statusText.setText(`${this.currentLaneIndex() === 0 ? '좌측' : this.currentLaneIndex() === 1 ? '중앙' : '우측'} 게이트 집중사격`);

    if (rule.operation === 'add') rule.value += 10;
    else if (rule.operation === 'multiply' && hitCount % 8 === 0) rule.value += 1;
    else if (rule.operation === 'subtract') rule.value = Math.max(0, rule.value - 10);
    else if (rule.operation === 'divide' && hitCount % 8 === 0) rule.value = Math.max(1, rule.value - 1);

    text.setText(gateLabel(rule)).setScale(1.18).setColor('#fef08a');
    this.time.delayedCall(55, () => text.setScale(1).setColor('#ffffff'));
    this.spawnBullet(target.y - 8);
    return true;
  }

  private updateSwarmFire(time: number) {
    const candidates = this.swarms
      .flatMap((wave) => wave.units)
      .filter((unit) => (
        unit.alive
        && unit.sprite.y <= PLAYER_Y - 70
        && unit.sprite.y >= 145
        && Math.abs(unit.sprite.x - this.squadX) <= (this.hasPowerUp('spread') ? 180 : 70)
      ))
      .sort((a, b) => b.sprite.y - a.sprite.y);
    if (candidates.length === 0) return;

    this.prepareFireMode('swarm', time);
    if (time < this.nextShotAt) return;
    this.nextShotAt = time + (this.hasPowerUp('rapid') ? 39 : 82);
    const penetration = swarmPenetration(this.actualCount) * (this.hasPowerUp('penetration') ? 3 : 1);
    const victims = candidates.slice(0, penetration);
    const targetY = victims.reduce((sum, unit) => sum + unit.sprite.y, 0) / victims.length;
    this.spawnBullet(targetY);
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
      const collided = alive.filter((unit) => unit.sprite.y >= PLAYER_Y - 35);
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
      if (obstacle.getData('used') || obstacle.y < PLAYER_Y - 30) continue;
      obstacle.setData('used', true);
      if (Math.abs(this.squadX - obstacle.x) < 105) {
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
    const combat = this.combats.find((item) => !item.used && item.container.y >= 320);
    if (!combat) return;
    this.activeCombat = combat;
    this.state = 'combat';
    this.statusText.setText(combat.def.boss ? '결승 요새 공격!' : '적 웨이브 교전');
  }

  private updateCombat(time: number) {
    const combat = this.activeCombat;
    if (!combat) return;
    const isAimed = Math.abs(this.squadX - combat.container.x) <= 85;
    if (!isAimed) this.statusText.setText('좌·중앙·우 이동으로 적을 조준하세요');
    if (isAimed) this.prepareFireMode('combat', time);
    if (time >= this.nextShotAt && isAimed) {
      this.nextShotAt = time + (this.hasPowerUp('rapid') ? 42 : 90);
      const damage = Math.max(3, Math.ceil(this.actualCount / 38));
      combat.health = Math.max(0, combat.health - damage);
      combat.healthText.setText(combat.health.toLocaleString('ko-KR'));
      this.spawnBullet(combat.container.y + 55);
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

  private spawnBullet(targetY: number) {
    const armyScale = Math.log2(Math.max(1, this.actualCount) / 50 + 1);
    const volleySize = Phaser.Math.Clamp(Math.ceil(6 + armyScale * 7), 8, 32);
    const muzzleCount = Phaser.Math.Clamp(Math.ceil(volleySize / 8), 2, 7);
    const spreadMultiplier = this.hasPowerUp('spread') ? 3 : 1;

    for (let i = 0; i < muzzleCount; i += 1) {
      const flash = this.add.circle(
        this.squadX + Phaser.Math.Between(-58, 58) * spreadMultiplier,
        PLAYER_Y - Phaser.Math.Between(22, 72),
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

    const impactRing = this.add.circle(this.squadX, targetY, 12, 0xffffff, 0)
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
      const columnSpread = ((i % 9) - 4) * 7 * spreadMultiplier;
      const fromX = this.squadX + columnSpread + Phaser.Math.Between(-4, 4);
      const fromY = PLAYER_Y + Phaser.Math.Between(-35, 30);
      const tracer = this.add.rectangle(
        fromX,
        fromY,
        Phaser.Math.Between(2, 4),
        Phaser.Math.Between(18, 34),
        i % 9 === 0 ? 0xfb923c : 0xfef08a,
        Phaser.Math.FloatBetween(0.72, 1),
      )
        .setOrigin(0.5)
        .setDepth(40);
      this.tweens.add({
        targets: tracer,
        y: targetY,
        duration: Phaser.Math.Between(65, 115),
        delay: (i % 8) * 4,
        onComplete: () => {
          if (i % 7 === 0) this.spawnImpactSpark(fromX, targetY);
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
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 620, 470, 0x172554, 0.97).setStrokeStyle(4, won ? 0xfacc15 : 0xf87171).setDepth(201);
    const title = this.add.text(WIDTH / 2, 505, won ? `${this.stage.bossName} 격파!` : '소대 전멸', { fontFamily: 'Arial Black, sans-serif', fontSize: '36px', color: won ? '#fde68a' : '#fecaca' }).setOrigin(0.5).setDepth(202);
    const summary = this.add.text(WIDTH / 2, 625, `${this.stage.chapter}-${this.stage.stage} ${this.stage.title}\n최종 병력  ${this.actualCount.toLocaleString('ko-KR')}명\n최대 병력  ${this.maxCount.toLocaleString('ko-KR')}명`, { fontSize: '21px', color: '#e2e8f0', align: 'center', lineSpacing: 10 }).setOrigin(0.5).setDepth(202);
    const retryButton = this.add.rectangle(WIDTH / 2 - 145, 790, 250, 62, won ? 0x22c55e : 0x2563eb).setStrokeStyle(3, 0xffffff, 0.75).setInteractive({ useHandCursor: true }).setDepth(202);
    const retryText = this.add.text(WIDTH / 2 - 145, 790, won ? '다시 도전' : '즉시 재시작', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(203);
    const leaveButton = this.add.rectangle(WIDTH / 2 + 145, 790, 250, 62, 0x475569).setStrokeStyle(3, 0xffffff, 0.75).setInteractive({ useHandCursor: true }).setDepth(202);
    const leaveText = this.add.text(WIDTH / 2 + 145, 790, '스테이지 선택', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(203);
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
