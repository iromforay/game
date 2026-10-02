// 새로고침·재접속 뒤 어느 화면에서 다시 시작할지(10-02 v5 §3) — 순수 판정(test/restore.test.ts).
// 근거는 서버의 접속 인증(presence:hello) 응답뿐이다. 브라우저에 남은 방 번호·위치 같은 로컬 상태로 복원하지 않는다.
//   1) 진행 중인 전투가 있으면 전투(파티 선택 단계면 전투 화면이 파티 선택으로 넘긴다). 스토리 전투면 끝난 뒤 대화로 돌아간다
//   2) 탐험 세션이 진행 중(playing)이고 맵 안에 있었으면 그 지역의 Map
//   3) 이어 볼 대화 구간은 Map 입장 응답(story.play)으로 서버가 알려 준다 — Map이 재생한다
//   4) 그 밖에는 마을(유예가 끝나 세션이 닫힌 경우 포함)

export interface RestoreInput {
  battle: { stageCode: string; story?: { encounterKey: string } | null } | null;
  room: { stageCode: string; phase: string } | null;
  inMap: boolean;
}

export type RestoreRoute = { to: 'battle'; stageCode: string; storyEncounterKey: string | null } | { to: 'map'; stageCode: string } | { to: 'village' };

export function restoreRoute(input: RestoreInput): RestoreRoute {
  if (input.battle) return { to: 'battle', stageCode: input.battle.stageCode, storyEncounterKey: input.battle.story?.encounterKey ?? null };
  if (input.room && input.room.phase === 'playing' && input.inMap) return { to: 'map', stageCode: input.room.stageCode };
  return { to: 'village' };
}
