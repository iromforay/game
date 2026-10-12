// 10-02 v6 §1·§3·§4: 탐험 맵의 안내 문구와 반복 억제, 복원 시도 판정, 야생 좌표의 서버 단일 정본(클라이언트 설정에 좌표가 없다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NoticeGate, POSITION_CORRECTED_TEXT, WILD_HINT_ENGAGED, WILD_HINT_NEAR, WILD_NOTICE_REPEAT_MS, WILD_UNREACHABLE_TEXT, wildNoticeKey, wildUnreachableText } from '../src/story/mapNotices.ts';
import { canLeaveToVillage, canRetry, DeferredRestore, OnceGuard, ackFailureAllowsExit, promptKindOf, RESTORE_PROMPT, RESTORE_TO_VILLAGE_TEXT, RESULT_ACK_RETRY_TEXT, RESTORE_RETRY_LABEL, RESTORE_SLOW_MS, RESTORE_TEXT, RESTORE_VILLAGE_LABEL, RestoreAttempts, shouldPromptBattle } from '../src/state/restoreAttempt.ts';
import { isUnackedResultError, recoverUnackedResult, UNACKNOWLEDGED_RESULT_CODE } from '../src/state/unackedResult.ts';
import { FALLBACK_ENCOUNTER_RADIUS_PX, resolveEncounterRadius } from '../src/net/encounterRadius.ts';
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
  // 10-06 v1 §1 확정 문구
  assert.equal(RESTORE_TEXT.slow, '연결이 늦어지고 있어요. 서버 응답을 기다리고 있어요.');
  assert.equal(RESTORE_TEXT.failed, '서버에 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
  assert.equal(RESTORE_RETRY_LABEL, '다시 시도');
  assert.equal(RESTORE_VILLAGE_LABEL, '마을 화면으로 돌아가기');
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
  assert.equal(LEGEND_LABEL.wild, '야생 터비 ▲');
  assert.deepEqual([WILD_HINT_NEAR, WILD_HINT_ENGAGED], ['가까이 가면 만날 수 있어요.', '다른 전투가 진행 중이에요.']);
  assert.deepEqual(legendEntries(['wild', 'dust', 'story'], false), ['player', 'story', 'dust', 'wild']);
});

test('조우 반경: 서버가 내려 준 값을 쓰고, 없거나 잘못된 구버전 응답에는 기본값(경고는 roomClient가 남긴다). 클라이언트에 고정 반경 상수가 없다', () => {
  assert.deepEqual(resolveEncounterRadius(25), { radius: 25, fromServer: true }, '40보다 작은 서버 값');
  assert.deepEqual(resolveEncounterRadius(400), { radius: 400, fromServer: true }, '40보다 큰 서버 값');
  for (const bad of [undefined, null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, '120', {}]) assert.deepEqual(resolveEncounterRadius(bad), { radius: FALLBACK_ENCOUNTER_RADIUS_PX, fromServer: false }, `잘못된 값 ${String(bad)}`);
  const consts = src('config/constants.ts');
  assert.doesNotMatch(consts, /ENCOUNTER_RADIUS/, '조우 반경 상수는 서버 설정 하나뿐이다');
  const map = src('scenes/MapScene.ts');
  assert.equal([...map.matchAll(/roomClient\.encounterRadius/g)].length, 3, '자동 조우 요청·제자리 판정이 모두 서버 값을 쓴다');
  assert.doesNotMatch(map, /ENCOUNTER_RADIUS/);
  const client = src('net/roomClient.ts');
  // 새 Map 상태(접속 인증·맵 입장 응답)마다 갱신 + 값이 없으면 경고
  assert.equal([...client.matchAll(/this\.setEncounterRadius\(res\.encounterRadiusPx\)/g)].length, 2);
  assert.match(client, /console\.warn\('\[room\] 서버 응답에 조우 반경이/);
});

test('자동 조우 요청은 이동을 잠그지 않는다: 같은 야생 중복만 막고, 승인될 때만 잠근다. 늦은 응답은 이미 시작된 전환·새 Map 상태를 덮지 않는다', () => {
  const map = src('scenes/MapScene.ts');
  const fn = map.slice(map.indexOf('private async triggerEncounter('), map.indexOf('const message = err instanceof RoomApiError'));
  // 요청을 보내는 동안(await 이전)에는 잠금이 없다
  const beforeAwait = fn.slice(0, fn.indexOf('await battleClient.start'));
  assert.doesNotMatch(beforeAwait, /encounterLocked\s*=\s*true/, '요청 중 이동을 잠그지 않는다');
  assert.match(beforeAwait, /marker\.encountered = true;/, '같은 야생 중복 요청만 막는다');
  // 승인 응답 뒤에만 잠그고 전투 전환을 시작한다
  assert.match(fn, /if \(stale\(\)\) return;\s*this\.encounterLocked = true;[\s\S]{0,160}this\.goPartySelect\(snapshot\);/);
  // 거부 경로는 잠금을 건드리지 않는다(이미 시작한 전투의 잠금을 풀지 않는다)
  const rejection = fn.slice(fn.indexOf('} catch (err) {'));
  assert.doesNotMatch(rejection, /encounterLocked\s*=/);
  // 늦은 응답 무시 조건: 화면이 바뀜·이미 다른 조우 승인·마커가 사라짐(새 Map 상태로 다시 맞춰짐)
  assert.match(fn, /const stale = \(\) => gen !== this\.generation \|\| !this\.sys\.isActive\(\) \|\| this\.encounterLocked \|\| !this\.markers\.includes\(marker\);/);
  assert.match(rejection, /if \(stale\(\)\) return;/);
  // 안내 억제와 재확인 제한은 그대로
  assert.match(rejection, /marker\.retryAt = Date\.now\(\) \+ WILD_RECHECK_MS;/);
  assert.match(rejection, /this\.notices\.allow\(wildNoticeKey\(marker\.index, err\.reason\), Date\.now\(\), WILD_NOTICE_REPEAT_MS\)/);
});

test('복원 실패 탈출: 다시 시도 + 마을 화면으로 돌아가기, 마을 복귀는 한 번만 요청하고 낡은 복원 응답이 마을 화면을 덮지 않는다', () => {
  assert.deepEqual([canLeaveToVillage('loading'), canLeaveToVillage('slow'), canLeaveToVillage('failed')], [false, true, true]);
  const once = new OnceGuard();
  assert.deepEqual([once.take(), once.take(), once.take(), once.used], [true, false, false, true], '여러 번 눌러도 한 번');
  const a = new RestoreAttempts();
  const pending = a.begin();
  a.begin(); // 마을 복귀가 시도를 낡은 것으로 만든다
  assert.equal(a.isCurrent(pending), false);
  const boot = src('scenes/BootScene.ts');
  const leave = boot.slice(boot.indexOf('private async leaveToVillage()'));
  assert.match(leave, /if \(!this\.escape\.take\(\)\) return;\s*this\.attempts\.begin\(\);/, '단일 요청 + 진행 중 시도 무효화');
  assert.match(leave, /await roomClient\.leaveRoomIfOnline\(\);/, '서버가 연결돼 있으면 기존 이탈 계약');
  assert.match(leave, /if \(how === 'offline' \|\| roomClient\.activeBattle\) deferredRestore\.mark\(\);/);
  assert.doesNotMatch(leave, /createRoom|startSolo|room:create/, '새 탐험 방을 만들지 않는다');
  assert.match(boot, /canLeaveToVillage\(phase\)\) this\.villageButton = pillButton/);
  const client = src('net/roomClient.ts');
  const leaveFn = client.slice(client.indexOf('async leaveRoomIfOnline()'), client.indexOf('// 1인 방 자동 생성+시작'));
  assert.match(leaveFn, /if \(!this\.online\) return 'offline';/, '서버에 닿지 않으면 요청하지 않는다');
});

test('마을: 서버를 확인하지 못한 채 돌아왔다면 연결 회복 뒤 활성 전투를 안내한다(자동으로 끌고 가지 않고, 안내에 답하기 전에는 새 활동을 막는다)', () => {
  const d = new DeferredRestore();
  assert.equal(d.isPending, false);
  assert.equal(shouldPromptBattle(d.isPending, { battleId: 'b' }), false, '일반 마을 진입은 기존 흐름(이어서 들어감)');
  d.mark();
  assert.deepEqual([shouldPromptBattle(d.isPending, { battleId: 'b' }), shouldPromptBattle(d.isPending, null)], [true, false]);
  d.clear();
  assert.equal(d.isPending, false);
  // 10-06 v3 §1 확정 문구 — 진행 중 전투와 종료 결과는 같은 문구가 아니다
  assert.deepEqual([RESTORE_PROMPT.active.text, RESTORE_PROMPT.active.button], ['진행 중인 전투가 있어요. 이어서 할까요?', '이어서 하기']);
  assert.deepEqual([RESTORE_PROMPT.result.text, RESTORE_PROMPT.result.button], ['확인하지 않은 전투 결과가 있어요.', '결과 보기']);
  assert.equal(RESTORE_TO_VILLAGE_TEXT, '마을로 돌아가는 중…');
  assert.deepEqual([promptKindOf({ phase: 'player_subturn' }), promptKindOf({ phase: 'party_select' }), promptKindOf({ phase: 'resolved' })], ['active', 'active', 'result']);
  const village = src('scenes/VillageScene.ts');
  assert.match(village, /roomClient\.on\('reconnected', \(\) => this\.checkServerBattle\(\)\)/, '연결이 돌아오면 접속 인증 결과를 다시 확인');
  assert.match(village, /if \(this\.restorePrompt\.length > 0\) return;/, '안내는 한 번만');
  assert.match(village, /this\.locked = true; \/\/ 안내에 답하기 전에는 새 활동/);
});

test('결과 확인: 결과 화면의 돌아가기 버튼이 확인 요청을 보내고, 성공(또는 서버에서 사라진 전투)일 때만 나간다. 실패하면 결과 화면을 닫지 않고 다시 시도할 수 있다. 맵 입장은 확인 신호가 아니다', () => {
  assert.equal(ackFailureAllowsExit('BATTLE_EXPIRED'), true);
  for (const code of ['RESULT_NOT_SETTLED', 'NOT_PARTICIPANT', 'BATTLE_NOT_ENDED', 'INTERNAL', undefined]) assert.equal(ackFailureAllowsExit(code), false, String(code));
  assert.match(RESULT_ACK_RETRY_TEXT, /다시 시도/);
  const battle = src('scenes/BattleScene.ts');
  const fn = battle.slice(battle.indexOf('private async confirmResultThenExit('), battle.indexOf('private renderResult()')).replace(/\r\n/g, '\n');
  assert.match(fn, /if \(this\.resultAcking\) return;/, '확인 요청은 한 번에 하나');
  assert.match(fn, /await battleClient\.ackResult\(this\.snap\.battleId\);/);
  assert.match(fn, /gen !== this\.generation\) return;[^\n]*\n\s*exit\(\);/, '오래된 응답이 새 화면을 덮지 않는다');
  const failure = fn.slice(fn.indexOf('catch (err)'), fn.indexOf('this.resultAcking = false;\n    if (!this.scene.isActive()'));
  assert.doesNotMatch(failure, /exit\(\)/, '실패 경로는 화면을 나가지 않는다');
  // 결과 화면을 실제로 그리는 버튼에서만 확인 요청을 보낸다(일반 전투만, 스토리 전투는 대화가 복원)
  assert.match(battle, /if \(story\) return this\.exitTo\(outcome, capturedIndices\);\s*void this\.confirmResultThenExit\(\(\) => this\.exitTo\(outcome, capturedIndices\)\);/);
  assert.equal([...battle.matchAll(/battleClient\.ackResult\(/g)].length, 1);
  assert.doesNotMatch(src('scenes/MapScene.ts'), /ackResult|result:ack/, '맵 입장·복귀는 확인 신호가 아니다');
  assert.match(src('net/battleClient.ts'), /'battle:result:ack'/);
});

test('복원 안내가 새 활동으로 우회되지 않는다: deferredRestore는 화면이 바뀌어도 유지되고(모듈 상태), 서버가 남은 전투 없음을 확인할 때나 사용자가 안내에 답할 때만 지워진다', () => {
  const restore = src('state/restoreAttempt.ts');
  assert.match(restore, /export const deferredRestore = new DeferredRestore\(\);/, '화면(씬)이 아닌 모듈 상태');
  const village = src('scenes/VillageScene.ts');
  assert.equal([...village.matchAll(/deferredRestore\.clear\(\)/g)].length, 2, '서버가 전투 없음을 확인할 때와 안내에 답할 때만');
  assert.match(village, /if \(!battle\) deferredRestore\.clear\(\); \/\/ 서버가 "남은 전투 없음"을 확인했다/);
  assert.match(village, /this\.locked = true; \/\/ 안내에 답하기 전에는 새 활동/);
});

test('미확인 결과 우회 방지(클라이언트): 새 활동이 거부되면 계속 시도하지 않고 그 결과 화면으로 가며, 조회가 실패하면 마을에서 복원 안내를 유지한다. 오래된 응답은 새 화면을 덮지 않는다', async () => {
  const err = Object.assign(new Error('확인하지 않은 전투 결과가 있어요. 결과를 먼저 확인해 주세요.'), { code: UNACKNOWLEDGED_RESULT_CODE, battleId: 'b-1' });
  assert.equal(isUnackedResultError(err), true);
  assert.equal(isUnackedResultError(new Error('x')), false);
  const calls: string[] = [];
  const ports = (over: Partial<Parameters<typeof recoverUnackedResult>[1]> = {}) => ({ fetchSnapshot: async (id: string) => ({ id }), showResult: () => calls.push('result'), fallbackToVillage: () => calls.push('village'), isStale: () => false, ...over });
  assert.equal(await recoverUnackedResult(new Error('다른 오류'), ports()), false, '다른 오류는 처리하지 않는다');
  assert.equal(await recoverUnackedResult(err, ports()), true);
  assert.equal(await recoverUnackedResult(err, ports({ fetchSnapshot: async () => { throw new Error('network'); } })), true);
  assert.equal(await recoverUnackedResult(Object.assign(new Error('x'), { code: UNACKNOWLEDGED_RESULT_CODE, battleId: null }), ports()), true);
  assert.equal(await recoverUnackedResult(err, ports({ isStale: () => true })), true);
  assert.deepEqual(calls, ['result', 'village', 'village'], '결과 화면 / 조회 실패·ID 없음은 마을 / 오래된 응답은 아무것도 하지 않음');
  // 새 활동 진입 네 곳이 모두 같은 복원 경로를 쓴다
  for (const f of ['scenes/MapScene.ts', 'scenes/StageSelectScene.ts', 'scenes/StoryDialogueScene.ts']) assert.match(src(f), /recoverUnackedResult\(err,/, f);
  assert.equal([...src('scenes/MapScene.ts').matchAll(/recoverUnackedResult\(err,/g)].length, 2, '맵 입장·야생 조우');
});

test('결과 확인에 성공하면 접속 인증 때 받아 둔 활성 전투 값을 비운다(이미 확인한 결과를 마을이 다시 안내하지 않는다)', () => {
  const c = src('net/battleClient.ts');
  assert.match(c, /await roomClient\.request<\{ acknowledged: true \}>\('battle:result:ack', \{ battleId \}\);\s*if \(roomClient\.activeBattle\?\.battleId === battleId\) roomClient\.activeBattle = null;/);
});
