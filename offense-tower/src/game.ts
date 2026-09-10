import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from 'tower-defense';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

export function mountGame(parent: HTMLElement | string): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#1a1010',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [GameScene, UIScene],
  };

  return new Phaser.Game(config);
}
