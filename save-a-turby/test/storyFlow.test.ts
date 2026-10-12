// M4-C 1장 실제 흐름 — 실제 런타임 1장 파일(BE/story-data/save-a-turby/dialogue/ch01.json)로 재생 범위·복원 규칙 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { plainText, runDialogue, type DialogueFile, type RunnerPorts, type StoryBattleResult } from '../src/story/dialogueRunner.ts';
import { battleEntryOf, battleResultOf, battleStartErrorResult, chapterOfSegment, chapterOfStage, deliveryGoalText, shortageText } from '../src/story/storyFlow.ts';

const CH01 = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/dialogue/ch01.json', import.meta.url)), 'utf8')) as DialogueFile;

function ports(battles: StoryBattleResult[] = []) {
  const log: string[] = [];
  const queue = [...battles];
  const p: RunnerPorts = {
    async show(line) {
      log.push(`show:${line.entry.dialogueId}`);
      return 'next';
    },
    cue() {},
    async askName() {},
    async completeEvent(eventId) {
      log.push(`event:${eventId}`);
    },
    async saveName() {
      return { playerName: '하늘' };
    },
    async waitRetry(m) {
      log.push(`retry:${m}`);
    },
    needsName: () => false,
    playerName: () => '하늘',
    isSeen: () => false,
    markSeen() {},
    onSegment: (id) => log.push(`segment:${id}`),
    async startBattle(key) {
      const r = queue.shift() ?? 'won';
      log.push(`battle:${key}:${r}`);
      return r;
    },
  };
  return { p, log };
}

const segmentsOf = (log: string[]) => log.filter((l) => l.startsWith('segment:')).map((l) => l.slice(8));

test('숲 첫 진입 재생 범위: 첫 길 → 전투 → 보풀이 단서에서 멈추고(나침판 구간은 보풀이 전달 트리거가 연다), 클라이언트가 보내는 이벤트는 단서 완료뿐', async () => {
  const { p, log } = ports(['won']);
  await runDialogue(CH01, 'ch01.first_path', p, { endAfter: 'ch01.bopul_clue', exact: true });
  assert.deepEqual(segmentsOf(log), ['ch01.first_path', 'ch01.bopul_clue']);
  assert.deepEqual(log.filter((l) => l.startsWith('event:')), ['event:forest_dansuring_clue_learned']);
  assert.ok(log.includes('battle:forest_stitchling_ambush:won'));
});

test('나침판 제작 구간: 서버가 전달을 확정한 뒤 재생 — 정본 106줄 서술 두 문장 → 보풀이 대사, 클라이언트 이벤트 없음', async () => {
  const { p, log } = ports();
  // 재접속 시작점 규칙이면 실시간 전용 구간이라 건너뛰지만, 서버가 트리거 직후 알려 준 구간은 그대로 재생(exact)
  await assert.rejects(runDialogue(CH01, 'ch01.compass_craft', ports().p, { endAfter: 'ch01.compass_craft' }), /알 수 없는 끝 구간/);
  await runDialogue(CH01, 'ch01.compass_craft', p, { endAfter: 'ch01.compass_craft', exact: true });
  assert.deepEqual(segmentsOf(log), ['ch01.compass_craft'], '숨은 길은 좌표 트리거가 연다(자동 진행 없음)');
  assert.equal(log.filter((l) => l.startsWith('event:')).length, 0);
  const seg = CH01.segments.find((s) => s.segmentId === 'ch01.compass_craft')!;
  assert.deepEqual(seg.entries.slice(0, 2).map((e) => e.kind), ['narration', 'narration']);
});

test('복원: 스토리 전투 도중 새로고침 → 전투 항목부터 그 구간 끝까지(앞 대사 반복 없음), 이미 이긴 전투면 다시 싸우지 않고 다음 대사', async () => {
  const at = battleEntryOf(CH01, 'forest_stitchling_ambush')!;
  assert.equal(at.segmentId, 'ch01.first_path');
  const seg = CH01.segments.find((s) => s.segmentId === at.segmentId)!;
  const battleIndex = seg.entries.findIndex((e) => e.dialogueId === at.dialogueId);

  const { p, log } = ports(['already_won']);
  await runDialogue(CH01, at.segmentId, p, { fromEntry: at.dialogueId, endAfter: at.segmentId });
  const shown = log.filter((l) => l.startsWith('show:')).map((l) => l.slice(5));
  assert.deepEqual(shown, seg.entries.slice(battleIndex + 1).filter((e) => e.kind !== 'storyBattle' && e.kind !== 'storyEvent').map((e) => e.dialogueId), '전투 뒤 대사만');
  assert.deepEqual(segmentsOf(log), ['ch01.first_path'], '다음 구간은 맵 재입장 때 서버가 알려 준다');

  // 진 전투에서 복원: 같은 전투를 다시(진행기 규칙 — 짐 → 재도전 안내 → 다시 시작)
  const lost = ports(['lost', 'won']);
  await runDialogue(CH01, at.segmentId, lost.p, { fromEntry: at.dialogueId, endAfter: at.segmentId });
  assert.deepEqual(lost.log.filter((l) => l.startsWith('battle:')), ['battle:forest_stitchling_ambush:lost', 'battle:forest_stitchling_ambush:won']);
  assert.equal(lost.log.filter((l) => l.startsWith('retry:')).length, 1);

  await assert.rejects(runDialogue(CH01, at.segmentId, p, { fromEntry: 'nope', endAfter: at.segmentId }), /알 수 없는 시작 항목/);
  assert.equal(battleEntryOf(CH01, 'forest_giant_knot')!.segmentId, 'ch01.hidden_path');
});

test('전투 결과·오류 → 진행기 결과, 목표·부족 문구, 장 파일 코드', () => {
  assert.equal(battleResultOf('win'), 'won');
  for (const o of ['lose', 'draw', 'cancelled', undefined]) assert.equal(battleResultOf(o), 'lost');
  assert.equal(battleStartErrorResult('STORY_ENCOUNTER_DONE'), 'already_won');
  assert.equal(battleStartErrorResult('NOT_IN_MAP'), null, '그 밖은 재시도');
  assert.equal(deliveryGoalText({ triggerId: 'forest_bopuli_return', itemCode: 'glowing_yarn_dust', have: 0, need: 10 }), '빛나는 실가루 모으기 0/10');
  assert.equal(deliveryGoalText({ triggerId: 'forest_bopuli_return', itemCode: 'glowing_yarn_dust', have: 13, need: 10 }), '빛나는 실가루 모으기 10/10');
  assert.equal(shortageText({ itemCode: 'glowing_yarn_dust', have: 3, need: 10 }), '빛나는 실가루가 7개 더 필요해요 (3/10)');
  assert.equal(chapterOfSegment('ch01.bopul_clue'), 'ch01');
  assert.equal(chapterOfStage('forest'), 'ch01');
  assert.equal(plainText('빛이 가라앉자 `실의 떨림을 찾는 나침판`이 완성된다.'), '빛이 가라앉자 실의 떨림을 찾는 나침판이 완성된다.', '강조 표기는 화면에서 기호 없이');
});
