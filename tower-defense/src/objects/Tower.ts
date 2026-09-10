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

  sprite: Phaser.GameObjects.Image;
  rangeCircle: Phaser.GameObjects.Arc;
  levelText: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, def: TowerDef, col: number, row: number, x: number, y: number) {
    this.id = nextTowerId++;
    this.scene = scene;
    this.def = def;
    this.col = col;
    this.row = row;
    this.x = x;
    this.y = y;

    this.sprite = scene.add.image(0, 0, `tower-${def.id}`).setDisplaySize(52, 52);
    this.levelText = scene.add.text(0, 24, 'Lv1', { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5);
    this.rangeCircle = scene.add.circle(0, 0, def.range, 0xffffff, 0.08).setStrokeStyle(1, 0xffffff, 0.25);
    this.rangeCircle.setVisible(false);

    this.container = scene.add.container(x, y, [this.rangeCircle, this.sprite, this.levelText]);
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
