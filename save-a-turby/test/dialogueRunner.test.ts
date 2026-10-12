// M3 공용 대사 재생기 테스트 — 실제 런타임 오프닝 파일(BE/story-data/save-a-turby/dialogue/opening.json)로 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runDialogue, startIndex, portraitCandidates, fillName, type DialogueFile, type RunnerPorts, type ShownLine, type Advance } from '../src/story/dialogueRunner.ts';

const OPENING = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/dialogue/opening.json', import.meta.url)), 'utf8')) as DialogueFile;

interface Log {
  shown: ShownLine[];
  events: string[];
  names: string[];
  asked: number;
  retries: number;
  order: string[]; // show·event·name을 일어난 순서대로
}

function ports(opts: { needsName?: boolean; names?: string[]; failEvents?: Record<string, number>; seen?: string[]; advance?: (line: ShownLine) => Advance; eventGate?: Promise<void> } = {}) {
  const log: Log = { shown: [], events: [], names: [], asked: 0, retries: 0, order: [] };
  let playerName = '터비 탐험가';
  let needsName = opts.needsName ?? true;
  const fails = { ...(opts.failEvents ?? {}) };
  const seen = new Set(opts.seen ?? []);
  const names = [...(opts.names ?? ['하늘'])];
  const p: RunnerPorts = {
    async show(line) {
      log.shown.push(line);
      log.order.push(`show:${line.entry.dialogueId}`);
      return opts.advance?.(line) ?? 'next';
    },
    cue() {},
    async askName(_prompt, submit) {
      log.asked++;
      for (;;) {
        const name = names.shift();
        if (name === undefined) throw new Error('테스트 이름 부족');
        const res = await submit(name);
        if (res.ok) return;
      }
    },
    async completeEvent(eventId) {
      if (opts.eventGate) await opts.eventGate;
      if ((fails[eventId] ?? 0) > 0) {
        fails[eventId]--;
        throw new Error('network');
      }
      log.events.push(eventId);
      log.order.push(`event:${eventId}`);
      if (eventId === 'opening_name_saved') needsName = false;
    },
    async saveName(name) {
      if (!/^[가-힣A-Za-z0-9]+( [가-힣A-Za-z0-9]+)*$/.test(name) || [...name].length > 10) throw Object.assign(new Error('사용할 수 없는 이름입니다.'), { code: 'NAME_INVALID' });
      playerName = name;
      needsName = false;
      log.names.push(name);
      log.order.push(`name:${name}`);
      return { playerName: name };
    },
    async waitRetry() {
      log.retries++;
    },
    needsName: () => needsName,
    playerName: () => playerName,
    isSeen: (id) => seen.has(id),
    markSeen: (id) => void seen.add(id),
  };
  return { p, log, seen };
}

test('처음부터 끝까지: 4구간 39항목을 JSON 순서·문구 그대로(이름만 치환), 이벤트는 구간 끝에서', async () => {
  const { p, log } = ports({ names: ['하늘'] });
  await runDialogue(OPENING, 'opening.fall', p);
  const expected = OPENING.segments.flatMap((s) => s.entries).filter((e) => e.kind !== 'nameInput');
  assert.equal(OPENING.segments.length, 4);
  assert.equal(OPENING.segments.reduce((n, s) => n + s.entries.length, 0), 39);
  assert.deepEqual(log.shown.map((l) => l.entry.dialogueId), expected.map((e) => e.dialogueId));
  for (const l of log.shown) assert.equal(l.text, fillName((l.entry as { text: string }).text, '하늘'));
  assert.equal(log.asked, 1);
  assert.deepEqual(log.events, ['opening_fall_completed', 'story_nubi_granted'], '이름은 이름 API가 이벤트를 함께 기록');
  const echo = log.shown.find((l) => l.entry.dialogueId === 'opening.name_echo.001')!;
  assert.deepEqual([echo.label, echo.text], ['하늘', '내 이름은 하늘이야.']);
});

test('구간 완료 이벤트 성공 전에는 다음 구간을 보여 주지 않는다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { p, log } = ports({ eventGate: gate });
  const run = runDialogue(OPENING, 'opening.fall', p);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(log.shown.map((l) => l.entry.dialogueId), ['opening.fall.001', 'opening.fall.002', 'opening.fall.003'], '추락 구간까지만');
  release();
  await run;
  const iFall = log.order.indexOf('event:opening_fall_completed');
  const iMeeting = log.order.indexOf('show:opening.meeting.001');
  assert.ok(iFall >= 0 && iFall < iMeeting);
  assert.ok(log.order.indexOf('name:하늘') < log.order.indexOf('show:opening.name_echo.001'), '이름 저장 성공 뒤에만 다음으로');
});

test('완료 요청이 실패하면 다시 시도 후 진행(중복 진행 없음)', async () => {
  const { p, log } = ports({ failEvents: { opening_fall_completed: 2 } });
  await runDialogue(OPENING, 'opening.fall', p);
  assert.equal(log.retries, 2);
  assert.equal(log.events.filter((e) => e === 'opening_fall_completed').length, 1);
  assert.equal(log.shown.filter((l) => l.entry.dialogueId === 'opening.meeting.001').length, 1);
});

test('체크포인트별 복귀: 서버가 준 구간부터, 이름 되뇌기 구간은 재접속 때 건너뜀', async () => {
  assert.equal(OPENING.segments[startIndex(OPENING, 'opening.fall')].segmentId, 'opening.fall');
  assert.equal(OPENING.segments[startIndex(OPENING, 'opening.meeting')].segmentId, 'opening.meeting');
  assert.equal(OPENING.segments[startIndex(OPENING, 'opening.promise')].segmentId, 'opening.promise');
  assert.equal(OPENING.segments[startIndex(OPENING, 'opening.name_echo')].segmentId, 'opening.promise', '실시간 전용 구간이면 다음 구간');
  assert.equal(startIndex(OPENING, 'ch01.first_path'), -1);
  assert.equal(startIndex(OPENING, null), -1);

  const { p, log } = ports({ needsName: false });
  await runDialogue(OPENING, 'opening.promise', p);
  assert.equal(log.shown[0].entry.dialogueId, 'opening.promise.001');
  assert.ok(!log.shown.some((l) => l.entry.dialogueId.startsWith('opening.name_echo')));
  assert.deepEqual(log.events, ['story_nubi_granted']);
});

test('이름: 잘못된 이름은 패널 안에서 다시 입력, 기존 계정은 입력 없이 이름 이벤트만', async () => {
  const bad = ports({ names: ['하늘!!', '가나다라마바사아자차카', '하늘'] });
  await runDialogue(OPENING, 'opening.meeting', bad.p);
  assert.equal(bad.log.asked, 1, '패널은 한 번 열리고 그 안에서 재시도');
  assert.deepEqual(bad.log.names, ['하늘']);

  const legacy = ports({ needsName: false });
  await runDialogue(OPENING, 'opening.meeting', legacy.p);
  assert.equal(legacy.log.asked, 0);
  assert.deepEqual(legacy.log.events, ['opening_name_saved', 'story_nubi_granted']);
});

test('이미 본 구간만 건너뛸 수 있고, 건너뛰어도 이름 입력과 완료 이벤트는 거치고 다음 구간은 처음부터', async () => {
  const { p, log } = ports({ seen: ['opening.meeting'], advance: (l) => (l.entry.dialogueId === 'opening.meeting.002' ? 'skip' : 'next') });
  await runDialogue(OPENING, 'opening.meeting', p);
  const meetingShown = log.shown.filter((l) => l.entry.dialogueId.startsWith('opening.meeting')).map((l) => l.entry.dialogueId);
  assert.deepEqual(meetingShown, ['opening.meeting.001', 'opening.meeting.002'], '건너뛰기 이후 대사 생략');
  assert.equal(log.asked, 1, '이름 입력은 건너뛰지 않음');
  assert.ok(log.shown.some((l) => l.entry.dialogueId === 'opening.name_echo.001'), '본 적 없는 구간은 처음부터');
  assert.ok(log.shown.every((l) => l.canSkipSegment === l.entry.dialogueId.startsWith('opening.meeting')));

  const unseen = ports({ advance: () => 'skip' });
  await runDialogue(OPENING, 'opening.fall', unseen.p);
  assert.equal(unseen.log.shown.length, 38, '본 적 없는 구간에서 건너뛰기 요청은 무시');
});

test('초상화·사운드·카메라 폴백과 이름 입력 전 주인공 초상화 숨김', () => {
  assert.deepEqual(portraitCandidates('nubi', 'worried'), ['portrait-nubi-worried', 'portrait-nubi-neutral', 'turby-nubi']);
  assert.deepEqual(portraitCandidates('player', 'neutral'), ['portrait-player-neutral', 'avatar']);
  assert.deepEqual(portraitCandidates(null, null), []);
  const beforeName = OPENING.segments[1].entries.filter((e) => e.kind === 'line' && e.speaker === 'player');
  assert.ok(beforeName.length > 0 && beforeName.every((e) => e.kind === 'line' && e.portrait === null));
  const expressions = new Set(OPENING.segments.flatMap((s) => s.entries).flatMap((e) => (e.kind === 'line' && e.portrait === 'nubi' ? [e.expression] : [])));
  assert.deepEqual([...expressions].sort(), ['happy', 'neutral', 'weak', 'worried']);
  const cues = OPENING.segments.flatMap((s) => s.entries).flatMap((e) => ('soundCue' in e && e.soundCue ? [e.soundCue] : []));
  assert.deepEqual(cues, ['reality-rift-open', 'fall-through-yarn'], '사운드 파일이 없으면 화면 쪽에서 무음 처리');
});
