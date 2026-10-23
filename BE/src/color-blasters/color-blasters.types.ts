export const COLOR_BLASTERS_EVENTS = {
  queueJoin: 'color-blasters:queue:join',
  queueLeave: 'color-blasters:queue:leave',
  matchFound: 'color-blasters:match:found',
  move: 'color-blasters:move',
  fire: 'color-blasters:fire',
  state: 'color-blasters:state',
  result: 'color-blasters:result',
  error: 'color-blasters:error',
} as const;

export const COLOR_BLASTERS_ZONES = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type ColorBlastersZone = (typeof COLOR_BLASTERS_ZONES)[number];

export interface BattlePosition {
  x: number;
  z: number;
  facing: number;
}

export interface BattleVector3 { x: number; y: number; z: number }

export interface BattlePlayerState {
  playerId: string;
  socketId: string;
  position: BattlePosition;
  paintedZones: Set<ColorBlastersZone>;
  lastShotAt: number;
}

export interface BattleMatch {
  matchId: string;
  players: [BattlePlayerState, BattlePlayerState];
  startedAt: number;
  finished: boolean;
}
