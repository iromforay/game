import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../color-blasters/src/styles.css', import.meta.url), 'utf8');

test('컬러 블래스터즈 스타일은 허브의 html·body·root 스크롤을 막지 않는다', () => {
  assert.doesNotMatch(css, /(?:^|,)\s*(?:html|body|#root)\b[^{}]*\{[^}]*overflow\s*:\s*hidden/is);
});
