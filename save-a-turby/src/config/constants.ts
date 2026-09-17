// 4.6 화면/캔버스 규격 확정: 가로(landscape) 고정, 1280x720
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

// 3.5.2 배틀그리드: 80px 타일, 12열 x 8행
export const BATTLE_TILE_SIZE = 80;
export const BATTLE_GRID_COLS = 12;
export const BATTLE_GRID_ROWS = 8;

// 3.5.1 맵(탐험) 자유이동 프로토타입(7-5) — 수치는 임시, 실측/밸런싱 전
export const AVATAR_SPEED = 260; // px/sec, 가상 조이스틱 최대 기울임 기준
export const ENCOUNTER_RADIUS = 40; // 아바타-야생 터비 조우 판정 거리(px)
export const VILLAGE_INTERACT_RADIUS = 55; // 아바타-마을 건물/출구 상호작용 판정 거리(px)
export const JOYSTICK_BASE_RADIUS = 55;
export const JOYSTICK_THUMB_RADIUS = 26;
