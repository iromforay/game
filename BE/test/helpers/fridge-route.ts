// 시험용: 4장 냉장고 속 길 골격(scripts/data/fridge-skeleton.json)을 따라 걷는 경유지(10-23 C4-1). 3장 경유지와 같은 방식으로 촘촘히 나눈다.
// fridge-layout.test.ts가 같은 골격의 통과 가능성을 따로 검증한다.
import { densify } from './underfloor-route';
export type { Pt } from './underfloor-route';

// 입구 → 성에 통로(서리 구역) → 가느리 자리
export const SPAWN_TO_GANEURI = densify([[380, 2020], [800, 1900], [1250, 1900], [1520, 1680], [1680, 1600]]);
// 가느리 자리 → 바늘 통로 서쪽 앵커(바늘 칸 앞)
export const GANEURI_TO_NEEDLES = densify([[1680, 1600], [1760, 1560]]);
// 바늘 통로 동쪽 앵커 → 저장고 앞 길목
export const NEEDLES_TO_GUARD = densify([[2560, 1540], [2650, 1380], [2700, 1180], [2700, 1080]]);
// 저장고 문(열린 뒤) → 도안 벽 → 고백 지점
export const GUARD_TO_WALL = densify([[2700, 1080], [2700, 760], [2600, 560], [2600, 400]]);
export const WALL_TO_CONFESSION = densify([[2600, 400], [2400, 560], [2260, 520], [2050, 495]]);
