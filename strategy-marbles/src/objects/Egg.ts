import Phaser from 'phaser';
import { WEIGHT_DEFS } from '../config/weights';
import type { WeightTier } from '../config/weights';
import { floorFrictionToAir } from '../config/physics';
import { HIDDEN_STONE_TEXTURE_KEY, OPPONENT_STONE_TEXTURE_KEYS, WEIGHT_STONE_TEXTURE_KEYS } from '../assets/stoneTextures';

const STONE_DISPLAY_RADIUS = 21;

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
    // Every opponent uses the same public texture. The owner-only weight art
    // is swapped in by setWeightVisible(), without changing the physics body.
    const image = scene.add.image(x, y, HIDDEN_STONE_TEXTURE_KEY).setDisplaySize(STONE_DISPLAY_RADIUS * 2, STONE_DISPLAY_RADIUS * 2);
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
      .circle(x, y, STONE_DISPLAY_RADIUS + 4, 0x000000, 0)
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
    this.weightLabel.setPosition(this.x, this.y - STONE_DISPLAY_RADIUS - 12);
    this.selectionRing.setPosition(this.x, this.y);
  }

  setWeightVisible(visible: boolean, opponentMarkerIndex = 0) {
    this.weightLabel.setVisible(visible);
    const textureKey = visible
      ? WEIGHT_STONE_TEXTURE_KEYS[this.weightTier]
      : OPPONENT_STONE_TEXTURE_KEYS[opponentMarkerIndex % OPPONENT_STONE_TEXTURE_KEYS.length];
    this.circle.setTexture(textureKey).setDisplaySize(STONE_DISPLAY_RADIUS * 2, STONE_DISPLAY_RADIUS * 2);
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
