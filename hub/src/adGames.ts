export type AdGameId = 'number-gate-runner' | 'number-hero-tower';

export interface AdGameMeta {
  id: AdGameId;
  number: number;
  title: string;
  description: string;
  status: 'planning' | 'available';
}

export const AD_GAMES: AdGameMeta[] = [
  {
    id: 'number-gate-runner',
    number: 1,
    title: '숫자 게이트 러너',
    description: '숫자 게이트로 소대를 키우고 기계 군단을 격파하세요.',
    status: 'available',
  },
  {
    id: 'number-hero-tower',
    number: 2,
    title: '숫자 용사 탑',
    description: '공격 숫자와 경로 폭을 판단하고 숨은 보상을 흡수해 드래곤에 도전하세요.',
    status: 'available',
  },
];
