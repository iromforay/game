import kirbiesJson from './kirbies.json';
import { getGrade, type GradeDef } from '../config/grades';

export interface KirbyDef {
  code: string;
  name: string;
  gradeId: number;
  weight: number;
  imageKey: string | null;
}

export const KIRBIES: KirbyDef[] = kirbiesJson as KirbyDef[];

const TOTAL_WEIGHT = KIRBIES.reduce((sum, k) => sum + k.weight, 0);

// 3.2/7번 확정: 등장 확률은 백분율이 아니라 자연수 weight로 저장하고, weight/전체weight합으로 런타임 계산
export function pickWeightedRandomKirby(): KirbyDef {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const kirby of KIRBIES) {
    roll -= kirby.weight;
    if (roll <= 0) return kirby;
  }
  return KIRBIES[KIRBIES.length - 1];
}

export function kirbyGrade(kirby: KirbyDef): GradeDef {
  return getGrade(kirby.gradeId);
}
