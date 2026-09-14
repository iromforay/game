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

    this.sprite = scene.add.image(0, 0, this.textureKey());
    this.fitSprite();
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
    this.sprite.setTexture(this.textureKey());
    this.fitSprite();
  }

  /** Per-level art (`tower-<id>-lv<level>`) if loaded, else the single shared texture. */
  private textureKey(): string {
    const leveled = `tower-${this.def.id}-lv${this.level}`;
    return this.scene.textures.exists(leveled) ? leveled : `tower-${this.def.id}`;
  }

  /**
   * Uniform-scale the sprite to fit within the tile instead of forcing a
   * square display size - the tower art is portrait (taller than wide), so
   * squashing it to 52x52 stretched/distorted it and looked low-quality.
   *
   * Deliberately bigger than the 64px tile (towers overflow into neighbors
   * a bit) - shrinking the detailed source art down to fit inside one tile
   * lost most of its fine detail, and letting towers "pop" past their tile
   * is normal for the genre.
   */
  private fitSprite() {
    const target = 88;
    const scale = target / Math.max(this.sprite.width, this.sprite.height);
    this.sprite.setScale(scale);
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
