export interface RunnerStage {
  id: number;
  chapter: 1 | 2;
  stage: number;
  title: string;
  route: string;
  enemyGroup: string;
  bossName: string;
  startCount: number;
  threat: number;
  accent: string;
}

const PLAYROOM = [
  ['블록 바닥', '흩어진 블록 길', '블록 병정', '블록 성문'],
  ['인형 진열장', '인형 선반 통로', '봉제 인형대', '거대 곰 인형'],
  ['태엽 기차선', '움직이는 기찻길', '태엽 병정', '기관차 요새'],
  ['미니카 경주장', '고속 장난감 트랙', '미니카 군단', '챔피언 트럭'],
  ['로봇 조립소', '자동 조립 벨트', '로봇 보병', '메카 티라노'],
  ['해적 장난감선', '갑판 돌격로', '블록 해적단', '해적왕 함포'],
  ['공룡 장난감 숲', '피규어 정글', '공룡 피규어', '폭군 티렉스'],
  ['고장 난 놀이공원', '회전목마 거리', '폭주 장난감', '회전목마 요새'],
  ['황금 장난감 성', '황금 블록 대로', '황금 근위대', '황금 골렘'],
  ['장난감 탑 진입로', '왕의 카펫 길', '왕실 장난감군', '장난감 왕의 성문'],
] as const;

const KITCHEN = [
  ['쿠키 조리대', '부스러기 길', '쿠키 병정', '쿠키 통 요새'],
  ['식기 서랍', '은빛 식기 통로', '포크 기사단', '국자 장군'],
  ['사탕 선반', '끈적한 사탕길', '캔디 병정', '캔디 항아리'],
  ['싱크대 수로', '거품 물길', '거품 슬라임', '수도꼭지 골렘'],
  ['토스터 협곡', '빵 부스러기 협곡', '토스트 병사', '토스터 요새'],
  ['냄비 화산', '뜨거운 조리대', '수프 정령', '압력솥 대장'],
  ['냉장고 설원', '얼음 선반길', '냉동 푸딩군', '얼음 냉장고'],
  ['오븐 요새', '불꽃 베이킹로', '불꽃 셰프단', '왕실 오븐'],
  ['한밤의 식탁', '달빛 식탁보', '은식기 군단', '촛대 골렘'],
  ['왕실 주방', '황금 접시 길', '주방 근위대', '냉장고 대왕'],
] as const;

export const RUNNER_STAGES: RunnerStage[] = [...PLAYROOM, ...KITCHEN].map((data, index) => {
  const chapter = index < 10 ? 1 : 2;
  const stage = (index % 10) + 1;
  return {
    id: index + 1,
    chapter,
    stage,
    title: data[0],
    route: data[1],
    enemyGroup: data[2],
    bossName: data[3],
    startCount: 80 + stage * 20 + (chapter - 1) * 30,
    threat: stage + (chapter - 1) * 4,
    accent: chapter === 1 ? '#f2c75b' : '#ff9466',
  };
});

export const RUNNER_CHAPTERS = [
  { id: 1 as const, title: '놀이방', subtitle: '장난감 탑까지 진격', accent: '#f2c75b' },
  { id: 2 as const, title: '주방', subtitle: '주방 탑까지 진격', accent: '#ff9466' },
];

export function runnerStage(chapter: 1 | 2, stage: number) {
  return RUNNER_STAGES.find((item) => item.chapter === chapter && item.stage === stage) ?? RUNNER_STAGES[0];
}
