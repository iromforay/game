import Phaser from 'phaser';
import type { TowerDef } from '../config/towers';
import { statMultiplier } from '../config/towers';
import { Enemy } from './Enemy';

let nextTowerId = 1;

export class Tower {
  id: number;
  scene: Phaser.Scene;
  def: TowerDef;
  level = 1;
  col: number;
  row: number;
  x: number;
  y: number;
  lastFired = 0;

  // Undefined maxHp means indestructible (normal mode: towers are never
  // attacked). Only set this when something in the game can damage towers.
  maxHp?: number;
  hp?: number;
  destroyed = false;

  sprite: Phaser.GameObjects.Image;
  rangeCircle: Phaser.GameObjects.Arc;
  levelText: Phaser.GameObjects.Text;
  hpBarBg?: Phaser.GameObjects.Rectangle;
  hpBarFill?: Phaser.GameObjects.Rectangle;
  container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, def: TowerDef, col: number, row: number, x: number, y: number, maxHp?: number) {
    this.id = nextTowerId++;
    this.scene = scene;
    this.def = def;
    this.col = col;
    this.row = row;
    this.x = x;
    this.y = y;
    this.maxHp = maxHp;
    this.hp = maxHp;

    this.sprite = scene.add.image(0, 0, `tower-${def.id}`).setDisplaySize(52, 52);
    this.levelText = scene.add.text(0, 24, 'Lv1', { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5);
    this.rangeCircle = scene.add.circle(0, 0, def.range, 0xffffff, 0.08).setStrokeStyle(1, 0xffffff, 0.25);
    this.rangeCircle.setVisible(false);

    const containerChildren: Phaser.GameObjects.GameObject[] = [this.rangeCircle, this.sprite, this.levelText];
    if (maxHp !== undefined) {
      this.hpBarBg = scene.add.rectangle(0, -34, 40, 5, 0x000000, 0.5);
      this.hpBarFill = scene.add.rectangle(-20, -34, 40, 5, 0x33dd55).setOrigin(0, 0.5);
      containerChildren.push(this.hpBarBg, this.hpBarFill);
    }

    this.container = scene.add.container(x, y, containerChildren);
  }

  /** Returns true when this hit destroyed the tower. */
  takeDamage(amount: number): boolean {
    if (this.maxHp === undefined || this.hp === undefined || this.destroyed) return false;
    this.hp -= amount;
    const ratio = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill?.setDisplaySize(40 * ratio, 5);
    if (this.hp <= 0) {
      this.destroyed = true;
      return true;
    }
    return false;
  }

  get range(): number {
    return this.def.range * statMultiplier(this.level);
  }

  get damage(): number {
    return this.def.damage * statMultiplier(this.level);
  }

  setSelected(selected: boolean) {
    this.rangeCircle.setVisible(selected);
  }

  upgrade() {
    this.level++;
    this.levelText.setText(`Lv${this.level}`);
    this.rangeCircle.setRadius(this.range);
  }

  findTarget(enemies: Enemy[]): Enemy | null {
    let closest: Enemy | null = null;
    let closestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      if (d <= this.range && d < closestDist) {
        closest = e;
        closestDist = d;
      }
    }
    return closest;
  }

  canFire(now: number): boolean {
    return now - this.lastFired >= this.def.fireRate;
  }

  fire(now: number) {
    this.lastFired = now;
  }

  destroy() {
    this.container.destroy();
  }
}
