// 아직 열리지 않은 구역을 가리는 안개 — 아트 에셋이 아니라 실행 중에 만드는 단색 반투명 막이다(가장자리만 부드럽게).
// 서버가 render.overlays에 assetKey 'fog-veil'로 내려 주고(이벤트 전까지만), 이벤트가 기록되면 같은 서버 화면 데이터에서 사라진다.
// 최종 배경에는 숨은 길이 처음부터 그려져 있어서, 개방 전에는 이 막이 길을 가린다("공개 전에는 보이지 않음").
import type Phaser from 'phaser';

export const FOG_KEY = 'fog-veil';
const SIZE = 256;
const FEATHER = 36; // 가장자리 부드러운 폭(텍스처 픽셀). 월드에서는 표시 크기에 비례해 늘어난다
export const FOG_COLOR = 'rgba(34, 44, 52, 0.94)';

export function ensureFogTexture(textures: Phaser.Textures.TextureManager): boolean {
  if (textures.exists(FOG_KEY)) return true;
  const tex = textures.createCanvas(FOG_KEY, SIZE, SIZE);
  if (!tex) return false;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = FOG_COLOR;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // 네 가장자리를 안쪽으로 투명하게 지운다
  ctx.globalCompositeOperation = 'destination-out';
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, FEATHER, 0, 0, 0, FEATHER, SIZE);
  edge(SIZE, 0, SIZE - FEATHER, 0, SIZE - FEATHER, 0, FEATHER, SIZE);
  edge(0, 0, 0, FEATHER, 0, 0, SIZE, FEATHER);
  edge(0, SIZE, 0, SIZE - FEATHER, 0, SIZE - FEATHER, SIZE, FEATHER);
  ctx.globalCompositeOperation = 'source-over';
  tex.refresh();
  return true;
}
