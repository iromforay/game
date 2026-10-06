// 10-02 v6 §1·§3·§4: 탐험 맵의 안내 문구와 반복 억제, 복원 시도 판정, 야생 좌표의 서버 단일 정본(클라이언트 설정에 좌표가 없다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NoticeGate, POSITION_CORRECTED_TEXT, WILD_NOTICE_REPEAT_MS, WILD_UNREACHABLE_TEXT, wildNoticeKey, wildUnreachableText } from '../src/story/mapNotices.ts';
import { canRetry, RESTORE_RETRY_LABEL, RESTORE_SLOW_MS, RESTORE_TEXT, RestoreAttempts } from '../src/state/restoreAttempt.ts';
import { LEGEND_LABEL, legendEntries } from '../src/ui/screenStates.ts';

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');

test('접근 불가 야생 안내: 사유별 문구(Codex 지시 문구 그대로), 좌표·거리·사유 코드를 드러내지 않는다', () => {
  assert.equal(wildUnreachableText('blocked'), '길이 막혀 있어요. 돌아서 가까이 가 보세요.');
  assert.equal(wildUnreachableText('locked_zone'), '아직 들어갈 수 없는 곳이에요.');
  assert.equal(wildUnreachableText(null), WILD_UNREACHABLE_TEXT.blocked, '사유가 없으면 기본 안내');
  assert.equal(wildUnreachableText('tunnel'), WILD_UNREACHABLE_TEXT.blocked, '모르는 사유 코드를 그대로 보여 주지 않는다');
  for (const t of [...Object.values(WILD_UNREACHABLE_TEXT), POSITION_CORRECTED_TEXT]) assert.doesNotMatch(t, /\d|px|blocked|locked|zone|거리/, `내부 정보 없음: ${t}`);
  assert.equal(POSITION_CORRECTED_TEXT, '안전한 위치에서 다시 시작했어요.');
});

test('안내 반복 억제: 같은 야생·같은 사유는 3초 안에 다시 띄우지 않고, 다른 야생·다른 사유는 따로 센다. 위치 보정 안내는 한 번만', () => {
  assert.equal(WILD_NOTICE_REPEAT_MS, 3000);
  const gate = new NoticeGate();
  const key = wildNoticeKey(3, 'blocked');
  assert.equal(gate.allow(key, 10_000, WILD_NOTICE_REPEAT_MS), true, '처음');
  // 자동 조우 재확인(1.5초 간격)이 같은 거부를 다시 받아도 안내는 띄우지 않는다
  assert.equal(gate.allow(key, 11_500, WILD_NOTICE_REPEAT_MS), false);
  assert.equal(gate.allow(key, 12_999, WILD_NOTICE_REPEAT_MS), false);
  assert.equal(gate.allow(key, 13_000, WILD_NOTICE_REPEAT_MS), true, '3초가 지나면 다시');
  assert.equal(gate.allow(key, 14_500, WILD_NOTICE_REPEAT_MS), false, '억제 기준은 마지막으로 띄운 때');
  assert.equal(gate.allow(wildNoticeKey(5, 'blocked'), 13_100, WILD_NOTICE_REPEAT_MS), true, '다른 야생');
  assert.equal(gate.allow(wildNoticeKey(3, 'locked_zone'), 13_100, WILD_NOTICE_REPEAT_MS), true, '같은 야생의 다른 사유');
  assert.equal(wildNoticeKey(3, null), wildNoticeKey(3, 'blocked'), '사유 없음은 기본 사유와 같은 키');
  assert.deepEqual([gate.once('position-corrected'), gate.once('position-corrected'), new NoticeGate().once('position-corrected')], [true, false, true], '같은 화면에서는 한 번, 새 화면(새 재접속)은 다시 한 번');
});

test('탐험 화면: 서버 거부(WILD_UNREACHABLE)의 사유로 안내하고 1.5초 재확인 제한을 유지한다. 보정 안내는 입장 응답의 corrected에서만', () => {
  const map = src('scenes/MapScene.ts');
  assert.match(map, /const WILD_RECHECK_MS = 1500;/);
  assert.match(map, /err\.code === 'WILD_UNREACHABLE'\) \{\s*marker\.retryAt = Date\.now\(\) \+ WILD_RECHECK_MS;[\s\S]{0,200}this\.notices\.allow\(wildNoticeKey\(marker\.index, err\.reason\), Date\.now\(\), WILD_NOTICE_REPEAT_MS\)\) this\.notice\(wildUnreachableText\(err\.reason\)\)/);
  assert.match(map, /roomClient\.selfOnEnter\?\.corrected && this\.notices\.once\('position-corrected'\)\) this\.notice\(POSITION_CORRECTED_TEXT\)/);
  // 이동 중 받는 작은 보정(map:correct)에는 안내를 띄우지 않는다
  const correction = map.slice(map.indexOf('private applyCorrection('), map.indexOf('// 발밑 슬롯색 링'));
  assert.doesNotMatch(correction, /notice\(|showToast\(/);
});

test('복원 시도: 다시 시도하면 앞선 시도는 낡은 것이 된다(늦게 온 응답을 버리는 근거). 지연·실패 상태에서만 다시 시도 버튼', () => {
  const a = new RestoreAttempts();
  const first = a.begin();
  assert.equal(a.isCurrent(first), true);
  const second = a.begin();
  assert.deepEqual([a.isCurrent(first), a.isCurrent(second), a.count], [false, true, 2], '첫 시도의 응답이 늦게 와도 지금 시도가 아니다');
  const third = a.begin();
  assert.deepEqual([a.isCurrent(second), a.isCurrent(third)], [false, true], '연속 재시도');
  assert.deepEqual([canRetry('loading'), canRetry('slow'), canRetry('failed')], [false, true, true]);
  assert.ok(RESTORE_SLOW_MS >= 3000, `지연 안내는 지나치게 빨리 뜨지 않는다(${RESTORE_SLOW_MS}ms)`);
  assert.equal(RESTORE_TEXT.loading, '이어서 불러오는 중…');
  assert.match(RESTORE_TEXT.slow, /^이어서 불러오는 중…\n.*연결/, '지연: 불러오는 중임을 유지하고 연결 상태를 설명');
  assert.match(RESTORE_TEXT.failed, /연결/);
  assert.equal(RESTORE_RETRY_LABEL, '다시 시도');
  // 화면은 지금 시도의 결과만 반영하고, 재시도는 새 접속 인증(fresh)으로 보낸다 — 방을 만들지 않는다
  const boot = src('scenes/BootScene.ts');
  assert.match(boot, /if \(!this\.attempts\.isCurrent\(id\) \|\| !this\.sys\.isActive\(\)\) return;/);
  assert.match(boot, /\.connect\(\{ fresh: id > 1 \}\)/);
  assert.doesNotMatch(boot, /createRoom|startSolo|room:create/, '복원은 방을 만들지 않는다');
  const client = src('net/roomClient.ts');
  assert.match(client, /if \(seq !== this\.helloSeq\) return reject\(superseded\(\)\);/, '낡은 접속 인증 응답은 상태를 덮지 않는다');
});

test('야생 위치 단일 정본: 클라이언트 지역 설정에 야생 좌표·종류가 없고, 탐험 화면은 서버가 내려 준 마커로만 만든다', () => {
  const dir = fileURLToPath(new URL('../src/config/stages/', import.meta.url));
  for (const f of readdirSync(dir)) {
    const text = readFileSync(`${dir}${f}`, 'utf8');
    assert.doesNotMatch(text, /wildSpawns|characterCode|\bx:\s*\d|\by:\s*\d/, `${f}: 야생 좌표·종류 없음`);
  }
  const map = src('scenes/MapScene.ts');
  assert.doesNotMatch(map, /wildSpawns|WildSpawn\b/);
  // 마커를 만드는 곳은 서버 목록을 도는 syncWilds 하나뿐이다
  assert.equal([...map.matchAll(/this\.createMarker\(/g)].length, 1);
  assert.match(map, /private syncWilds\(\) \{\s*const server = roomClient\.wilds;/);
  assert.match(map, /for \(const info of server\.values\(\)\)/);
  // 조우 거리·제자리 판정·미니맵 마커 모두 서버 좌표(info)를 쓴다
  assert.match(map, /Distance\.Between\(this\.avatar\.x, this\.avatar\.y, marker\.info\.x, marker\.info\.y\)/);
  assert.match(map, /type: 'wild' as const, name: this\.characterName\(m\.info\.characterCode\), x: m\.info\.x, y: m\.info\.y/);
  // 상태 방송은 좌표까지 다시 반영한다(서버 좌표가 바뀌면 마커를 옮긴다)
  assert.match(map, /private onWildChanged\(info: WildInfo\) \{[\s\S]{0,400}m\.gfx\.setPosition\(info\.x, info\.y\);/);
  // 지도 범례: 야생 터비는 색이 아니라 모양(세모)으로 구분된다
  assert.equal(LEGEND_LABEL.wild, '야생 터비 — 세모');
  assert.deepEqual(legendEntries(['wild', 'dust', 'story'], false), ['player', 'story', 'dust', 'wild']);
});
