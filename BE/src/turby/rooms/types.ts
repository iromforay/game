export type Facing = 'down' | 'left' | 'right' | 'up';
export type RoomVisibility = 'public' | 'private';
export type RoomPhase = 'lobby' | 'playing';

export const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];
export const MIN_PLAYERS = 1; // docs/Save a Turby.md 3.6: 방 인원 1~5명
export const MAX_PLAYERS = 5;
export const ROOM_NAME_MAX = 20;
export const ROOM_CODE_LENGTH = 5;

export interface RoomMember {
  playerId: string;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  inMap: boolean;
  x: number;
  y: number;
  dir: Facing;
  lastMoveAt: number;
  graceTimer: NodeJS.Timeout | null;
}

export type WildState = 'free' | 'engaged' | 'captured' | 'removed';

// 방 안의 야생 터비 1마리(서버 권위). 원본은 stage_wild_spawn이고 상태만 방마다 따로 가진다.
export interface WildRuntime {
  index: number;
  characterCode: string;
  x: number;
  y: number;
  state: WildState;
  battleId: string | null; // engaged일 때 이 야생과 싸우는 전투
}

export interface WildDto {
  index: number;
  state: WildState;
}

export interface Room {
  code: string;
  name: string;
  stageCode: string;
  mapWidth: number;
  mapHeight: number;
  maxPlayers: number;
  visibility: RoomVisibility;
  phase: RoomPhase;
  members: RoomMember[]; // 입장 순서 — 호스트 승계 기준
  wilds: WildRuntime[];
}

export interface MemberDto {
  playerId: string;
  nickname: string;
  connected: boolean;
  inMap: boolean;
}

export interface RoomStateDto {
  code: string;
  name: string;
  stageCode: string;
  maxPlayers: number;
  visibility: RoomVisibility;
  phase: RoomPhase;
  hostPlayerId: string;
  members: MemberDto[];
}

export interface RoomSummaryDto {
  code: string;
  name: string;
  stageCode: string;
  maxPlayers: number;
  memberCount: number;
  phase: RoomPhase;
  hostNickname: string;
}

export interface MapPlayerDto {
  playerId: string;
  nickname: string;
  x: number;
  y: number;
  dir: Facing;
}

export class RoomError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
