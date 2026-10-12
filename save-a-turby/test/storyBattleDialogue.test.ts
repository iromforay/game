// M4-B 대화 속 스토리 전투 — 실제 런타임 1장 파일(BE/story-data/save-a-turby/dialogue/ch01.json)로 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runDialogue, STORY_BATTLE_RETRY_MESSAGE, type DialogueFile, type RunnerPorts, type StoryBattleResult } from '../src/story/dialogueRunner.ts';

const CH01 = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/dialogue/ch01.json', import.meta.url)), 'utf8')) as DialogueFile;

// results[key]: 전투를 열 때마다 앞에서부터 꺼내 쓰는 결과('throw'는 통신 실패)
function ports(results: Record<string, (StoryBattleResult | 'throw')[]>, withBattle = true) {
  const order: string[] = [];
  const retries: string[] = [];
  const queue = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, [...v]]));
  const p: RunnerPorts = {
    async show(line) {
      order.push(`show:${line.entry.dialogueId}`);
      return 'next';
    },
    cue() {},
    async askName() {
      throw new Error('1장에는 이름 입력이 없다');
    },
    async completeEvent(eventId) {
      order.push(`event:${eventId}`);
    },
    async saveName() {
      throw new Error('1장에는 이름 저장이 없다');
    },
    async waitRetry(message) {
      retries.push(message);
    },
    needsName: () => false,
    playerName: () => '하늘',
    isSeen: () => false,
    markSeen() {},
    ...(withBattle
      ? {
          async startBattle(key: string) {
            const next = queue[key]?.shift();
            if (next === undefined) throw new Error(`테스트 결과 부족: ${key}`);
            order.push(`battle:${key}:${next}`);
            if (next === 'throw') throw new Error('network');
            return next;
          },
        }
      : {}),
  };
  return { p, order, retries };
}

const battleEntries = CH01.segments.flatMap((s) => s.entries).filter((e) => e.kind === 'storyBattle');

test('1장에는 두 스토리 전투가 정본 순서대로 있다(매복 → 거대 매듭)', () => {
  assert.deepEqual(
    battleEntries.map((e) => (e as { encounterKey: string }).encounterKey),
    ['forest_stitchling_ambush', 'forest_giant_knot'],
  );
});

test('지면 다시 도전 안내 후 같은 전투를 다시 열고, 이긴 뒤에야 다음 대사로 간다 — 승리 이벤트는 클라이언트가 보내지 않는다', async () => {
  const { p, order, retries } = ports({ forest_stitchling_ambush: ['lost', 'won'], forest_giant_knot: ['won'] });
  await runDialogue(CH01, 'ch01.first_path', p);
  const ambush = order.indexOf('battle:forest_stitchling_ambush:won');
  assert.ok(order.indexOf('battle:forest_stitchling_ambush:lost') < ambush);
  assert.deepEqual(retries, [STORY_BATTLE_RETRY_MESSAGE]);
  // 전투 항목 바로 다음 대사는 승리 뒤에 나온다
  const seg = CH01.segments.find((s) => s.entries.some((e) => e.kind === 'storyBattle'))!;
  const after = seg.entries[seg.entries.findIndex((e) => e.kind === 'storyBattle') + 1];
  if (after) assert.ok(order.indexOf(`show:${after.dialogueId}`) > ambush, '전투 뒤 대사는 승리 뒤에');
  assert.ok(!order.some((o) => o === 'event:forest_stitchling_battle_won' || o === 'event:forest_giant_knot_defeated'), '승리 이벤트는 서버 전용');
  assert.ok(order.indexOf('battle:forest_giant_knot:won') > ambush);
});

test('이미 이긴 전투(서버 STORY_ENCOUNTER_DONE)는 다시 싸우지 않고 넘어가고, 통신 실패는 재시도한다', async () => {
  const { p, order, retries } = ports({ forest_stitchling_ambush: ['throw', 'already_won'], forest_giant_knot: ['already_won'] });
  await runDialogue(CH01, 'ch01.first_path', p);
  assert.deepEqual(
    order.filter((o) => o.startsWith('battle:')),
    ['battle:forest_stitchling_ambush:throw', 'battle:forest_stitchling_ambush:already_won', 'battle:forest_giant_knot:already_won'],
  );
  assert.deepEqual(retries, ['전투를 시작하지 못했어요. 다시 시도해 주세요.']);
});

test('전투 포트가 없는 화면에서 전투 항목을 만나면 조용히 넘기지 않고 오류', async () => {
  const { p } = ports({}, false);
  await assert.rejects(runDialogue(CH01, 'ch01.first_path', p), /전투 포트 없이/);
});
