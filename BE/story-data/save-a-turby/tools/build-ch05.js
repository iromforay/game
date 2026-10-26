// docs/scene/5장.md → BE/story-data/save-a-turby/dialogue/ch05.json 변환(문구는 MD 줄에서 그대로 가져온다 — 손으로 옮기지 않음).
// 실행: node BE/story-data/save-a-turby/tools/build-ch05.js
// 범위: 뜨거운 침묵 · 말하지 못한 결론(능선 앞 전투) · 뜨거운 모래 능선(동료 셋·절단면) · 황금 재단인형(도입·전투·승리) · 가위 · 마지막 마감.
// 연출 지시문(발동 조건·저장점 안내·전투 진행 설명)은 대사가 아니라 트리거·전이표가 대신하므로 옮기지 않는다 — EXCLUDED에 근거와 함께 둔다.
const fs = require('fs');
const path = require('path');

const { docsRoot } = require('./docs-root');

const ROOT = path.resolve(__dirname, '../../../..');
const MD = path.join(docsRoot(ROOT), 'docs/scene/5장.md');
const OUT = path.join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch05.json');
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);
const L = (n) => {
  const s = lines[n - 1];
  if (s === undefined || s.trim() === '') throw new Error(`빈 줄 참조: ${n}`);
  return s.trim();
};

const unquote = (s) => s.replace(/^“/, '').replace(/”$/, '');
const unbacktick = (s) => s.replace(/`/g, ''); // 줄 전체(`서걱.`)·줄 안(`집의 중심`)의 표기용 백틱을 모두 뗀다
const unbullet = (s) => s.replace(/^-\s+/, '');
const unbold = (s) => s.replace(/^\*\*(.+)\*\*$/, '$1');

// 화자 표기 → 화자 키. 동료·가위는 초상화 에셋이 없어 portrait null(4장 가느리와 같은 방식)
const SPEAKER = { '{playerName}': 'player', 누비: 'nubi', 물들이: 'muldeuli', '오래된 폭신이': 'old_pokshini', 가느리: 'ganeuri', 가위: 'scissors' };
const PORTRAIT = { player: 'player', nubi: 'nubi', muldeuli: null, old_pokshini: null, ganeuri: null, scissors: null };

// 연출 지시문(옮기지 않음): 줄 번호 → 근거
const EXCLUDED = {
  37: '발동 조건(트리거 설명)',
  55: '중간 저장점 안내(CH05_STARTED — 전이표)',
  56: '중간 저장점 안내(CH05_STARTED — 전이표)',
  80: '중간 저장점 안내(CH05_CLUES_JOINED — 전이표)',
  81: '중간 저장점 안내(CH05_CLUES_JOINED — 전이표)',
  103: '중간 저장점 안내(CH05_RIDGE_CROSSED — 전이표)',
  104: '중간 저장점 안내(CH05_RIDGE_CROSSED — 전이표)',
  113: '보스 전투 진행 설명 → storyBattle desert_boss_golden_doll와 전투 정의(줄 절단·동료 복구·금빛 연결점)',
  125: '중간 저장점 안내(CH05_BOSS_DEFEATED — 전이표)',
  126: '중간 저장점 안내(CH05_BOSS_DEFEATED — 전이표)',
  158: '중간 저장점 안내(CH05_SCISSORS_REVEALED — 전이표)',
  159: '중간 저장점 안내(CH05_SCISSORS_REVEALED — 전이표)',
  188: '중간 저장점 안내(CH05_COMPLETE — 전이표)',
  189: '중간 저장점 안내(CH05_COMPLETE — 전이표)',
};

// 한 줄에 서술과 조작 설명이 섞인 줄: 서술 문장만 원문 그대로 옮긴다(문장 번호는 0부터)
// 115: 앞 문장(외부 공격으로 끊을 수 없다)은 전투 진행 설명 → 안쪽 검은 연결의 피해 0·누비 전용 풀기(전투 정의)가 대신한다
const PARTIAL = {
  115: { keep: [1], reason: '앞 문장은 전투 진행 설명 → 누비 전용 풀기(C5-3)' },
};
const sentences = (s) => s.split(/(?<=다\.)\s+/);

const seq = {};
function id(seg) {
  seq[seg] = (seq[seg] ?? 0) + 1;
  return `${seg}.${String(seq[seg]).padStart(3, '0')}`;
}
const n = (seg, line, extra = {}) => ({ kind: 'narration', dialogueId: id(seg), text: unbullet(unbacktick(L(line))), cameraCue: null, soundCue: null, ...extra });
const ns = (seg, line, index) => ({ kind: 'narration', dialogueId: id(seg), text: sentences(L(line))[index], cameraCue: null, soundCue: null });
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
  chapterCode: 'ch05',
  source: 'docs/scene/5장.md',
  segments: [
    // 사막 초입에 들어서면(지역 진입 트리거) 도입 → desert_entry_seen + CH05_STARTED
    segment('ch05.entry', 'CH04_COMPLETE', true, 'desert_entry_seen', (s) => [
      t(s, 35),
      n(s, 39),
      n(s, 41),
      l(s, 43, 44, 'neutral'),
      n(s, 46),
      l(s, 48, 49, 'neutral'),
      n(s, 51),
      n(s, 53),
    ]),
    // 단서 길 → desert_clues_seen + CH05_CLUES_JOINED(정본: 단서를 거의 완성했지만 정체를 말하지 않은 장면을 저장)
    segment('ch05.clues', 'CH05_STARTED', true, 'desert_clues_seen', (s) => [
      t(s, 58),
      n(s, 60),
      l(s, 62, 63, 'neutral'),
      l(s, 65, 66, 'neutral'),
      l(s, 68, 69, 'neutral'),
      n(s, 71),
      l(s, 73, 74, 'neutral'),
      n(s, 76),
    ]),
    // 능선 앞: 지문 → 전투. 승리하면 서버가 desert_scorched_won(능선 첫 틈 앞 물들이 지점 열림, 체크포인트 유지) 기록
    segment('ch05.scorched', 'CH05_CLUES_JOINED', false, null, (s) => [
      n(s, 78),
      battle(s, 'desert_scorched_ambush'),
    ]),
    // 능선 첫 틈 앞 물들이 → desert_ridge_pad(첫 틈 이어짐)
    segment('ch05.ridge_pad', 'CH05_CLUES_JOINED', false, 'desert_ridge_pad', (s) => [
      t(s, 83),
      n(s, 85),
      n(s, 87),
      n(s, 89),
    ]),
    // 둘째 틈 앞 오래된 폭신이 → desert_ridge_scent(둘째 틈 이어짐)
    segment('ch05.ridge_scent', 'CH05_CLUES_JOINED', false, 'desert_ridge_scent', (s) => [n(s, 90)]),
    // 셋째 틈 앞 가느리 → desert_ridge_thread(셋째 틈 이어짐)
    segment('ch05.ridge_thread', 'CH05_CLUES_JOINED', false, 'desert_ridge_thread', (s) => [n(s, 91)]),
    // 능선 끝 절단면 → desert_ridge_crossed + CH05_RIDGE_CROSSED. 두 긴 날은 플레이어에게만(화면 가장자리 연출)
    segment('ch05.cut_face', 'CH05_CLUES_JOINED', true, 'desert_ridge_crossed', (s) => [
      n(s, 93),
      l(s, 95, 96, 'neutral'),
      l(s, 98, 99, 'neutral'),
      n(s, 101, { cameraCue: 'scissors-glimpse' }),
    ]),
    // 금빛 마감실이 잠든 자리: 보스 도입 → 전투 → (이기면 이어서) 승리 장면 → 가위. 한 재생 범위로 이어진다
    segment('ch05.boss_intro', 'CH05_RIDGE_CROSSED', false, null, (s) => [
      t(s, 106),
      n(s, 108),
      l(s, 110, 111, 'neutral'),
      battle(s, 'desert_boss_golden_doll'), // 승리 시 서버가 desert_boss_defeated(마감실 지급 사건·금빛 마감실·CH05_BOSS_DEFEATED) 기록
    ]),
    // 승리 장면을 끝까지 보면 desert_boss_aftermath_seen(체크포인트·보상·성장 변화 없음). 재접속하면 이 장면부터
    segment('ch05.boss_victory', 'CH05_BOSS_DEFEATED', true, 'desert_boss_aftermath_seen', (s) => [
      ns(s, 115, 1),
      l(s, 117, 118, 'worried'),
      l(s, 120, 121, 'neutral'),
      n(s, 123),
    ]),
    // 장착하려는 순간 가위 → desert_scissors_seen + CH05_SCISSORS_REVEALED
    segment('ch05.scissors', 'CH05_BOSS_DEFEATED', true, 'desert_scissors_seen', (s) => [
      t(s, 128),
      n(s, 130),
      n(s, 132, { soundCue: 'scissors-snip' }),
      n(s, 134, { cameraCue: 'scissors-reveal' }), // 2차 에셋: 아지랑이 너머 거대한 두 날(얼굴·손·사람 형상 없음 — C5-0 수위)
      l(s, 136, 137, 'neutral'),
      l(s, 139, 140, 'worried'),
      l(s, 142, 143, 'neutral'),
      n(s, 145),
      l(s, 147, 148, 'neutral'),
      l(s, 150, 151, 'neutral'),
      l(s, 153, 154, 'neutral'),
      n(s, 156),
    ]),
    // 인벤토리에서 "누비에게 장착"(desert_finish_thread_equipped) 성공 직후 — 장면을 끝까지 보면 desert_chapter_complete_seen
    segment('ch05.chapter_complete', 'CH05_COMPLETE', true, 'desert_chapter_complete_seen', (s) => [
      t(s, 161),
      n(s, 163, { cameraCue: 'five-relics' }), // 2차 에셋: 다섯 실의 유물이 처음으로 동시에 빛난다(결속은 아직)
      n(s, 165),
      l(s, 167, 168, 'neutral'),
      l(s, 170, 171, 'neutral'),
      n(s, 173),
      n(s, 175),
      l(s, 177, 178, 'neutral'),
      n(s, 180),
      l(s, 182, 183, 'neutral'),
      l(s, 185, 186, 'neutral'),
    ]),
  ],
};

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n', 'utf8');
  const count = file.segments.reduce((sum, s) => sum + s.entries.length, 0);
  console.log(`ch05.json: 구간 ${file.segments.length}개, 항목 ${count}개, 제외 지시문 ${Object.keys(EXCLUDED).length}줄`);
}
module.exports = { EXCLUDED, PARTIAL, sentences };
