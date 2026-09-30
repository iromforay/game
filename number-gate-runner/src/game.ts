import Phaser from 'phaser';
import { RunnerScene } from './scenes/RunnerScene';

export function mountGame(parent: HTMLElement | string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1280,
    height: 720,
    backgroundColor: '#102236',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [RunnerScene],
  });
}

export * from './model';
