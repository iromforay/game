import Phaser from 'phaser';

// Bakes a glossy, domed "Go stone" look (bright highlight offset toward one
// corner, darkening toward the rim) into a small canvas texture, once per
// color+radius combo, reused by every egg that needs it.
export function ensureEggTexture(scene: Phaser.Scene, color: number, radius: number): string {
  const key = `egg-tex-${color.toString(16)}-${radius}`;
  if (scene.textures.exists(key)) return key;

  const size = radius * 2 + 4;
  const cx = size / 2;
  const cy = size / 2;

  const canvasTexture = scene.textures.createCanvas(key, size, size)!;
  const ctx = canvasTexture.getContext();

  const c = Phaser.Display.Color.IntegerToColor(color);
  const light = `rgb(${Math.min(255, c.red + 100)}, ${Math.min(255, c.green + 100)}, ${Math.min(255, c.blue + 100)})`;
  const base = `rgb(${c.red}, ${c.green}, ${c.blue})`;
  const dark = `rgb(${Math.max(0, c.red - 100)}, ${Math.max(0, c.green - 100)}, ${Math.max(0, c.blue - 100)})`;

  const gradient = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.55, base);
  gradient.addColorStop(1, dark);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();

  canvasTexture.refresh();
  return key;
}
