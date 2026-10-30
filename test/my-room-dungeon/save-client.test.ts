import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../my-room-dungeon/src/saveClient.ts', import.meta.url), 'utf8');

test('내방이 던전 FE는 서버 환경변수와 메인 BE 기본 포트를 사용한다', () => {
  assert.match(source, /VITE_MY_ROOM_DUNGEON_SERVER_URL/);
  assert.match(source, /http:\/\/localhost:3001/);
});

test('모든 저장 요청은 인증 토큰을 Bearer 헤더로 전달한다', () => {
  assert.match(source, /AUTH_TOKEN_KEY\s*=\s*'bomul_auth_token'/);
  assert.match(source, /Authorization:\s*`Bearer \$\{authToken\}`/);
});

test('프로필 조회와 저장 API 계약이 유지된다', () => {
  assert.match(source, /request<DungeonSaveData>\('\/profile'\)/);
  assert.match(source, /request<DungeonSaveData>\('\/profile',\s*\{\s*method:\s*'PUT'/s);
});

test('채집과 구역 완료 API가 요청 payload를 전달한다', () => {
  assert.match(source, /request<DungeonSaveData>\('\/collect'/);
  assert.match(source, /JSON\.stringify\(\{ resource, quantity \}\)/);
  assert.match(source, /request<DungeonSaveData>\('\/complete-zone'/);
  assert.match(source, /JSON\.stringify\(\{ zoneId \}\)/);
});

test('로봇 배치와 정산 API 경로가 정의되어 있다', () => {
  assert.match(source, /request<DungeonSaveData>\('\/deploy-robot'/);
  assert.match(source, /request<DungeonSettlementResponse>\('\/settle-robots'/);
});
