export interface ActiveInvasion {
  instanceId: string;
  ownerPlayerId: string;
  viewerPlayerId: string;
  hitCount: number;
  startedAt: number; // 방어 시간(1분) 기준 시각 — Date.now()
  exitEnteredAt?: number;
  positions: Map<string, { x: number; y: number; t: number }>; // playerId -> last known position + timestamp(ms)
}
