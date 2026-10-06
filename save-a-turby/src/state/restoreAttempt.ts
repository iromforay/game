// 새로고침·재접속 복원 화면의 진행 상태(10-02 v6 §4.2, 10-06 v1 §1·§6) — 순수 판정(test/mapNotices.test.ts).
// 화면은 "지금 시도"의 결과만 반영한다: 다시 시도하면 앞선 시도의 응답(성공이든 실패든)은 버린다.

export const RESTORE_SLOW_MS = 4000; // 이 시간 넘게 응답이 없으면 연결 상태를 설명하고 다시 시도·마을 복귀 버튼을 보인다

export type RestorePhase = 'loading' | 'slow' | 'failed';

export const RESTORE_TEXT: Record<RestorePhase, string> = {
  loading: '이어서 불러오는 중…',
  slow: '연결이 늦어지고 있어요. 서버 응답을 기다리고 있어요.', // 10-06 v1 §1 확정 문구
  failed: '서버에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.', // 10-06 v1 §1 확정 문구
};
export const RESTORE_RETRY_LABEL = '다시 시도';
export const RESTORE_VILLAGE_LABEL = '마을 화면으로 돌아가기';

// 다시 시도·마을 복귀 버튼을 보이는 상태. 응답을 기다리는 중(slow)에도 마을로 나갈 수 있어야 한다(끝없이 기다리게 하지 않는다)
export const canRetry = (phase: RestorePhase) => phase !== 'loading';
export const canLeaveToVillage = canRetry;

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

// 한 번만 실행되게 한다(마을 복귀 버튼을 여러 번 눌러도 요청은 한 번)
export class OnceGuard {
  private taken = false;

  take(): boolean {
    if (this.taken) return false;
    this.taken = true;
    return true;
  }

  get used() {
    return this.taken;
  }
}

// 서버를 확인하지 못한 채(또는 서버 확인을 건너뛰고) 마을로 돌아왔다는 표시.
// 마을에서 서버 연결이 돌아오면 접속 인증 결과를 다시 확인하고, 서버에 활성 전투가 남아 있으면 새 활동을 시작하기 전에 복원 안내를 다시 보인다.
export class DeferredRestore {
  private pending = false;

  mark() {
    this.pending = true;
  }

  get isPending() {
    return this.pending;
  }

  clear() {
    this.pending = false;
  }
}
export const deferredRestore = new DeferredRestore();

// 마을 화면: 서버에 남은 전투를 알릴 때(10-06 v3 §1 확정 문구). 진행 중 전투와 종료된 전투 결과는 같은 문구로 표시하지 않는다
export const RESTORE_PROMPT = {
  active: { text: '진행 중인 전투가 있어요. 이어서 할까요?', button: '이어서 하기' },
  result: { text: '확인하지 않은 전투 결과가 있어요.', button: '결과 보기' },
} as const;
export const RESTORE_TO_VILLAGE_TEXT = '마을로 돌아가는 중…';
export const promptKindOf = (battle: { phase: string }): keyof typeof RESTORE_PROMPT => (battle.phase === 'resolved' ? 'result' : 'active');
export const shouldPromptBattle = (deferredPending: boolean, activeBattle: unknown): boolean => deferredPending && !!activeBattle;

// 결과 확인 요청의 실패 처리(10-06 v3 §2): 서버에 사라진 전투(보존 기간 지남)는 더 확인할 것이 없어 계속 진행하고, 그 밖의 실패는 결과 화면을 닫지 않고 다시 시도하게 한다
export const RESULT_ACK_RETRY_TEXT = '결과를 확인하지 못했어요. 다시 시도해 주세요.';
export const ackFailureAllowsExit = (code: string | undefined): boolean => code === 'BATTLE_EXPIRED';
