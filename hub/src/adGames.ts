export type AdGameId =
  | 'number-gate-runner'
  | 'number-hero-tower'
  | 'merge-defense'
  | 'sweet-shop'
  | 'my-room-dungeon';

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
  {
    id: 'merge-defense',
    number: 3,
    title: '머지 디펜스',
    description: '검사·궁사·마검사를 스폰하고 합쳐 태엽 군단을 막으세요.',
    status: 'available',
  },
  {
    id: 'sweet-shop',
    number: 4,
    title: '달콤상점',
    description: '디저트를 만들어 가격을 정하고 다른 플레이어와 사고파는 온라인 카페를 운영하세요.',
    status: 'planning',
  },
  {
    id: 'my-room-dungeon',
    number: 5,
    title: '내 방이 던전',
    description: '방 안의 사물을 분해해 자원을 모으고 무기와 채집 로봇을 성장시키세요.',
    status: 'planning',
  },
];
