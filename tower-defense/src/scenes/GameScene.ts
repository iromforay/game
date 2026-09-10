import Phaser from 'phaser';
import {
  COLS,
  ROWS,
  TILE,
  PATH_POINTS,
  PATH_TILES,
  isBuildable,
  STARTING_GOLD,
  STARTING_LIVES,
} from '../config/constants';
import { TOWER_DEFS, upgradeCost, sellValue, MAX_TOWER_LEVEL } from '../config/towers';
import type { TowerType } from '../config/towers';
import { WAVES, ENEMY_DEFS } from '../config/enemies';
import { Tower } from '../objects/Tower';
import { Enemy } from '../objects/Enemy';
import { Projectile } from '../objects/Projectile';
import { gameEvents, Events } from '../events';
import type { SelectedTowerInfo } from '../events';
import towerBasicUrl from '../assets/towers/basic.svg?url';
import towerSplashUrl from '../assets/towers/splash.svg?url';
import towerSlowUrl from '../assets/towers/slow.svg?url';

export class GameScene extends Phaser.Scene {
  gold = STARTING_GOLD;
  lives = STARTING_LIVES;
  waveIndex = -1; // -1 = not started
  waveInProgress = false;
  enemiesRemainingToSpawn = 0;

  towers: Tower[] = [];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];

  buildType: TowerType | null = null;
  selectedTower: Tower | null = null;
  hoverTile: Phaser.GameObjects.Rectangle | null = null;

  gameEnded = false;

  constructor() {
    super('Game');
  }

  preload() {
    this.load.svg('tower-basic', towerBasicUrl, { width: 64, height: 64 });
    this.load.svg('tower-splash', towerSplashUrl, { width: 64, height: 64 });
    this.load.svg('tower-slow', towerSlowUrl, { width: 64, height: 64 });
  }

  create() {
    this.gold = STARTING_GOLD;
    this.lives = STARTING_LIVES;
    this.waveIndex = -1;
    this.waveInProgress = false;
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.buildType = null;
    this.selectedTower = null;
    this.gameEnded = false;

    this.drawBoard();
    this.drawPath();

    this.hoverTile = this.add.rectangle(0, 0, TILE, TILE, 0x33dd55, 0.35).setVisible(false);

    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerdown', this.onPointerDown, this);

    gameEvents.on(Events.BuildTypeSelected, (type: TowerType | null) => {
      this.buildType = type;
      this.selectTower(null);
    });
    gameEvents.on(Events.RequestStartWave, () => this.startNextWave());
    gameEvents.on(Events.RequestUpgrade, () => this.upgradeSelected());
    gameEvents.on(Events.RequestSell, () => this.sellSelected());
    gameEvents.on(Events.Restart, () => this.scene.restart());

    this.emitGold();
    this.emitLives();
    this.emitWave();
  }

  shutdown() {
    gameEvents.removeAllListeners(Events.BuildTypeSelected);
    gameEvents.removeAllListeners(Events.RequestStartWave);
    gameEvents.removeAllListeners(Events.RequestUpgrade);
    gameEvents.removeAllListeners(Events.RequestSell);
    gameEvents.removeAllListeners(Events.Restart);
  }

  private drawBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isPath = PATH_TILES.has(`${c},${r}`);
        const color = isPath ? 0x3a3a2a : (r + c) % 2 === 0 ? 0x24314a : 0x28364f;
        this.add
          .rectangle(c * TILE, r * TILE, TILE, TILE, color)
          .setOrigin(0, 0)
          .setStrokeStyle(1, 0x000000, 0.15);
      }
    }
  }

  private drawPath() {
    const g = this.add.graphics();
    g.lineStyle(4, 0x8a7a4a, 0.5);
    g.beginPath();
    g.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
    for (let i = 1; i < PATH_POINTS.length; i++) g.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    g.strokePath();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.buildType || pointer.y > ROWS * TILE) {
      this.hoverTile?.setVisible(false);
      return;
    }
    const col = Math.floor(pointer.x / TILE);
    const row = Math.floor(pointer.y / TILE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
      this.hoverTile?.setVisible(false);
      return;
    }
    const buildable = isBuildable(col, row) && !this.towerAt(col, row);
    this.hoverTile?.setPosition(col * TILE + TILE / 2, row * TILE + TILE / 2);
    this.hoverTile?.setFillStyle(buildable ? 0x33dd55 : 0xdd3333, 0.35);
    this.hoverTile?.setVisible(true);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.y > ROWS * TILE) return;

    const col = Math.floor(pointer.x / TILE);
    const row = Math.floor(pointer.y / TILE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;

    if (this.buildType) {
      this.tryPlaceTower(this.buildType, col, row);
      return;
    }

    const existing = this.towerAt(col, row);
    this.selectTower(existing);
  }

  private towerAt(col: number, row: number): Tower | null {
    return this.towers.find((t) => t.col === col && t.row === row) ?? null;
  }

  private tryPlaceTower(type: TowerType, col: number, row: number) {
    if (!isBuildable(col, row) || this.towerAt(col, row)) return;
    const def = TOWER_DEFS[type];
    if (this.gold < def.cost) return;

    this.gold -= def.cost;
    this.emitGold();

    const x = col * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    const tower = new Tower(this, def, col, row, x, y);
    this.towers.push(tower);
    this.buildType = null;
    gameEvents.emit(Events.BuildTypeSelected, null);
    this.selectTower(tower);
  }

  private selectTower(tower: Tower | null) {
    if (this.selectedTower) this.selectedTower.setSelected(false);
    this.selectedTower = tower;
    if (tower) {
      tower.setSelected(true);
      this.emitSelectedTowerInfo(tower);
    } else {
      gameEvents.emit(Events.PlacedTowerSelected, null);
    }
  }

  private emitSelectedTowerInfo(tower: Tower) {
    const atMax = tower.level >= MAX_TOWER_LEVEL;
    const info: SelectedTowerInfo = {
      towerId: tower.id,
      typeName: tower.def.name,
      level: tower.level,
      maxLevel: atMax,
      upgradeCost: atMax ? null : upgradeCost(tower.def, tower.level),
      sellValue: sellValue(tower.def, tower.level),
    };
    gameEvents.emit(Events.PlacedTowerSelected, info);
  }

  private upgradeSelected() {
    const tower = this.selectedTower;
    if (!tower || tower.level >= MAX_TOWER_LEVEL) return;
    const cost = upgradeCost(tower.def, tower.level);
    if (this.gold < cost) return;
    this.gold -= cost;
    tower.upgrade();
    this.emitGold();
    this.emitSelectedTowerInfo(tower);
  }

  private sellSelected() {
    const tower = this.selectedTower;
    if (!tower) return;
    this.gold += sellValue(tower.def, tower.level);
    this.emitGold();
    this.towers = this.towers.filter((t) => t !== tower);
    tower.destroy();
    this.selectTower(null);
  }

  private startNextWave() {
    if (this.waveInProgress || this.gameEnded) return;
    this.waveIndex++;
    if (this.waveIndex >= WAVES.length) return;
    this.waveInProgress = true;
    this.emitWave();

    const wave = WAVES[this.waveIndex];
    const hpMultiplier = 1 + this.waveIndex * 0.12;
    let totalToSpawn = 0;
    wave.groups.forEach((g) => (totalToSpawn += g.count));
    this.enemiesRemainingToSpawn = totalToSpawn;

    let cumulativeDelay = 0;
    for (const group of wave.groups) {
      for (let i = 0; i < group.count; i++) {
        this.time.delayedCall(cumulativeDelay, () => {
          this.enemiesRemainingToSpawn--;
          if (this.gameEnded) return;
          const def = ENEMY_DEFS[group.type];
          const enemy = new Enemy(this, def, hpMultiplier);
          this.enemies.push(enemy);
        });
        cumulativeDelay += group.interval;
      }
    }
  }

  private emitGold() {
    gameEvents.emit(Events.GoldChanged, this.gold);
  }
  private emitLives() {
    gameEvents.emit(Events.LivesChanged, this.lives);
  }
  private emitWave() {
    gameEvents.emit(Events.WaveChanged, { current: this.waveIndex + 1, total: WAVES.length, inProgress: this.waveInProgress });
  }

  update(_time: number, deltaMs: number) {
    if (this.gameEnded) return;
    const now = this.time.now;

    // Towers acquire targets and fire.
    for (const tower of this.towers) {
      if (!tower.canFire(now)) continue;
      const target = tower.findTarget(this.enemies);
      if (!target) continue;
      tower.fire(now);
      const damage = tower.damage;
      const projectile = new Projectile(this, tower.x, tower.y, target, tower.def, damage);
      this.projectiles.push(projectile);
    }

    // Advance projectiles.
    this.projectiles = this.projectiles.filter((p) => {
      const done = p.update(deltaMs, (target, def, damage, x, y) => this.resolveHit(target, def, damage, x, y));
      return !done;
    });

    // Advance enemies.
    for (const enemy of this.enemies) {
      enemy.update(deltaMs, now);
    }

    // Remove dead / escaped enemies.
    const survivors: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        this.gold += enemy.def.reward;
        this.emitGold();
        enemy.destroy();
        continue;
      }
      if (enemy.reachedEnd) {
        this.lives -= 1;
        this.emitLives();
        enemy.destroy();
        if (this.lives <= 0) {
          this.endGame(false);
          return;
        }
        continue;
      }
      survivors.push(enemy);
    }
    this.enemies = survivors;

    // Wave completion check.
    if (this.waveInProgress && this.enemies.length === 0 && this.enemiesRemainingToSpawn <= 0) {
      this.waveInProgress = false;
      this.emitWave();
      if (this.waveIndex >= WAVES.length - 1) {
        this.endGame(true);
      } else {
        gameEvents.emit(Events.WaveCleared, this.waveIndex + 1);
      }
    }
  }

  private resolveHit(target: Enemy, def: (typeof TOWER_DEFS)['basic'], damage: number, x: number, y: number) {
    if (def.splashRadius) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
        if (d <= def.splashRadius) {
          e.takeDamage(e === target ? damage : damage * 0.6);
        }
      }
    } else {
      target.takeDamage(damage);
    }

    if (def.slowFactor && target.alive) {
      target.applySlow(def.slowFactor, def.slowDuration ?? 1000, this.time.now);
    }
  }

  private endGame(won: boolean) {
    this.gameEnded = true;
    if (won) gameEvents.emit(Events.GameWin);
    else gameEvents.emit(Events.GameOver);
  }
}
