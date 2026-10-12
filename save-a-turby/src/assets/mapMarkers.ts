// 지도(미니맵·전체 지도·범례)의 정식 UI 기호 텍스처 — 정의(키·크기·종류)는 mapMarkerSpecs.ts, 여기서는 그리기만 한다.
// 월드의 임시 placeholder(placeholders.ts)와 분리된 정식 UI 기호다. 키·크기·색·모양은 분리 전과 같다.
import Phaser from 'phaser';
import { MAP_MARKER_SPECS, type MarkerShape } from './mapMarkerSpecs';

type Draw = (g: Phaser.GameObjects.Graphics) => void;

function star(g: Phaser.GameObjects.Graphics, cx: number, cy: number, outer: number, inner: number) {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  g.fillPoints(pts, true);
}

const DRAW: Record<MarkerShape, Draw> = {
  arrow: (g) => {
    g.fillStyle(0x695b67).fillTriangle(20, 3, 35, 35, 5, 35);
    g.lineStyle(3, 0xfff4df, 1).strokeTriangle(20, 3, 35, 35, 5, 35);
  },
  house: (g) => {
    g.fillStyle(0xd9a58a).fillRect(9, 18, 22, 17).fillStyle(0xc78a80).fillTriangle(4, 20, 20, 5, 36, 20);
    g.lineStyle(2, 0xfff4df, 1).strokeRect(9, 18, 22, 17);
  },
  stall: (g) => {
    g.fillStyle(0xd99a9a).fillTriangle(4, 22, 20, 5, 36, 22).fillStyle(0xf5e6c8).fillRect(8, 22, 24, 13);
    g.lineStyle(2, 0xfff4df, 1).strokeRect(8, 22, 24, 13);
  },
  door: (g) => {
    g.fillStyle(0x8fbf9f).fillRoundedRect(8, 4, 24, 32, 10);
    g.fillStyle(0x5f8a6f).fillRect(16, 16, 8, 20);
    g.lineStyle(2, 0xfff4df, 1).strokeRoundedRect(8, 4, 24, 32, 10);
  },
  lock: (g) => {
    g.lineStyle(4, 0xcccccc, 1).strokeCircle(20, 14, 8);
    g.fillStyle(0x8a8a8a).fillRoundedRect(9, 18, 22, 18, 3);
  },
  ring: (g) => {
    g.lineStyle(4, 0x9276d2, 1).strokeCircle(20, 20, 15);
    g.fillStyle(0x9276d2, 1).fillCircle(20, 20, 7);
  },
  diamond: (g) => {
    g.fillStyle(0xffd23f, 1).fillPoints([{ x: 20, y: 4 }, { x: 34, y: 20 }, { x: 20, y: 36 }, { x: 6, y: 20 }], true);
    g.lineStyle(2, 0x695b67, 1).strokePoints([{ x: 20, y: 4 }, { x: 34, y: 20 }, { x: 20, y: 36 }, { x: 6, y: 20 }], true);
  },
  triangle: (g) => {
    g.fillStyle(0x7fc8ff, 1).fillPoints([{ x: 20, y: 5 }, { x: 35, y: 33 }, { x: 5, y: 33 }], true);
    g.lineStyle(2, 0x695b67, 1).strokePoints([{ x: 20, y: 5 }, { x: 35, y: 33 }, { x: 5, y: 33 }], true);
  },
  star: (g) => {
    g.fillStyle(0xffd23f, 0.35);
    star(g, 24, 25, 22, 10);
    g.lineStyle(3, 0xffd23f, 1).strokeCircle(24, 24, 21);
  },
};

// 마을·탐험 지도 장면이 지도 기호를 쓰기 전에 명시적으로 부른다. 같은 키의 PNG가 이미 있으면 만들지 않는다
export function ensureMapMarkerTextures(scene: Phaser.Scene) {
  for (const spec of MAP_MARKER_SPECS) {
    if (scene.textures.exists(spec.key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    DRAW[spec.shape](g);
    g.generateTexture(spec.key, spec.width, spec.height);
    g.destroy();
  }
}
