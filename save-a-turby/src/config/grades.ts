// 6.1 캐릭터 등급 — 항목 수가 적고(10개) 값이 단순해 JSON 대신 TS 상수로 유지(3.1.1 기준)
export interface GradeDef {
  id: number;
  name: string;
  baseAttack: number | null;
  baseDefense: number | null;
  baseActionPower: number | null;
  baseHp: number | null;
}

export const GRADES: GradeDef[] = [
  { id: 1, name: '헌실', baseAttack: 5, baseDefense: 8, baseActionPower: 6, baseHp: 30 },
  { id: 2, name: '무명실', baseAttack: 8, baseDefense: 6, baseActionPower: 7, baseHp: 28 },
  { id: 3, name: '색실', baseAttack: 12, baseDefense: 10, baseActionPower: 7, baseHp: 35 },
  { id: 4, name: '벨벳실', baseAttack: 14, baseDefense: 18, baseActionPower: 6, baseHp: 48 },
  { id: 5, name: '금실', baseAttack: 22, baseDefense: 16, baseActionPower: 8, baseHp: 42 },
  { id: 6, name: '극세사', baseAttack: 28, baseDefense: 14, baseActionPower: 9, baseHp: 38 },
  { id: 7, name: '무지개실', baseAttack: 35, baseDefense: 30, baseActionPower: 9, baseHp: 60 },
  // 8~10등급: 스탯 미정 (docs/Save a Turby.md 6.1 참고)
  { id: 8, name: '별실', baseAttack: null, baseDefense: null, baseActionPower: null, baseHp: null },
  { id: 9, name: '태초의 실', baseAttack: null, baseDefense: null, baseActionPower: null, baseHp: null },
  { id: 10, name: '마지막 한 타래', baseAttack: null, baseDefense: null, baseActionPower: null, baseHp: null },
];
