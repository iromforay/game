// 10-02 v5 §3: 새로고침·재접속 뒤의 화면 복원 우선순위(순수 판정). 근거는 서버의 접속 인증 응답뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { restoreRoute } from '../src/state/restore.ts';

const room = (phase: string) => ({ stageCode: 'forest', phase });

test('복원 우선순위: 전투 → 탐험 중이던 Map → 마을', () => {
  // 1) 진행 중인 전투가 가장 먼저(탐험 세션 안에 있어도)
  assert.deepEqual(restoreRoute({ battle: { stageCode: 'forest' }, room: room('playing'), inMap: true }), { to: 'battle', stageCode: 'forest', storyEncounterKey: null });
  assert.deepEqual(restoreRoute({ battle: { stageCode: 'forest', story: { encounterKey: 'forest_giant_knot' } }, room: room('playing'), inMap: true }), { to: 'battle', stageCode: 'forest', storyEncounterKey: 'forest_giant_knot' }, '스토리 전투는 끝난 뒤 대화로 돌아갈 키를 넘긴다');
  // 2) 탐험 세션이 진행 중이고 맵 안에 있었으면 그 지역의 Map
  assert.deepEqual(restoreRoute({ battle: null, room: room('playing'), inMap: true }), { to: 'map', stageCode: 'forest' });
  // 4) 그 밖에는 마을
  assert.deepEqual(restoreRoute({ battle: null, room: room('playing'), inMap: false }), { to: 'village' }, '방은 있지만 맵에 들어간 적 없음');
  assert.deepEqual(restoreRoute({ battle: null, room: room('lobby'), inMap: true }), { to: 'village' }, '시작 전인 방');
  assert.deepEqual(restoreRoute({ battle: null, room: null, inMap: false }), { to: 'village' }, '유예가 끝나 세션이 닫힘');
  assert.deepEqual(restoreRoute({ battle: null, room: null, inMap: true }), { to: 'village' }, '방 없이 inMap만 남은 값은 믿지 않는다');
});

test('복원은 서버 응답만 쓴다: 방 번호·위치를 브라우저 저장소에 두거나 읽지 않고, 복원 입장도 좌표를 보내지 않는다', () => {
  const read = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
  for (const f of ['state/restore.ts', 'scenes/BootScene.ts', 'net/roomClient.ts', 'scenes/MapScene.ts']) {
    const src = read(f);
    assert.doesNotMatch(src, /(localStorage|sessionStorage)\.(get|set)Item\([^)]*(room|position|spawn|lastPos)/i, `${f}: 방·위치를 저장소에 두지 않는다`);
  }
  assert.match(read('net/roomClient.ts'), /request<[^>]*>\('map:enter', \{ dir \}\)/s, '입장 요청에는 방향만');
  assert.match(read('scenes/BootScene.ts'), /restoreRoute\(\{ battle: roomClient\.activeBattle, room: roomClient\.room, inMap: roomClient\.resumeInMap \}\)/);
});
