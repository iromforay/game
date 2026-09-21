// 기지 층별 계단 재설계 — to_claude_v2_C(2026-09-21, Codex 최종본) 명세를 그대로 옮긴 공통 정의.
// 관리·선택·침입/방어 모든 모드가 이 하나의 정의를 공유한다(층 번호는 명세와 동일하게 1부터).
export type StairType = 'up' | 'down';

export interface StairDef {
  type: StairType;
  shaft: 'A' | 'B'; // A: 1↔2층, B: 2↔3층
  x: number;
  y: number;
  targetFloor: number;
  arrivalX: number;
  arrivalY: number;
}

export const FLOOR_STAIRS: Record<number, StairDef[]> = {
  1: [{ type: 'up', shaft: 'A', x: 820, y: 180, targetFloor: 2, arrivalX: 820, arrivalY: 340 }],
  2: [
    { type: 'up', shaft: 'B', x: 460, y: 180, targetFloor: 3, arrivalX: 460, arrivalY: 340 },
    { type: 'down', shaft: 'A', x: 820, y: 180, targetFloor: 1, arrivalX: 820, arrivalY: 340 },
  ],
  3: [{ type: 'down', shaft: 'B', x: 460, y: 180, targetFloor: 2, arrivalX: 460, arrivalY: 340 }],
};

export const STAIR_TRIGGER_RADIUS = 72; // 캐릭터 발 중심 ↔ 계단 중심
export const STAIR_MARKER_RADIUS = 160; // 방향 마커 표시 반경
export const STAIR_MARKER_OFFSET_Y = -112;
export const STAIR_INPUT_LOCK_MS = 750; // 층 이동 직후 입력 잠금(보조 안전장치)
export const STAIR_PIVOT_Y = 0.72;
