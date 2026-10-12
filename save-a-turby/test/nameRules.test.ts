// 이름 입력 안내(서버 D5 규칙과 같은 기준)와 서버 사유 문구
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precheckName, nameReasonMessage } from '../src/story/nameRules.ts';

test('입력 중 안내 검사: 서버 규칙과 같은 기준', () => {
  assert.deepEqual(precheckName('  하늘 '), { ok: true, name: '하늘' });
  assert.deepEqual(precheckName('Kim 하늘'), { ok: true, name: 'Kim 하늘' });
  assert.equal(precheckName('').ok, false);
  assert.equal(precheckName('하  늘').ok, false);
  assert.equal(precheckName('하늘!').ok, false);
  assert.equal(precheckName('가나다라마바사아자차카').ok, false);
  assert.equal(precheckName('터비 탐험가').ok, false);
});

test('서버 거절 사유마다 화면 문구가 있다(모르는 사유는 기본 문구)', () => {
  for (const r of ['length', 'characters', 'default_name', 'banned_word']) assert.notEqual(nameReasonMessage(r), nameReasonMessage(null));
  assert.equal(nameReasonMessage('unknown'), '이 이름은 사용할 수 없어요.');
});
