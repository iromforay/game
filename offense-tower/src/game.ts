import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from 'tower-defense';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { loadHero, DEFAULT_HERO } from './config/heroes';
import type { HeroId } from './config/heroes';

export interface MountOptions {
  heroId?: HeroId;
  roundId?: number;
}

export async function mountGame(parent: HTMLElement | string, options: MountOptions = {}): Promise<Phaser.Game> {
  const hero = await loadHero(options.heroId ?? DEFAULT_HERO);

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

  const game = new Phaser.Game(config);
  game.scene.start('Game', { hero, roundId: options.roundId });
  return game;
}

// Re-exported so hub's Lobby screen can show hero info before the match starts.
export * from './config/heroes';
export * from './config/stages';
export { getClearedRounds, isRoundCleared } from './roundProgress';
