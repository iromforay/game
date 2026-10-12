// 런타임 대화 데이터 검증 — 스키마 규칙, 서버 재접속 구간 ID, MD 대본과 항목별 순서·화자·문구 일치(M4-B 1장, M3 오프닝)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { resumeOf } from '../src/turby/story/story-rules';
import { EVENT_BY_ID, type Checkpoint } from '../src/turby/story/story-data';

const ROOT = resolve(__dirname, '../..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DOCS = (require(join(ROOT, 'BE/story-data/save-a-turby/tools/docs-root.js')) as { docsRoot: (root: string) => string }).docsRoot(ROOT);
const schema = JSON.parse(readFileSync(join(DOCS, 'docs/dev/save-a-turby/m0/dialogue.schema.json'), 'utf8'));
const load = (code: string) => JSON.parse(readFileSync(join(ROOT, `BE/story-data/save-a-turby/dialogue/${code}.json`), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EXCLUDED, PARTIAL, sentences } = require(join(ROOT, 'BE/story-data/save-a-turby/tools/build-ch01.js')) as { EXCLUDED: Record<number, string>; PARTIAL: Record<number, { keep: number[] }>; sentences: (s: string) => string[] };

type Entry = { kind: string; dialogueId: string; [k: string]: unknown };
type Segment = { segmentId: string; resumeFrom: string; replayOnResume: boolean; completesWith: string | null; entries: Entry[] };

// ajv 없이 스키마의 핵심 규칙을 그대로 확인(허용 키·필수 키·패턴·열거값)
function checkSchema(file: { segments: Segment[] } & Record<string, unknown>) {
  const defs = schema.$defs;
  for (const k of Object.keys(file)) assert.ok(k in schema.properties, `최상위 키 ${k}`);
  assert.match(String(file.chapterCode), new RegExp(schema.properties.chapterCode.pattern));
  const ids = new Set<string>();
  for (const seg of file.segments) {
    for (const k of defs.segment.required) assert.ok(k in seg, `${seg.segmentId}: ${k}`);
    assert.match(seg.segmentId, new RegExp(defs.id.pattern));
    assert.match(seg.resumeFrom, new RegExp(defs.checkpoint.pattern));
    if (seg.completesWith !== null) assert.match(seg.completesWith, new RegExp(defs.eventId.pattern));
    for (const e of seg.entries) {
      const def = defs[e.kind];
      assert.ok(def && ['line', 'narration', 'title', 'nameInput', 'storyEvent', 'storyBattle'].includes(e.kind), `알 수 없는 kind ${e.kind}`);
      for (const k of Object.keys(e)) assert.ok(k in def.properties, `${e.dialogueId}: 허용 안 된 키 ${k}`);
      for (const k of def.required) assert.ok(k in e, `${e.dialogueId}: 필수 키 ${k}`);
      assert.ok(e.dialogueId.startsWith(seg.segmentId + '.'), `${e.dialogueId}: 구간 접두어`);
      assert.ok(!ids.has(e.dialogueId), `중복 ${e.dialogueId}`);
      ids.add(e.dialogueId);
      if (e.kind === 'line') {
        assert.ok(def.properties.speaker.enum.includes(e.speaker), `${e.dialogueId}: speaker`);
        assert.ok(def.properties.expression.enum.includes(e.expression), `${e.dialogueId}: expression`);
      }
    }
  }
}

// MD의 대사 영역을 순서대로 읽어 JSON 항목(대사·지문·제목)과 한 줄씩 대조. 제외 목록 외의 줄이 빠지거나 바뀌면 실패
function compareWithMd(file: { segments: Segment[] }, mdPath: string, fromHeading: string, excluded: Record<number, string>, partial: Record<number, { keep: number[] }> = {}) {
  const raw = readFileSync(join(DOCS, mdPath), 'utf8').split(/\r?\n/);
  const start = raw.findIndex((l) => l.trim() === fromHeading);
  assert.ok(start >= 0, `시작 제목 ${fromHeading}`);
  const md: { line: number; kind: 'line' | 'text'; label?: string; text: string }[] = [];
  for (let i = start + 1; i < raw.length; i++) {
    const s = raw[i].trim();
    if (!s || s.startsWith('#') || excluded[i + 1]) continue;
    if (partial[i + 1]) {
      // 설계 문장과 서술이 섞인 줄: 남기기로 한 문장만 원문 그대로 대조
      const parts = sentences(s);
      for (const k of partial[i + 1].keep) md.push({ line: i + 1, kind: 'text', text: parts[k] });
      continue;
    }
    const next = raw[i + 1]?.trim();
    if (next && next.startsWith('“') && !s.startsWith('“')) {
      md.push({ line: i + 1, kind: 'line', label: s, text: next.replace(/^“/, '').replace(/”$/, '') });
      i++;
    } else md.push({ line: i + 1, kind: 'text', text: /^`[^`]+`$/.test(s) ? s.slice(1, -1) : s });
  }
  const json = file.segments.flatMap((seg) => seg.entries).filter((e) => e.kind === 'line' || e.kind === 'narration' || e.kind === 'title');
  assert.equal(json.length, md.length, `항목 수: JSON ${json.length} / MD ${md.length}`);
  md.forEach((m, i) => {
    const e = json[i];
    if (m.kind === 'line') {
      assert.equal(e.kind, 'line', `MD ${m.line}행은 대사`);
      assert.equal(e.speakerLabel, m.label, `MD ${m.line}행 화자`);
    } else assert.notEqual(e.kind, 'line', `MD ${m.line}행은 지문·제목`);
    assert.equal(e.text, m.text, `MD ${m.line}행 문구`);
  });
  return md.length;
}

test('1장 대화: 스키마 규칙 통과', () => {
  checkSchema(load('ch01'));
});

test('1장 대화: MD 대본과 순서·화자·문구가 항목별로 일치(연출 지시문 제외 목록만 빠짐)', () => {
  const matched = compareWithMd(load('ch01'), 'docs/scene/1장.md', '## 첫 번째 길', EXCLUDED, PARTIAL);
  assert.ok(matched > 60);
  for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 0);
});

test('1장 대화: 서버 재접속 구간 ID가 모두 파일에 있고, 전투·이벤트 지점이 전이표 순서와 맞음', () => {
  const file = load('ch01') as { segments: Segment[] };
  const ids = new Set(file.segments.map((s) => s.segmentId));
  const snap = (checkpoint: Checkpoint, events: string[]) => ({ checkpoint, events: new Set(events), objectives: new Map(), growthStage: 0 });
  const resumes = [
    resumeOf(snap('CH01_STARTED', [])).segmentId,
    resumeOf(snap('CH01_STARTED', ['forest_bopul_rescued'])).segmentId,
    resumeOf(snap('CH01_COMPASS_ACQUIRED', ['forest_giant_knot_defeated'])).segmentId,
    resumeOf(snap('CH01_FIRST_KNOT_EQUIPPED', ['forest_dansuring_found'])).segmentId,
  ];
  assert.deepEqual(resumes, ['ch01.first_path', 'ch01.bopul_clue', 'ch01.first_knot_awaken', 'ch01.primordial_knot']);
  for (const r of resumes) assert.ok(ids.has(r!), r!);
  const flat = file.segments.flatMap((s) => s.entries.map((e) => ({ seg: s.segmentId, ...e })));
  const marks = flat.filter((e) => e.kind === 'storyBattle' || e.kind === 'storyEvent').map((e) => `${e.seg}:${e.kind === 'storyBattle' ? e.encounterKey : e.eventId}`);
  assert.deepEqual(marks, [
    'ch01.first_path:forest_stitchling_ambush',
    'ch01.hidden_path:forest_giant_knot',
    'ch01.primordial_knot:forest_primordial_knot_seen',
  ]);
  assert.deepEqual(file.segments.map((s) => s.completesWith), [null, 'forest_dansuring_clue_learned', null, null, 'forest_first_knot_awakened', null, null]);
  // 대화가 클라이언트 경로로 완료시키는 이벤트에는 서버 전용 이벤트가 없어야 한다(시작·나침판·전투 승리는 서버 트리거/전투만)
  const clientEvents = [...flat.filter((e) => e.kind === 'storyEvent').map((e) => e.eventId as string), ...file.segments.map((s) => s.completesWith).filter((x): x is string => !!x)];
  for (const id of clientEvents) assert.equal(EVENT_BY_ID.get(id)?.serverOnly ?? false, false, `${id}는 서버 전용 이벤트`);
});

test('오프닝 대화: 같은 검증기로 스키마·MD 대조 통과(회귀)', () => {
  const file = load('opening');
  checkSchema(file);
  const excluded: Record<number, string> = {};
  const md = readFileSync(join(DOCS, 'docs/scene/오프닝.md'), 'utf8').split(/\r?\n/);
  md.forEach((l, i) => {
    const s = l.trim();
    // 연출 지시문 2줄과 이름 입력값 자리 표시(빈 {playerName} 줄)
    if (s === '화면에 이름 입력창이 나타난다.' || s === '이 순간 풀린누비가 주인공의 첫 번째 이야기 동료로 등록된다.' || s === '누비에게 알려 줄 이름을 입력하세요.') excluded[i + 1] = '연출·입력 안내';
    if (s === '{playerName}' && md[i + 1]?.trim() === '') excluded[i + 1] = '입력값 자리';
  });
  const firstLine = md.findIndex((l) => l.trim().startsWith('# ')) ;
  assert.ok(firstLine >= 0);
  compareWithMd(file, 'docs/scene/오프닝.md', md[firstLine].trim(), excluded);
});
