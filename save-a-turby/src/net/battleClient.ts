import { roomClient } from './roomClient';
import type { ActionBody, BattleResponse, BattleSnapshot } from './battleTypes';

// 4-B: 서버 전투 요청 래퍼. 오류는 RoomApiError(code)로 던져지고 STATE_MISMATCH는 최신 snapshot을 함께 담는다.
export const battleClient = {
  async start(spawnIndex: number): Promise<BattleSnapshot> {
    return (await roomClient.request<{ snapshot: BattleSnapshot }>('battle:start', { spawnIndex })).snapshot;
  },

  // M4-B/C: 대화의 storyBattle 항목 → 서버 스토리 전투(이미 이긴 전투는 STORY_ENCOUNTER_DONE 오류)
  async startStory(encounterKey: string): Promise<BattleSnapshot> {
    return (await roomClient.request<{ snapshot: BattleSnapshot }>('battle:story:start', { encounterKey })).snapshot;
  },

  // 조우 초대에 참전/불참으로 응답
  respond(battleId: string, join: boolean): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:respond', { battleId, join });
  },

  party(battleId: string, turbyIds: string[]): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:party', { battleId, turbyIds });
  },

  // 같은 actionId를 재전송해도 서버가 최초 응답을 돌려주므로, 네트워크 실패 시 같은 요청 객체를 그대로 다시 보낼 수 있다
  action(battleId: string, expectedVersion: number, body: ActionBody, actionId = crypto.randomUUID()): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:action', { battleId, actionId, expectedVersion, ...body });
  },

  // 파티 선택을 포기하거나 전투에서 빠진다(보상 없음, 마지막 참전자면 전투 취소)
  leave(battleId: string): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:leave', { battleId });
  },

  // 10-06 v3 §2: 결과 화면을 보여 준 뒤 사용자가 돌아가기를 선택했을 때 보내는 명시적 결과 확인(여러 번 보내도 같은 성공)
  async ackResult(battleId: string): Promise<void> {
    await roomClient.request<{ acknowledged: true }>('battle:result:ack', { battleId });
    if (roomClient.activeBattle?.battleId === battleId) roomClient.activeBattle = null; // 확인한 결과를 접속 인증 때 받아 둔 값으로 다시 안내하지 않는다
  },

  snapshot(battleId: string): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:snapshot', { battleId });
  },
};
