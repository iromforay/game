// fetch 래퍼 — import.meta·전역 설정에 의존하지 않아 node:test에서 가짜 fetch로 검증한다(test/session.test.ts).

// 서버가 { code, message }로 내려주는 게임 규칙 위반(잔액 부족 등)과 네트워크 실패를 구분하기 위한 에러
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly reason: string | null; // 서버가 함께 내려주는 세부 사유(예: NAME_INVALID의 length·characters)

  constructor(status: number, code: string | null, message: string, reason: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createHttp(baseUrl: string, fetchImpl: FetchLike) {
  async function parse<T>(path: string, res: Awaited<ReturnType<FetchLike>>): Promise<T> {
    if (!res.ok) {
      let body: { code?: string; message?: string; reason?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // 본문이 JSON이 아니면 상태코드만 사용
      }
      throw new ApiError(res.status, body.code ?? null, body.message ?? `${path} failed: ${res.status}`, typeof body.reason === 'string' ? body.reason : null);
    }
    return (await res.json()) as T;
  }

  return {
    async postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
      const res = await fetchImpl(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      return parse<T>(path, res);
    },
    async getJson<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
      return parse<T>(path, await fetchImpl(`${baseUrl}${path}`, { method: 'GET', headers }));
    },
  };
}
