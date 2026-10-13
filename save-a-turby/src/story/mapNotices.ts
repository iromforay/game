// 탐험 맵의 짧은 안내(10-02 v6 §3·§4.1) — 문구와 반복 억제 규칙(순수 판정, test/mapNotices.test.ts).
// 문구는 서버가 준 거부 사유 코드로만 고른다. 좌표·거리·내부 판정 값은 화면에 내지 않는다.

// 서버가 WILD_UNREACHABLE로 거부했을 때의 안내(사유별)
export const WILD_UNREACHABLE_TEXT: Record<string, string> = {
  blocked: '길이 막혀 있어요. 돌아서 가까이 가 보세요.',
  locked_zone: '아직 들어갈 수 없는 곳이에요.',
};
// 지도에서 야생 터비를 골랐을 때의 안내(10-06 v1 §1 확정 문구)
export const WILD_HINT_NEAR = '가까이 가면 만날 수 있어요.';
export const WILD_HINT_ENGAGED = '다른 전투가 진행 중이에요.';
export const WILD_NOTICE_REPEAT_MS = 3000; // 같은 야생·같은 사유의 안내는 이 시간 안에 다시 띄우지 않는다

// 재입장 위치가 유효하지 않아 서버가 시작 지점으로 보정했을 때(한 번만)
export const POSITION_CORRECTED_TEXT = '안전한 위치에서 다시 시작했어요.';

// 깊은 물에 들어가 마지막 안전 지점으로 돌아왔을 때(한 탐험 세션에서 처음 한 번만, 10-13 C2-2)
export const DEEP_WATER_TEXT = '깊은 물은 위험해. 물풀이 잔잔한 길로 가자.';

// 모르는 사유는 가장 흔한 경우(길이 막힘)로 안내한다 — 사유 코드를 그대로 보여 주지 않는다
export function wildUnreachableText(reason: string | null | undefined): string {
  return WILD_UNREACHABLE_TEXT[reason ?? ''] ?? WILD_UNREACHABLE_TEXT.blocked;
}

// 같은 키의 안내를 일정 시간 안에 반복하지 않게 한다. allow가 true를 돌려준 때만 그 시각을 기억한다
export class NoticeGate {
  private last = new Map<string, number>();

  allow(key: string, now: number, windowMs: number): boolean {
    const at = this.last.get(key);
    if (at !== undefined && now - at < windowMs) return false;
    this.last.set(key, now);
    return true;
  }

  // 한 번만 보여 줄 안내(같은 화면에서 다시 요청해도 false)
  once(key: string): boolean {
    if (this.last.has(key)) return false;
    this.last.set(key, 0);
    return true;
  }
}

export const wildNoticeKey = (index: number, reason: string | null | undefined) => `wild:${index}:${reason ?? 'blocked'}`;
