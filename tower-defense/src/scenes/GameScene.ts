import Phaser from 'phaser';
import {
  COLS,
  ROWS,
  TILE,
  GAME_WIDTH,
  GAME_HEIGHT,
  PATH_POINTS,
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
import { setupBoardCamera } from '../boardCamera';
import { reportGameResult } from '../gameResult';
import type { BoardCamera } from '../boardCamera';
import towerBasicUrl from '../assets/towers/basic.svg?url';
import towerSplashUrl from '../assets/towers/splash.svg?url';
import towerSlowUrl from '../assets/towers/slow.svg?url';
import towerBasicLv1Url from '../assets/towers/basic-lv1.png?url';
import towerBasicLv2Url from '../assets/towers/basic-lv2-v2.png?url';
import towerSplashLv1Url from '../assets/towers/splash-lv1.png?url';
import towerSplashLv2Url from '../assets/towers/splash-lv2-v2.png?url';
import towerSlowLv1Url from '../assets/towers/slow-lv1.png?url';
import towerSlowLv2Url from '../assets/towers/slow-lv2-v2.png?url';
import towerStormLv1Url from '../assets/towers/storm-lv1.png?url';
import towerStormLv2Url from '../assets/towers/storm-lv2.png?url';
import enemyGruntUrl from '../assets/enemies/grunt.png?url';
import enemyFastUrl from '../assets/enemies/fast.png?url';
import enemyTankUrl from '../assets/enemies/tank.png?url';
import enemyBossUrl from '../assets/enemies/boss.png?url';
import boardBackgroundUrl from '../assets/board/background.png?url';

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
  private boardCam!: BoardCamera;

  gameEnded = false;
  kills = 0; // 스코어보드용 처치 수

  constructor() {
    super('Game');
  }

  preload() {
    this.load.svg('tower-basic', towerBasicUrl, { width: 64, height: 64 });
    this.load.svg('tower-splash', towerSplashUrl, { width: 64, height: 64 });
    this.load.svg('tower-slow', towerSlowUrl, { width: 64, height: 64 });

    this.load.image('tower-basic-lv1', towerBasicLv1Url);
    this.load.image('tower-basic-lv2', towerBasicLv2Url);
    this.load.image('tower-splash-lv1', towerSplashLv1Url);
    this.load.image('tower-splash-lv2', towerSplashLv2Url);
    this.load.image('tower-slow-lv1', towerSlowLv1Url);
    this.load.image('tower-slow-lv2', towerSlowLv2Url);
    this.load.image('tower-storm-lv1', towerStormLv1Url);
    this.load.image('tower-storm-lv2', towerStormLv2Url);

    this.load.image('enemy-grunt', enemyGruntUrl);
    this.load.image('enemy-fast', enemyFastUrl);
    this.load.image('enemy-tank', enemyTankUrl);
    this.load.image('enemy-boss', enemyBossUrl);

    this.load.image('board-bg', boardBackgroundUrl);
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
    this.kills = 0;

    this.drawBackground();
    this.drawBoard();
    this.drawPath();

    this.hoverTile = this.add.rectangle(0, 0, TILE, TILE, 0x33dd55, 0.35).setVisible(false);

    // 사용자 요청(2026-09-28): 게임판 150% 확대 + 드래그 이동 — 드래그와 구분하려고 설치/선택은 "탭(손 뗄 때)"으로 처리
    this.boardCam = setupBoardCamera(this, (wx, wy) => this.onBoardTap(wx, wy));
    this.input.on('pointermove', this.onPointerMove, this);

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

  private drawBackground() {
    this.add.image(0, 0, 'board-bg').setOrigin(0, 0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
  }

  private drawBoard() {
    // The painted background already shows ground/path art - just a faint
    // grid so build placement still reads clearly on top of it.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.add
          .rectangle(c * TILE, r * TILE, TILE, TILE, 0x000000, 0)
          .setOrigin(0, 0)
          .setStrokeStyle(1, 0xffffff, 0.06);
      }
    }
  }

  private drawPath() {
    // Thin guide line in case the painted road doesn't line up pixel-perfect
    // with the walkable path - kept subtle so it doesn't fight the art.
    const g = this.add.graphics();
    g.lineStyle(3, 0xffe9a8, 0.18);
    g.beginPath();
    g.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
    for (let i = 1; i < PATH_POINTS.length; i++) g.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    g.strokePath();
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.buildType || pointer.x > COLS * TILE || this.boardCam.isDragging()) {
      this.hoverTile?.setVisible(false);
      return;
    }
    // 확대/이동된 카메라 기준 월드 좌표로 칸 계산(화면 좌표 pointer.x를 쓰면 확대 후 칸이 어긋남)
    const world = this.boardCam.toWorld(pointer);
    const col = Math.floor(world.x / TILE);
    const row = Math.floor(world.y / TILE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
      this.hoverTile?.setVisible(false);
      return;
    }
    const buildable = isBuildable(col, row) && !this.towerAt(col, row);
    this.hoverTile?.setPosition(col * TILE + TILE / 2, row * TILE + TILE / 2);
    this.hoverTile?.setFillStyle(buildable ? 0x33dd55 : 0xdd3333, 0.35);
    this.hoverTile?.setVisible(true);
  }

  private onBoardTap(worldX: number, worldY: number) {
    const col = Math.floor(worldX / TILE);
    const row = Math.floor(worldY / TILE);
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
        this.kills++;
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
    // 스코어보드(2026-09-28): 결과 수치를 허브에 알림 — 패배 시 waveIndex(진행 중이던 웨이브 번호)가 곧 막아낸 웨이브 수
    reportGameResult({
      game: 'tower_defense',
      stats: { won, wavesCleared: won ? WAVES.length : Math.max(0, this.waveIndex), kills: this.kills, lives: Math.max(0, this.lives), gold: this.gold },
    });
    if (won) gameEvents.emit(Events.GameWin);
    else gameEvents.emit(Events.GameOver);
  }
}
