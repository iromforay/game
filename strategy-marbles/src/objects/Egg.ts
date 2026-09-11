import Phaser from 'phaser';
import { WEIGHT_DEFS } from '../config/weights';
import type { WeightTier } from '../config/weights';
import { PLAYER_COLORS } from '../config/constants';
import { floorFrictionToAir } from '../config/physics';
import { ensureEggTexture } from './eggTexture';

let nextEggId = 1;

export class Egg {
  readonly id: number;
  readonly scene: Phaser.Scene;
  readonly ownerId: number;
  readonly weightTier: WeightTier;
  readonly circle: Phaser.GameObjects.Image & { body: MatterJS.BodyType };
  readonly weightLabel: Phaser.GameObjects.Text;
  readonly selectionRing: Phaser.GameObjects.Arc;
  readonly frictionMultiplier: number;
  readonly baseFrictionAir: number;

  // Zones the egg currently overlaps (by index into the map's zone list).
  // While non-empty, one of those zones' friction wins over the floor's.
  activeZones = new Set<number>();

  alive = true;
  usedThisTurn = false;
  isShooterThisTurn = false;
  pendingVelocity: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene, ownerId: number, weightTier: WeightTier, x: number, y: number, floorFriction: number) {
    this.id = nextEggId++;
    this.scene = scene;
    this.ownerId = ownerId;
    this.weightTier = weightTier;

    const def = WEIGHT_DEFS[weightTier];
    this.frictionMultiplier = def.frictionMultiplier;
    this.baseFrictionAir = floorFrictionToAir(floorFriction) * def.frictionMultiplier;
    const color = PLAYER_COLORS[ownerId % PLAYER_COLORS.length];

    // A glossy, domed Go-stone look instead of a flat-filled circle.
    const textureKey = ensureEggTexture(scene, color, def.radius);
    const image = scene.add.image(x, y, textureKey);
    scene.matter.add.gameObject(image, {
      shape: { type: 'circle', radius: def.radius },
      mass: def.mass,
      frictionAir: this.baseFrictionAir,
      friction: 0.05,
      restitution: 0.65,
      label: `egg:${this.id}`,
    });
    this.circle = image as Phaser.GameObjects.Image & { body: MatterJS.BodyType };

    this.selectionRing = scene.add
      .circle(x, y, def.radius + 3, 0x000000, 0)
      .setStrokeStyle(2, 0xffffff, 1)
      .setVisible(false);

    this.weightLabel = scene.add
      .text(x, y, def.label, { fontSize: '11px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);
  }

  get x(): number {
    return this.circle.x;
  }

  get y(): number {
    return this.circle.y;
  }

  get radius(): number {
    return WEIGHT_DEFS[this.weightTier].radius;
  }

  get speed(): number {
    return this.circle.body.speed;
  }

  syncLabel() {
    this.weightLabel.setPosition(this.x, this.y - this.radius - 12);
    this.selectionRing.setPosition(this.x, this.y);
  }

  setWeightVisible(visible: boolean) {
    this.weightLabel.setVisible(visible);
  }

  setSelected(selected: boolean) {
    this.selectionRing.setPosition(this.x, this.y).setVisible(selected);
  }

  setFrictionAir(value: number) {
    this.circle.body.frictionAir = value;
  }

  resetForNewTurn() {
    this.usedThisTurn = false;
    this.isShooterThisTurn = false;
    this.pendingVelocity = null;
  }

  destroy() {
    this.alive = false;
    this.scene.matter.world.remove(this.circle.body);
    this.circle.destroy();
    this.weightLabel.destroy();
    this.selectionRing.destroy();
  }
}
