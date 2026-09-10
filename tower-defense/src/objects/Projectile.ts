import Phaser from 'phaser';
import { Enemy } from './Enemy';
import type { TowerDef } from '../config/towers';

export class Projectile {
  scene: Phaser.Scene;
  def: TowerDef;
  target: Enemy;
  damage: number;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Arc;
  spent = false;

  constructor(scene: Phaser.Scene, x: number, y: number, target: Enemy, def: TowerDef, damage: number) {
    this.scene = scene;
    this.def = def;
    this.target = target;
    this.damage = damage;
    this.x = x;
    this.y = y;
    this.sprite = scene.add.circle(x, y, 4, def.projectileColor);
  }

  /** Returns true when the projectile should be removed. */
  update(deltaMs: number, onHit: (target: Enemy, def: TowerDef, damage: number, x: number, y: number) => void): boolean {
    if (this.spent) return true;
    if (!this.target.alive) {
      this.sprite.destroy();
      return true;
    }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = (this.def.projectileSpeed * deltaMs) / 1000;

    if (dist <= step) {
      this.spent = true;
      onHit(this.target, this.def, this.damage, this.target.x, this.target.y);
      this.sprite.destroy();
      return true;
    }

    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    this.sprite.setPosition(this.x, this.y);
    return false;
  }
}
