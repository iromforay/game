import Phaser from 'phaser';
import {
  COLS,
  ROWS,
  TILE,
  GAME_WIDTH,
  GAME_HEIGHT,
  TOWER_DEFS,
  Tower,
  Enemy,
  Projectile,
  towerBasicUrl,
  towerSplashUrl,
  towerSlowUrl,
  towerBasicLv1Url,
  towerSplashLv1Url,
  towerSlowLv1Url,
  enemyGruntUrl,
  enemyTankUrl,
  enemyFastUrl,
  logEvent,
  addCoins,
} from 'tower-defense';
import type { TowerType } from 'tower-defense';
import { UNIT_DEFS, damageMultiplier } from '../config/units';
import type { UnitDef, UnitType } from '../config/units';
import type { HeroDef } from '../config/heroes';
import { getStage } from '../config/stages';
import type { StageDef } from '../config/stages';
import { computePathPoints, computePathTiles, isBuildable } from '../config/map';
import type { PixelPoint } from '../config/map';
import { markRoundCleared } from '../roundProgress';
import { gameEvents, Events } from '../events';

const TOWER_ORDER: TowerType[] = ['basic', 'splash', 'slow'];

const AI_STARTING_GOLD = 90; // just enough to seed the bottleneck splash tower
const AI_PLACEMENT_INTERVAL = 2600; // ms between AI build attempts

// Unlike normal mode, AI towers here are destructible (roughly cost-scaled).
const TOWER_HP: Record<TowerType, number> = { basic: 140, splash: 200, slow: 160 };

const CLEAR_REWARD_COINS = 100;

export class GameScene extends Phaser.Scene {
  towers: Tower[] = [];
  units: Enemy[] = [];
  projectiles: Projectile[] = [];

  aiGold = AI_STARTING_GOLD;
  kills = 0;
  breakthroughs = 0;
  unitBreakthroughs = 0; // excludes the hero - this is what the clear goal counts
  gameCleared = false;

  aiPlacementTimer = 0;
  aiTowerOrderIndex = 0;
  aiCandidateTiles: { col: number; row: number }[] = [];

  spawnCooldownUntil: Record<UnitType, number> = { swarm: 0, tank: 0, speed: 0 };
  cooldownEmitAccumulator = 0;

  stage: StageDef = getStage(1);
  pathPoints: PixelPoint[] = [];
  pathTiles: Set<string> = new Set();
  hero!: HeroDef; // resolved before mountGame() starts this scene - see game.ts
  heroAlive: Enemy | null = null;
  heroLocked = true; // unlocked once a unit clears the seed tower's bottleneck
  heroUsed = false; // hero is a single one-time summon per run, no cooldown/respawn
  heroLastAttack = 0;
  heroZoneRect!: Phaser.GameObjects.Rectangle;
  heroZoneLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  init(data: { hero: HeroDef; roundId?: number }) {
    this.hero = data.hero;
    this.stage = getStage(data.roundId ?? 1);
  }

  preload() {
    // SVG kept as a fallback - Tower.textureKey() prefers 'tower-<id>-lv1'
    // (the painted PNG art below) when it's loaded, same swap logic that
    // already lets tower-defense's upgrade art work with no other changes.
    this.load.svg('tower-basic', towerBasicUrl, { width: 64, height: 64 });
    this.load.svg('tower-splash', towerSplashUrl, { width: 64, height: 64 });
    this.load.svg('tower-slow', towerSlowUrl, { width: 64, height: 64 });
    this.load.image('tower-basic-lv1', towerBasicLv1Url);
    this.load.image('tower-splash-lv1', towerSplashLv1Url);
    this.load.image('tower-slow-lv1', towerSlowLv1Url);
    // Units are the same "creature walking a path" role as tower-defense's
    // enemies, drawn by the same shared Enemy class - reuse that painted
    // monster art instead of needing new art (grunt~swarm, tank~tank, fast~speed).
    this.load.image('enemy-swarm', enemyGruntUrl);
    this.load.image('enemy-tank', enemyTankUrl);
    this.load.image('enemy-speed', enemyFastUrl);
    if (this.stage.background) {
      this.load.image(`round-bg-${this.stage.id}`, this.stage.background);
    }
  }

  create() {
    this.pathPoints = computePathPoints(this.stage.pathGrid);
    this.pathTiles = computePathTiles(this.stage.pathGrid);
    this.towers = [];
    this.units = [];
    this.projectiles = [];
    this.aiGold = AI_STARTING_GOLD;
    this.kills = 0;
    this.breakthroughs = 0;
    this.unitBreakthroughs = 0;
    this.gameCleared = false;
    this.aiPlacementTimer = AI_PLACEMENT_INTERVAL;
    this.aiTowerOrderIndex = 0;
    this.spawnCooldownUntil = { swarm: 0, tank: 0, speed: 0 };
    this.heroAlive = null;
    this.heroLocked = true;
    this.heroUsed = false;
    this.heroLastAttack = 0;

    this.drawBackground();
    this.drawBoard();
    this.drawPath();
    this.drawHeroZone();
    this.buildAiCandidateTiles();
    this.placeSeedTower();

    gameEvents.on(Events.RequestSpawn, (type: UnitType) => this.trySpawnUnit(type));
    gameEvents.on(Events.RequestSpawnHero, () => this.trySpawnHero());

    this.emitScore();
    this.emitHeroState();
    gameEvents.emit(Events.HeroInfoChanged, { name: this.hero.name, color: this.hero.color });
    logEvent('offense-tower', 'game_start', { heroId: this.hero.id, roundId: this.stage.id });
  }

  shutdown() {
    gameEvents.removeAllListeners(Events.RequestSpawn);
    gameEvents.removeAllListeners(Events.RequestSpawnHero);
  }

  private drawBackground() {
    if (!this.stage.background) return;
    this.add.image(0, 0, `round-bg-${this.stage.id}`).setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
  }

  private drawBoard() {
    // With a background image, tiles become a translucent grid overlay
    // instead of the solid checkerboard fill so the art shows through.
    const hasBackground = !!this.stage.background;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isPath = this.pathTiles.has(`${c},${r}`);
        const color = isPath ? 0x3a2a2a : (r + c) % 2 === 0 ? 0x4a2431 : 0x4f2836;
        this.add
          .rectangle(c * TILE, r * TILE, TILE, TILE, color, hasBackground ? 0.35 : 1)
          .setOrigin(0, 0)
          .setStrokeStyle(1, 0x000000, 0.15);
      }
    }
  }

  private drawPath() {
    const g = this.add.graphics();
    // Same dimmed gold guide-line tower-defense uses once a painted
    // background is present - the art already shows a stone path, so a bold
    // line here would just clash with it.
    const hasBackground = !!this.stage.background;
    if (hasBackground) g.lineStyle(3, 0xffe9a8, 0.18);
    else g.lineStyle(4, 0x8a5a4a, 0.5);
    g.beginPath();
    g.moveTo(this.pathPoints[0].x, this.pathPoints[0].y);
    for (let i = 1; i < this.pathPoints.length; i++) g.lineTo(this.pathPoints[i].x, this.pathPoints[i].y);
    g.strokePath();
  }

  private drawHeroZone() {
    const x = this.stage.heroZoneTile.col * TILE + TILE / 2;
    const y = this.stage.heroZoneTile.row * TILE + TILE / 2;
    this.heroZoneRect = this.add
      .rectangle(x, y, TILE, TILE, 0xffd166, 0.35)
      .setStrokeStyle(2, 0xffd166, 0.9);
    this.heroZoneLabel = this.add
      .text(x, y - TILE / 2 - 12, '영웅존', { fontSize: '11px', color: '#ffd166' })
      .setOrigin(0.5, 1);
  }

  private buildAiCandidateTiles() {
    const tiles: { col: number; row: number }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isBuildable(c, r, this.pathTiles)) continue;
        if (c === this.stage.seedTowerTile.col && r === this.stage.seedTowerTile.row) continue;
        const nearPath =
          this.pathTiles.has(`${c + 1},${r}`) ||
          this.pathTiles.has(`${c - 1},${r}`) ||
          this.pathTiles.has(`${c},${r + 1}`) ||
          this.pathTiles.has(`${c},${r - 1}`);
        if (nearPath) tiles.push({ col: c, row: r });
      }
    }
    Phaser.Utils.Array.Shuffle(tiles);
    this.aiCandidateTiles = tiles;
  }

  private placeSeedTower() {
    const def = TOWER_DEFS.splash;
    const { col, row } = this.stage.seedTowerTile;
    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    this.towers.push(new Tower(this, def, col, row, x, y, TOWER_HP.splash));
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
      this.towers.push(new Tower(this, def, tile.col, tile.row, x, y, TOWER_HP[type]));
      this.aiGold -= def.cost;
      logEvent('offense-tower', 'tower_built', { type, col: tile.col, row: tile.row, aiGold: this.aiGold });
      return;
    }
  }

  private trySpawnUnit(type: UnitType) {
    const now = this.time.now;
    if (now < this.spawnCooldownUntil[type]) return;
    const def = UNIT_DEFS[type];
    this.spawnCooldownUntil[type] = now + def.spawnCooldown;
    this.units.push(new Enemy(this, def, 1, this.pathPoints));
    logEvent('offense-tower', 'unit_spawn', { type });
  }

  private trySpawnHero() {
    if (this.heroLocked || this.heroUsed) return;
    this.heroUsed = true;
    const heroUnit = new Enemy(this, this.hero, 1, this.pathPoints);
    this.heroAlive = heroUnit;
    this.units.push(heroUnit);
    this.emitHeroState();
    logEvent('offense-tower', 'hero_spawn', { heroId: this.hero.id });
  }

  private heroAttackTowers(now: number) {
    const hero = this.heroAlive;
    if (!hero || !hero.alive) return;
    const def = this.hero;
    if (now - this.heroLastAttack < def.attackRate) return;

    let target: Tower | null = null;
    let closestDist = Infinity;
    for (const tower of this.towers) {
      if (tower.maxHp === undefined) continue;
      const d = Phaser.Math.Distance.Between(hero.x, hero.y, tower.x, tower.y);
      if (d <= def.attackRange && d < closestDist) {
        target = tower;
        closestDist = d;
      }
    }
    if (!target) return;

    this.heroLastAttack = now;
    this.flashHeroAttack(hero.x, hero.y, target.x, target.y);
    if (target.takeDamage(def.attackDamage)) {
      this.towers = this.towers.filter((t) => t !== target);
      logEvent('offense-tower', 'tower_destroyed', { towerType: target.def.id, byHero: true });
      target.destroy();
    }
  }

  private flashHeroAttack(x1: number, y1: number, x2: number, y2: number) {
    const line = this.add.graphics();
    line.lineStyle(3, 0xffd166, 0.9);
    line.beginPath();
    line.moveTo(x1, y1);
    line.lineTo(x2, y2);
    line.strokePath();
    this.time.delayedCall(100, () => line.destroy());
  }

  update(_time: number, deltaMs: number) {
    if (this.gameCleared) return;
    const now = this.time.now;

    // AI builds towers over time as it accumulates gold from kills.
    this.aiPlacementTimer -= deltaMs;
    if (this.aiPlacementTimer <= 0) {
      this.aiPlacementTimer = AI_PLACEMENT_INTERVAL;
      this.aiTryBuild();
    }

    this.heroAttackTowers(now);

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

    // Unlock the hero once any unit has cleared the seed tower's bottleneck.
    if (this.heroLocked && this.units.some((u) => u.segmentIndex >= this.stage.heroUnlockSegmentIndex)) {
      this.heroLocked = false;
      this.heroZoneRect.setFillStyle(0x66dd88, 0.25).setStrokeStyle(2, 0x66dd88, 0.6);
      this.heroZoneLabel.setText('영웅존 (해금됨)').setColor('#66dd88');
      this.emitHeroState();
      logEvent('offense-tower', 'hero_zone_unlocked', { elapsedMs: now });
    }

    // Remove dead / breakthrough units.
    const survivors: Enemy[] = [];
    for (const unit of this.units) {
      if (!unit.alive) {
        this.kills++;
        this.aiGold += unit.def.reward;
        const wasHero = unit === this.heroAlive;
        if (wasHero) this.heroAlive = null;
        logEvent('offense-tower', wasHero ? 'hero_death' : 'unit_kill', { unitType: unit.def.id });
        unit.destroy();
        continue;
      }
      if (unit.reachedEnd) {
        this.breakthroughs++;
        const wasHero = unit === this.heroAlive;
        if (wasHero) {
          // Reaching the goal earns the hero another summon; dying does not.
          this.heroAlive = null;
          this.heroUsed = false;
          this.emitHeroState();
        }
        logEvent('offense-tower', wasHero ? 'hero_breakthrough' : 'unit_breakthrough', { unitType: unit.def.id });
        if (!wasHero) this.unitBreakthroughs++;
        unit.destroy();
        continue;
      }
      survivors.push(unit);
    }
    this.units = survivors;

    if (!this.gameCleared && this.unitBreakthroughs >= this.stage.goalBreakthroughs) {
      this.triggerClear();
    }

    this.emitScore();
    this.emitCooldowns(deltaMs, now);
  }

  private triggerClear() {
    this.gameCleared = true;
    markRoundCleared(this.stage.id);
    const totalCoins = addCoins(CLEAR_REWARD_COINS);
    logEvent('offense-tower', 'game_clear', { roundId: this.stage.id, unitBreakthroughs: this.unitBreakthroughs, reward: CLEAR_REWARD_COINS });
    gameEvents.emit(Events.GameCleared, { reward: CLEAR_REWARD_COINS, totalCoins });
  }

  private resolveHit(target: Enemy, def: (typeof TOWER_DEFS)['basic'], damage: number, x: number, y: number) {
    const mult = (unit: Enemy) => {
      if ('resistance' in unit.def) return (unit.def as HeroDef).resistance;
      return damageMultiplier(unit.def as UnitDef, def.id);
    };

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
    gameEvents.emit(Events.ScoreChanged, {
      kills: this.kills,
      breakthroughs: this.breakthroughs,
      unitBreakthroughs: this.unitBreakthroughs,
      goal: this.stage.goalBreakthroughs,
      roundName: this.stage.name,
      aiGold: this.aiGold,
    });
  }

  private emitHeroState() {
    gameEvents.emit(Events.HeroStateChanged, { locked: this.heroLocked, used: this.heroUsed });
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
