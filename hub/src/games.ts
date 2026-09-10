export type GameId = 'tower-defense' | 'offense-tower';

export interface GameMeta {
  id: GameId;
  title: string;
  description: string;
}

export const GAMES: GameMeta[] = [
  { id: 'tower-defense', title: '디펜스타워', description: '타워를 세워 몰려오는 적을 막는다' },
  { id: 'offense-tower', title: '오펜스 타워', description: 'AI의 방어를 뚫고 유닛을 돌파시킨다' },
];
