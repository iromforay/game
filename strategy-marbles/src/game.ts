import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/constants';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import type { NetworkOptions } from './network';

export interface MountOptions {
  roundId?: number;
  network?: NetworkOptions;
}

export function mountGame(parent: HTMLElement | string, options: MountOptions = {}): Phaser.Game {
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
    physics: {
      default: 'matter',
      matter: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    scene: [GameScene, UIScene],
  };

  const game = new Phaser.Game(config);
  game.scene.start('Game', { roundId: options.roundId, network: options.network });
  return game;
}

export * from './config/constants';
export * from './config/weights';
export * from './config/maps';
export type { NetworkOptions, NetworkSocket, TurnActionPayload } from './network';
