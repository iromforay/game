import { io, type Socket } from 'socket.io-client';
import type { PaintZone } from './gameLogic';

export const COLOR_BLASTERS_EVENTS = {
  queueJoin: 'color-blasters:queue:join', queueLeave: 'color-blasters:queue:leave',
  matchFound: 'color-blasters:match:found', move: 'color-blasters:move', fire: 'color-blasters:fire',
  state: 'color-blasters:state', result: 'color-blasters:result', error: 'color-blasters:error',
} as const;

export interface MultiplayerSnapshot {
  matchId: string;
  startedAt: number;
  finished: boolean;
  players: Array<{
    playerId: string;
    socketId: string;
    position: { x: number; z: number; facing: number };
    paintedZones: PaintZone[];
  }>;
}

export function createColorBlastersSocket(serverUrl = import.meta.env.VITE_COLOR_BLASTERS_SERVER_URL ?? 'http://localhost:3007'): Socket {
  return io(serverUrl, { transports: ['websocket'], autoConnect: false });
}
