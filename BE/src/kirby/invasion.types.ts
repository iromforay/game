export interface ActiveInvasion {
  instanceId: string;
  ownerPlayerId: string;
  viewerPlayerId: string;
  hitCount: number;
  positions: Map<string, { x: number; y: number; t: number }>; // playerId -> last known position + timestamp(ms)
}
