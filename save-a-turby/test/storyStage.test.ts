// 10-02 v3: 지역 스토리 화면 판정(순수 함수) — 누를 대상 고르기, 막힌 곳, 구간 나눠 재생.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedAt, collectedText, LOCKED_OBJECT_PROMPT, nearestInteractable, promptText, solidRects, stepWithSolids, type StageView } from '../src/story/storyStage.ts';
import { runDialogue, type DialogueFile, type RunnerPorts } from '../src/story/dialogueRunner.ts';
import { mapHudLayout } from '../src/ui/screenLayouts.ts';
import { LEGEND_LABEL, legendEntries } from '../src/ui/screenStates.ts';

const obj = (id: string, x: number, y: number, state: 'locked' | 'available' = 'available') => ({ id, objectiveKey: 'forest_glowing_dust', x, y, radius: 56, assetKey: 'placeholder-dust', label: '실가루', prompt: '실가루 줍기', state });
const pt = (id: string, x: number, y: number) => ({ id, kind: 'inspect', x, y, radius: 64, assetKey: 'placeholder-point', label: id, prompt: '살펴보기' });
const view = (over: Partial<StageView> = {}): StageView => ({
  stageCode: 'forest',
  greybox: true,
  size: { width: 3200, height: 2400 },
  objects: [obj('forest_dust_01', 100, 100), obj('forest_dust_02', 400, 100, 'locked')],
  points: [pt('forest_cut_thread', 100, 300)],
  gates: [{ id: 'gate_a', label: '문', x: 500, y: 0, width: 40, height: 200, open: false }, { id: 'gate_b', label: '문', x: 800, y: 0, width: 40, height: 200, open: true }],
  layout: { zones: [], paths: [], blockers: [{ id: 'bush', label: '먼지풀', x: 200, y: 400, width: 100, height: 40 }] },
  objectives: [{ key: 'forest_glowing_dust', collected: 0, required: 10, active: true }],
  ...over,
});

test('누를 대상: 반경 안에서 가장 가까운 것 하나, 반경 밖이면 없음, 화면 데이터가 없으면 없음', () => {
  const v = view();
  assert.equal(nearestInteractable(null, 100, 100), null);
  assert.equal(nearestInteractable(v, 100, 100)?.target.id, 'forest_dust_01');
  assert.equal(nearestInteractable(v, 100, 157), null, '반경(56) 바로 밖');
  assert.equal(nearestInteractable(v, 100, 156)?.target.id, 'forest_dust_01', '반경 경계 안');
  assert.equal(nearestInteractable(v, 100, 250)?.target.id, 'forest_cut_thread');
  assert.equal(nearestInteractable(v, 1000, 1000), null);
  // 지점과 오브젝트가 겹칠 때: 더 가까운 쪽, 같은 거리면 이야기 지점
  const both = view({ objects: [obj('d', 100, 100)], points: [pt('p', 100, 100)] });
  assert.equal(nearestInteractable(both, 100, 100)?.type, 'point');
  const near = view({ objects: [obj('d', 100, 100)], points: [pt('p', 140, 100)] });
  assert.equal(nearestInteractable(near, 105, 100)?.target.id, 'd');
  // 수집해서 목록에서 빠진 오브젝트는 더 이상 대상이 아니다
  assert.equal(nearestInteractable(view({ objects: [] }), 100, 100), null);
});

test('안내 문구: 수집 가능한 것은 지역 데이터의 문구, 잠긴 것은 잠김 안내', () => {
  const v = view();
  assert.equal(promptText(nearestInteractable(v, 100, 100)!), '실가루 줍기');
  assert.equal(promptText(nearestInteractable(v, 400, 100)!), LOCKED_OBJECT_PROMPT);
  assert.equal(promptText(nearestInteractable(v, 100, 300)!), '살펴보기');
  assert.equal(collectedText('빛나는 실가루', 5, 10), '빛나는 실가루 5/10');
  assert.equal(collectedText('빛나는 실가루', 12, 10), '빛나는 실가루 10/10', '10개를 넘겨 표시하지 않는다');
});

test('막힌 곳: 먼지풀과 닫힌 문은 지나가지 못하고 벽을 따라 미끄러진다. 열린 문은 지나간다', () => {
  const solids = solidRects(view());
  assert.deepEqual(solids.map((s) => s.id), ['bush', 'gate_a'], '열린 문은 막힌 곳이 아니다');
  assert.deepEqual(solidRects(null), []);
  assert.deepEqual(solidRects(view({ layout: null })), []);
  assert.equal(blockedAt(solids, 250, 420, 16), true);
  assert.equal(blockedAt(solids, 250, 383, 16), false, '몸 반지름만큼 떨어지면 닿지 않는다');
  assert.equal(blockedAt(solids, 250, 385, 16), true);
  assert.equal(blockedAt(solids, 820, 100, 16), false, '열린 문');
  // 닫힌 문으로 걸어가면 가로는 멈추고 세로는 움직인다(미끄러짐)
  assert.deepEqual(stepWithSolids(solids, { x: 480, y: 100 }, { x: 490, y: 110 }, 16), { x: 480, y: 110 });
  // 막힌 곳이 없으면 그대로
  assert.deepEqual(stepWithSolids(solids, { x: 100, y: 100 }, { x: 110, y: 105 }, 16), { x: 110, y: 105 });
  // 가로·세로 모두 막히면 제자리
  assert.deepEqual(stepWithSolids([{ id: 'a', label: '', x: 110, y: 0, width: 50, height: 300 }, { id: 'b', label: '', x: 0, y: 110, width: 300, height: 50 }], { x: 90, y: 90 }, { x: 100, y: 100 }, 16), { x: 90, y: 90 });
});

test('맵 HUD: 상호작용 버튼은 다른 HUD·조이스틱 영역·화면 가운데(캐릭터)와 겹치지 않고, 640×360에서도 누를 수 있는 크기다', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const scale of [0.5, 0.6, 0.75, 1, 1.5]) {
    const L = mapHudLayout(scale);
    for (const [name, r] of Object.entries({ area: L.area, captured: L.captured, home: L.home, room: L.room, goal: L.goal, miniMap: L.miniMap, inventory: L.inventory, turbys: L.turbys, joystick: L.joystickZone })) {
      assert.ok(!overlap(L.interact, r), `${scale}: ${name}과 겹침`);
    }
    assert.ok(!overlap(L.interact, { x: 600, y: 320, w: 80, h: 80 }), `${scale}: 화면 가운데의 캐릭터를 가리지 않는다`);
    assert.ok(L.interact.h * scale >= 40 - 0.5 && L.interact.w * scale >= 200, `${scale}: 실제 화면에서 누를 수 있는 크기(${L.interact.w * scale}×${L.interact.h * scale})`);
    assert.ok(L.font.button * scale >= 13 - 0.01, `${scale}: 버튼 글자`);
    assert.ok(L.interact.x >= 0 && L.interact.x + L.interact.w <= 1280 && L.interact.y >= 0);
  }
});

test('지도 범례: 이야기 지점·실가루는 지도에 있을 때만, 모양으로 구분해 보여 준다', () => {
  assert.deepEqual(legendEntries(['dust', 'story'], false), ['player', 'story', 'dust']);
  assert.deepEqual(legendEntries(['dust'], false), ['player', 'dust']);
  assert.match(LEGEND_LABEL.dust, /마름모/);
  assert.match(LEGEND_LABEL.story, /겹동그라미/);
  // 회색상자 지형(10-02 v4): 지도에 실제로 있는 것만 — 닫힌 문만 있으면 열린 문은 범례에 없다
  assert.deepEqual(legendEntries(['story'], false, { path: true, wall: true, gateClosed: true, gateOpen: false }), ['player', 'story', 'path', 'wall', 'gateClosed']);
  assert.deepEqual(legendEntries(['story'], false, { path: true, wall: true, gateClosed: true, gateOpen: true }), ['player', 'story', 'path', 'wall', 'gateClosed', 'gateOpen']);
  assert.deepEqual(legendEntries(['home'], false), ['player', 'home'], '지형이 없는 지도(마을·최종 지도)는 그대로');
  for (const k of ['path', 'wall', 'gateClosed', 'gateOpen'] as const) assert.ok(LEGEND_LABEL[k].length > 0);
});

// ---------- 한 구간을 나눠 재생(서버가 알려 준 fromEntry·untilEntry) ----------

const CH01 = JSON.parse(readFileSync(new URL('../../BE/story-data/save-a-turby/dialogue/ch01.json', import.meta.url), 'utf8')) as DialogueFile;

function ports(log: string[], over: Partial<RunnerPorts> = {}): RunnerPorts {
  return {
    show: async (line) => {
      log.push(line.entry.dialogueId);
      return 'next';
    },
    cue: () => undefined,
    askName: async () => undefined,
    completeEvent: async (e) => void log.push(`event:${e}`),
    saveName: async () => ({ playerName: '하늘' }),
    waitRetry: async () => undefined,
    needsName: () => false,
    playerName: () => '하늘',
    isSeen: () => false,
    markSeen: (s) => void log.push(`seen:${s}`),
    startBattle: async (key) => {
      log.push(`battle:${key}`);
      return 'won';
    },
    ...over,
  };
}

test('숲의 첫 길을 세 지점이 나눠 재생한다: 001~004 / 005~009 / 010~전투~단서. 중간에서 끝난 부분은 본 구간·완료 이벤트를 남기지 않는다', async () => {
  const FP = 'ch01.first_path';
  const id = (n: number) => `${FP}.${String(n).padStart(3, '0')}`;
  const a: string[] = [];
  await runDialogue(CH01, FP, ports(a), { endAfter: FP, untilEntry: id(4), exact: true });
  assert.deepEqual(a, [1, 2, 3, 4].map(id), '입구: 걷는 장면만(전투 없음, 본 구간 기록 없음)');

  const b: string[] = [];
  await runDialogue(CH01, FP, ports(b), { endAfter: FP, fromEntry: id(5), untilEntry: id(9), exact: true });
  assert.deepEqual(b, [5, 6, 7, 8, 9].map(id), '잘린 실 지점');

  const c: string[] = [];
  await runDialogue(CH01, FP, ports(c), { endAfter: 'ch01.bopul_clue', fromEntry: id(10), exact: true });
  assert.deepEqual(c.slice(0, 7), [...[10, 11, 12, 13, 14, 15].map(id), 'battle:forest_stitchling_ambush']);
  assert.ok(c.includes(`seen:${FP}`) && c.includes('seen:ch01.bopul_clue'), '끝까지 본 구간만 기록');
  assert.equal(c[c.length - 1], 'event:forest_dansuring_clue_learned', '단서 구간의 완료 이벤트');
  // 세 부분을 이으면 첫 길 전체와 같다(빠지거나 겹치는 대사 없음)
  const whole = CH01.segments.find((s) => s.segmentId === FP)!.entries.filter((e) => e.kind !== 'storyBattle').map((e) => e.dialogueId);
  assert.deepEqual([...a, ...b, ...c.filter((x) => x.startsWith(`${FP}.`))], whole);

  // 숨은 길: 지점은 001~002만, 거대 매듭 지점이 전투(003)부터 각성까지
  const HP = 'ch01.hidden_path';
  const d: string[] = [];
  await runDialogue(CH01, HP, ports(d), { endAfter: HP, untilEntry: `${HP}.002`, exact: true });
  assert.deepEqual(d, [`${HP}.001`, `${HP}.002`]);
  const e: string[] = [];
  await runDialogue(CH01, HP, ports(e), { endAfter: 'ch01.first_knot_awaken', fromEntry: `${HP}.003`, exact: true });
  assert.equal(e[0], 'battle:forest_giant_knot');
  assert.equal(e[e.length - 1], 'event:forest_first_knot_awakened');
  // 없는 항목 ID는 오류(잘못된 범위를 조용히 넘기지 않는다)
  await assert.rejects(runDialogue(CH01, FP, ports([]), { endAfter: FP, untilEntry: 'ch01.first_path.999', exact: true }), /끝 항목/);
});
