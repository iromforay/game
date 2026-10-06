// 새로고침·재접속 복원 화면의 진행 상태(10-02 v6 §4.2) — 순수 판정(test/restoreAttempt.test.ts).
// 화면은 "지금 시도"의 결과만 반영한다: 다시 시도하면 앞선 시도의 응답(성공이든 실패든)은 버린다.

export const RESTORE_SLOW_MS = 4000; // 이 시간 넘게 응답이 없으면 연결 상태를 설명하고 다시 시도 버튼을 보인다

export type RestorePhase = 'loading' | 'slow' | 'failed';

export const RESTORE_TEXT: Record<RestorePhase, string> = {
  loading: '이어서 불러오는 중…',
  slow: '이어서 불러오는 중…\n연결이 늦어지고 있어요. 서버 응답을 기다리고 있어요.',
  failed: '서버에 연결하지 못했어요.\n연결 상태를 확인하고 다시 시도해 주세요.',
};
export const RESTORE_RETRY_LABEL = '다시 시도';

// 다시 시도 버튼을 보이는 상태
export const canRetry = (phase: RestorePhase) => phase !== 'loading';

export class RestoreAttempts {
  private current = 0;

  // 새 시도를 시작한다 — 이전 시도는 그 순간 낡은 것이 된다
  begin(): number {
    return ++this.current;
  }

  isCurrent(id: number): boolean {
    return id === this.current;
  }

  get count(): number {
    return this.current;
  }
}
