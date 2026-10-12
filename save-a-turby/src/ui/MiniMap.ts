import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import type { Rect } from '../config/village';
import { displayScaleOf } from './responsive';
import { miniMapLayout, type MiniMapLayout } from './screenLayouts';
import { LEGEND_LABEL, legendEntries, type MarkerType } from './screenStates';
import { markerTextureKey } from '../assets/mapMarkerSpecs';

// 미니맵/전체화면 지도가 그릴 지역 — 마을은 길·광장(paths)이 있고, 야생 맵은 경계(bounds)만 있다
export interface MapView {
  title: string;
  width: number;
  height: number;
  bounds: Rect;
  paths?: { lines: { x: number; y: number }[][]; plaza: { x: number; y: number; w: number; h: number } };
  // 회색상자(임시) 지형: 공개된 구역·길·막힌 곳·문. 최종 지도 에셋이 연결되면 넘기지 않는다
  greybox?: { zones: TerrainRect[]; paths: number[][][]; blockers: TerrainRect[]; gates: (TerrainRect & { open: boolean })[] };
  // 최종 지도: 대형 배경 그림을 축소해 지도로 쓴다(임시 도형 대신). covers = 아직 열리지 않아 가려진 구역의 수풀 오버레이(서버가 내려 준 오버레이와 같은 상태)
  art?: { assetKey: string; covers: (TerrainRect & { assetKey: string })[] };
}
interface TerrainRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapMarker {
  id: string;
  type: MarkerType; // target: 스토리 목적지(별 표시, 맥동)
  name: string;
  x: number;
  y: number;
  hint: string;
}

// 코덱스 시각 QA(2026-09-21): 파스텔 팔레트
const PAL = { mint: 0xcdebdd, cream: 0xfff4df, lavender: 0xdcd3f4, ink: 0x695b67, panelInfo: 0xf3eefb, overlay: 0x4a3f4b };
const INK = '#695B67';
// 회색상자(임시) 지형 색 — 범례와 지도가 같은 값을 쓴다
const TERRAIN = { zone: 0xfff4df, path: 0xb7a98f, wall: 0x4a4f4a, gate: 0x8a6fc0, gateLine: 0x5a3a8a };
const DEPTH_HUD = 4000;
const DEPTH_MODAL = 5000;

const markerTexture = markerTextureKey;

// docs/save_a_turby_asset.md §7.7 — 우측 상단 원형 미니맵 + 전체화면 지도(M/Esc/닫기 버튼).
// 마커는 색이 아니라 서로 다른 실루엣(marker-*)으로 구분하고, 위치·목적지는 게임 데이터로 그린다.
// 크기·글자는 miniMapLayout(표시 배율별). 창 크기가 바뀌면 relayout()으로 다시 그린다(열림 상태·고른 마커 유지).
export class MiniMap {
  private scene: Phaser.Scene;
  private view: MapView;
  private markers: MapMarker[];
  private destinationId: string;
  private onToggle: (open: boolean) => void;
  private L!: MiniMapLayout;

  private miniObjs: Phaser.GameObjects.GameObject[] = [];
  private miniPlayer!: Phaser.GameObjects.Image;
  private fullPlayer!: Phaser.GameObjects.Image;
  private miniOrigin = { x: 0, y: 0 };
  private miniScale = 0;
  private fullScale = 0;
  private fullOrigin = { x: 0, y: 0 };
  private full!: Phaser.GameObjects.Container;
  private infoLayer: Phaser.GameObjects.GameObject[] = [];
  private open = false;
  private legendOpen = false;
  private selectedId = '';
  private hidden = new Set<string>();
  private markerObjs = new Map<string, Phaser.GameObjects.GameObject[]>(); // 마커 id → 미니맵·전체 지도 표시 오브젝트(목적지 별을 즉시 켜고 끄는 데 쓴다)
  private peerViews = new Map<string, { mini: Phaser.GameObjects.Arc | Phaser.GameObjects.Image; full: Phaser.GameObjects.Arc | Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }>();
  private lastPeers: { id: string; x: number; y: number; color: number; slot: number }[] = [];
  private lastPos = { x: 0, y: 0, angle: 0 };

  constructor(scene: Phaser.Scene, view: MapView, markers: MapMarker[], destinationId: string, onToggle: (open: boolean) => void) {
    this.scene = scene;
    this.view = view;
    this.markers = markers;
    this.destinationId = destinationId;
    this.onToggle = onToggle;
    this.selectedId = destinationId || markers[0]?.id || '';
    this.build();

    // 키 입력은 한 번만 등록한다(relayout으로 다시 그려도 늘지 않음). 씬이 끝나면 Phaser가 지운다
    scene.input.keyboard?.on('keydown-M', () => this.toggle());
    scene.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  get isOpen() {
    return this.open;
  }
  // 미니맵이 차지하는 영역(HUD 배치용)
  get rect() {
    return this.L.mini.rect;
  }
  // 진단용 요약(화면 상태만)
  get debugState() {
    const gb = this.view.greybox;
    return { art: this.view.art ? { assetKey: this.view.art.assetKey, covers: this.view.art.covers.length } : null, terrain: gb ? { zones: gb.zones.length, paths: gb.paths.length, blockers: gb.blockers.length, gatesClosed: gb.gates.filter((x) => !x.open).length, gatesOpen: gb.gates.filter((x) => x.open).length } : null, legend: this.legendKeys(), wilds: this.markers.filter((m) => m.type === 'wild').map((m) => ({ id: m.id, x: m.x, y: m.y, mini: { x: this.miniOrigin.x + m.x * this.miniScale, y: this.miniOrigin.y + m.y * this.miniScale }, full: { x: this.fullOrigin.x + m.x * this.fullScale, y: this.fullOrigin.y + m.y * this.fullScale } })), scale: { mini: this.miniScale, full: this.fullScale }, open: this.open, legendOpen: this.legendOpen, mode: this.L.mode, selected: this.selectedId, diameter: this.L.mini.diameter, close: this.L.full.close, legendToggle: this.L.full.legendToggle, openButton: this.L.mini.open, labelsOnMap: this.L.full.labelsOnMap };
  }

  toggle() {
    this.open ? this.close() : this.openMap();
  }

  openMap() {
    if (this.open) return;
    this.open = true;
    this.full.setVisible(true);
    this.syncPlayer();
    this.onToggle(true);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.full.setVisible(false);
    this.onToggle(false);
  }

  // 표시 배율이 바뀌면 미니맵·전체 지도를 새 크기로 다시 그린다. 열림 상태·범례·고른 마커·동료 표시·숨긴 마커는 그대로
  relayout() {
    this.miniObjs.forEach((o) => o.destroy());
    this.miniObjs = [];
    this.full.destroy();
    this.infoLayer = [];
    this.markerObjs.clear();
    for (const v of this.peerViews.values()) v.mini.destroy(); // full·text는 full 컨테이너와 함께 파괴됨
    this.peerViews.clear();
    this.build();
    this.full.setVisible(this.open);
    for (const id of this.hidden) this.setMarkerVisible(id, false);
    this.setPeers(this.lastPeers);
    this.syncPlayer();
  }

  // 게임 진행으로 지도에 놓이는 것이 바뀌면(이야기 지점이 열리고 닫힘, 오브젝트 수집, 문 개방, 구역 공개) 지형과 마커를 바꿔 다시 그린다
  setScene(view: MapView, markers: MapMarker[]) {
    this.view = view;
    this.markers = markers;
    if (!markers.some((m) => m.id === this.selectedId)) this.selectedId = this.destinationId || markers[0]?.id || '';
    this.hidden.clear();
    this.relayout();
  }

  private build() {
    this.L = miniMapLayout(displayScaleOf(this.scene.scale.displaySize.width));
    this.buildMini();
    this.buildFull();
  }

  update(x: number, y: number, angle: number) {
    this.lastPos = { x, y, angle };
    this.syncPlayer();
  }

  private syncPlayer() {
    const { x, y, angle } = this.lastPos;
    this.miniPlayer.setPosition(this.miniOrigin.x + x * this.miniScale, this.miniOrigin.y + y * this.miniScale).setRotation(angle + Math.PI / 2);
    if (this.open) this.fullPlayer.setPosition(this.fullOrigin.x + x * this.fullScale, this.fullOrigin.y + y * this.fullScale).setRotation(angle + Math.PI / 2);
  }

  // 같은 방 플레이어 표시(슬롯색 원 + 전체 지도에는 슬롯 번호 — 색만으로 구분하지 않는다). 내 위치는 방향 화살표를 유지한다.
  setPeers(peers: { id: string; x: number; y: number; color: number; slot: number }[]) {
    const hadPeers = this.lastPeers.length > 0;
    this.lastPeers = peers;
    const M = this.L.mini;
    const F = this.L.full;
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      let v = this.peerViews.get(p.id);
      if (!v) {
        const useImage = this.scene.textures.exists('map-marker'); // Codex ui/coop/map-marker.png — 슬롯색으로 tint해 같은 이미지를 재사용
        const mini = (useImage ? this.scene.add.image(0, 0, 'map-marker').setDisplaySize(M.marker, M.marker).setTint(p.color) : this.scene.add.circle(0, 0, M.marker / 2 - 1, p.color).setStrokeStyle(2, 0xffffff)).setScrollFactor(0).setDepth(DEPTH_HUD + 3);
        const full = (useImage ? this.scene.add.image(0, 0, 'map-marker').setDisplaySize(F.peer, F.peer).setTint(p.color) : this.scene.add.circle(0, 0, F.peer / 2 - 2, p.color).setStrokeStyle(2, 0xffffff)).setScrollFactor(0);
        const text = this.scene.add.text(0, 0, String(p.slot), { fontSize: `${F.font.label}px`, color: '#ffffff' }).setOrigin(0.5).setScrollFactor(0);
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
    if (hadPeers !== peers.length > 0) this.renderInfo(); // 범례의 "함께 온 친구" 줄이 생기거나 사라진다
  }

  private trackMarker(id: string, obj: Phaser.GameObjects.GameObject) {
    const list = this.markerObjs.get(id) ?? [];
    list.push(obj);
    this.markerObjs.set(id, list);
  }

  // 스토리 목적지 별처럼 게임 상태로 사라졌다 돌아오는 마커를 즉시 숨기거나 보인다
  setMarkerVisible(id: string, visible: boolean) {
    if (visible) this.hidden.delete(id);
    else this.hidden.add(id);
    this.markerObjs.get(id)?.forEach((o) => (o as Phaser.GameObjects.Image).setVisible(visible));
  }

  private pulse(target: Phaser.GameObjects.Image) {
    this.scene.tweens.add({ targets: target, scale: target.scale * 1.25, alpha: 0.6, duration: 700, yoyo: true, repeat: -1 });
  }

  private buildMini() {
    const s = this.scene;
    const M = this.L.mini;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.miniObjs.push(o);
      return o;
    };
    const { cx, cy, diameter } = M;
    const mapW = diameter * (120 / 144);
    const mapH = diameter * (100 / 144);
    this.miniScale = Math.min(mapW / this.view.width, mapH / this.view.height);
    this.miniOrigin = { x: cx - (this.view.width * this.miniScale) / 2, y: cy - (this.view.height * this.miniScale) / 2 };
    const k = this.miniScale;
    const o = this.miniOrigin;

    const g = keep(s.add.graphics().setScrollFactor(0).setDepth(DEPTH_HUD));
    g.fillStyle(PAL.cream, 0.6).fillCircle(cx, cy, diameter / 2 - 4);
    this.drawTerrain(g, o.x, o.y, k);
    this.addArt(keep, o.x, o.y, k, DEPTH_HUD + 0.1);

    keep(s.add.image(cx, cy, 'minimap-frame').setDisplaySize(diameter, diameter).setScrollFactor(0).setDepth(DEPTH_HUD + 1));

    for (const m of this.markers) {
      const px = o.x + m.x * k;
      const py = o.y + m.y * k;
      const size = m.type === 'target' ? M.target : M.marker;
      const icon = keep(s.add.image(px, py, markerTexture(m.type)).setDisplaySize(size, size).setScrollFactor(0).setDepth(DEPTH_HUD + 2));
      this.trackMarker(m.id, icon);
      if (m.type === 'target') this.pulse(icon);
      else if (m.id === this.destinationId) {
        const ring = keep(s.add.image(px, py, 'marker-current').setDisplaySize(size * 1.5, size * 1.5).setScrollFactor(0).setDepth(DEPTH_HUD + 3));
        this.pulse(ring);
      }
    }
    this.miniPlayer = keep(s.add.image(0, 0, 'marker-player').setDisplaySize(M.player, M.player).setScrollFactor(0).setDepth(DEPTH_HUD + 4));

    // 미니맵 전체와 확대 아이콘 모두 전체 지도를 연다
    keep(s.add.zone(cx, cy, diameter, diameter).setScrollFactor(0).setDepth(DEPTH_HUD + 1).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.openMap()));
    keep(
      s.add
        .image(M.open.x, M.open.y, 'map-open')
        .setDisplaySize(M.open.size, M.open.size)
        .setScrollFactor(0)
        .setDepth(DEPTH_HUD + 5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.openMap()),
    );
  }

  private buildFull() {
    const s = this.scene;
    const F = this.L.full;
    const FULL = F.map;
    const INFO = F.info;
    this.fullScale = Math.min(FULL.w / this.view.width, FULL.h / this.view.height);
    const k = this.fullScale;
    this.fullOrigin = { x: FULL.x + (FULL.w - this.view.width * k) / 2, y: FULL.y + (FULL.h - this.view.height * k) / 2 };
    const fo = this.fullOrigin;
    const items: Phaser.GameObjects.GameObject[] = [];

    // 뒤 화면 입력을 막는다(지도가 열려 있는 동안 이동·HUD 입력이 새지 않게)
    const dim = s.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, PAL.overlay, 0.68).setOrigin(0, 0).setInteractive();
    items.push(dim);

    const g = s.add.graphics();
    g.fillStyle(PAL.cream, 1).lineStyle(7, PAL.lavender, 1).fillRoundedRect(FULL.x - 14, FULL.y - 14, FULL.w + 28, FULL.h + 28, 18).strokeRoundedRect(FULL.x - 14, FULL.y - 14, FULL.w + 28, FULL.h + 28, 18);
    g.fillStyle(PAL.mint, 1).fillRect(FULL.x, FULL.y, FULL.w, FULL.h);
    this.drawTerrain(g, fo.x, fo.y, k);
    g.fillStyle(PAL.panelInfo, 1).lineStyle(7, PAL.lavender, 1).fillRoundedRect(INFO.x, INFO.y - 14, INFO.w, INFO.h + 28, 18).strokeRoundedRect(INFO.x, INFO.y - 14, INFO.w, INFO.h + 28, 18);
    items.push(g);
    this.addArt((o) => (items.push(o), o), fo.x, fo.y, k, null);

    items.push(s.add.text(FULL.x + 14, FULL.y + 10, `${this.view.title} 지도`, { fontSize: `${F.font.title}px`, color: INK, backgroundColor: '#FFF4DFCC', padding: { x: 6, y: 2 } }));

    for (const m of this.markers) {
      const px = fo.x + m.x * k;
      const py = fo.y + m.y * k;
      const size = m.type === 'target' ? F.target : F.marker;
      const icon = s.add.image(px, py, markerTexture(m.type)).setDisplaySize(size, size).setInteractive({ useHandCursor: true });
      if (m.type === 'target') this.pulse(icon);
      icon.on('pointerdown', () => this.select(m.id));
      this.trackMarker(m.id, icon);
      items.push(icon);
      // 이름표: 보통 화면은 마커 아래에, 작은 화면은 서로 겹치므로 지도에서 빼고 오른쪽 정보·범례 영역에서 보여 준다
      if (F.labelsOnMap) items.push(s.add.text(px, py + size / 2 + 8, m.name, { fontSize: `${F.font.label}px`, color: INK, backgroundColor: '#FFF4DFE6', padding: { x: 5, y: 2 } }).setOrigin(0.5, 0));
      if (m.type !== 'target' && m.id === this.destinationId) {
        const ring = s.add.image(px, py, 'marker-current').setDisplaySize(size * 1.6, size * 1.6);
        this.pulse(ring);
        items.push(ring);
      }
    }
    this.fullPlayer = s.add.image(0, 0, 'marker-player').setDisplaySize(F.player, F.player);
    items.push(this.fullPlayer);

    const C = F.close;
    const close = s.add.image(C.x + C.w / 2, C.y + C.h / 2, 'map-close').setDisplaySize(C.w, C.h).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.close());
    items.push(close);

    this.full = s.add.container(0, 0, items).setScrollFactor(0).setDepth(DEPTH_MODAL).setVisible(false);
    for (const it of items) (it as Phaser.GameObjects.Image).setScrollFactor?.(0);
    this.renderInfo();
  }

  // 오른쪽 정보 영역: 고른 마커의 이름·안내 + 범례. 작은 화면은 범례를 버튼으로 접고 펼친다(펼치면 안내 대신 범례)
  private renderInfo() {
    if (!this.full) return;
    this.infoLayer.forEach((o) => o.destroy());
    this.infoLayer = [];
    const s = this.scene;
    const F = this.L.full;
    const INFO = F.info;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      (o as unknown as Phaser.GameObjects.Image).setScrollFactor?.(0);
      this.infoLayer.push(o);
      this.full.add(o);
      return o;
    };
    const innerW = INFO.w - 40;
    const m = this.markers.find((x) => x.id === this.selectedId);
    const showLegend = F.legendAlways || this.legendOpen;
    const entries = this.legendKeys();
    const legendH = entries.length * F.legendRow + F.font.label * 1.6;
    const bottom = F.legendToggle ? F.legendToggle.y - 10 : INFO.y + INFO.h - 10;

    if (!this.legendOpen || F.legendAlways) {
      const title = add(s.add.text(INFO.x + 20, INFO.y + 16, m?.name ?? `${this.view.title}`, { fontSize: `${F.font.infoTitle}px`, color: INK, wordWrap: { width: innerW - F.close.w, useAdvancedWrap: true } }));
      const isDest = !!m && (m.id === this.destinationId || m.type === 'target');
      const bodyY = Math.max(title.y + title.height + 12, F.close.y + F.close.h + 8);
      add(s.add.text(INFO.x + 20, bodyY, m ? `${isDest ? '★ 현재 목적지\n\n' : ''}${m.hint}` : '지도의 표시를 누르면 설명이 나와요.', { fontSize: `${F.font.body}px`, color: INK, lineSpacing: 6, wordWrap: { width: innerW, useAdvancedWrap: true } }));
    }
    if (showLegend) {
      const y0 = F.legendAlways ? bottom - legendH - F.font.hint * 1.8 : Math.max(INFO.y + 16, F.close.y + F.close.h + 12);
      add(s.add.text(INFO.x + 20, y0, '범례', { fontSize: `${F.font.label}px`, color: '#ffffff', backgroundColor: '#8a7aa8', padding: { x: 8, y: 2 } }));
      entries.forEach((key, i) => {
        const y = y0 + F.font.label * 1.6 + i * F.legendRow + F.legendRow / 2;
        const size = Math.round(F.legendRow * 0.8);
        const cxk = INFO.x + 20 + size / 2;
        if (key === 'peer') {
          add(s.add.circle(cxk, y, size / 2 - 2, 0x9aa9d8).setStrokeStyle(2, 0xffffff));
          add(s.add.text(cxk, y, '1', { fontSize: `${Math.round(F.font.label * 0.8)}px`, color: '#ffffff' }).setOrigin(0.5));
        } else if (key === 'path') {
          add(s.add.rectangle(cxk, y, size, Math.max(4, size * 0.22), TERRAIN.path));
        } else if (key === 'wall') {
          add(s.add.rectangle(cxk, y, size, size * 0.6, TERRAIN.wall));
        } else if (key === 'gateClosed') {
          add(s.add.rectangle(cxk, y, size * 0.5, size, TERRAIN.gate).setStrokeStyle(2, TERRAIN.gateLine));
        } else if (key === 'gateOpen') {
          add(s.add.rectangle(cxk, y, size * 0.5, size).setStrokeStyle(3, TERRAIN.gateLine).setFillStyle(0xffffff, 0));
        } else {
          add(s.add.image(INFO.x + 20 + size / 2, y, key === 'player' ? 'marker-player' : markerTexture(key)).setDisplaySize(size, size));
        }
        add(s.add.text(INFO.x + 20 + size + 12, y, LEGEND_LABEL[key], { fontSize: `${F.font.label}px`, color: INK, wordWrap: { width: innerW - size - 12, useAdvancedWrap: true } }).setOrigin(0, 0.5));
      });
    }
    if (F.legendAlways) add(s.add.text(INFO.x + 20, bottom - F.font.hint * 1.3, 'M 또는 Esc로 닫기', { fontSize: `${F.font.hint}px`, color: '#9a8d98' }));
    const T = F.legendToggle;
    if (T) {
      const box = add(s.add.rectangle(T.x, T.y, T.w, T.h, 0xdcd3f4).setOrigin(0, 0).setStrokeStyle(3, 0xb9a9e0));
      add(s.add.text(T.x + T.w / 2, T.y + T.h / 2, this.legendOpen ? '범례 접기 ▴' : '범례 보기 ▾', { fontSize: `${F.font.body}px`, color: INK }).setOrigin(0.5));
      box.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.legendOpen = !this.legendOpen;
        this.renderInfo();
      });
    }
  }

  private legendKeys() {
    const gb = this.view.greybox;
    return legendEntries(this.markers.map((x) => x.type), this.lastPeers.length > 0, gb ? { path: gb.paths.length > 0, wall: gb.blockers.length > 0, gateClosed: gb.gates.some((x) => !x.open), gateOpen: gb.gates.some((x) => x.open) } : undefined);
  }

  // 최종 지도 그림과 가려진 구역(수풀 오버레이) — 그림 텍스처가 로드돼 있을 때만. 없으면 아무것도 그리지 않아 기본 지형(회색상자)만 남는다
  private addArt(keep: <T extends Phaser.GameObjects.GameObject>(o: T) => T, ox: number, oy: number, k: number, depth: number | null) {
    const art = this.view.art;
    if (!art || !this.scene.textures.exists(art.assetKey)) return;
    const img = keep(this.scene.add.image(ox, oy, art.assetKey).setOrigin(0, 0).setDisplaySize(this.view.width * k, this.view.height * k).setScrollFactor(0));
    if (depth !== null) img.setDepth(depth);
    for (const r of art.covers) {
      if (!this.scene.textures.exists(r.assetKey)) continue;
      const cover = keep(this.scene.add.image(ox + r.x * k, oy + r.y * k, r.assetKey).setOrigin(0, 0).setDisplaySize(r.width * k, r.height * k).setScrollFactor(0));
      if (depth !== null) cover.setDepth(depth + 0.1);
    }
  }

  private drawTerrain(g: Phaser.GameObjects.Graphics, ox: number, oy: number, k: number) {
    const b = this.view.bounds;
    g.fillStyle(PAL.mint, 1).fillRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k);
    g.lineStyle(Math.max(1.5, 3 * k * 4), PAL.lavender, 1).strokeRect(ox + b.x * k, oy + b.y * k, b.w * k, b.h * k);
    const gb = this.view.greybox;
    if (gb) {
      // 회색상자(임시): 공개된 구역 → 길 → 막힌 곳 → 문(닫힘은 채운 사각형, 열림은 테두리만) 순서로 그린다
      for (const z of gb.zones) g.fillStyle(TERRAIN.zone, 0.55).fillRect(ox + z.x * k, oy + z.y * k, z.width * k, z.height * k);
      g.lineStyle(Math.max(2, 26 * k), TERRAIN.path, 1);
      for (const path of gb.paths) {
        g.beginPath().moveTo(ox + path[0][0] * k, oy + path[0][1] * k);
        for (const [x, y] of path.slice(1)) g.lineTo(ox + x * k, oy + y * k);
        g.strokePath();
      }
      for (const w of gb.blockers) g.fillStyle(TERRAIN.wall, 1).fillRect(ox + w.x * k, oy + w.y * k, Math.max(2, w.width * k), Math.max(2, w.height * k));
      for (const gate of gb.gates) {
        const r = [ox + gate.x * k, oy + gate.y * k, Math.max(3, gate.width * k), Math.max(3, gate.height * k)] as const;
        if (gate.open) g.lineStyle(2, TERRAIN.gateLine, 1).strokeRect(...r);
        else g.fillStyle(TERRAIN.gate, 1).fillRect(...r).lineStyle(1.5, TERRAIN.gateLine, 1).strokeRect(...r);
      }
    }
    const paths = this.view.paths;
    if (!paths) return;
    g.lineStyle(70 * k, PAL.cream, 1);
    for (const [p0, p1, p2] of paths.lines) g.beginPath().moveTo(ox + p0.x * k, oy + p0.y * k).lineTo(ox + p1.x * k, oy + p1.y * k).lineTo(ox + p2.x * k, oy + p2.y * k).strokePath();
    g.fillStyle(PAL.cream, 1).fillEllipse(ox + paths.plaza.x * k, oy + paths.plaza.y * k, paths.plaza.w * k, paths.plaza.h * k);
  }

  private select(id: string) {
    if (!this.markers.some((x) => x.id === id)) return;
    this.selectedId = id;
    this.legendOpen = false; // 마커를 고르면 그 설명을 보여 준다
    this.renderInfo();
  }
}
