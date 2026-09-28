import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config/constants';

// 사용자 요청(2026-09-28): 디펜스/오펜스 타워 게임판을 150% 확대하고 드래그로 화면 이동.
// 확대는 게임판 카메라에만 적용(오른쪽 사이드바 UIScene은 별도 씬이라 그대로 유지).
export const BOARD_ZOOM = 1.5;
// 이 거리(캔버스 px) 이상 움직이면 드래그(화면 이동), 그보다 적게 움직이고 떼면 탭(타워 설치/선택 등)
const DRAG_THRESHOLD_PX = 10;

export interface BoardCamera {
  isDragging(): boolean;
  toWorld(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2;
}

export function setupBoardCamera(scene: Phaser.Scene, onTap?: (worldX: number, worldY: number) => void): BoardCamera {
  const cam = scene.cameras.main;
  cam.setViewport(0, 0, GAME_WIDTH, GAME_HEIGHT);
  cam.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
  cam.setZoom(BOARD_ZOOM);
  cam.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);

  let start: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  let dragging = false;
  const inBoard = (p: Phaser.Input.Pointer) => p.x >= 0 && p.x < GAME_WIDTH && p.y >= 0 && p.y < GAME_HEIGHT;

  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (!inBoard(p)) return; // 사이드바 버튼 조작은 드래그/탭 대상 아님
    start = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
    dragging = false;
  });
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (!start || !p.isDown) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    cam.setScroll(start.scrollX - dx / cam.zoom, start.scrollY - dy / cam.zoom); // setBounds가 판 밖으로 못 나가게 막아줌
  });
  const end = (p: Phaser.Input.Pointer) => {
    const wasTap = start !== null && !dragging;
    start = null;
    dragging = false;
    if (wasTap && onTap && inBoard(p)) {
      const w = cam.getWorldPoint(p.x, p.y);
      onTap(w.x, w.y);
    }
  };
  scene.input.on('pointerup', end);
  scene.input.on('pointerupoutside', end);

  return {
    isDragging: () => dragging,
    toWorld: (p) => cam.getWorldPoint(p.x, p.y),
  };
}
