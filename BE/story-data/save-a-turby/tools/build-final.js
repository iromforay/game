// docs/scene/종장.md → BE/story-data/save-a-turby/dialogue/final.json 변환(문구는 MD 줄에서 그대로 가져온다 — 손으로 옮기지 않음).
// 실행: node BE/story-data/save-a-turby/tools/build-final.js
// 범위: 집의 중심(도착) · 다섯 기억의 결속 · 마지막 검정실(가위 → 최종 전투) · 다섯 기억의 매듭(승리) · 귀환의 대가 · 다섯 실이 풀리다 · 현실 세계.
// 10-26 F-1은 도착·결속 구간을 트리거에 연결한다. 가위 전투 이후 구간(완료 사건)은 F-3에서 전이표와 함께 연결한다.
// 연출 지시문(발동 조건·저장점 안내·전투 진행 설명·표시 명칭 처리·암전 지시)은 대사가 아니라 트리거·전이표·화면이 대신하므로 옮기지 않는다 — EXCLUDED에 근거와 함께 둔다.
const fs = require('fs');
const path = require('path');

const { docsRoot } = require('./docs-root');

const ROOT = path.resolve(__dirname, '../../../..');
const MD = path.join(docsRoot(ROOT), 'docs/scene/종장.md');
const OUT = path.join(ROOT, 'BE/story-data/save-a-turby/dialogue/final.json');
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);
const L = (n) => {
  const s = lines[n - 1];
  if (s === undefined || s.trim() === '') throw new Error(`빈 줄 참조: ${n}`);
  return s.trim();
};

const unquote = (s) => s.replace(/^“/, '').replace(/”$/, '');
const unbacktick = (s) => s.replace(/`/g, '');
const unbullet = (s) => s.replace(/^-\s+/, '');
const unbold = (s) => s.replace(/^\*\*(.+)\*\*$/, '$1');

// 화자 표기 → 화자 키. 초상화가 있는 화자만 portrait(보풀이·단수링·누비·주인공), 나머지는 null(5장과 같다)
const SPEAKER = { '{playerName}': 'player', 누비: 'nubi', 보풀이: 'bopuli', 물들이: 'muldeuli', '오래된 폭신이': 'old_pokshini', 가느리: 'ganeuri', 가위: 'scissors', 단수링: 'dansuring', 엄마: 'mother' };
const PORTRAIT = { player: 'player', nubi: 'nubi', bopuli: 'bopuli', dansuring: 'dansuring', muldeuli: null, old_pokshini: null, ganeuri: null, scissors: null, mother: null };

// 연출 지시문(옮기지 않음): 줄 번호 → 근거
const EXCLUDED = {
  38: '발동 조건(트리거 설명)',
  82: '표시 명칭 처리(누비 → 태초의 실타래 누비) → 화면이 final_identity_revealed 뒤 표시 명칭으로 처리(F-3)',
  129: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  131: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  132: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  133: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  134: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  135: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  137: '최종 전투 1단계 진행 설명 → 전투 정의(F-3)',
  141: '최종 전투 2단계 진행 설명 → 전투 정의(F-3)',
  143: '최종 전투 2단계 환영 목록 → 전투 정의(F-3)',
  144: '최종 전투 2단계 환영 목록 → 전투 정의(F-3)',
  145: '최종 전투 2단계 환영 목록 → 전투 정의(F-3)',
  146: '최종 전투 2단계 환영 목록 → 전투 정의(F-3)',
  148: '최종 전투 2단계 진행 설명 → 전투 정의(F-3)',
  296: '암전 지시(즉시 암전) → 화면 연출(F-3b)',
  298: '연출 지시(반응·추가 움직임을 보여 주지 않는다) → 화면 연출(F-3b)',
  300: '연출 지시(제목 카드) → 화면 연출(F-3b, 제목 카드 문구는 인용 블록)',
};
const PARTIAL = {};
const sentences = (s) => s.split(/(?<=다\.)\s+/);

const seq = {};
function id(seg) {
  seq[seg] = (seq[seg] ?? 0) + 1;
  return `${seg}.${String(seq[seg]).padStart(3, '0')}`;
}
const n = (seg, line, extra = {}) => ({ kind: 'narration', dialogueId: id(seg), text: unbullet(unbacktick(L(line))), cameraCue: null, soundCue: null, ...extra });
const t = (seg, line) => ({ kind: 'title', dialogueId: id(seg), text: L(line).replace(/^#+\s*/, '') });
function l(seg, labelLine, textLine, expression) {
  const label = unbold(L(labelLine));
  const speaker = SPEAKER[label];
  if (!speaker) throw new Error(`알 수 없는 화자 ${label} (${labelLine})`);
  return { kind: 'line', dialogueId: id(seg), speaker, speakerLabel: label, text: unquote(L(textLine)), portrait: PORTRAIT[speaker], expression, cameraCue: null, soundCue: null };
}
const battle = (seg, encounterKey) => ({ kind: 'storyBattle', dialogueId: id(seg), encounterKey });

function segment(segmentId, resumeFrom, replayOnResume, completesWith, build) {
  return { segmentId, resumeFrom, replayOnResume, completesWith, entries: build(segmentId) };
}

const file = {
  schemaVersion: 1,
  chapterCode: 'final',
  source: 'docs/scene/종장.md',
  segments: [
    // 금빛 길 끝(도착 지점) → final_entry_seen + CHFINAL_STARTED(정본: 집의 중심 진입과 지역 동료 합류)
    segment('final.arrival', 'CH05_COMPLETE', true, 'final_entry_seen', (s) => [
      t(s, 36),
      n(s, 40),
      n(s, 42),
      n(s, 44),
      l(s, 46, 47, 'neutral'),
      n(s, 49, { cameraCue: 'five-relics' }), // 5장 연출 재사용: 다섯 실의 유물이 동시에 빛난다
    ]),
    // 중앙의 빈자리 → final_identity_revealed + CHFINAL_IDENTITY_REVEALED
    segment('final.bind', 'CHFINAL_STARTED', true, 'final_identity_revealed', (s) => [
      t(s, 54),
      n(s, 56, { cameraCue: 'five-bind' }), // 1차 에셋 WF-FX-01
      n(s, 58),
      n(s, 60),
      l(s, 62, 63, 'neutral'),
      l(s, 65, 66, 'neutral'),
      l(s, 68, 69, 'neutral'),
      n(s, 71, { cameraCue: 'origin-fall' }), // 1차 에셋 WF-FX-02(그날의 기억)
      l(s, 73, 74, 'neutral'),
      l(s, 76, 77, 'neutral'),
      l(s, 79, 80, 'happy'),
    ]),
    // 검은 틈(F-3에서 트리거 연결): 가위 등장 → 최종 전투(한 전투 안의 3단계)
    segment('final.last_thread', 'CHFINAL_IDENTITY_REVEALED', false, null, (s) => [
      t(s, 87),
      n(s, 89),
      n(s, 91, { soundCue: 'scissors-snip' }),
      n(s, 93, { cameraCue: 'scissors-final-reveal' }), // 2차 에셋 WF-FX-01(가위 전체 — F-0 수위)
      l(s, 95, 96, 'neutral'),
      l(s, 98, 99, 'neutral'),
      l(s, 101, 102, 'neutral'),
      n(s, 104),
      l(s, 106, 107, 'neutral'),
      l(s, 109, 110, 'worried'),
      l(s, 112, 113, 'neutral'),
      n(s, 115),
      l(s, 117, 118, 'neutral'),
      n(s, 120),
      l(s, 122, 123, 'neutral'),
      battle(s, 'final_boss_scissors'),
    ]),
    // 다섯 기억의 매듭(승리) → final_boss_aftermath_seen(F-3). 정본 3단계의 동료 대사는 전투가 끝난 뒤 매듭 장면으로 이어 보여 준다
    segment('final.knot', 'CHFINAL_SCISSORS_DEFEATED', true, 'final_boss_aftermath_seen', (s) => [
      n(s, 152),
      l(s, 154, 155, 'neutral'),
      l(s, 157, 158, 'neutral'),
      l(s, 160, 161, 'neutral'),
      l(s, 163, 164, 'neutral'),
      n(s, 166, { cameraCue: 'five-knot-bind' }), // 2차 에셋 WF-FX-02(매듭이 두 날을 감는다)
      n(s, 168),
      n(s, 170),
      l(s, 172, 173, 'neutral'),
      l(s, 175, 176, 'neutral'),
      n(s, 178),
    ]),
    // 귀환의 대가(선택지 없는 고정 장면) → final_cost_accepted + CHFINAL_COST_ACCEPTED(F-3)
    segment('final.cost', 'CHFINAL_SCISSORS_DEFEATED', true, 'final_cost_accepted', (s) => [
      t(s, 183),
      n(s, 185),
      l(s, 187, 188, 'neutral'),
      l(s, 190, 191, 'neutral'),
      l(s, 193, 194, 'neutral'),
      n(s, 196),
      l(s, 198, 199, 'neutral'),
      n(s, 201),
      l(s, 203, 204, 'neutral'),
      n(s, 206),
      l(s, 208, 209, 'worried'),
      n(s, 211),
      n(s, 213),
      l(s, 215, 216, 'neutral'),
      l(s, 218, 219, 'neutral'),
      l(s, 221, 222, 'worried'),
      l(s, 224, 225, 'worried'),
      n(s, 227),
      l(s, 229, 230, 'neutral'),
      n(s, 232),
    ]),
    // 다섯 실이 풀리다(역순 해체) — 현실 세계로 이어진다
    segment('final.unravel', 'CHFINAL_COST_ACCEPTED', true, null, (s) => [
      t(s, 237),
      n(s, 239),
      n(s, 241),
      n(s, 243),
      n(s, 245),
      n(s, 247),
      n(s, 249),
      n(s, 251),
      l(s, 253, 254, 'neutral'),
      l(s, 256, 257, 'neutral'),
      n(s, 259),
      n(s, 261),
      n(s, 263),
      n(s, 265),
    ]),
    // 현실 세계 → ending_yarn_reunion_seen + ENDING_COMPLETE(F-3b). 암전·제목 카드는 화면 연출
    segment('final.real_world', 'CHFINAL_COST_ACCEPTED', true, 'ending_yarn_reunion_seen', (s) => [
      t(s, 267),
      n(s, 269),
      n(s, 271),
      n(s, 273),
      l(s, 275, 276, 'neutral'),
      n(s, 278),
      n(s, 280),
      l(s, 282, 283, 'neutral'),
      n(s, 285),
      n(s, 287),
      l(s, 289, 290, 'neutral'),
      n(s, 292),
      n(s, 294),
    ]),
  ],
};

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n', 'utf8');
  const count = file.segments.reduce((sum, s) => sum + s.entries.length, 0);
  console.log(`final.json: 구간 ${file.segments.length}개, 항목 ${count}개, 제외 지시문 ${Object.keys(EXCLUDED).length}줄`);
}
module.exports = { EXCLUDED, PARTIAL, sentences };
