// 시험용: 5장 보일러 옆 사막 길 골격(scripts/data/desert-skeleton.json)을 따라 걷는 경유지(10-26 C5-1). 3·4장 경유지와 같은 방식으로 촘촘히 나눈다.
// desert-layout.test.ts가 같은 골격의 통과 가능성을 따로 검증한다.
import { densify } from './underfloor-route';
export type { Pt } from './underfloor-route';

// 초입 → 단서 길 지점
export const SPAWN_TO_CLUES = densify([[400, 2020], [900, 1900], [1150, 1885]]);
// 단서 길 → 능선 앞 전투 지점
export const CLUES_TO_SCORCHED = densify([[1150, 1885], [1300, 1880], [1500, 1760], [1640, 1690]]);
// 능선 앞 → 첫째 틈 앞 물들이(뜨거운 모래 안)
export const SCORCHED_TO_PAD = densify([[1640, 1690], [1850, 1700], [2150, 1700], [2150, 1590]]);
// 첫째 틈(열린 뒤) → 둘째 틈 앞 폭신이
export const PAD_TO_SCENT = densify([[2150, 1590], [2150, 1250], [2650, 1250], [2650, 1170]]);
// 둘째 틈(열린 뒤) → 셋째 틈 앞 가느리
export const SCENT_TO_THREAD = densify([[2650, 1170], [2650, 880], [2950, 880], [2950, 830]]);
// 셋째 틈(열린 뒤) → 절단면 → 금빛 마감실 입구
export const THREAD_TO_CUT = densify([[2950, 830], [2950, 600], [2950, 470]]);
export const CUT_TO_BOSS = densify([[2950, 470], [2800, 470], [2380, 470]]);
