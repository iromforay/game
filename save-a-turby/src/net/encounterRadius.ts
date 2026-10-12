// 조우 반경(px) — 서버 설정(battle.encounterRadiusPx)이 유일한 정본이다(10-06 v1 §3).
// 서버가 Map 계약(map:enter·presence:hello 응답)으로 내려 주는 값을 자동 조우 요청과 가까움 판정에 그대로 쓴다.
// 구버전 서버처럼 값이 없거나 잘못된 응답에는 안전한 기본값을 쓰고 경고를 남긴다. 서버 판정이 최종 정본이라 기본값이 틀려도 조우가 잘못 승인되지는 않는다.
// 반경 숫자는 사용자 화면에 보이지 않는다.

export const FALLBACK_ENCOUNTER_RADIUS_PX = 40;

export interface EncounterRadius {
  radius: number;
  fromServer: boolean; // false면 서버 응답에 쓸 만한 값이 없어 기본값을 쓴 것
}

export function resolveEncounterRadius(raw: unknown): EncounterRadius {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return { radius: raw, fromServer: true };
  return { radius: FALLBACK_ENCOUNTER_RADIUS_PX, fromServer: false };
}
