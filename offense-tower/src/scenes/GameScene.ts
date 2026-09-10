import Phaser from 'phaser';
import {
  COLS,
  ROWS,
  TILE,
  PATH_POINTS,
  PATH_TILES,
  isBuildable,
  TOWER_DEFS,
  Tower,
  Enemy,
  Projectile,
  towerBasicUrl,
  towerSplashUrl,
  towerSlowUrl,
} from 'tower-defense';
import type { TowerType } from 'tower-defense';
import { UNIT_DEFS, damageMultiplier } from '../config/units';
import type { UnitDef, UnitType } from '../config/units';
import { gameEvents, Events } from '../events';

const TOWER_ORDER: TowerType[] = ['basic', 'splash', 'slow'];

const AI_STARTING_GOLD = 90; // just enough to seed the bottleneck splash tower
const AI_PLACEMENT_INTERVAL = 2600; // ms between AI build attempts
const SEED_TOWER_TILE = { col: 8, row: 2 }; // adjacent to the path's first bend

export class GameScene extends Phaser.Scene {
  towers: Tower[] = [];
  units: Enemy[] = [];
  projectiles: Projectile[] = [];

  aiGold = AI_STARTING_GOLD;
  kills = 0;
  breakthroughs = 0;

  aiPlacementTimer = 0;
  aiTowerOrderIndex = 0;
  aiCandidateTiles: { col: number; row: number }[] = [];

  spawnCooldownUntil: Record<UnitType, number> = { swarm: 0, tank: 0, speed: 0 };
  cooldownEmitAccumulator = 0;

  constructor() {
    super('Game');
  }

  preload() {
    this.load.svg('tower-basic', towerBasicUrl, { width: 64, height: 64 });
    this.load.svg('tower-splash', towerSplashUrl, { width: 64, height: 64 });
    this.load.svg('tower-slow', towerSlowUrl, { width: 64, height: 64 });
  }

  create() {
    this.towers = [];
    this.units = [];
    this.projectiles = [];
    this.aiGold = AI_STARTING_GOLD;
    this.kills = 0;
    this.breakthroughs = 0;
    this.aiPlacementTimer = AI_PLACEMENT_INTERVAL;
    this.aiTowerOrderIndex = 0;
    this.spawnCooldownUntil = { swarm: 0, tank: 0, speed: 0 };

    this.drawBoard();
    this.drawPath();
    this.buildAiCandidateTiles();
    this.placeSeedTower();

    gameEvents.on(Events.RequestSpawn, (type: UnitType) => this.trySpawnUnit(type));

    this.emitScore();
  }

  shutdown() {
    gameEvents.removeAllListeners(Events.RequestSpawn);
  }

  private drawBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isPath = PATH_TILES.has(`${c},${r}`);
        const color = isPath ? 0x3a2a2a : (r + c) % 2 === 0 ? 0x4a2431 : 0x4f2836;
        this.add
          .rectangle(c * TILE, r * TILE, TILE, TILE, color)
          .setOrigin(0, 0)
          .setStrokeStyle(1, 0x000000, 0.15);
      }
    }
  }

  private drawPath() {
    const g = this.add.graphics();
    g.lineStyle(4, 0x8a5a4a, 0.5);
    g.beginPath();
    g.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
    for (let i = 1; i < PATH_POINTS.length; i++) g.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    g.strokePath();
  }

  private buildAiCandidateTiles() {
    const tiles: { col: number; row: number }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isBuildable(c, r)) continue;
        if (c === SEED_TOWER_TILE.col && r === SEED_TOWER_TILE.row) continue;
        const nearPath =
          PATH_TILES.has(`${c + 1},${r}`) ||
          PATH_TILES.has(`${c - 1},${r}`) ||
          PATH_TILES.has(`${c},${r + 1}`) ||
          PATH_TILES.has(`${c},${r - 1}`);
        if (nearPath) tiles.push({ col: c, row: r });
      }
    }
    Phaser.Utils.Array.Shuffle(tiles);
    this.aiCandidateTiles = tiles;
  }

  private placeSeedTower() {
    const def = TOWER_DEFS.splash;
    const x = SEED_TOWER_TILE.col * TILE + TILE / 2;
    const y = SEED_TOWER_TILE.row * TILE + TILE / 2;
    this.towers.push(new Tower(this, def, SEED_TOWER_TILE.col, SEED_TOWER_TILE.row, x, y));
    this.aiGold -= def.cost;
  }

  private towerAt(col: number, row: number): boolean {
    return this.towers.some((t) => t.col === col && t.row === row);
  }

  private aiTryBuild() {
    if (this.aiCandidateTiles.length === 0) return;

    for (let attempt = 0; attempt < TOWER_ORDER.length; attempt++) {
      const type = TOWER_ORDER[this.aiTowerOrderIndex % TOWER_ORDER.length];
      this.aiTowerOrderIndex++;
      const def = TOWER_DEFS[type];
      if (this.aiGold < def.cost) continue;

      const tileIndex = this.aiCandidateTiles.findIndex((t) => !this.towerAt(t.col, t.row));
      if (tileIndex === -1) return; // board full

      const tile = this.aiCandidateTiles[tileIndex];
      const x = tile.col * TILE + TILE / 2;
      const y = tile.row * TILE + TILE / 2;
      this.towers.push(new Tower(this, def, tile.col, tile.row, x, y));
      this.aiGold -= def.cost;
      return;
    }
  }

  private trySpawnUnit(type: UnitType) {
    const now = this.time.now;
    if (now < this.spawnCooldownUntil[type]) return;
    const def = UNIT_DEFS[type];
    this.spawnCooldownUntil[type] = now + def.spawnCooldown;
    this.units.push(new Enemy(this, def, 1));
  }

  update(_time: number, deltaMs: number) {
    const now = this.time.now;

    // AI builds towers over time as it accumulates gold from kills.
    this.aiPlacementTimer -= deltaMs;
    if (this.aiPlacementTimer <= 0) {
      this.aiPlacementTimer = AI_PLACEMENT_INTERVAL;
      this.aiTryBuild();
    }

    // Towers acquire targets and fire at player units.
    for (const tower of this.towers) {
      if (!tower.canFire(now)) continue;
      const target = tower.findTarget(this.units);
      if (!target) continue;
      tower.fire(now);
      const damage = tower.damage;
      this.projectiles.push(new Projectile(this, tower.x, tower.y, target, tower.def, damage));
    }

    // Advance projectiles.
    this.projectiles = this.projectiles.filter((p) => {
      const done = p.update(deltaMs, (target, def, damage, x, y) => this.resolveHit(target, def, damage, x, y));
      return !done;
    });

    // Advance units.
    for (const unit of this.units) unit.update(deltaMs, now);

    // Remove dead / breakthrough units.
    const survivors: Enemy[] = [];
    for (const unit of this.units) {
      if (!unit.alive) {
        this.kills++;
        this.aiGold += unit.def.reward;
        unit.destroy();
        continue;
      }
      if (unit.reachedEnd) {
        this.breakthroughs++;
        unit.destroy();
        continue;
      }
      survivors.push(unit);
    }
    this.units = survivors;

    this.emitScore();
    this.emitCooldowns(deltaMs, now);
  }

  private resolveHit(target: Enemy, def: (typeof TOWER_DEFS)['basic'], damage: number, x: number, y: number) {
    const mult = (unit: Enemy) => damageMultiplier(unit.def as UnitDef, def.id);

    if (def.splashRadius) {
      for (const u of this.units) {
        if (!u.alive) continue;
        const d = Phaser.Math.Distance.Between(x, y, u.x, u.y);
        if (d <= def.splashRadius) {
          const base = u === target ? damage : damage * 0.6;
          u.takeDamage(base * mult(u));
        }
      }
    } else {
      target.takeDamage(damage * mult(target));
    }

    if (def.slowFactor && target.alive) {
      target.applySlow(def.slowFactor, def.slowDuration ?? 1000, this.time.now);
    }
  }

  private emitScore() {
    gameEvents.emit(Events.ScoreChanged, { kills: this.kills, breakthroughs: this.breakthroughs, aiGold: this.aiGold });
  }

  private emitCooldowns(deltaMs: number, now: number) {
    this.cooldownEmitAccumulator += deltaMs;
    if (this.cooldownEmitAccumulator < 100) return;
    this.cooldownEmitAccumulator = 0;
    const remaining: Record<UnitType, number> = {
      swarm: Math.max(0, this.spawnCooldownUntil.swarm - now),
      tank: Math.max(0, this.spawnCooldownUntil.tank - now),
      speed: Math.max(0, this.spawnCooldownUntil.speed - now),
    };
    gameEvents.emit(Events.CooldownsChanged, remaining);
  }
}
