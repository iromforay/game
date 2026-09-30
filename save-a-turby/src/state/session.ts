// 스토리 M1-B: 서버 identify()가 발급한 세션 토큰 보관·전송·재식별.
// - HTTP /player/me/* 는 X-Turby-Session 헤더, 소켓 presence:hello 는 body.sessionToken 으로 같은 토큰을 보낸다.
// - 토큰은 기기 식별자(device_uuid)별로 localStorage에 둔다. 새로고침·재접속 뒤 그대로 다시 쓴다.
// - 토큰이 거부되면 재식별은 "한 번만" 한다. 그래도 실패하면 재접속 안내 상태로 바꾸고 더 시도하지 않는다.
// import.meta·DOM에 의존하지 않아 node:test로 바로 검증한다(test/session.test.ts).

export const SESSION_HEADER = 'X-Turby-Session';
export const SESSION_ERROR_CODES = new Set(['SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_PLAYER_MISMATCH']);

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SessionState = 'unknown' | 'ready' | 'reconnect_required';

// 서버가 세션 문제로 거절했는지(401/403 + 세션 오류 코드)
export function isSessionRejection(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown } | null;
  return !!e && typeof e.code === 'string' && SESSION_ERROR_CODES.has(e.code);
}

export function sessionHeaders(token: string | null): Record<string, string> {
  return token ? { [SESSION_HEADER]: token } : {};
}

export function helloPayload(deviceUuid: string, token: string | null): { deviceUuid: string; sessionToken?: string } {
  return token ? { deviceUuid, sessionToken: token } : { deviceUuid };
}

export class SessionManager {
  private token: string | null = null;
  private stateValue: SessionState = 'unknown';
  private reidentifying: Promise<string> | null = null;
  private reidentifyUsed = false;
  private listeners = new Set<(state: SessionState) => void>();
  private readonly deviceUuid: string;
  private readonly storage: KeyValueStorage | null;
  private readonly identify: () => Promise<{ sessionToken?: string }>;

  // identify: 서버 identify를 다시 불러 새 토큰을 받아 오는 함수(identify 응답 전체 처리는 호출한 쪽이 한다)
  constructor(deviceUuid: string, storage: KeyValueStorage | null, identify: () => Promise<{ sessionToken?: string }>) {
    this.deviceUuid = deviceUuid;
    this.storage = storage;
    this.identify = identify;
    try {
      this.token = storage?.getItem(this.key()) ?? null;
    } catch {
      this.token = null; // 저장소 사용 불가 — 이번 실행 동안만 메모리로
    }
  }

  get state(): SessionState {
    return this.stateValue;
  }

  current(): string | null {
    return this.token;
  }

  onChange(fn: (state: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // identify 응답을 받을 때마다 호출. 토큰이 없으면(구 BE) 저장된 값을 지우지 않고 그대로 둔다.
  accept(token: string | undefined) {
    if (!token) return;
    this.token = token;
    try {
      this.storage?.setItem(this.key(), token);
    } catch {
      // 저장 실패는 무시 — 메모리 값으로 계속 동작
    }
    this.setState('ready');
  }

  // 세션이 필요한 호출을 감싼다. 세션 거절이면 재식별 1회 후 한 번만 다시 시도한다.
  async run<T>(call: (token: string | null) => Promise<T>): Promise<T> {
    if (this.stateValue === 'reconnect_required') throw new SessionLostError();
    try {
      return await call(this.token);
    } catch (err) {
      if (!isSessionRejection(err)) throw err;
      const fresh = await this.reidentifyOnce();
      try {
        return await call(fresh);
      } catch (retryErr) {
        if (isSessionRejection(retryErr)) this.lose();
        throw retryErr;
      }
    }
  }

  // 동시에 여러 요청이 거절돼도 재식별은 한 번만(같은 Promise 공유). 한 번 쓴 뒤에는 다시 하지 않는다.
  reidentifyOnce(): Promise<string> {
    if (this.reidentifying) return this.reidentifying;
    if (this.reidentifyUsed) {
      this.lose();
      return Promise.reject(new SessionLostError());
    }
    this.reidentifyUsed = true;
    this.clearStored();
    this.reidentifying = this.identify()
      .then((res) => {
        if (!res.sessionToken) throw new SessionLostError();
        this.accept(res.sessionToken);
        return res.sessionToken;
      })
      .catch((err) => {
        this.lose();
        throw err instanceof SessionLostError ? err : new SessionLostError();
      })
      .finally(() => {
        this.reidentifying = null;
      });
    return this.reidentifying;
  }

  // 재접속 안내 화면에서 사용자가 "다시 시도"를 눌렀을 때만 초기화
  resetAfterUserRetry() {
    this.reidentifyUsed = false;
    this.setState(this.token ? 'ready' : 'unknown');
  }

  private lose() {
    this.setState('reconnect_required');
  }

  private clearStored() {
    this.token = null;
    try {
      this.storage?.removeItem(this.key());
    } catch {
      // 무시
    }
  }

  private setState(state: SessionState) {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.listeners.forEach((fn) => fn(state));
  }

  private key() {
    return `turby_session_token:${this.deviceUuid}`;
  }
}

export class SessionLostError extends Error {
  readonly code = 'SESSION_LOST';

  constructor() {
    super('접속 정보를 확인할 수 없습니다. 게임을 다시 시작해 주세요.');
  }
}
