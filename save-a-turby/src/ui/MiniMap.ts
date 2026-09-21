import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import type { Rect } from '../config/village';

// 미니맵/전체화면 지도가 그릴 지역 — 마을은 길·광장(paths)이 있고, 야생 맵은 경계(bounds)만 있다
export interface MapView {
  title: string;
  width: number;
  height: number;
  bounds: Rect;
  paths?: { lines: { x: number; y: number }[][]; plaza: { x: number; y: number; w: number; h: number } };
}

export interface MapMarker {
  id: string;
  type: 'home' | 'market' | 'exit' | 'target'; // target: 스토리 목적지(별 표시, 맥동)
  name: string;
  x: number;
  y: number;
  hint: string;
}

// 코덱스 시각 QA(2026-09-21): 파스텔 팔레트, 미니맵 지름 144
const PAL = { mint: 0xcdebdd, cream: 0xfff4df, lavender: 0xdcd3f4, ink: 0x695b67, panelInfo: 0xf3eefb, overlay: 0x4a3f4b };
const INK = '#695B67';
const MINI_DIAMETER = 144;
const MINI_MARGIN = 16;
const MINI_MAP_WIDTH = 120;
const MINI_MAP_HEIGHT = 100;
const FULL = { x: 60, y: 110, w: 800, h: 450 };
const INFO = { x: 890, y: 110, w: 330, h: 450 };
const DEPTH_HUD = 4000;
const DEPTH_MODAL = 5000;

function markerTexture(type: MapMarker['type']) {
  return type === 'target' ? 'marker-current' : `marker-${type}`;
}

// docs/save_a_turby_asset.md §7.7 — 우측 상단 지름 160 원형 미니맵 + 전체화면 지도(M/Esc/닫기 버튼).
// 마커는 색이 아니라 서로 다른 실루엣(marker-*)으로 구분하고, 위치·목적지는 게임 데이터로 그린다.
export class MiniMap {
  private scene: Phaser.Scene;
  private view: MapView;
  private markers: MapMarker[];
  private destinationId: string;
  private onToggle: (open: boolean) => void;

  private miniPlayer!: Phaser.GameObjects.Image;
  private fullPlayer!: Phaser.GameObjects.Image;
  private miniOrigin = { x: 0, y: 0 };
  private miniScale = 0;
  private fullScale = 0;
  private fullOrigin = { x: 0, y: 0 };
  private full!: Phaser.GameObjects.Container;
  private infoTitle!: Phaser.GameObjects.Text;
  private infoBody!: Phaser.GameObjects.Text;
  private open = false;
  private markerObjs = new Map<string, Phaser.GameObjects.GameObject[]>(); // 마커 id → 미니맵·전체 지도 표시 오브젝트(목적지 별을 즉시 켜고 끄는 데 쓴다)
  private peerViews = new Map<string, { mini: Phaser.GameObjects.Arc | Phaser.GameObjects.Image; full: Phaser.GameObjects.Arc | Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }>();

  constructor(scene: Phaser.Scene, view: MapView, markers: MapMarker[], destinationId: string, onToggle: (open: boolean) => void) {
    this.scene = scene;
    this.view = view;
    this.markers = markers;
    this.destinationId = destinationId;
    this.onToggle = onToggle;
    this.buildMini();
    this.buildFull();

    scene.input.keyboard?.on('keydown-M', () => this.toggle());
    scene.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  get isOpen() {
    return this.open;
  }

  toggle() {
    this.open ? this.close() : this.openMap();
  }

  openMap() {
    if (this.open) return;
    this.open = true;
    this.full.setVisible(true);
    this.onToggle(true);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.full.setVisible(false);
    this.onToggle(false);
  }

  update(x: number, y: number, angle: number) {
    const mx = this.miniOrigin.x + x * this.miniScale;
    const my = this.miniOrigin.y + y * this.miniScale;
    this.miniPlayer.setPosition(mx, my).setRotation(angle + Math.PI / 2);
    if (this.open) this.fullPlayer.setPosition(this.fullOrigin.x + x * this.fullScale, this.fullOrigin.y + y * this.fullScale).setRotation(angle + Math.PI / 2);
  }

  // 같은 방 플레이어 표시(미니맵 슬롯색 18px 원+흰 외곽선, 전체 지도 28px 원+슬롯 번호). 내 위치는 기존 방향 삼각형을 유지한다.
  setPeers(peers: { id: string; x: number; y: number; color: number; slot: number }[]) {
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      let v = this.peerViews.get(p.id);
      if (!v) {
        const useImage = this.scene.textures.exists('map-marker'); // Codex ui/coop/map-marker.png — 슬롯색으로 tint해 같은 이미지를 재사용
        const mini = (useImage ? this.scene.add.image(0, 0, 'map-marker').setDisplaySize(20, 20).setTint(p.color) : this.scene.add.circle(0, 0, 9, p.color).setStrokeStyle(2, 0xffffff)).setScrollFactor(0).setDepth(DEPTH_HUD + 3);
        const full = (useImage ? this.scene.add.image(0, 0, 'map-marker').setDisplaySize(32, 32).setTint(p.color) : this.scene.add.circle(0, 0, 14, p.color).setStrokeStyle(2, 0xffffff)).setScrollFactor(0);
        const text = this.scene.add.text(0, 0, String(p.slot), { fontSize: '16px', color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0);
        this.full.add([full, text]); // 전체 지도 컨테이너 안(닫혀 있으면 함께 숨김)
        v = { mini, full, text };
        this.peerViews.set(p.id, v);
      }
      v.mini.setPosition(this.miniOrigin.x + p.x * this.miniScale, this.miniOrigin.y + p.y * this.miniScale);
      const fx = this.fullOrigin.x + p.x * this.fullScale;
      const fy = this.fullOrigin.y + p.y * this.fullScale;
      v.full.setPosition(fx, fy);
      v.text.setPosition(fx, fy);
    }
    for (const [id, v] of this.peerViews) {
      if (seen.has(id)) continue;
      v.mini.destroy();
      v.full.destroy();
      v.text.destroy();
      this.peerViews.delete(id);
    }
  }

  private trackMarker(id: string, obj: Phaser.GameObjects.GameObject) {
    const list = this.markerObjs.get(id) ?? [];
    list.push(obj);
    this.markerObjs.set(id, list);
  }

  // 스토리 목적지 별처럼 게임 상태로 사라졌다 돌아오는 마커를 즉시 숨기거나 보인다
  setMarkerVisible(id: string, visible: boolean) {
    this.markerObjs.get(id)?.forEach((o) => (o as Phaser.GameObjects.Image).setVisible(visible));
  }

  private pulse(target: Phaser.GameObjects.Image) {
    this.scene.tweens.add({ targets: target, scale: target.scale * 1.25, alpha: 0.6, duration: 700, yoyo: true, repeat: -1 });
  }

  private buildMini() {
    const s = this.scene;
    const cx = CANVAS_WIDTH - MINI_MARGIN - MINI_DIAMETER / 2;
    const cy = MINI_MARGIN + MINI_DIAMETER / 2;
    this.miniScale = Math.min(MINI_MAP_WIDTH / this.view.width, MINI_MAP_HEIGHT / this.view.height);
    this.miniOrigin = { x: cx - (this.view.width * this.miniScale) / 2, y: cy - (this.view.height * this.miniScale) / 2 };
    const k = this.miniScale;
    const o = this.miniOrigin;

    const g = s.add.graphics().setScrollFactor(0).setDepth(DEPTH_HUD);
    g.fillStyle(PAL.cream, 0.6).fillCircle(cx, cy, MINI_DIAMETER / 2 - 4);
    this.drawTerrain(g, o.x, o.y, k);

    s.add.image(cx, cy, 'minimap-frame').setDisplaySize(MINI_DIAMETER, MINI_DIAMETER).setScrollFactor(0).setDepth(DEPTH_HUD + 1);

    for (const m of this.markers) {
      const px = o.x + m.x * k;
      const py = o.y + m.y * k;
      const icon = s.add.image(px, py, markerTexture(m.type)).setDisplaySize(m.type === 'target' ? 26 : 20, m.type === 'target' ? 26 : 20).setScrollFactor(0).setDepth(DEPTH_HUD + 2);
      this.trackMarker(m.id, icon);
      if (m.type === 'target') this.pulse(icon);
      else if (m.id === this.destinationId) {
        const ring = s.add.image(px, py, 'marker-current').setDisplaySize(30, 30).setScrollFactor(0).setDepth(DEPTH_HUD + 3);
        this.pulse(ring);
      }
    }
    this.miniPlayer = s.add.image(0, 0, 'marker-player').setDisplaySize(16, 16).setScrollFactor(0).setDepth(DEPTH_HUD + 4);

    s.add.zone(cx, cy, MINI_DIAMETER, MINI_DIAMETER).setScrollFactor(0).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.openMap());
    s.add
      .image(cx + 54, cy + 54, 'map-open')
      .setDisplaySize(38, 38)
      .setScrollFactor(0)
      .setDepth(DEPTH_HUD + 5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.openMap());
  }

  private buildFull() {
    const s = this.scene;
    this.fullScale = Math.min(FULL.w / this.view.width, FULL.h / this.view.height);
    const k = this.fullScale;
    this.fullOrigin = { x: FULL.x + (FULL.w - this.view.width * k) / 2, y: FULL.y + (FULL.h - this.view.height * k) / 2 };
    const fo = this.fullOrigin;
    const items: Phaser.GameObjects.GameObject[] = [];

    const dim = s.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.overlay, 0.68).setOrigin(0, 0).setInteractive();
    items.push(dim);

    const g = s.add.graphics();
    g.fillStyle(PAL.cream, 1).lineStyle(7, PAL.lavender, 1).fillRoundedRect(FULL.x - 14, FULL.y - 14, FULL.w + 28, FULL.h + 28, 18).strokeRoundedRect(FULL.x - 14, FULL.y - 14, FULL.w + 28, FULL.h + 28, 18);
    g.fillStyle(PAL.mint, 1).fillRect(FULL.x, FULL.y, FULL.w, FULL.h);
    this.drawTerrain(g, fo.x, fo.y, k);
    g.fillStyle(PAL.panelInfo, 1).lineStyle(7, PAL.lavender, 1).fillRoundedRect(INFO.x, INFO.y - 14, INFO.w, INFO.h + 28, 18).strokeRoundedRect(INFO.x, INFO.y - 14, INFO.w, INFO.h + 28, 18);
    items.push(g);

    items.push(s.add.text(FULL.x + 14, FULL.y + 10, `${this.view.title} 지도`, { fontSize: '22px', color: INK }));

    this.infoTitle = s.add.text(INFO.x + 20, INFO.y + 16, '', { fontSize: '22px', color: INK, wordWrap: { width: INFO.w - 100 } });
    this.infoBody = s.add.text(INFO.x + 20, INFO.y + 60, '', { fontSize: '16px', color: INK, lineSpacing: 6, wordWrap: { width: INFO.w - 40 } });
    items.push(this.infoTitle, this.infoBody);
    items.push(
      s.add.text(INFO.x + 20, INFO.y + INFO.h - 40, 'M 또는 Esc로 닫기', { fontSize: '13px', color: '#9a8d98' }),
    );

    for (const m of this.markers) {
      const px = fo.x + m.x * k;
      const py = fo.y + m.y * k;
      const icon = s.add.image(px, py, markerTexture(m.type)).setDisplaySize(m.type === 'target' ? 48 : 44, m.type === 'target' ? 48 : 44).setInteractive({ useHandCursor: true });
      if (m.type === 'target') this.pulse(icon);
      icon.on('pointerdown', () => this.select(m.id));
      this.trackMarker(m.id, icon);
      items.push(icon, s.add.text(px, py + 30, m.name, { fontSize: '14px', color: INK, backgroundColor: '#FFF4DFE6', padding: { x: 5, y: 2 } }).setOrigin(0.5, 0));
      if (m.type !== 'target' && m.id === this.destinationId) {
        const ring = s.add.image(px, py, 'marker-current').setDisplaySize(70, 70);
        this.pulse(ring);
        items.push(ring);
      }
    }
    this.fullPlayer = s.add.image(0, 0, 'marker-player').setDisplaySize(34, 34);
    items.push(this.fullPlayer);

    const close = s.add.image(INFO.x + INFO.w - 34, INFO.y + 34, 'map-close').setDisplaySize(48, 48).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.close());
    items.push(close);

    this.full = s.add.container(0, 0, items).setScrollFactor(0).setDepth(DEPTH_MODAL).setVisible(false);
    for (const it of items) (it as Phaser.GameObjects.Image).setScrollFactor?.(0);
    this.select(this.destinationId || this.markers[0]?.id || '');
  }

  private drawTerrain(g: Phaser.GameObjects.Graphics, ox: number, oy: number, k: number) {
    const b = this.view.bounds;
    g.fillStyle(PAL.mint, 1).fillRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k);
    g.lineStyle(Math.max(1.5, 3 * k * 4), PAL.lavender, 1).strokeRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k);
    const paths = this.view.paths;
    if (!paths) return;
    g.lineStyle(70 * k, PAL.cream, 1);
    for (const [p0, p1, p2] of paths.lines) g.beginPath().moveTo(ox + p0.x * k, oy + p0.y * k).lineTo(ox + p1.x * k, oy + p1.y * k).lineTo(ox + p2.x * k, oy + p2.y * k).strokePath();
    g.fillStyle(PAL.cream, 1).fillEllipse(ox + paths.plaza.x * k, oy + paths.plaza.y * k, paths.plaza.w * k, paths.plaza.h * k);
  }

  private select(id: string) {
    const m = this.markers.find((x) => x.id === id);
    if (!m) return;
    const isDest = id === this.destinationId || m.type === 'target';
    this.infoTitle.setText(m.name);
    this.infoBody.setText(`${isDest ? '★ 현재 목적지\n\n' : ''}${m.hint}`);
  }
}
