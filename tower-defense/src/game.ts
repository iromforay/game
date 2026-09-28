import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/constants';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

export function mountGame(parent: HTMLElement | string): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#10101a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [GameScene, UIScene],
  };

  return new Phaser.Game(config);
}

// Re-exported so sibling game packages (e.g. offense-tower, the reverse-mode
// pivot) can reuse the core simulation pieces instead of duplicating them.
export * from './config/constants';
export { setupBoardCamera, BOARD_ZOOM } from './boardCamera';
export { reportGameResult, GAME_RESULT_EVENT } from './gameResult';
export type { GameResultDetail } from './gameResult';
export type { BoardCamera } from './boardCamera';
export * from './config/towers';
export type { EnemyType, EnemyDef, WaveEnemySpawn, WaveDef } from './config/enemies';
export { ENEMY_DEFS, WAVES } from './config/enemies';
export { Tower } from './objects/Tower';
export { Enemy } from './objects/Enemy';
export { Projectile } from './objects/Projectile';
export { default as towerBasicUrl } from './assets/towers/basic.svg?url';
export { default as towerSplashUrl } from './assets/towers/splash.svg?url';
export { default as towerSlowUrl } from './assets/towers/slow.svg?url';
// Painted art (fantasy/crystal tone) - sibling packages load these with the
// same 'tower-<id>-lv1' texture keys the shared Tower class already looks
// for, so towers render with real art instead of the flat SVG fallback with
// no other code changes needed.
export { default as towerBasicLv1Url } from './assets/towers/basic-lv1.png?url';
export { default as towerSplashLv1Url } from './assets/towers/splash-lv1.png?url';
export { default as towerSlowLv1Url } from './assets/towers/slow-lv1.png?url';
export { default as towerStormLv1Url } from './assets/towers/storm-lv1.png?url';
export { default as towerStormLv2Url } from './assets/towers/storm-lv2.png?url';
export { default as boardBackgroundUrl } from './assets/board/background.png?url';
// Painted monster art - offense-tower's units are the same kind of creature
// (walks a path, drawn by the shared Enemy class) so it reuses these instead
// of needing brand-new art: grunt/tank/fast map to swarm/tank/speed by radius
// and role (grunt~swarm: common & quick, tank~tank, fast~speed).
export { default as enemyGruntUrl } from './assets/enemies/grunt.png?url';
export { default as enemyTankUrl } from './assets/enemies/tank.png?url';
export { default as enemyFastUrl } from './assets/enemies/fast.png?url';
export { logEvent, getAllLogs, clearLogs, pruneLogsOlderThan, exportLogsAsJson } from './logger';
export type { LogEntry } from './logger';
export { getCoins, addCoins } from './metaCurrency';
