import Phaser from 'phaser';
import { getVillagePaths } from '../config/village';
import type { VillageLayout } from '../config/village';

type Draw = (g: Phaser.GameObjects.Graphics) => void;

// 최종 에셋 파일명과 같은 키로 임시 도형 텍스처를 만든다 — 실제 PNG가 로드돼 있으면 건드리지 않음
function ensureTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const STONE = 0xb8b0a0;
const WOOD = 0xb98252;
const DARK = 0x3a2a1c;
const CREAM = 0xf0e2c0;

function panel(g: Phaser.GameObjects.Graphics, w: number, h: number) {
  g.fillStyle(DARK, 0.85).fillRoundedRect(2, 2, w - 4, h - 4, 18);
  g.lineStyle(4, CREAM, 1).strokeRoundedRect(2, 2, w - 4, h - 4, 18);
}

function star(g: Phaser.GameObjects.Graphics, cx: number, cy: number, outer: number, inner: number) {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  g.fillPoints(pts, true);
}

export function ensureVillagePlaceholders(scene: Phaser.Scene, layout: VillageLayout) {
  ensureTexture(scene, 'home-field', 512, 512, (g) => {
    g.fillStyle(WOOD).fillRect(96, 250, 320, 200);
    g.fillStyle(0xa8483c).fillTriangle(70, 262, 256, 100, 442, 262);
    g.fillStyle(0x7a3a30).fillRect(350, 120, 34, 80);
    g.fillStyle(0x5a3a24).fillRect(226, 350, 60, 100);
    g.fillStyle(0xffe9a8).fillRect(130, 300, 60, 50).fillRect(322, 300, 60, 50);
  });
  ensureTexture(scene, 'market-field', 640, 512, (g) => {
    g.fillStyle(WOOD).fillRect(80, 310, 480, 140);
    for (let i = 0; i < 8; i++) g.fillStyle(i % 2 === 0 ? 0xd9534f : 0xf5e6c8).fillRect(60 + i * 65, 200, 65, 110);
    g.fillStyle(0x5a3a24).fillRect(70, 200, 14, 250).fillRect(556, 200, 14, 250);
    g.fillStyle(0xf3c969).fillRect(150, 330, 80, 50).fillRect(280, 330, 80, 50).fillRect(410, 330, 80, 50);
  });
  ensureTexture(scene, 'village-fountain', 384, 384, (g) => {
    g.fillStyle(STONE).fillEllipse(192, 290, 300, 110);
    g.fillStyle(0x6fc3e6).fillEllipse(192, 284, 250, 84);
    g.fillStyle(STONE).fillRect(172, 150, 40, 130).fillEllipse(192, 150, 90, 34);
    g.fillStyle(0x9adcf2).fillEllipse(192, 146, 60, 20);
  });
  ensureTexture(scene, 'village-gate', 512, 384, (g) => {
    g.fillStyle(STONE).fillRect(60, 130, 70, 208).fillRect(382, 130, 70, 208);
    g.fillStyle(0x8f8878).fillRect(40, 90, 432, 56);
    g.fillStyle(0x4a7a3a).fillRect(180, 96, 152, 40);
  });
  for (const [key, crown] of [['tree-a', 0x4f9a4a], ['tree-b', 0x6bb35a]] as const) {
    ensureTexture(scene, key, 256, 384, (g) => {
      g.fillStyle(0x6b4a2b).fillRect(108, 230, 40, 135);
      g.fillStyle(crown).fillCircle(128, 150, 100).fillCircle(80, 200, 60).fillCircle(176, 200, 60);
    });
  }
  ensureTexture(scene, 'lamp-post', 128, 256, (g) => {
    g.fillStyle(0x4a4038).fillRect(58, 80, 12, 163);
    g.fillStyle(0xffe08a).fillCircle(64, 66, 22);
  });
  ensureTexture(scene, 'fence-horizontal', 256, 128, (g) => {
    g.fillStyle(WOOD).fillRect(0, 62, 256, 14).fillRect(0, 90, 256, 14);
    for (let x = 4; x < 256; x += 64) g.fillStyle(0x8a5a30).fillRect(x, 50, 12, 66);
  });
  ensureTexture(scene, 'fence-vertical', 128, 256, (g) => {
    g.fillStyle(WOOD).fillRect(58, 0, 12, 256);
    for (let y = 0; y < 256; y += 64) g.fillStyle(0x8a5a30).fillRect(50, y + 10, 28, 12);
  });

  ensureTexture(scene, 'village-path-overlay', layout.width, layout.height, (g) => {
    const { lines, plaza } = getVillagePaths(layout);
    g.lineStyle(70, 0xd8c9a6, 0.9);
    for (const [a, b, c] of lines) g.beginPath().moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y).strokePath();
    g.fillStyle(0xd8c9a6, 0.9).fillEllipse(plaza.x, plaza.y, plaza.w, plaza.h);
  });

  ensureUiPlaceholders(scene);
}

// 지도·HUD용 임시 도형 — 마을과 야생 맵이 같이 쓰므로 레이아웃 없이도 만들 수 있게 분리
export function ensureUiPlaceholders(scene: Phaser.Scene) {
  ensureTexture(scene, 'hud-coin-panel', 320, 96, (g) => panel(g, 320, 96));
  ensureTexture(scene, 'hud-area-panel', 480, 96, (g) => panel(g, 480, 96));
  ensureTexture(scene, 'prompt-interact', 256, 96, (g) => panel(g, 256, 96));
  ensureTexture(scene, 'minimap-frame', 192, 192, (g) => {
    g.lineStyle(10, CREAM, 1).strokeCircle(96, 96, 91);
    g.lineStyle(4, DARK, 1).strokeCircle(96, 96, 84);
  });

  // 코덱스 시각 QA: 검은 원 대신 크림 펠트 원 + 라벤더 테두리
  ensureTexture(scene, 'map-open', 64, 64, (g) => {
    g.fillStyle(0xfff4df, 1).fillCircle(32, 32, 29).lineStyle(4, 0xdcd3f4, 1).strokeCircle(32, 32, 29);
    g.fillStyle(0x695b67).fillRect(18, 22, 8, 22).fillRect(28, 20, 8, 22).fillRect(38, 22, 8, 22);
  });
  ensureTexture(scene, 'map-close', 64, 64, (g) => {
    g.fillStyle(0xfff4df, 1).fillCircle(32, 32, 29).lineStyle(4, 0xdcd3f4, 1).strokeCircle(32, 32, 29);
    g.lineStyle(6, 0x695b67, 1).beginPath().moveTo(21, 21).lineTo(43, 43).moveTo(43, 21).lineTo(21, 43).strokePath();
  });
  ensureTexture(scene, 'marker-player', 40, 40, (g) => {
    g.fillStyle(0x695b67).fillTriangle(20, 3, 35, 35, 5, 35);
    g.lineStyle(3, 0xfff4df, 1).strokeTriangle(20, 3, 35, 35, 5, 35);
  });
  ensureTexture(scene, 'marker-home', 40, 40, (g) => {
    g.fillStyle(0xd9a58a).fillRect(9, 18, 22, 17).fillStyle(0xc78a80).fillTriangle(4, 20, 20, 5, 36, 20);
    g.lineStyle(2, 0xfff4df, 1).strokeRect(9, 18, 22, 17);
  });
  ensureTexture(scene, 'marker-market', 40, 40, (g) => {
    g.fillStyle(0xd99a9a).fillTriangle(4, 22, 20, 5, 36, 22).fillStyle(0xf5e6c8).fillRect(8, 22, 24, 13);
    g.lineStyle(2, 0xfff4df, 1).strokeRect(8, 22, 24, 13);
  });
  ensureTexture(scene, 'marker-exit', 40, 40, (g) => {
    g.fillStyle(0x8fbf9f).fillRoundedRect(8, 4, 24, 32, 10);
    g.fillStyle(0x5f8a6f).fillRect(16, 16, 8, 20);
    g.lineStyle(2, 0xfff4df, 1).strokeRoundedRect(8, 4, 24, 32, 10);
  });
  ensureTexture(scene, 'marker-locked', 40, 40, (g) => {
    g.lineStyle(4, 0xcccccc, 1).strokeCircle(20, 14, 8);
    g.fillStyle(0x8a8a8a).fillRoundedRect(9, 18, 22, 18, 3);
  });
  // 10-02 v3: 이야기 지점·실가루 지도 표식(임시 도형 — 최종 에셋 아님)
  ensureTexture(scene, 'marker-story', 40, 40, (g) => {
    g.lineStyle(4, 0x9276d2, 1).strokeCircle(20, 20, 15);
    g.fillStyle(0x9276d2, 1).fillCircle(20, 20, 7);
  });
  ensureTexture(scene, 'marker-dust', 40, 40, (g) => {
    g.fillStyle(0xffd23f, 1).fillPoints([{ x: 20, y: 4 }, { x: 34, y: 20 }, { x: 20, y: 36 }, { x: 6, y: 20 }], true);
    g.lineStyle(2, 0x695b67, 1).strokePoints([{ x: 20, y: 4 }, { x: 34, y: 20 }, { x: 20, y: 36 }, { x: 6, y: 20 }], true);
  });
  ensureTexture(scene, 'marker-current', 48, 48, (g) => {
    g.fillStyle(0xffd23f, 0.35);
    star(g, 24, 25, 22, 10);
    g.lineStyle(3, 0xffd23f, 1).strokeCircle(24, 24, 21);
  });
}
