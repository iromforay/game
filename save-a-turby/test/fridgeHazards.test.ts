// 10-23 C4-1: 4장 냉장고 속 화면 쪽 계산 — 서리 구역 속도 배율·바늘 칸 단계가 서버 판정(BE rooms/stage-water.ts)과 같은 식인지, 지역 데이터 수치로 확인한다.
// 누비에게만 들리는 목소리(voice-frost) 연출이 대화 화면에 연결돼 있는지도 소스로 확인한다(Phaser 없이 node에서 실행).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { frostFactorAt, needlePhaseAt, needleUnder } from '../src/story/fridgeHazards.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const ICE = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/ice.json'), 'utf8')) as {
  frostZones: { id: string; x: number; y: number; width: number; height: number; slowFactor: number }[];
  needleFields: { id: string; x: number; y: number; width: number; height: number; periodMs: number; warnMs: number; strikeMs: number; offsetMs: number }[];
};

test('서리 구역: 안이면 0.7, 밖·경계선 위는 1', () => {
  const z = ICE.frostZones[0];
  assert.equal(frostFactorAt(ICE.frostZones, { x: z.x + 10, y: z.y + 10 }), 0.7);
  assert.equal(frostFactorAt(ICE.frostZones, { x: z.x - 1, y: z.y + 10 }), 1);
  assert.equal(frostFactorAt(ICE.frostZones, { x: z.x, y: z.y + 10 }), 1, '경계선 위는 바깥(서버 insideRect와 같다)');
  assert.equal(frostFactorAt(undefined, { x: 0, y: 0 }), 1);
});

test('바늘 칸: 서버와 같은 주기(예고 1초 → 내려찍기 0.5초 → 쉼), 1 → 2 → 3 순서로 0.6초씩 늦게 내려찍는다', () => {
  const [n1, n2, n3] = ICE.needleFields;
  assert.deepEqual([0, 999, 1000, 1499, 1500].map((t) => needlePhaseAt(n1, t)), ['warn', 'warn', 'strike', 'strike', 'idle']);
  assert.deepEqual([1600, 2200].map((t, i) => needlePhaseAt([n2, n3][i], t)), ['strike', 'strike']);
  assert.equal(needlePhaseAt(n1, -500), needlePhaseAt(n1, 2500), '음수 시각도 같은 주기');
  assert.equal(needleUnder(ICE.needleFields, { x: n1.x + n1.width / 2, y: n1.y + n1.height / 2 })?.id, 'needle_1');
  assert.equal(needleUnder(ICE.needleFields, { x: (n1.x + n1.width + n2.x) / 2, y: 1560 }), null, '칸 사이 틈은 바깥');
});

test('목소리 연출: voice-frost 지문은 은색 기울임 글자 + 화면 가장자리 서리, 서리 구역은 이동 배율과 가장자리 서리를 쓰고 안내 버튼을 늦추지 않는다', () => {
  const opening = readFileSync(here('../src/scenes/OpeningScene.ts'), 'utf8');
  assert.match(opening, /const VOICE_CUE = 'voice-frost';/);
  assert.match(opening, /else if \(cam === VOICE_CUE\) this\.playVoiceFrost\(\);/);
  assert.match(opening, /entry\.cameraCue === VOICE_CUE \? VOICE_TEXT_COLOR : TEXT\.sub/);
  const map = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  assert.match(map, /frostFactorAt\(this\.stageView\?\.layout\?\.frost, this\.avatar\)/, '이동 속도에 서리 배율');
  assert.doesNotMatch(map, /promptDelay|PROMPT_DELAY/, '10-23 Codex 의견 P-02: 안내 버튼 지연 없음');
  const room = readFileSync(here('../src/net/roomClient.ts'), 'utf8');
  assert.match(room, /this\.observeServerTime\(res\.serverNow\); \/\/ 10-23 C4-1/, '바늘 주기 표시는 map:enter의 서버 시각으로 보정');
});
