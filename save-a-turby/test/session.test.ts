// 스토리 M1-B 프런트 세션 흐름 테스트 — node --test(Node 22 타입 제거)로 실행한다. 브라우저·Vite 없이 순수 모듈만 검증.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager, SessionLostError, helloPayload, SESSION_HEADER, type KeyValueStorage } from '../src/state/session.ts';
import { ApiError, createHttp, type FetchLike } from '../src/api/http.ts';
import { createMeApi } from '../src/api/meApi.ts';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

// 서버 흉내: 유효 토큰 목록을 들고 X-Turby-Session을 검사한다
function fakeServer(valid: Set<string>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = init?.headers ?? {};
    seen.push({ url, headers });
    const token = headers[SESSION_HEADER];
    if (!token || !valid.has(token)) return { ok: false, status: 401, json: async () => ({ code: token ? 'SESSION_INVALID' : 'SESSION_REQUIRED', message: 'no' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, token }) };
  };
  return { seen, fetchImpl };
}

test('HTTP /player/me 요청과 소켓 hello가 같은 토큰을 보낸다', async () => {
  const storage = memoryStorage();
  const session = new SessionManager('dev-uuid-1', storage, async () => ({ sessionToken: 'unused' }));
  session.accept('tok-A');
  const server = fakeServer(new Set(['tok-A']));
  const me = createMeApi(createHttp('http://be', server.fetchImpl), session);
  await me.get('/items');
  await me.post('/turby/7/bag', {});
  assert.deepEqual(server.seen.map((s) => [s.url, s.headers[SESSION_HEADER]]), [
    ['http://be/player/me/items', 'tok-A'],
    ['http://be/player/me/turby/7/bag', 'tok-A'],
  ]);
  assert.ok(!server.seen.some((s) => /\/player\/\d+\//.test(s.url)), 'URL에 playerId를 넣지 않는다');
  assert.deepEqual(helloPayload('dev-uuid-1', session.current()), { deviceUuid: 'dev-uuid-1', sessionToken: 'tok-A' });
  assert.deepEqual(helloPayload('dev-uuid-1', null), { deviceUuid: 'dev-uuid-1' }, '토큰이 없으면 보내지 않음(구 BE 호환)');
});

test('새로고침 뒤 저장된 토큰을 다시 쓴다(기기 식별자별 저장)', () => {
  const storage = memoryStorage();
  new SessionManager('dev-uuid-1', storage, async () => ({})).accept('tok-A');
  assert.equal(new SessionManager('dev-uuid-1', storage, async () => ({})).current(), 'tok-A');
  assert.equal(new SessionManager('dev-uuid-2', storage, async () => ({})).current(), null, '다른 기기 식별자의 토큰은 쓰지 않음');
  const broken: KeyValueStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
  const s = new SessionManager('dev-uuid-1', broken, async () => ({}));
  s.accept('tok-B');
  assert.equal(s.current(), 'tok-B', '저장소가 막혀도 메모리로 동작');
});

test('토큰 거부: 재식별은 한 번만(동시 요청도 공유), 새 토큰으로 다시 시도', async () => {
  const storage = memoryStorage();
  let identifyCalls = 0;
  const valid = new Set<string>();
  const session = new SessionManager('dev-uuid-1', storage, async () => {
    identifyCalls++;
    valid.add('tok-NEW');
    return { sessionToken: 'tok-NEW' };
  });
  session.accept('tok-OLD'); // 서버에서 이미 무효(위조·만료와 같음)
  const server = fakeServer(valid);
  const me = createMeApi(createHttp('http://be', server.fetchImpl), session);
  const results = await Promise.all([me.get<{ token: string }>('/items'), me.get<{ token: string }>('/turby'), me.get<{ token: string }>('/inventory')]);
  assert.equal(identifyCalls, 1);
  assert.deepEqual(results.map((r) => r.token), ['tok-NEW', 'tok-NEW', 'tok-NEW']);
  assert.equal(storage.data.get('turby_session_token:dev-uuid-1'), 'tok-NEW');
  assert.equal(session.state, 'ready');
});

test('재식별 뒤에도 거부되면 재접속 안내 상태로 바꾸고 더 이상 요청·재식별하지 않는다', async () => {
  let identifyCalls = 0;
  const session = new SessionManager('dev-uuid-1', memoryStorage(), async () => {
    identifyCalls++;
    return { sessionToken: 'tok-STILL-BAD' };
  });
  session.accept('tok-OLD');
  const states: string[] = [];
  session.onChange((s) => states.push(s));
  const server = fakeServer(new Set()); // 어떤 토큰도 통과하지 않음
  const me = createMeApi(createHttp('http://be', server.fetchImpl), session);

  await assert.rejects(me.get('/items'), (e: ApiError) => e.code === 'SESSION_INVALID');
  assert.equal(session.state, 'reconnect_required');
  const requestsSoFar = server.seen.length;
  await assert.rejects(me.get('/items'), SessionLostError);
  await assert.rejects(me.get('/turby'), SessionLostError);
  assert.equal(server.seen.length, requestsSoFar, '안내 상태에서는 네트워크 요청을 보내지 않음');
  assert.equal(identifyCalls, 1, '재식별은 한 번뿐');
  assert.deepEqual(states, ['reconnect_required'], '재식별로 받은 토큰은 이미 ready라 알림 없음, 최종 거부만 알림');
});

test('재식별 자체가 실패해도(서버 다운 등) 반복하지 않고 안내 상태', async () => {
  let identifyCalls = 0;
  const session = new SessionManager('dev-uuid-1', memoryStorage(), async () => {
    identifyCalls++;
    throw new Error('network down');
  });
  session.accept('tok-OLD');
  const me = createMeApi(createHttp('http://be', fakeServer(new Set()).fetchImpl), session);
  await assert.rejects(me.get('/items'), SessionLostError);
  await assert.rejects(me.get('/items'), SessionLostError);
  assert.equal(identifyCalls, 1);
  assert.equal(session.state, 'reconnect_required');
});

test('세션과 무관한 오류(잔액 부족 등)는 재식별하지 않고 그대로 전달', async () => {
  let identifyCalls = 0;
  const session = new SessionManager('dev-uuid-1', memoryStorage(), async () => {
    identifyCalls++;
    return { sessionToken: 'x' };
  });
  session.accept('tok-A');
  const fetchImpl: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ code: 'INSUFFICIENT_TARE', message: '타레가 부족합니다.' }) });
  const me = createMeApi(createHttp('http://be', fetchImpl), session);
  await assert.rejects(me.post('/shop/purchase', {}), (e: ApiError) => e.code === 'INSUFFICIENT_TARE');
  assert.equal(identifyCalls, 0);
  assert.equal(session.state, 'ready');
});
