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

  body: Phaser.GameObjects.Arc;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, def: EnemyDef, hpMultiplier = 1) {
    this.scene = scene;
    this.def = def;
    this.maxHp = Math.round(def.hp * hpMultiplier);
    this.hp = this.maxHp;
    this.x = PATH_POINTS[0].x;
    this.y = PATH_POINTS[0].y;

    this.body = scene.add.circle(0, 0, def.radius, def.color).setStrokeStyle(2, 0x000000, 0.35);
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

    while (remaining > 0 && this.segmentIndex < PATH_POINTS.length - 1) {
      const a = PATH_POINTS[this.segmentIndex];
      const b = PATH_POINTS[this.segmentIndex + 1];
      const segLen = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      const left = segLen - this.segmentProgress;

      if (remaining < left) {
        this.segmentProgress += remaining;
        remaining = 0;
      } else {
        remaining -= left;
        this.segmentIndex++;
        this.segmentProgress = 0;
        if (this.segmentIndex >= PATH_POINTS.length - 1) {
          this.reachedEnd = true;
          break;
        }
      }
    }

    const a = PATH_POINTS[Math.min(this.segmentIndex, PATH_POINTS.length - 2)];
    const b = PATH_POINTS[Math.min(this.segmentIndex + 1, PATH_POINTS.length - 1)];
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
