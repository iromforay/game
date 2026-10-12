// 세션 토큰 기반 /player/me/* 호출 묶음. URL에 playerId를 넣지 않는다(서버가 토큰으로 플레이어를 정함).
// 순수 모듈 — client.ts가 실제 fetch·세션을 넣어 만든다. 테스트는 가짜 fetch를 넣는다.
import type { createHttp } from './http.ts';
import { sessionHeaders, type SessionManager } from '../state/session.ts';

type Http = ReturnType<typeof createHttp>;

export function createMeApi(http: Http, session: SessionManager) {
  const get = <T>(path: string) => session.run((token) => http.getJson<T>(`/player/me${path}`, sessionHeaders(token)));
  const post = <T>(path: string, body: unknown) => session.run((token) => http.postJson<T>(`/player/me${path}`, body, sessionHeaders(token)));
  return { get, post };
}
