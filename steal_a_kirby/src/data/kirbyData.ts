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

// 좌대 캐릭터 추첨은 서버(PlayerService.rollOffer)만 한다 — 2026-09-28 FE 추첨 제거(보이는 캐릭터와 구매 캐릭터 불일치 버그).

export function kirbyGrade(kirby: KirbyDef): GradeDef {
  return getGrade(kirby.gradeId);
}
