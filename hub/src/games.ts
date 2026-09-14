import cardFrameUrl from './assets/cards/card-frame.png';
import towerDefenseIconUrl from './assets/cards/icon-tower-defense.png';
import offenseTowerIconUrl from './assets/cards/icon-offense-tower.png';
import strategyMarblesIconUrl from './assets/cards/icon-strategy-marbles.png';

export type GameId = 'tower-defense' | 'offense-tower' | 'strategy-marbles';

export interface GameMeta {
  id: GameId;
  title: string;
  description: string;
  iconUrl: string;
}

export const CARD_FRAME_URL = cardFrameUrl;

export const GAMES: GameMeta[] = [
  { id: 'tower-defense', title: '디펜스타워', description: '몰려오는 적, 타워로 막아라', iconUrl: towerDefenseIconUrl },
  { id: 'offense-tower', title: '오펜스 타워', description: 'AI의 방어를 뚫고 돌파하라', iconUrl: offenseTowerIconUrl },
  { id: 'strategy-marbles', title: '전략 알까기', description: '무게를 숨기고 상대를 쳐내라', iconUrl: strategyMarblesIconUrl },
];
