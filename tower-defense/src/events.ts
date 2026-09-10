import Phaser from 'phaser';

// Shared event bus so GameScene and UIScene can talk without tight coupling.
export const gameEvents = new Phaser.Events.EventEmitter();

export interface SelectedTowerInfo {
  towerId: number;
  typeName: string;
  level: number;
  maxLevel: boolean;
  upgradeCost: number | null;
  sellValue: number;
}

export const Events = {
  GoldChanged: 'gold-changed',
  LivesChanged: 'lives-changed',
  WaveChanged: 'wave-changed',
  WaveCleared: 'wave-cleared',
  GameOver: 'game-over',
  GameWin: 'game-win',
  BuildTypeSelected: 'build-type-selected', // UI -> Game
  PlacedTowerSelected: 'placed-tower-selected', // Game -> UI (SelectedTowerInfo | null)
  RequestStartWave: 'request-start-wave', // UI -> Game
  RequestUpgrade: 'request-upgrade', // UI -> Game
  RequestSell: 'request-sell', // UI -> Game
  Restart: 'restart', // UI -> Game
} as const;
