import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import itemIcons from '../data/item-icons.json';

// docs/save_a_turby_ui_spec.md 1절 공통 시각 체계. 이미지 에셋이 들어오기 전까지 도형으로 같은 정보 구조를 그린다.
export const PAL = {
  cream: 0xfff4df,
  cream2: 0xf7e9d2,
  pink: 0xf5cad8,
  lavender: 0xdcd3f4,
  mint: 0xcdebdd,
  sky: 0xcde7f3,
  disabled: 0xb9afb5,
} as const;

export const TEXT = {
  body: '#695B67',
  sub: '#8B7C86',
  error: '#B85C70',
  disabled: '#B9AFB5',
  onMint: '#4F6B5E',
} as const;

// image가 로드돼 있으면 Codex가 만든 프레임 이미지를 쓰고(문구 없는 이미지 — 글자는 호출자가 올린다), 없으면 도형으로 그린다.
export function feltPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: { fill?: number; stroke?: number; strokeW?: number; radius?: number; alpha?: number; image?: string; tint?: number; fit?: 'stretch' | 'width' } = {}): Phaser.GameObjects.GameObject {
  if (opts.image && scene.textures.exists(opts.image)) {
    // fit:'width' — 원본 비율을 지켜 폭에 맞추고 영역 중앙에 놓는다(그림 영역이 캔버스보다 얇은 행·칩 이미지용)
    if (opts.fit === 'width') {
      const tex = scene.textures.get(opts.image).getSourceImage();
      const scaleTo = w / tex.width;
      const wide = scene.add.image(x + w / 2, y + h / 2, opts.image).setScale(scaleTo);
      if (opts.tint !== undefined) wide.setTint(opts.tint);
      if (opts.alpha !== undefined) wide.setAlpha(opts.alpha);
      return wide;
    }
    const img = scene.add.image(x, y, opts.image).setOrigin(0, 0).setDisplaySize(w, h);
    if (opts.tint !== undefined) img.setTint(opts.tint);
    if (opts.alpha !== undefined) img.setAlpha(opts.alpha);
    return img;
  }
  const g = scene.add.graphics();
  g.fillStyle(opts.fill ?? PAL.cream, opts.alpha ?? 1);
  g.fillRoundedRect(x, y, w, h, opts.radius ?? 24);
  g.lineStyle(opts.strokeW ?? 5, opts.stroke ?? PAL.lavender, 1);
  g.strokeRoundedRect(x, y, w, h, opts.radius ?? 24);
  return g;
}

export type ButtonKind = 'primary' | 'secondary' | 'disabled' | 'back';

const BUTTON_STYLE: Record<ButtonKind, { fill: number; stroke: number; color: string; alpha: number }> = {
  primary: { fill: PAL.mint, stroke: PAL.lavender, color: TEXT.onMint, alpha: 1 },
  secondary: { fill: PAL.cream2, stroke: PAL.lavender, color: TEXT.body, alpha: 1 },
  back: { fill: PAL.lavender, stroke: PAL.cream, color: TEXT.body, alpha: 1 },
  disabled: { fill: PAL.cream2, stroke: PAL.disabled, color: TEXT.disabled, alpha: 0.48 },
};

// 최소 터치 64x48. 누르면 0.96 스케일. disabled면 입력을 받지 않는다(안내 토스트가 필요하면 onDisabledClick 사용).
export function pillButton(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  label: string,
  kind: ButtonKind,
  onClick: () => void,
  onDisabledClick?: () => void,
) {
  const st = BUTTON_STYLE[kind];
  const box = scene.add.container(cx, cy);
  const imageKey = kind === 'primary' ? 'button-primary' : kind === 'disabled' ? 'button-disabled' : 'button-secondary';
  if (scene.textures.exists(imageKey)) {
    box.add(scene.add.image(0, 0, imageKey).setDisplaySize(w, h));
  } else {
    const g = scene.add.graphics();
    g.fillStyle(st.fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(20, h / 2));
    g.lineStyle(4, st.stroke, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(20, h / 2));
    box.add(g);
  }
  const text = scene.add.text(0, 0, label, { fontSize: h >= 56 ? '20px' : '16px', color: st.color }).setOrigin(0.5);
  box.add(text);
  if (!scene.textures.exists(imageKey)) box.setAlpha(st.alpha);
  box.setSize(Math.max(w, 64), Math.max(h, 48));
  box.setInteractive({ useHandCursor: kind !== 'disabled' });
  box.on('pointerdown', () => {
    if (kind === 'disabled') {
      onDisabledClick?.();
      return;
    }
    box.setScale(0.96);
    onClick();
  });
  box.on('pointerup', () => box.setScale(1));
  box.on('pointerout', () => box.setScale(1));
  return box;
}

// 크림 오버레이(배경을 살짝 비치게)
export function creamOverlay(scene: Phaser.Scene, alpha = 0.78) {
  return scene.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.cream, alpha).setOrigin(0, 0);
}

// 토스트: 1.8초 표시 + 0.4초 페이드. 버튼을 가리지 않도록 호출자가 y를 정한다.
export function showToast(scene: Phaser.Scene, message: string, opts: { y?: number; error?: boolean; width?: number; fixed?: boolean } = {}) {
  const width = opts.width ?? 720;
  const y = opts.y ?? 600;
  const box = scene.add.container(CANVAS_WIDTH / 2, y).setDepth(1000);
  if (scene.textures.exists('toast-panel')) {
    box.add(scene.add.image(0, 0, 'toast-panel').setDisplaySize(width, 64));
  } else {
    const g = scene.add.graphics();
    g.fillStyle(PAL.cream, 1);
    g.fillRoundedRect(-width / 2, -28, width, 56, 22);
    g.lineStyle(4, opts.error ? 0xe9b7c2 : PAL.lavender, 1);
    g.strokeRoundedRect(-width / 2, -28, width, 56, 22);
    box.add(g);
  }
  const text = scene.add
    .text(0, 0, message, { fontSize: '16px', color: opts.error ? TEXT.error : TEXT.body, wordWrap: { width: width - 40 }, align: 'center' })
    .setOrigin(0.5);
  box.add(text);
  if (opts.fixed) {
    // 스크롤하는 카메라 위에서도 화면에 고정(컨테이너 자식은 각자 scrollFactor가 필요)
    box.setScrollFactor(0);
    box.list.forEach((o) => (o as Phaser.GameObjects.Text).setScrollFactor(0));
  }
  scene.tweens.add({ targets: box, alpha: 0, delay: 1800, duration: 400, onComplete: () => box.destroy() });
  return box;
}

// 긴 이름 한 줄 말줄임
export function ellipsize(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// 아이템 코드 → 아이콘 텍스처 키(data/item-icons.json). 아이콘이 로드되지 않았으면 null이라 호출자가 도형으로 대체한다.
export function itemIconKey(scene: Phaser.Scene, itemCode: string): string | null {
  const key = (itemIcons as Record<string, string>)[itemCode];
  return key && scene.textures.exists(key) ? key : null;
}
