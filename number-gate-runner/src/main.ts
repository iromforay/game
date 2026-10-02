import { mountGame } from './game';

const game = mountGame('app');
if (import.meta.env.DEV) (window as unknown as { __game?: Phaser.Game }).__game = game;
