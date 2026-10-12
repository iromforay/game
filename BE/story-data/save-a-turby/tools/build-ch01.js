// docs/scene/1장.md → BE/story-data/save-a-turby/dialogue/ch01.json 변환(문구는 MD 줄에서 그대로 가져온다 — 손으로 옮기지 않음).
// 실행: node BE/story-data/save-a-turby/tools/build-ch01.js
// 구간 ID는 서버 resumeOf(story-rules.ts)와 Codex v15 지시를 따른다. 연출 지시문(발동 조건·전투 진행 설명·목표 UI 설명)은
// 대사가 아니므로 옮기지 않고 storyBattle/storyEvent 항목이나 클라이언트 동작으로 대신한다 — 제외 목록은 EXCLUDED에 근거와 함께 둔다.
// 초상화 표정은 제작 목록(production_manifest P0) 안에서 고른 제안값이다(Codex 검수 대상).
const fs = require('fs');
const path = require('path');

const { docsRoot } = require('./docs-root');

const ROOT = path.resolve(__dirname, '../../../..');
const MD = path.join(docsRoot(ROOT), 'docs/scene/1장.md');
const OUT = path.join(ROOT, 'BE/story-data/save-a-turby/dialogue/ch01.json');
const lines = fs.readFileSync(MD, 'utf8').split(/\r?\n/);
const L = (n) => {
  const s = lines[n - 1];
  if (s === undefined || s.trim() === '') throw new Error(`빈 줄 참조: ${n}`);
  return s.trim();
};

// 대사 양끝 큰따옴표 제거(오프닝과 같은 규칙), 한 줄 전체가 백틱이면 표시 형식이라 제거
const unquote = (s) => s.replace(/^“/, '').replace(/”$/, '');
const unbacktick = (s) => (/^`[^`]+`$/.test(s) ? s.slice(1, -1) : s);

const SPEAKER = { '{playerName}': 'player', 누비: 'nubi', 보풀이: 'bopuli', 단수링: 'dansuring' };

// 연출 지시문(옮기지 않음): 줄 번호 → 근거
const EXCLUDED = {
  38: '발동 조건(트리거 설명)',
  40: '트리거 동작 설명',
  71: '첫 전투 진행 설명 → storyBattle forest_stitchling_ambush',
  104: '목표 UI 설명(단서 기록·실가루 0/10)',
  119: '보스 전투 진행 설명 → storyBattle forest_giant_knot',
  140: '발동 조건(트리거 설명)',
  142: '자동 전환 금지 설명',
};

// 한 줄에 설계 문장과 서술이 섞인 줄: 서술 문장만 원문 그대로 옮긴다(문장 번호는 0부터). 문장을 새로 쓰지 않는다.
// 106: Codex v2 §1.2 — 제작 연출로 처리. 앞 두 문장("열 개를 모은 것만으로는…", "…제작 이벤트가 시작된다")은 발동 조건 설명이라
//      보풀이 전달 트리거(npc_bopuli)가 대신하고, 뒤 두 문장(실가루를 둥글게 모음·떨림 → 바늘과 크림색 실 → 나침판 완성)을 지문으로 쓴다.
const PARTIAL = {
  106: { keep: [2, 3], reason: '앞 두 문장은 제작 발동 조건 설명 → 보풀이 전달 트리거' },
};
const sentences = (s) => s.split(/(?<=다\.)\s+/);

let seq = {};
function id(seg) {
  seq[seg] = (seq[seg] ?? 0) + 1;
  return `${seg}.${String(seq[seg]).padStart(3, '0')}`;
}
const n = (seg, line, extra = {}) => ({ kind: 'narration', dialogueId: id(seg), text: unbacktick(L(line)), cameraCue: null, soundCue: null, ...extra });
const t = (seg, line) => ({ kind: 'title', dialogueId: id(seg), text: L(line) });
// 부분 줄의 한 문장(원문 그대로)
const ns = (seg, line, index) => ({ kind: 'narration', dialogueId: id(seg), text: sentences(L(line))[index], cameraCue: null, soundCue: null });
function l(seg, labelLine, textLine, expression) {
  const label = L(labelLine);
  const speaker = SPEAKER[label];
  if (!speaker) throw new Error(`알 수 없는 화자 ${label} (${labelLine})`);
  return { kind: 'line', dialogueId: id(seg), speaker, speakerLabel: label, text: unquote(L(textLine)), portrait: speaker, expression, cameraCue: null, soundCue: null };
}
const battle = (seg, encounterKey) => ({ kind: 'storyBattle', dialogueId: id(seg), encounterKey });
const ev = (seg, eventId) => ({ kind: 'storyEvent', dialogueId: id(seg), eventId });

function segment(segmentId, resumeFrom, replayOnResume, completesWith, build) {
  return { segmentId, resumeFrom, replayOnResume, completesWith, entries: build(segmentId) };
}

const file = {
  schemaVersion: 1,
  chapterCode: 'ch01',
  source: 'docs/scene/1장.md',
  segments: [
    // CH01_STARTED(첫 번째 길 트리거) → 보풀이 앞 첫 전투까지
    segment('ch01.first_path', 'CH01_STARTED', true, null, (s) => [
      n(s, 42),
      l(s, 43, 44, 'neutral'),
      l(s, 45, 46, 'neutral'),
      n(s, 47),
      n(s, 49),
      l(s, 51, 52, 'neutral'),
      n(s, 54),
      l(s, 56, 57, 'neutral'),
      n(s, 59),
      n(s, 61),
      t(s, 62),
      n(s, 63),
      l(s, 64, 65, 'neutral'),
      l(s, 66, 67, 'worried'),
      n(s, 69),
      battle(s, 'forest_stitchling_ambush'), // 승리 시 서버가 forest_stitchling_battle_won·forest_bopul_rescued 기록
    ]),
    // 전투 승리 뒤(재접속하면 여기부터) → 단서 확인 = CH01_BOPUL_RESCUED
    segment('ch01.bopul_clue', 'CH01_STARTED', true, 'forest_dansuring_clue_learned', (s) => [
      n(s, 73),
      l(s, 74, 75, 'relieved'),
      n(s, 77),
      l(s, 79, 80, 'worried'),
      n(s, 82),
      n(s, 84, { soundCue: 'sewing-machine-distant' }),
      n(s, 86),
      l(s, 88, 89, 'neutral'),
      l(s, 90, 91, 'neutral'),
      n(s, 93),
      l(s, 95, 96, 'neutral'),
      l(s, 98, 99, 'neutral'),
      l(s, 101, 102, 'neutral'),
    ]),
    // 실가루 10개 전달(보풀이 근처) — 서버 이벤트 성공 뒤 제작 장면. 이후 체크포인트는 COMPASS_ACQUIRED라 재접속 때 다시 틀지 않는다
    segment('ch01.compass_craft', 'CH01_BOPUL_RESCUED', false, null, (s) => [
      // 전달(실가루 10개 소비)·나침판 지급·체크포인트는 보풀이 전달 트리거가 서버에서 먼저 확정한다(클라이언트가 이벤트를 보내지 않음)
      ns(s, 106, 2),
      ns(s, 106, 3),
      l(s, 107, 108, 'neutral'),
      n(s, 109),
      n(s, 110),
      n(s, 111),
      l(s, 112, 113, 'neutral'),
      l(s, 114, 115, 'worried'),
    ]),
    // 나침판 사용 → 숨은 길 → 거대 실밥 매듭 전투
    segment('ch01.hidden_path', 'CH01_COMPASS_ACQUIRED', false, null, (s) => [
      t(s, 116),
      n(s, 117),
      battle(s, 'forest_giant_knot'), // 승리 시 서버가 forest_giant_knot_defeated 기록
    ]),
    // 보스 승리 뒤(재접속하면 여기부터) → 첫 매듭 각성·지급(이야기 탭, 미장착)
    segment('ch01.first_knot_awaken', 'CH01_COMPASS_ACQUIRED', true, 'forest_first_knot_awakened', (s) => [
      n(s, 121),
      n(s, 122),
      l(s, 123, 124, 'neutral'),
      l(s, 125, 126, 'worried'),
      n(s, 127),
      l(s, 128, 129, 'neutral'),
      n(s, 130),
    ]),
    // 인벤토리에서 "누비에게 장착"(forest_first_knot_equipped) 성공 직후 — 실시간 흐름에서만
    segment('ch01.first_knot_equipped', 'CH01_FIRST_KNOT_EQUIPPED', false, null, (s) => [
      n(s, 132),
      l(s, 133, 134, 'happy'),
      l(s, 135, 136, 'neutral'),
      l(s, 137, 138, 'weak'),
    ]),
    // 단수링 발견(forest_dansuring_found) 뒤 태초의 매듭 → 장 완료 이벤트 → 완료 알림과 맺음
    segment('ch01.primordial_knot', 'CH01_FIRST_KNOT_EQUIPPED', true, null, (s) => [
      t(s, 139),
      n(s, 144),
      n(s, 145),
      l(s, 146, 147, 'neutral'),
      n(s, 148),
      l(s, 149, 150, 'counting'),
      n(s, 151),
      l(s, 152, 153, 'counting'),
      l(s, 154, 155, 'worried'),
      l(s, 156, 157, 'neutral'),
      n(s, 158),
      n(s, 159),
      l(s, 160, 161, 'neutral'),
      l(s, 162, 163, 'worried'),
      l(s, 164, 165, 'neutral'),
      l(s, 166, 167, 'neutral'),
      n(s, 168),
      l(s, 169, 170, 'neutral'),
      n(s, 171),
      n(s, 172),
      l(s, 173, 174, 'neutral'),
      l(s, 175, 176, 'neutral'),
      n(s, 177),
      l(s, 178, 179, 'neutral'),
      n(s, 180),
      l(s, 181, 182, 'happy'),
      ev(s, 'forest_primordial_knot_seen'), // 장 완료 트랜잭션(CH01_COMPLETE + lake_unlocked) 뒤 완료 알림
      t(s, 183),
      n(s, 184),
      n(s, 186),
      l(s, 187, 188, 'neutral'),
      n(s, 189),
    ]),
  ],
};

// 테스트가 EXCLUDED만 가져갈 때는 파일을 다시 쓰지 않는다(직접 실행할 때만 생성)
if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2) + '\n', 'utf8');
  const count = file.segments.reduce((sum, s) => sum + s.entries.length, 0);
  console.log(`ch01.json: 구간 ${file.segments.length}개, 항목 ${count}개, 제외 지시문 ${Object.keys(EXCLUDED).length}줄`);
}
module.exports = { EXCLUDED, PARTIAL, sentences };
