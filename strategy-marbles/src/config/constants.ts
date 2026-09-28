import Phaser from 'phaser';

export const HUD_HEIGHT = 110;

export const BOARD_RADIUS = 260;
export const BOARD_CENTER_X = 320;
export const BOARD_CENTER_Y = 300;

export const GAME_WIDTH = BOARD_CENTER_X * 2;
export const GAME_HEIGHT = BOARD_CENTER_Y * 2;
export const CANVAS_WIDTH = GAME_WIDTH;
export const CANVAS_HEIGHT = GAME_HEIGHT + HUD_HEIGHT;

// The arena camera is enlarged independently from the HUD scene.
export const BOARD_ZOOM = 1.5;

export const DEFAULT_PLAYER_COUNT = 2;
export const EGGS_PER_PLAYER = 4;

export const TURN_TIME_LIMIT_MS = 20_000;
export const MAX_TURNS = 12;

// Drag-to-flick tuning: pulling the pointer this far from the egg reaches max power.
export const MAX_PULL_DISTANCE = 140;
export const MAX_LAUNCH_SPEED = 22;

export const SCORE_HIT = 20;
export const SCORE_OUT = 100;

// Up to 9 players (matches the multiplayer room's max player count), in a
// fixed traditional-ish order: white, black, then a spread of saturated
// colors chosen to stay distinct from each other and from the dark green
// board.
export const PLAYER_COLORS = [
  0xf5f5f0, // 1P 백색
  0x1a1a1a, // 2P 흑색
  0xdb4437, // 3P 적색
  0x4285f4, // 4P 청색
  0x34a853, // 5P 녹색
  0xfbbc05, // 6P 황색
  0x9b59b6, // 7P 보라
  0xff8c00, // 8P 주황
  0x00bcd4, // 9P 하늘
];

// PLAYER_COLORS as-is, for drawing the stones themselves. For HUD text drawn
// on the (dark) HUD background, near-black entries like 2P need a brightness
// floor or they're unreadable - this lightens a color only when needed.
export function uiTextColor(color: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  const luminance = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255;
  const MIN_LUMINANCE = 0.35;
  if (luminance >= MIN_LUMINANCE) return color;
  const boost = MIN_LUMINANCE - luminance;
  const lighten = (channel: number) => Math.min(255, Math.round(channel + boost * 255));
  return Phaser.Display.Color.GetColor(lighten(c.red), lighten(c.green), lighten(c.blue));
}
