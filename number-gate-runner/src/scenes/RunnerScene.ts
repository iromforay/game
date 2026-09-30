import Phaser from 'phaser';
import { applyGate, gateLabel, swarmPenetration } from '../model';
import type { GateRule } from '../model';
import heroCommanderUrl from '../assets/units/hero-commander.png';
import advancingSquadUrl from '../assets/units/advancing-squad.png';
import numberGateUrl from '../assets/world/number-gate-3d.png';
import clockworkGruntUrl from '../assets/enemies/clockwork-grunt.png';
import siegeTankUrl from '../assets/enemies/siege-tank.png';

const WIDTH = 1280;
const HEIGHT = 720;
const PLAYER_X = 285;
const TRACK_TOP = 145;
const TRACK_BOTTOM = 610;
const RUN_SPEED = 210;
const FINISH_DISTANCE = 5200;

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
  sprite?: 'clockwork-grunt' | 'siege-tank';
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
  private activeCombat: CombatVisual | null = null;
  private nextShotAt = 0;
  private nextEnemyHitAt = 0;
  private dragging = false;
  private combo = 0;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super('Runner');
  }

  preload() {
    this.load.image('hero-commander', heroCommanderUrl);
    this.load.image('advancing-squad', advancingSquadUrl);
    this.load.image('number-gate-3d', numberGateUrl);
    this.load.image('clockwork-grunt', clockworkGruntUrl);
    this.load.image('siege-tank', siegeTankUrl);
  }

  create() {
    this.runDistance = 0;
    this.squadY = 360;
    this.targetY = 360;
    this.actualCount = 100;
    this.maxCount = 100;
    this.state = 'running';
    this.gates = [];
    this.combats = [];
    this.swarms = [];
    this.obstacles = [];
    this.activeCombat = null;
    this.nextShotAt = 0;
    this.nextEnemyHitAt = 0;
    this.dragging = false;
    this.combo = 0;
    this.cursors = this.input.keyboard?.createCursorKeys();

    this.drawBackground();
    this.createCourse();
    this.createFormation();
    this.createHud();
    this.bindInput();
  }

  private drawBackground() {
    this.cameras.main.setBackgroundColor('#102236');
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x5bb7d1, 0x5bb7d1, 0xbce8dd, 0xbce8dd, 1);
    sky.fillRect(0, 0, WIDTH, HEIGHT);
    sky.fillStyle(0xdff3df, 1).fillEllipse(1030, 125, 520, 150);

    const track = this.add.graphics();
    track.fillStyle(0x334155, 1);
    track.beginPath();
    track.moveTo(90, TRACK_BOTTOM);
    track.lineTo(1190, TRACK_BOTTOM - 45);
    track.lineTo(1190, TRACK_TOP + 45);
    track.lineTo(90, TRACK_TOP);
    track.closePath();
    track.fillPath();
    track.lineStyle(4, 0x94a3b8, 0.7);
    track.strokePath();
    track.lineStyle(2, 0xffffff, 0.15);
    track.lineBetween(90, 375, 1190, 375);
  }

  private createCourse() {
    this.addGatePair({ distance: 520, upper: { operation: 'add', value: 120 }, lower: { operation: 'add', value: 60 } });
    this.addSwarm(1050, 40, '태엽 병정 선발대');
    this.addObstacle(1580, 490, 50);
    this.addGatePair({ distance: 1980, upper: { operation: 'multiply', value: 2 }, lower: { operation: 'add', value: 180 } });
    this.addSwarm(2520, 60, '태엽 병정 대군');
    this.addCombat({ distance: 3260, strength: 360, title: '공성 전차', sprite: 'siege-tank' });
    this.addSwarm(3850, 80, '태엽 병정 총공세');
    this.addGatePair({ distance: 4300, upper: { operation: 'add', value: 350 }, lower: { operation: 'multiply', value: 2 } });
    this.addCombat({ distance: 5000, strength: 760, title: '장난감 성문', boss: true });
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
    const shadow = this.add.ellipse(0, 68 * scale, def.sprite === 'siege-tank' ? 230 : 145, 34, 0x0f172a, 0.38);
    let enemy: Phaser.GameObjects.GameObject;
    if (def.sprite) {
      enemy = this.add.image(0, 0, def.sprite).setDisplaySize(def.sprite === 'siege-tank' ? 245 : 165, def.sprite === 'siege-tank' ? 163 : 138);
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
    this.add.text(24, 17, 'STAGE 1  증원 개시', { fontSize: '22px', color: '#f8fafc', fontStyle: 'bold' }).setDepth(101);
    this.add.text(24, 48, '선봉 영웅 · 돌격소총 Lv.1', { fontSize: '15px', color: '#93c5fd' }).setDepth(101);
    this.countText = this.add.text(PLAYER_X, 92, '100', { fontFamily: 'Arial Black, sans-serif', fontSize: '34px', color: '#ffffff', stroke: '#1e3a8a', strokeThickness: 7 }).setOrigin(0.5).setDepth(101);
    this.add.rectangle(880, 30, 330, 12, 0x334155).setOrigin(0, 0.5).setDepth(101);
    this.progressBar = this.add.rectangle(880, 30, 0, 12, 0x38bdf8).setOrigin(0, 0.5).setDepth(102);
    this.statusText = this.add.text(1045, 51, '결승까지 전진', { fontSize: '14px', color: '#cbd5e1' }).setOrigin(0.5).setDepth(102);
    this.choiceText = this.add.text(WIDTH / 2, 102, '', { fontSize: '24px', color: '#ffffff', backgroundColor: '#0f172acc', padding: { x: 16, y: 8 } }).setOrigin(0.5).setDepth(110).setAlpha(0);
    this.comboText = this.add.text(1215, 105, '', { fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#fef08a', stroke: '#7c2d12', strokeThickness: 6 }).setOrigin(1, 0.5).setDepth(112);
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
    if (this.state === 'running') this.updateGateFire(time);
    if (this.state === 'running') this.updateSwarmFire(time);
    this.checkGates();
    this.checkObstacles();
    this.checkSwarmCollisions();
    this.checkCombatStart();
    if (this.state === 'combat') this.updateCombat(time);
    this.progressBar.width = 330 * Phaser.Math.Clamp(this.runDistance / FINISH_DISTANCE, 0, 1);
  }

  private updateCoursePositions() {
    for (const gate of this.gates) {
      const x = PLAYER_X + gate.def.distance - this.runDistance;
      gate.upper.x = x;
      gate.lower.x = x;
    }
    for (const obstacle of this.obstacles) obstacle.x = PLAYER_X + Number(obstacle.getData('distance')) - this.runDistance;
    for (const combat of this.combats) combat.container.x = PLAYER_X + combat.def.distance - this.runDistance;
    for (const wave of this.swarms) {
      for (const unit of wave.units) {
        if (!unit.alive) continue;
        unit.sprite.x = PLAYER_X + unit.distance - this.runDistance;
        unit.sprite.y = unit.laneY + Math.sin((this.runDistance + unit.distance) * 0.025) * 5;
      }
    }
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
    }
  }

  private updateGateFire(time: number) {
    if (time < this.nextShotAt) return;
    const gate = this.gates.find((item) => !item.used && item.upper.x >= PLAYER_X + 55 && item.upper.x <= 920);
    if (!gate) return;

    const useUpper = this.squadY < 370;
    const target = useUpper ? gate.upper : gate.lower;
    const rule = useUpper ? gate.def.upper : gate.def.lower;
    const text = useUpper ? gate.upperText : gate.lowerText;
    const hitCount = useUpper ? ++gate.upperHits : ++gate.lowerHits;
    this.nextShotAt = time + 90;
    this.statusText.setText(`${useUpper ? '상단' : '하단'} 게이트 집중사격`);

    if (rule.operation === 'add') rule.value += 10;
    else if (rule.operation === 'multiply' && hitCount % 8 === 0) rule.value += 1;
    else if (rule.operation === 'subtract') rule.value = Math.max(0, rule.value - 10);
    else if (rule.operation === 'divide' && hitCount % 8 === 0) rule.value = Math.max(1, rule.value - 1);

    text.setText(gateLabel(rule)).setScale(1.18).setColor('#fef08a');
    this.time.delayedCall(55, () => text.setScale(1).setColor('#ffffff'));
    this.spawnBullet(target.x - 8, target.y);
  }

  private updateSwarmFire(time: number) {
    if (time < this.nextShotAt) return;
    const candidates = this.swarms
      .flatMap((wave) => wave.units)
      .filter((unit) => unit.alive && unit.sprite.x >= PLAYER_X + 70 && unit.sprite.x <= 1020)
      .sort((a, b) => a.sprite.x - b.sprite.x);
    if (candidates.length === 0) return;

    this.nextShotAt = time + 82;
    const penetration = swarmPenetration(this.actualCount);
    const victims = candidates.slice(0, penetration);
    const targetX = victims.reduce((sum, unit) => sum + unit.sprite.x, 0) / victims.length;
    const targetY = victims.reduce((sum, unit) => sum + unit.sprite.y, 0) / victims.length;
    this.spawnBullet(targetX, targetY);
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
      for (const unit of collided) {
        unit.alive = false;
        unit.sprite.setVisible(false);
      }
      this.actualCount = Math.max(0, this.actualCount - collided.length);
      this.cameras.main.shake(90, 0.004);
      this.flashChoice(`잔존 병정 충돌  −${collided.length}`);
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
    if (time >= this.nextShotAt) {
      this.nextShotAt = time + 90;
      const damage = Math.max(3, Math.ceil(this.actualCount / 38));
      combat.health = Math.max(0, combat.health - damage);
      combat.healthText.setText(combat.health.toLocaleString('ko-KR'));
      this.spawnBullet(combat.container.x - 55, combat.container.y);
      combat.container.setScale(0.98);
      this.time.delayedCall(45, () => combat.container.setScale(1));
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

  private spawnBullet(targetX: number, targetY: number) {
    const armyScale = Math.log2(Math.max(1, this.actualCount) / 50 + 1);
    const volleySize = Phaser.Math.Clamp(Math.ceil(10 + armyScale * 13), 12, 56);
    const muzzleCount = Phaser.Math.Clamp(Math.ceil(volleySize / 8), 2, 7);

    for (let i = 0; i < muzzleCount; i += 1) {
      const flash = this.add.circle(
        PLAYER_X + Phaser.Math.Between(22, 72),
        this.squadY + Phaser.Math.Between(-58, 58),
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

    const impactRing = this.add.circle(targetX, targetY, 12, 0xffffff, 0)
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
      const rowSpread = ((i % 13) - 6) * 9;
      const fromX = PLAYER_X + Phaser.Math.Between(-48, 72);
      const fromY = this.squadY + rowSpread + Phaser.Math.Between(-15, 15);
      const hitY = targetY + Phaser.Math.Between(-62, 62);
      const angle = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(fromX, fromY, targetX, hitY));
      const tracer = this.add.rectangle(
        fromX,
        fromY,
        Phaser.Math.Between(18, 34),
        Phaser.Math.Between(2, 4),
        i % 9 === 0 ? 0xfb923c : 0xfef08a,
        Phaser.Math.FloatBetween(0.72, 1),
      )
        .setOrigin(0.5)
        .setAngle(angle)
        .setDepth(40);
      this.tweens.add({
        targets: tracer,
        x: targetX,
        y: hitY,
        duration: Phaser.Math.Between(65, 115),
        delay: (i % 8) * 4,
        onComplete: () => {
          if (i % 6 === 0) this.spawnImpactSpark(targetX, hitY);
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
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 520, 350, 0x172554, 0.97).setStrokeStyle(4, won ? 0xfacc15 : 0xf87171).setDepth(201);
    const title = this.add.text(WIDTH / 2, 235, won ? '장난감 성문 격파!' : '소대 전멸', { fontFamily: 'Arial Black, sans-serif', fontSize: '38px', color: won ? '#fde68a' : '#fecaca' }).setOrigin(0.5).setDepth(202);
    const summary = this.add.text(WIDTH / 2, 330, `최종 병력  ${this.actualCount.toLocaleString('ko-KR')}명\n최대 병력  ${this.maxCount.toLocaleString('ko-KR')}명`, { fontSize: '23px', color: '#e2e8f0', align: 'center', lineSpacing: 12 }).setOrigin(0.5).setDepth(202);
    const button = this.add.rectangle(WIDTH / 2, 455, 230, 62, won ? 0x22c55e : 0x2563eb).setStrokeStyle(3, 0xffffff, 0.75).setInteractive({ useHandCursor: true }).setDepth(202);
    const buttonText = this.add.text(WIDTH / 2, 455, won ? '다시 플레이' : '즉시 재시작', { fontSize: '22px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(203);
    button.on('pointerdown', () => this.scene.restart());
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.restart());
    overlay.setInteractive();
    void panel;
    void title;
    void summary;
    void buttonText;
  }
}
