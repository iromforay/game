export const HUD_HEIGHT = 110;

export const BOARD_RADIUS = 260;
export const BOARD_CENTER_X = 320;
export const BOARD_CENTER_Y = 300;

export const GAME_WIDTH = BOARD_CENTER_X * 2;
export const GAME_HEIGHT = BOARD_CENTER_Y * 2;
export const CANVAS_WIDTH = GAME_WIDTH;
export const CANVAS_HEIGHT = GAME_HEIGHT + HUD_HEIGHT;

export const DEFAULT_PLAYER_COUNT = 2;
export const EGGS_PER_PLAYER = 4;

export const TURN_TIME_LIMIT_MS = 20_000;
export const MAX_TURNS = 12;

// Drag-to-flick tuning: pulling the pointer this far from the egg reaches max power.
export const MAX_PULL_DISTANCE = 140;
export const MAX_LAUNCH_SPEED = 22;

export const SCORE_HIT = 20;
export const SCORE_OUT = 100;

export const PLAYER_COLORS = [0xff5a5a, 0x5ac8ff, 0x8aff5a, 0xffd75a];
