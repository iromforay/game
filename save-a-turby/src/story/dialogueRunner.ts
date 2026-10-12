// 공용 대사 재생기(M3) — 대화 JSON(docs/dev/save-a-turby/m0/dialogue.schema.json)을 구간 단위로 재생한다.
// 화면(Phaser)·네트워크와 분리된 순수 모듈: 입출력은 ports로만 한다(test/dialogueRunner.test.ts).
// 규칙
// - 서버가 준 resume.segmentId 구간부터 파일 순서대로 재생한다(대사 한 줄 위치는 저장하지 않음).
// - replayOnResume=false 구간은 실시간 흐름에서만 재생하고, 재접속 시작점이면 건너뛴다.
// - 구간 끝의 completesWith 이벤트는 서버 성공을 받은 뒤에만 다음 구간으로 간다(실패하면 다시 시도).
// - nameInput은 이름 저장 성공 전에는 넘어가지 않는다. 이미 이름이 있는 계정은 입력 없이 opening_name_saved만 요청.
// - 건너뛰기는 이미 본 구간에서만 허용하며, nameInput과 구간 완료 이벤트는 건너뛰지 않는다.
// - 문구는 JSON 그대로 쓴다. {playerName} 토큰만 치환한다.
// - storyBattle은 서버 스토리 전투(battle:story:start)를 연다. 이기거나 이미 이긴 전투면 다음 항목으로, 지면 다시 도전한다.
//   승리 이벤트는 서버가 기록하므로 여기서 completeEvent를 보내지 않는다. 전투는 건너뛰지 않는다.

export type Portrait = 'player' | 'nubi' | 'bopuli' | 'dansuring';
export type Expression = 'neutral' | 'worried' | 'happy' | 'weak' | 'relieved' | 'counting';

export interface LineEntry {
  kind: 'line';
  dialogueId: string;
  speaker: string;
  speakerLabel: string;
  text: string;
  portrait: Portrait | null;
  expression: Expression | null;
  cameraCue?: string | null;
  soundCue?: string | null;
}
export interface NarrationEntry {
  kind: 'narration';
  dialogueId: string;
  text: string;
  cameraCue?: string | null;
  soundCue?: string | null;
}
export interface TitleEntry {
  kind: 'title';
  dialogueId: string;
  text: string;
}
export interface NameInputEntry {
  kind: 'nameInput';
  dialogueId: string;
  prompt: string;
}
export interface StoryEventEntry {
  kind: 'storyEvent';
  dialogueId: string;
  eventId: string;
}
export interface StoryBattleEntry {
  kind: 'storyBattle';
  dialogueId: string;
  encounterKey: string;
}
export type DialogueEntry = LineEntry | NarrationEntry | TitleEntry | NameInputEntry | StoryEventEntry | StoryBattleEntry;

export interface DialogueSegment {
  segmentId: string;
  resumeFrom: string;
  replayOnResume: boolean;
  completesWith: string | null;
  entries: DialogueEntry[];
}

export interface DialogueFile {
  schemaVersion: 1;
  chapterCode: string;
  source: string;
  segments: DialogueSegment[];
}

// 화면에 보여 줄 한 줄(치환 완료)
export interface ShownLine {
  entry: LineEntry | NarrationEntry | TitleEntry;
  text: string;
  label: string | null;
  canSkipSegment: boolean;
}

export type Advance = 'next' | 'skip';
// won: 이번에 이김 / already_won: 서버가 이미 이긴 전투라고 답함(STORY_ENCOUNTER_DONE) / lost: 패배·무승부·취소
export type StoryBattleResult = 'won' | 'already_won' | 'lost';
export type NameSubmitResult = { ok: true } | { ok: false; message: string };

export interface RunnerPorts {
  show(line: ShownLine): Promise<Advance>; // 사용자가 다음(또는 건너뛰기)을 누르면 끝난다
  cue(entry: DialogueEntry): void; // 사운드·카메라 큐 — 에셋이 없으면 화면 쪽에서 무음·무연출로 무시
  askName(prompt: string, submit: (name: string) => Promise<NameSubmitResult>): Promise<void>; // 저장 성공 뒤에만 끝난다
  completeEvent(eventId: string): Promise<void>; // 서버 성공 시 resolve, 실패 시 throw
  saveName(name: string): Promise<{ playerName: string }>; // 실패 시 { code, message }를 가진 오류 throw
  waitRetry(message: string): Promise<void>; // 서버 요청 실패 — 사용자가 다시 시도를 누르면 끝난다
  needsName(): boolean;
  playerName(): string;
  isSeen(segmentId: string): boolean;
  markSeen(segmentId: string): void;
  onSegment?(segmentId: string): void;
  startBattle?(encounterKey: string): Promise<StoryBattleResult>; // 전투가 있는 장만 제공. 전투 화면을 열고 끝날 때 resolve, 통신 실패는 throw
}

export const PLAYER_NAME_TOKEN = '{playerName}';
export const STORY_BATTLE_RETRY_MESSAGE = '전투에서 졌어요. 다시 도전해 볼까요?';

// 정본 대본의 `…` 는 아이템·장식 이름 강조 표기(마크다운)라 화면에는 기호 없이 보인다. 데이터는 정본 그대로 둔다
export function plainText(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1');
}

export function fillName(text: string, playerName: string): string {
  return text.split(PLAYER_NAME_TOKEN).join(playerName);
}

// 서버가 지정한 시작 구간의 위치. 없는 ID면 -1(호출 쪽이 오류 처리).
export function startIndex(file: DialogueFile, segmentId: string | null): number {
  if (!segmentId) return -1;
  let i = file.segments.findIndex((s) => s.segmentId === segmentId);
  // 재접속 시작점이 실시간 전용 구간이면 다음 구간부터(서버는 원래 이런 ID를 주지 않는다)
  while (i >= 0 && i < file.segments.length && !file.segments[i].replayOnResume) i++;
  return i < file.segments.length ? i : -1;
}

// 초상화 텍스처 후보(앞에서부터 있는 것을 쓴다): 정본 초상화 → 같은 인물 기본 표정 → 기존 캐릭터 그림(플레이스홀더)
export function portraitCandidates(portrait: Portrait | null, expression: Expression | null): string[] {
  if (!portrait) return [];
  const list = [`portrait-${portrait}-${expression ?? 'neutral'}`, `portrait-${portrait}-neutral`];
  list.push(portrait === 'player' ? 'avatar' : `turby-${portrait}`);
  return [...new Set(list)];
}

async function withRetry(ports: RunnerPorts, run: () => Promise<void>, message: string) {
  for (;;) {
    try {
      await run();
      return;
    } catch {
      await ports.waitRetry(message);
    }
  }
}

// endAfter: 서버가 정한 이어서 재생할 마지막 구간(그다음 구간은 별도 트리거가 연다). 없으면 파일 끝까지.
// fromEntry: 복원용 — 시작 구간 안에서 이 항목(dialogueId)부터 재생(스토리 전투 도중 새로고침 → 전투 항목부터). 서버 진행과 무관한 화면 위치일 뿐이다.
// exact: 서버가 실시간 흐름으로 알려 준 구간(트리거 직후 제작 장면 등)은 replayOnResume=false여도 그 구간부터 재생한다.
//        기본(false)은 재접속 시작점 규칙 — 실시간 전용 구간이면 다음 구간부터.
// untilEntry: 마지막 구간을 이 항목(dialogueId)까지만 재생한다(숲 안의 지점이 한 구간을 나눠 재생). 구간을 끝까지 보지 않았으므로
//             "본 구간" 기록과 구간 완료 이벤트(completesWith)는 하지 않는다 — 그것은 구간의 마지막 부분을 재생할 때 한다.
export interface RunOptions {
  endAfter?: string | null;
  fromEntry?: string | null;
  untilEntry?: string | null;
  exact?: boolean;
}

export async function runDialogue(file: DialogueFile, startSegmentId: string, ports: RunnerPorts, opts: RunOptions = {}): Promise<void> {
  const first = opts.fromEntry || opts.exact ? file.segments.findIndex((s) => s.segmentId === startSegmentId) : startIndex(file, startSegmentId);
  if (first < 0) throw new Error(`알 수 없는 시작 구간: ${startSegmentId}`);
  const last = opts.endAfter ? file.segments.findIndex((s) => s.segmentId === opts.endAfter) : file.segments.length - 1;
  if (last < first) throw new Error(`알 수 없는 끝 구간: ${opts.endAfter}`);

  for (let s = first; s <= last; s++) {
    const seg = file.segments[s];
    ports.onSegment?.(seg.segmentId);
    const canSkip = ports.isSeen(seg.segmentId);
    let skipping = false;
    let entries = seg.entries;
    if (s === first && opts.fromEntry) {
      const at = entries.findIndex((e) => e.dialogueId === opts.fromEntry);
      if (at < 0) throw new Error(`알 수 없는 시작 항목: ${opts.fromEntry}`);
      entries = entries.slice(at);
    }
    let partial = false;
    if (s === last && opts.untilEntry) {
      const end = entries.findIndex((e) => e.dialogueId === opts.untilEntry);
      if (end < 0) throw new Error(`알 수 없는 끝 항목: ${opts.untilEntry}`);
      partial = end < entries.length - 1;
      entries = entries.slice(0, end + 1);
    }

    for (const entry of entries) {
      if (entry.kind === 'nameInput') {
        skipping = false; // 이름 입력은 건너뛰지 않는다
        if (!ports.needsName()) {
          await withRetry(ports, () => ports.completeEvent('opening_name_saved'), '이야기 진행을 저장하지 못했어요. 다시 시도해 주세요.');
          continue;
        }
        await ports.askName(entry.prompt, async (name) => {
          try {
            await ports.saveName(name);
            return { ok: true };
          } catch (err) {
            return { ok: false, message: (err as { message?: string }).message ?? '이름을 저장하지 못했어요.' };
          }
        });
        continue;
      }
      if (entry.kind === 'storyBattle') {
        skipping = false; // 전투는 건너뛰지 않는다
        const startBattle = ports.startBattle;
        if (!startBattle) throw new Error(`전투 포트 없이 전투 항목을 만났습니다: ${entry.dialogueId}`);
        for (;;) {
          let result: StoryBattleResult = 'lost';
          await withRetry(ports, async () => {
            result = await startBattle(entry.encounterKey);
          }, '전투를 시작하지 못했어요. 다시 시도해 주세요.');
          if (result !== 'lost') break;
          await ports.waitRetry(STORY_BATTLE_RETRY_MESSAGE);
        }
        continue;
      }
      if (entry.kind === 'storyEvent') {
        await withRetry(ports, () => ports.completeEvent(entry.eventId), '이야기 진행을 저장하지 못했어요. 다시 시도해 주세요.');
        continue;
      }
      if (skipping) continue;
      ports.cue(entry);
      const name = ports.playerName();
      const label = entry.kind === 'line' ? fillName(entry.speakerLabel, name) : null;
      const advance = await ports.show({ entry, text: plainText(fillName(entry.text, name)), label, canSkipSegment: canSkip });
      if (advance === 'skip' && canSkip) skipping = true;
    }

    if (partial) continue; // 구간 중간에서 끝남 — 본 구간 기록·완료 이벤트 없음
    // 대사를 끝까지 봤으면 "본 구간"으로 기록(완료 요청 전에 끊겨 다시 재생될 때 건너뛰기 허용)
    ports.markSeen(seg.segmentId);
    if (seg.completesWith) {
      const eventId = seg.completesWith;
      await withRetry(ports, () => ports.completeEvent(eventId), '이야기 진행을 저장하지 못했어요. 다시 시도해 주세요.');
    }
  }
}
