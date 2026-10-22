import assert from 'node:assert/strict';
import test from 'node:test';
import { FALLBACK_ENCOUNTER_RADIUS_PX, resolveEncounterRadius } from '../../save-a-turby/src/net/encounterRadius.ts';
import { precheckName, nameReasonMessage } from '../../save-a-turby/src/story/nameRules.ts';
import { helloPayload, isSessionRejection, sessionHeaders } from '../../save-a-turby/src/state/session.ts';

test('플레이어 이름은 1~10자의 한글·영문·숫자와 한 칸 공백만 허용한다', () => {
  assert.deepEqual(precheckName(' 누비123 '), { ok: true, name: '누비123' });
  assert.equal(precheckName('').ok, false);
  assert.equal(precheckName('12345678901').ok, false);
  assert.deepEqual(precheckName('두  칸'), { ok: false, reason: 'characters' });
});

test('기본 이름과 서버 거절 사유를 사용자 문구로 변환한다', () => {
  assert.deepEqual(precheckName('터비 탐험가'), { ok: false, reason: 'default_name' });
  assert.match(nameReasonMessage('banned_word'), /사용할 수 없는 단어/);
  assert.match(nameReasonMessage('unknown'), /사용할 수 없어요/);
});

test('서버 조우 반경은 양수일 때만 사용한다', () => {
  assert.deepEqual(resolveEncounterRadius(72), { radius: 72, fromServer: true });
  for (const invalid of [0, -1, Number.NaN, '40', null]) {
    assert.deepEqual(resolveEncounterRadius(invalid), { radius: FALLBACK_ENCOUNTER_RADIUS_PX, fromServer: false });
  }
});

test('세션 토큰은 HTTP 헤더와 소켓 hello payload에 동일하게 전달된다', () => {
  assert.deepEqual(sessionHeaders('token-1'), { 'X-Turby-Session': 'token-1' });
  assert.deepEqual(sessionHeaders(null), {});
  assert.deepEqual(helloPayload('device-1', 'token-1'), { deviceUuid: 'device-1', sessionToken: 'token-1' });
  assert.deepEqual(helloPayload('device-1', null), { deviceUuid: 'device-1' });
});

test('정해진 세션 오류 코드만 재식별 대상으로 판단한다', () => {
  assert.equal(isSessionRejection({ status: 401, code: 'SESSION_INVALID' }), true);
  assert.equal(isSessionRejection({ status: 500, code: 'OTHER' }), false);
  assert.equal(isSessionRejection(null), false);
});
