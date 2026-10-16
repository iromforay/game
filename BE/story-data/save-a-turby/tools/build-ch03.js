// docs/scene/3장.md → BE/story-data/save-a-turby/dialogue/ch03.json 변환(문구는 MD 줄에서 그대로 가져온다 — 손으로 옮기지 않음).
// 실행: node BE/story-data/save-a-turby/tools/build-ch03.js
// 범위: 낯익은 어둠 · 오래된 폭신이 · 사라진 기억실(조사 3곳, 기계음, 매복 전투) · 내 것이 아닌 기억 · 기억 실패굴이(보스 입장·승리) · 돌아온 중심.
// 연출 지시문(발동 조건·저장점 안내·전투 진행 설명)은 대사가 아니라 트리거·전이표가 대신하므로 옮기지 않는다 — EXCLUDED에 근거와 함께 둔다.
const fs = require('fs');
const path = require('path');

const { docsRoot } = require('./docs-root');

const ROOT = path.resolve(__dirname, '../../../..');
const MD = path.join(docsRoot(ROOT), 'docs/scene/3장.md');
const OUT = path.join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch03.json');
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);
const L = (n) => {
  const s = lines[n - 1];
  if (s === undefined || s.trim() === '') throw new Error(`빈 줄 참조: ${n}`);
  return s.trim();
};

const unquote = (s) => s.replace(/^“/, '').replace(/”$/, '');
const unbacktick = (s) => (/^`[^`]+`$/.test(s) ? s.slice(1, -1) : s);
const unbullet = (s) => s.replace(/^-\s+/, '');
const unbold = (s) => s.replace(/^\*\*(.+)\*\*$/, '$1');

// 화자 표기 → 화자 키. 오래된 폭신이는 초상화 에셋이 없어 portrait null(물들이와 같은 방식)
const SPEAKER = { '{playerName}': 'player', 누비: 'nubi', '오래된 폭신이': 'old_pokshini' };
const PORTRAIT = { player: 'player', nubi: 'nubi', old_pokshini: null };

// 연출 지시문(옮기지 않음): 줄 번호 → 근거
const EXCLUDED = {
  37: '발동 조건(트리거 설명)',
  54: '중간 저장점 안내(CH03_STARTED — 전이표)',
  55: '중간 저장점 안내(CH03_STARTED — 전이표)',
  80: '중간 저장점 안내(CH03_ELDER_MET — 전이표)',
  81: '중간 저장점 안내(CH03_ELDER_MET — 전이표)',
  85: '조사 지점 설명(트리거 동작) — 조사 3곳이 각자 기억 비침 구간을 재생한다',
  102: '중간 저장점 안내(CH03_MEMORY_TRAIL_FOUND — 전이표)',
  103: '중간 저장점 안내(CH03_MEMORY_TRAIL_FOUND — 전이표)',
  122: '중간 저장점 안내(CH03_MEMORY_FRAGMENT_SEEN — 전이표)',
  123: '중간 저장점 안내(CH03_MEMORY_FRAGMENT_SEEN — 전이표)',
  134: '보스 전투 진행 설명 → storyBattle underfloor_boss_memory_spool와 전투 정의(기억실 순서·혼란)',
  146: '중간 저장점 안내(CH03_BOSS_DEFEATED — 전이표)',
  147: '중간 저장점 안내(CH03_BOSS_DEFEATED — 전이표)',
  164: '중간 저장점 안내(CH03_COMPLETE — 전이표)',
  165: '중간 저장점 안내(CH03_COMPLETE — 전이표)',
};

// 한 줄에 서술과 전투 진행 설명이 섞인 줄: 서술 문장만 원문 그대로 옮긴다(문장 번호는 0부터)
// 100: 첫 문장(박음이 등장)은 지문, 뒤 문장(전투 승리 → 실패 자국)은 전투 진행 설명 → C3-3 storyBattle·정산이 대신한다
const PARTIAL = {
  100: { keep: [0], reason: '뒤 문장은 전투 진행 설명 → 매복 전투(C3-3)와 사건 정산' },
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
  chapterCode: 'ch03',
  source: 'docs/scene/3장.md',
  segments: [
    // 마루 틈새 입구에 들어서면(지역 진입 트리거) 도입 → underfloor_entry_seen + CH03_STARTED
    segment('ch03.entry', 'CH02_COMPLETE', true, 'underfloor_entry_seen', (s) => [
      t(s, 35),
      n(s, 39),
      l(s, 41, 42, 'neutral'),
      l(s, 44, 45, 'neutral'),
      n(s, 47),
      l(s, 49, 50, 'worried'),
      n(s, 52),
    ]),
    // 물건 더미의 오래된 폭신이 → underfloor_elder_met + CH03_ELDER_MET
    segment('ch03.elder', 'CH03_STARTED', false, 'underfloor_elder_met', (s) => [
      t(s, 57),
      n(s, 59),
      l(s, 61, 62, 'neutral'),
      n(s, 64),
      l(s, 66, 67, 'neutral'),
      l(s, 69, 70, 'worried'),
      l(s, 72, 73, 'neutral'),
      n(s, 75),
      l(s, 77, 78, 'neutral'),
    ]),
    // 사라진 기억실: 조사 지점마다 짧은 기억 비침(순서 없음). 지점 이벤트는 서버가 기록한다
    segment('ch03.memory_glove', 'CH03_ELDER_MET', false, null, (s) => [n(s, 87, { cameraCue: 'memory-glove' })]),
    segment('ch03.memory_blanket', 'CH03_ELDER_MET', false, null, (s) => [n(s, 88, { cameraCue: 'memory-blanket' })]),
    segment('ch03.memory_doll', 'CH03_ELDER_MET', false, null, (s) => [n(s, 89, { cameraCue: 'memory-doll' })]),
    // 세 곳을 모두 살펴본 뒤 매복 지점: 잘린 실, 기계음, 박음이 등장. 전투(storyBattle)는 C3-3에서 이 구간 끝에 붙는다
    segment('ch03.machine_sound', 'CH03_ELDER_MET', false, null, (s) => [
      n(s, 91),
      n(s, 93, { soundCue: 'sewing-machine-distant' }),
      n(s, 95),
      l(s, 97, 98, 'worried'),
      ns(s, 100, 0),
      battle(s, 'underfloor_ambush'), // 승리 시 서버가 underfloor_ambush_won(+ underfloor_memory_trail_found, CH03_MEMORY_TRAIL_FOUND) 기록
    ]),
    // 실패 자국 끝의 기억 조각 → underfloor_memory_fragment_seen + CH03_MEMORY_FRAGMENT_SEEN
    segment('ch03.fragment', 'CH03_MEMORY_TRAIL_FOUND', true, 'underfloor_memory_fragment_seen', (s) => [
      t(s, 105),
      n(s, 107, { cameraCue: 'memory-fragment' }), // 2차 에셋: 수많은 실이 하나의 타래로(추상적인 실·빛만)
      n(s, 109),
      l(s, 111, 112, 'weak'),
      l(s, 114, 115, 'worried'),
      l(s, 117, 118, 'weak'),
      n(s, 120),
    ]),
    // 넓은 빈 공간 입구: 보스 도입 → 전투 → (이기면 이어서) 승리 장면. 한 재생 범위로 이어진다
    segment('ch03.boss_intro', 'CH03_MEMORY_FRAGMENT_SEEN', false, null, (s) => [
      t(s, 125),
      n(s, 127),
      n(s, 129),
      l(s, 131, 132, 'neutral'),
      battle(s, 'underfloor_boss_memory_spool'), // 승리 시 서버가 underfloor_boss_defeated(솜심 지급 사건·오래된 솜심·CH03_BOSS_DEFEATED) 기록
    ]),
    // 승리 장면을 끝까지 보면 underfloor_boss_aftermath_seen(체크포인트·보상·성장 변화 없음). 재접속하면 이 장면부터
    segment('ch03.boss_victory', 'CH03_BOSS_DEFEATED', true, 'underfloor_boss_aftermath_seen', (s) => [
      n(s, 136),
      n(s, 138),
      l(s, 140, 141, 'worried'),
      l(s, 143, 144, 'neutral'),
    ]),
    // 인벤토리에서 "누비에게 장착"(underfloor_cotton_core_equipped) 성공 직후 — 장면을 끝까지 보면 underfloor_chapter_complete_seen
    segment('ch03.chapter_complete', 'CH03_COMPLETE', true, 'underfloor_chapter_complete_seen', (s) => [
      t(s, 149),
      n(s, 151),
      l(s, 153, 154, 'neutral'),
      l(s, 156, 157, 'neutral'),
      n(s, 159, { cameraCue: 'silver-thread' }), // 2차 에셋: 솜심 안쪽의 차가운 은빛 실·서리(4장 단서)
      l(s, 161, 162, 'neutral'),
    ]),
  ],
};

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n', 'utf8');
  const count = file.segments.reduce((sum, s) => sum + s.entries.length, 0);
  console.log(`ch03.json: 구간 ${file.segments.length}개, 항목 ${count}개, 제외 지시문 ${Object.keys(EXCLUDED).length}줄`);
}
module.exports = { EXCLUDED, PARTIAL, sentences };
