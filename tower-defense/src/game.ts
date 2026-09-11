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
export * from './config/towers';
export type { EnemyType, EnemyDef, WaveEnemySpawn, WaveDef } from './config/enemies';
export { ENEMY_DEFS, WAVES } from './config/enemies';
export { Tower } from './objects/Tower';
export { Enemy } from './objects/Enemy';
export { Projectile } from './objects/Projectile';
export { default as towerBasicUrl } from './assets/towers/basic.svg?url';
export { default as towerSplashUrl } from './assets/towers/splash.svg?url';
export { default as towerSlowUrl } from './assets/towers/slow.svg?url';
export { logEvent, getAllLogs, clearLogs, pruneLogsOlderThan, exportLogsAsJson } from './logger';
export type { LogEntry } from './logger';
export { getCoins, addCoins } from './metaCurrency';
