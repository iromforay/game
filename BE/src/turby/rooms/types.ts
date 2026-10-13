import type { StageCollision } from './stage-collision';
import type { StageWater, WaterMemberState } from './stage-water';
export type Facing = 'down' | 'left' | 'right' | 'up';
export type RoomVisibility = 'private'; // 멀티 제거: 방은 항상 플레이어 1인 전용(공개 목록·참가 없음)
export type RoomPhase = 'lobby' | 'playing';

export const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];
export const MAX_PLAYERS = 1;
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
  // 10-02 v4: 서버 권위 위치. placed = 이 탐험 세션에서 서버가 위치를 정해 준 적이 있는가(없으면 시작 지점부터)
  placed: boolean;
  storyEvents: Set<string>; // 문·구역 판정에 쓰는 이 플레이어의 완료 이벤트(입장 때 읽고, 이벤트가 기록되면 갱신)
  water: WaterMemberState; // 10-13 C2-2: 이 플레이어의 물살 cooldown·연속 적용·안전 앵커(다른 플레이어와 공유하지 않는다)
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

// 클라이언트에 내려 주는 야생 마커(10-02 v6 §1) — 위치의 유일한 정본은 서버(stage_wild_spawn)다. 클라이언트는 이 좌표로만 마커를 놓는다.
// index = 서버 야생 마커 ID(지역 안에서 고유, 전투·상태 방송·재접속 뒤에도 같은 값)
export interface WildDto {
  index: number;
  characterCode: string; // 표시 키(터비 종류)
  x: number;
  y: number;
  state: WildState;
  visible: boolean; // 지도에 보이는가(free·engaged). captured·removed는 이 탐험 세션에서 다시 나오지 않는다
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
  collision: StageCollision; // 지도 경계·시작 지점·막힌 곳·문(지역 데이터)
  water: StageWater | null; // 물·물살·안전 앵커(지역 데이터, 없으면 null)
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
