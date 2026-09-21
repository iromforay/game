import { roomClient } from './roomClient';
import type { ActionBody, BattleResponse, BattleSnapshot } from './battleTypes';

// 4-B: 서버 전투 요청 래퍼. 오류는 RoomApiError(code)로 던져지고 STATE_MISMATCH는 최신 snapshot을 함께 담는다.
export const battleClient = {
  async start(spawnIndex: number): Promise<BattleSnapshot> {
    return (await roomClient.request<{ snapshot: BattleSnapshot }>('battle:start', { spawnIndex })).snapshot;
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

  snapshot(battleId: string): Promise<BattleResponse> {
    return roomClient.request<BattleResponse>('battle:snapshot', { battleId });
  },
};
