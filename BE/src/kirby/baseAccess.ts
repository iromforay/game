// 4.4/4.5 확정 로직 — FE(steal_a_kirby/src/state/baseAccess.ts)와 동일한 판정을 BE(서버 권위)에서도 수행.
// PvP 특성상 클라이언트를 신뢰할 수 없으므로, 진입/탈출 게이트는 반드시 서버가 이 로직으로 재검사해야 함(7번 확정).

export type LockState = 'open' | 'locked' | 'conditional';

export interface BaseAccessState {
  lockState: LockState;
  allowedUserIds: string[];
  offlineOperationEnabled: boolean;
}

/** 4.5 1단계: 오프라인 + 운영 미사용이면 기지 자체가 존재하지 않음(침입 시도 불가). */
export function baseExists(access: BaseAccessState, ownerIsOnline: boolean): boolean {
  if (ownerIsOnline) return true;
  return access.offlineOperationEnabled;
}

/** 4.4 2단계: 기지가 존재하는 경우에 한해, 잠금 상태로 최종 진입 가능 여부를 판정. */
export function isEntryAllowed(access: BaseAccessState, viewerUserId: string): boolean {
  switch (access.lockState) {
    case 'open':
      return true;
    case 'locked':
      return false;
    case 'conditional':
      return access.allowedUserIds.includes(viewerUserId);
  }
}

/** 5.1의 "①기지 존재 여부(4.5) → ②잠금 상태(4.4)" 순서 — 진입/탈출 게이트 둘 다 이 함수로 재검사. */
export function canInvade(access: BaseAccessState, ownerIsOnline: boolean, viewerUserId: string): boolean {
  if (!baseExists(access, ownerIsOnline)) return false;
  return isEntryAllowed(access, viewerUserId);
}
