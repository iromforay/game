// docs/scene/4장.md → BE/story-data/save-a-turby/dialogue/ch04.json 변환(문구는 MD 줄에서 그대로 가져온다 — 손으로 옮기지 않음).
// 실행: node BE/story-data/save-a-turby/tools/build-ch04.js
// 범위: 소리 없는 냉기 · 얼음에 박힌 가느리 · 얼어붙은 저장고(길목 지문·전투·완성된 도안) · 누비의 고백 · 서리 미싱(도입·전투·승리) · 이어진 감각(C4-3).
// 연출 지시문(발동 조건·저장점 안내·전투 진행 설명)은 대사가 아니라 트리거·전이표가 대신하므로 옮기지 않는다 — EXCLUDED에 근거와 함께 둔다.
const fs = require('fs');
const path = require('path');

const { docsRoot } = require('./docs-root');

const ROOT = path.resolve(__dirname, '../../../..');
const MD = path.join(docsRoot(ROOT), 'docs/scene/4장.md');
const OUT = path.join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch04.json');
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

// 화자 표기 → 화자 키. 가느리·서리 미싱은 초상화 에셋이 없어 portrait null(오래된 폭신이와 같은 방식)
const SPEAKER = { '{playerName}': 'player', 누비: 'nubi', 가느리: 'ganeuri', '서리 미싱': 'frost_machine' };
const PORTRAIT = { player: 'player', nubi: 'nubi', ganeuri: null, frost_machine: null };

// 연출 지시문(옮기지 않음): 줄 번호 → 근거
const EXCLUDED = {
  37: '발동 조건(트리거 설명)',
  55: '중간 저장점 안내(CH04_STARTED — 전이표)',
  56: '중간 저장점 안내(CH04_STARTED — 전이표)',
  82: '중간 저장점 안내(CH04_GANEURI_RESCUED — 전이표)',
  83: '중간 저장점 안내(CH04_GANEURI_RESCUED — 전이표)',
  105: '중간 저장점 안내(CH04_STORAGE_CLEARED — 전이표)',
  106: '중간 저장점 안내(CH04_STORAGE_CLEARED — 전이표)',
  131: '중간 저장점 안내(CH04_CONFESSION_SEEN — 전이표)',
  132: '중간 저장점 안내(CH04_CONFESSION_SEEN — 전이표)',
  148: '보스 전투 진행 설명 → storyBattle fridge_boss_frost_machine와 전투 정의(바늘 예고·고정·연결 실·밑실→윗실)',
  159: '중간 저장점 안내(CH04_BOSS_DEFEATED — 전이표)',
  160: '중간 저장점 안내(CH04_BOSS_DEFEATED — 전이표)',
  174: '중간 저장점 안내(CH04_COMPLETE — 전이표)',
  175: '중간 저장점 안내(CH04_COMPLETE — 전이표)',
};

// 한 줄에 서술과 조작 설명이 섞인 줄: 서술 문장만 원문 그대로 옮긴다(문장 번호는 0부터)
// 87: 가운데 문장(상호작용이 늦게 반응)은 조작 설명 → 서리 구역의 이동 0.7배·화면 서리로 대신한다(안내 지연은 없앴다 — 10-23 Codex 의견 P-02)
// 89: 뒤 문장(골무막이 정면·등 뒤 실밥)은 전투 진행 설명 → 저장고 앞 전투(C4-3)의 첫 등장 안내가 대신한다
const PARTIAL = {
  87: { keep: [0, 2], reason: '가운데 문장은 조작 설명 → 서리 구역 연출' },
  89: { keep: [0], reason: '뒤 문장은 전투 진행 설명 → 저장고 앞 전투 안내(C4-3)' },
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
// 누비에게만 들리는 목소리(대본의 `…` 한 줄): 화자 없는 지문 + voice-frost 연출(화면 가장자리 서리·은색 글자)
const voice = (seg, line) => n(seg, line, { cameraCue: 'voice-frost' });
const battle = (seg, encounterKey) => ({ kind: 'storyBattle', dialogueId: id(seg), encounterKey });

function segment(segmentId, resumeFrom, replayOnResume, completesWith, build) {
  return { segmentId, resumeFrom, replayOnResume, completesWith, entries: build(segmentId) };
}

const file = {
  schemaVersion: 1,
  chapterCode: 'ch04',
  source: 'docs/scene/4장.md',
  segments: [
    // 성에 낀 입구에 들어서면(지역 진입 트리거) 도입 → fridge_entry_seen + CH04_STARTED
    segment('ch04.entry', 'CH03_COMPLETE', true, 'fridge_entry_seen', (s) => [
      t(s, 35),
      n(s, 39),
      n(s, 41),
      voice(s, 43),
      n(s, 45),
      l(s, 47, 48, 'worried'),
      l(s, 50, 51, 'neutral'),
      n(s, 53),
    ]),
    // 통로 끝의 가느리 → fridge_ganeuri_freed + CH04_GANEURI_RESCUED
    segment('ch04.ganeuri', 'CH04_STARTED', false, 'fridge_ganeuri_freed', (s) => [
      t(s, 58),
      n(s, 60),
      l(s, 62, 63, 'neutral'),
      n(s, 65),
      n(s, 67, { soundCue: 'needle-tap' }),
      l(s, 69, 70, 'neutral'),
      n(s, 72),
      l(s, 74, 75, 'neutral'),
      n(s, 77),
      l(s, 79, 80, 'neutral'),
    ]),
    // 바늘 통로 너머 저장고 앞 길목: 지문 → 전투. 승리하면 서버가 fridge_frozen_guard_won(저장고 문 열림) 기록
    segment('ch04.guard', 'CH04_GANEURI_RESCUED', false, null, (s) => [
      t(s, 85),
      ns(s, 87, 0),
      ns(s, 87, 2),
      ns(s, 89, 0),
      battle(s, 'fridge_frozen_guard'),
    ]),
    // 열린 저장고의 완성된 도안 → fridge_storage_seen + CH04_STORAGE_CLEARED
    segment('ch04.storage', 'CH04_GANEURI_RESCUED', true, 'fridge_storage_seen', (s) => [
      n(s, 91, { cameraCue: 'storage-pattern' }),
      l(s, 93, 94, 'worried'),
      l(s, 96, 97, 'neutral'),
      n(s, 99),
      voice(s, 101),
      n(s, 103),
    ]),
    // 저장고 중심 앞 → fridge_confession_seen + CH04_CONFESSION_SEEN
    segment('ch04.confession', 'CH04_STORAGE_CLEARED', true, 'fridge_confession_seen', (s) => [
      t(s, 108),
      n(s, 110),
      l(s, 112, 113, 'worried'),
      l(s, 115, 116, 'worried'),
      l(s, 118, 119, 'weak'),
      n(s, 121),
      l(s, 123, 124, 'weak'),
      l(s, 126, 127, 'neutral'),
      n(s, 129),
    ]),
    // 저장고 중심 입구: 보스 도입 → 전투 → (이기면 이어서) 승리 장면. 한 재생 범위로 이어진다
    segment('ch04.boss_intro', 'CH04_CONFESSION_SEEN', false, null, (s) => [
      t(s, 134),
      n(s, 136),
      n(s, 138),
      l(s, 140, 141, 'neutral'),
      n(s, 143),
      l(s, 145, 146, 'neutral'),
      battle(s, 'fridge_boss_frost_machine'), // 승리 시 서버가 fridge_boss_defeated(극세사 지급 사건·얼음 극세사·CH04_BOSS_DEFEATED) 기록
    ]),
    // 승리 장면을 끝까지 보면 fridge_boss_aftermath_seen(체크포인트·보상·성장 변화 없음). 재접속하면 이 장면부터
    segment('ch04.boss_victory', 'CH04_BOSS_DEFEATED', true, 'fridge_boss_aftermath_seen', (s) => [
      n(s, 150),
      l(s, 152, 153, 'neutral'),
      n(s, 155),
      n(s, 157, { cameraCue: 'frost-machine-scar' }), // 2차 에셋: 몸체의 평행한 두 날 흠집(가위는 그리지 않는다)
    ]),
    // 인벤토리에서 "누비에게 장착"(fridge_microfiber_equipped) 성공 직후 — 장면을 끝까지 보면 fridge_chapter_complete_seen
    segment('ch04.chapter_complete', 'CH04_COMPLETE', true, 'fridge_chapter_complete_seen', (s) => [
      t(s, 162),
      n(s, 164, { cameraCue: 'sense-restore' }),
      l(s, 166, 167, 'relieved'),
      n(s, 169, { cameraCue: 'warm-gold' }), // 2차 에셋: 따뜻한 금빛(5장 단서) — 이번 장에서 금빛은 여기에만
      l(s, 171, 172, 'neutral'),
    ]),
  ],
};

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n', 'utf8');
  const count = file.segments.reduce((sum, s) => sum + s.entries.length, 0);
  console.log(`ch04.json: 구간 ${file.segments.length}개, 항목 ${count}개, 제외 지시문 ${Object.keys(EXCLUDED).length}줄`);
}
module.exports = { EXCLUDED, PARTIAL, sentences };
