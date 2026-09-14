import Phaser from 'phaser';
import type { EnemyDef } from '../config/enemies';
import { PATH_POINTS } from '../config/constants';

export class Enemy {
  scene: Phaser.Scene;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  segmentIndex = 0;
  segmentProgress = 0; // px traveled on current segment
  alive = true;
  reachedEnd = false;
  slowUntil = 0;
  slowFactor = 1;

  // Defaults to the shared normal-mode path; callers with their own map
  // (e.g. offense-tower's per-round paths) pass their own points array.
  pathPoints: { x: number; y: number }[];

  body: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, def: EnemyDef, hpMultiplier = 1, pathPoints: { x: number; y: number }[] = PATH_POINTS) {
    this.scene = scene;
    this.def = def;
    this.maxHp = Math.round(def.hp * hpMultiplier);
    this.hp = this.maxHp;
    this.pathPoints = pathPoints;
    this.x = this.pathPoints[0].x;
    this.y = this.pathPoints[0].y;

    // Real art (`enemy-<id>`) if the scene loaded it, else the flat-color
    // placeholder circle (still used by offense-tower's units/hero).
    const spriteKey = `enemy-${def.id}`;
    if (scene.textures.exists(spriteKey)) {
      const image = scene.add.image(0, 0, spriteKey);
      // Uniform scale (not setDisplaySize, which would squash non-square art)
      // so aspect ratio is preserved - only the target diameter is fixed.
      // Bigger multiplier than the old placeholder circle's implied size so
      // the painted detail (gems, shading) actually reads on screen.
      const targetDiameter = def.radius * 3.2;
      image.setScale(targetDiameter / Math.max(image.width, image.height));
      this.body = image;
    } else {
      this.body = scene.add.circle(0, 0, def.radius, def.color).setStrokeStyle(2, 0x000000, 0.35);
    }
    this.hpBarBg = scene.add.rectangle(0, -def.radius - 10, def.radius * 2, 5, 0x000000, 0.5);
    this.hpBarFill = scene.add.rectangle(-def.radius, -def.radius - 10, def.radius * 2, 5, 0x33dd55).setOrigin(0, 0.5);

    this.container = scene.add.container(this.x, this.y, [this.body, this.hpBarBg, this.hpBarFill]);
  }

  private updateHpBar() {
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill.width = this.def.radius * 2 * ratio;
    this.hpBarFill.fillColor = ratio > 0.5 ? 0x33dd55 : ratio > 0.25 ? 0xddc233 : 0xdd3333;
  }

  applySlow(factor: number, durationMs: number, now: number) {
    // Take the strongest active slow.
    if (factor < this.slowFactor) this.slowFactor = factor;
    this.slowUntil = Math.max(this.slowUntil, now + durationMs);
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    this.updateHpBar();
    if (this.hp <= 0 && this.alive) {
      this.alive = false;
      return true; // died from this hit
    }
    return false;
  }

  update(deltaMs: number, now: number) {
    if (!this.alive) return;

    if (this.slowUntil > 0 && now > this.slowUntil) {
      this.slowFactor = 1;
      this.slowUntil = 0;
    }

    const speed = this.def.speed * this.slowFactor;
    let remaining = (speed * deltaMs) / 1000;

    while (remaining > 0 && this.segmentIndex < this.pathPoints.length - 1) {
      const a = this.pathPoints[this.segmentIndex];
      const b = this.pathPoints[this.segmentIndex + 1];
      const segLen = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      const left = segLen - this.segmentProgress;

      if (remaining < left) {
        this.segmentProgress += remaining;
        remaining = 0;
      } else {
        remaining -= left;
        this.segmentIndex++;
        this.segmentProgress = 0;
        if (this.segmentIndex >= this.pathPoints.length - 1) {
          this.reachedEnd = true;
          break;
        }
      }
    }

    const a = this.pathPoints[Math.min(this.segmentIndex, this.pathPoints.length - 2)];
    const b = this.pathPoints[Math.min(this.segmentIndex + 1, this.pathPoints.length - 1)];
    const segLen = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) || 1;
    const t = Phaser.Math.Clamp(this.segmentProgress / segLen, 0, 1);
    this.x = Phaser.Math.Linear(a.x, b.x, t);
    this.y = Phaser.Math.Linear(a.y, b.y, t);
    this.container.setPosition(this.x, this.y);
  }

  destroy() {
    this.container.destroy();
  }
}
