// 3.2 등급표 반영 — 수치는 밸런싱 전 임시값(8.2-⑤ 미확정, 프로토타입 진행을 위한 자리표시자)
export interface GradeDef {
  id: number;
  name: string;
  buyPrice: number;
  incomePerTick: number; // 2.3: 일정 주기(TICK_MS)마다 지급
  sellPrice: number;
  stealDifficultyLabel: string;
}

export const GRADES: GradeDef[] = [
  { id: 1, name: '커먼', buyPrice: 20, incomePerTick: 2, sellPrice: 12, stealDifficultyLabel: '쉬움' },
  { id: 2, name: '언커먼', buyPrice: 60, incomePerTick: 6, sellPrice: 36, stealDifficultyLabel: '쉬움~보통' },
  { id: 3, name: '레어', buyPrice: 150, incomePerTick: 15, sellPrice: 90, stealDifficultyLabel: '보통' },
  { id: 4, name: '에픽', buyPrice: 400, incomePerTick: 40, sellPrice: 240, stealDifficultyLabel: '보통~어려움' },
  { id: 5, name: '레전더리', buyPrice: 1000, incomePerTick: 100, sellPrice: 600, stealDifficultyLabel: '어려움' },
  { id: 6, name: '시크릿', buyPrice: 5000, incomePerTick: 500, sellPrice: 3000, stealDifficultyLabel: '매우 어려움' },
];

export function getGrade(gradeId: number): GradeDef {
  const grade = GRADES.find((g) => g.id === gradeId);
  if (!grade) throw new Error(`unknown gradeId: ${gradeId}`);
  return grade;
}
