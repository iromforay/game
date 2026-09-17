import cardFrameUrl from './assets/cards/card-frame.png';
import towerDefenseIconUrl from './assets/cards/icon-tower-defense.png';
import offenseTowerIconUrl from './assets/cards/icon-offense-tower.png';
import strategyMarblesIconUrl from './assets/cards/icon-strategy-marbles.png';
import saveATurbyIconUrl from './assets/cards/icon-save-a-turby.png';

export type GameId = 'tower-defense' | 'offense-tower' | 'strategy-marbles' | 'save-a-turby';

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
  { id: 'save-a-turby', title: '터비 구하기', description: '엄마의 마지막 한 타래를 찾아 떠나는 모험', iconUrl: saveATurbyIconUrl },
];
