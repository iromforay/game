import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { inventory } from '../state/inventory';
import { fetchShop } from '../api/client';
import type { ShopProduct } from '../api/client';
import slotData from '../data/equip-slots.json';
import { PAL, TEXT, feltPanel, pillButton, creamOverlay, showToast, ellipsize, itemIconKey } from '../ui/kit';
import { loadWorldImages } from '../assets/loader';

// docs/save_a_turby_ui_spec.md 3절 좌표
const CARD_W = 370;
const CARD_H = 190;
const GAP = 20;
const COLS = 3;
const START_X = 65;
const START_Y = 104;

function statText(p: ShopProduct) {
  const parts: string[] = [];
  const label = { attack: '공격', defense: '방어', actionPower: '행동', maxHp: '체력' };
  const sign = p.productType === 'item' ? '+' : '';
  for (const key of ['attack', 'defense', 'actionPower', 'maxHp'] as const) {
    if (p.stats[key] !== 0) parts.push(`${label[key]} ${sign}${p.stats[key]}`);
  }
  return parts.join('  ');
}

// 4.1: 마을 장터 — 기본 NPC 상점(누비/보풀이 등 터비 + 장착 아이템). 가격·잔액·지급은 서버(shop_product)가 판정하고
// 이 화면은 서버가 내려준 상품 목록을 그대로 보여주기만 한다. 도형 UI(에셋 적용 전).
export class MarketScene extends Phaser.Scene {
  private pendingProductId: number | null = null;
  private products: ShopProduct[] = [];
  private cardsLayer?: Phaser.GameObjects.Container;
  private tareText?: Phaser.GameObjects.Text;
  private spinner?: Phaser.Tweens.Tween;
  private message?: string;

  constructor() {
    super('Market');
  }

  init(data: { message?: string }) {
    this.message = data?.message;
  }

  preload() {
    loadWorldImages(this);
    if (!this.textures.exists('bg-village')) this.load.image('bg-village', BACKGROUND_TILES.village);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.pendingProductId = null;
    this.products = [];
    this.cameras.main.setBackgroundColor('#F7E9D2');
    this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'bg-village').setOrigin(0, 0);
    creamOverlay(this, 0.78);

    feltPanel(this, CANVAS_WIDTH / 2 - 240, 4, 480, 76, { radius: 28 });
    this.add.text(CANVAS_WIDTH / 2, 42, '장터 — NPC 상점', { fontSize: '28px', color: TEXT.body }).setOrigin(0.5);
    feltPanel(this, 28, 22, 260, 72, { fill: PAL.sky, radius: 26 });
    this.tareText = this.add.text(158, 58, '', { fontSize: '22px', color: TEXT.body }).setOrigin(0.5);
    this.refreshTare();

    pillButton(this, CANVAS_WIDTH / 2, 670, 240, 64, '마을로 돌아가기', 'back', () => this.scene.start('Village'));
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Village'));

    if (this.message) showToast(this, this.message, { y: 606 });
    void this.loadProducts();
  }

  private refreshTare() {
    this.tareText?.setText(`타레 ${inventory.getTareBalance()}`);
  }

  private async loadProducts() {
    try {
      this.products = await fetchShop();
    } catch {
      this.renderError();
      return;
    }
    this.renderCards();
  }

  // 서버 실패: 중앙 오류 패널 + 다시 시도
  private renderError() {
    this.cardsLayer?.destroy();
    const cx = CANVAS_WIDTH / 2;
    const cy = 320;
    const objs = [
      feltPanel(this, cx - 260, cy - 110, 520, 220, { fill: PAL.cream, stroke: 0xe9b7c2 }),
      this.add.text(cx, cy - 40, '상품 목록을 불러오지 못했어요.\n서버 연결을 확인해 주세요.', { fontSize: '18px', color: TEXT.error, align: 'center', lineSpacing: 6 }).setOrigin(0.5),
      pillButton(this, cx, cy + 50, 160, 56, '다시 시도', 'primary', () => {
        this.cardsLayer?.destroy();
        void this.loadProducts();
      }),
    ];
    this.cardsLayer = this.add.container(0, 0, objs);
  }

  private renderCards() {
    this.cardsLayer?.destroy();
    this.spinner?.stop();
    const objs: Phaser.GameObjects.GameObject[] = [];

    if (this.products.length === 0) {
      objs.push(feltPanel(this, CANVAS_WIDTH / 2 - 200, 200, 400, 240, {}));
      objs.push(
        this.textures.exists('empty-basket')
          ? this.add.image(CANVAS_WIDTH / 2, 300, 'empty-basket').setDisplaySize(140, 140)
          : this.add.ellipse(CANVAS_WIDTH / 2, 300, 100, 70, PAL.cream2).setStrokeStyle(4, PAL.lavender),
      );
      objs.push(this.add.text(CANVAS_WIDTH / 2, 380, '지금은 판매 중인 상품이 없어요.', { fontSize: '18px', color: TEXT.sub }).setOrigin(0.5));
    }
    this.products.forEach((p, i) => {
      objs.push(this.renderCard(p, START_X + (i % COLS) * (CARD_W + GAP), START_Y + Math.floor(i / COLS) * (CARD_H + GAP)));
    });
    this.cardsLayer = this.add.container(0, 0, objs);
  }

  private renderCard(p: ShopProduct, x: number, y: number) {
    const s = this;
    const layer = s.add.container(0, 0);
    const pending = this.pendingProductId === p.id;
    const canAfford = inventory.getTareBalance() >= p.price;

    layer.add(feltPanel(s, x, y, CARD_W, CARD_H, { radius: 24, image: 'shop-card-frame' }));

    // 왼쪽 104x104 아이콘 영역
    const ix = x + 16;
    const iy = y + 16;
    layer.add(feltPanel(s, ix, iy, 104, 104, { fill: PAL.cream2, stroke: PAL.lavender, strokeW: 3, radius: 20 }));
    if (p.productType === 'turby' && s.textures.exists(`turby-${p.code}`)) {
      layer.add(s.add.image(ix + 52, iy + 52, `turby-${p.code}`).setDisplaySize(88, 88));
    } else if (itemIconKey(s, p.code)) {
      layer.add(s.add.image(ix + 52, iy + 52, itemIconKey(s, p.code)!).setDisplaySize(88, 88));
    } else {
      layer.add(s.add.circle(ix + 52, iy + 52, 30, PAL.lavender).setStrokeStyle(4, PAL.cream));
      const slotLabel = slotData.find((sl) => sl.key === p.equipSlot)?.label ?? '';
      layer.add(s.add.text(ix + 52, iy + 52, slotLabel.slice(0, 1), { fontSize: '22px', color: TEXT.body }).setOrigin(0.5));
    }

    // 오른쪽: 이름 → 종류 칩 → 설명(2줄) → 스탯 → 보유
    const tx = x + 132;
    layer.add(s.add.text(tx, y + 12, ellipsize(p.name, 10), { fontSize: '21px', color: TEXT.body }));
    const kindLabel = p.productType === 'turby' ? '터비' : slotData.find((sl) => sl.key === p.equipSlot)?.label ?? '아이템';
    layer.add(feltPanel(s, tx, y + 42, 96, 30, { fill: p.productType === 'turby' ? PAL.pink : PAL.sky, stroke: PAL.lavender, strokeW: 2, radius: 12, image: p.productType === 'turby' ? 'chip-turby' : 'chip-item' }));
    layer.add(s.add.text(tx + 48, y + 57, kindLabel, { fontSize: '13px', color: TEXT.body }).setOrigin(0.5));
    layer.add(s.add.text(tx, y + 74, p.description, { fontSize: '13px', color: TEXT.sub, wordWrap: { width: CARD_W - 148 }, maxLines: 2 }));
    layer.add(s.add.text(tx, y + 108, statText(p), { fontSize: '13px', color: TEXT.onMint }));
    if (p.productType === 'item') {
      const owned = inventory.getItems().find((it) => it.code === p.code);
      layer.add(s.add.text(x + 20, y + CARD_H - 34, `보유 ${owned?.quantity ?? 0}`, { fontSize: '14px', color: TEXT.sub }));
    }

    // 가격+구매 버튼(우하단)
    const bx = x + CARD_W - 16 - 66;
    const by = y + CARD_H - 14 - 22;
    if (pending) {
      const spin = s.textures.exists('loading-yarn') ? s.add.image(bx, by, 'loading-yarn').setDisplaySize(44, 44) : s.add.circle(bx, by, 14, PAL.pink).setStrokeStyle(4, PAL.lavender);
      layer.add(spin);
      this.spinner = s.tweens.add({ targets: spin, angle: 360, duration: 800, repeat: -1 });
    } else {
      const locked = this.pendingProductId !== null;
      const kind = canAfford && !locked ? 'primary' : 'disabled';
      layer.add(
        pillButton(
          s,
          bx,
          by,
          132,
          44,
          `${p.price} 타레`,
          kind,
          () => void this.onBuy(p, x + CARD_W / 2, y + CARD_H / 2),
          () => !canAfford && showToast(s, '타레가 부족합니다.', { y: 606, error: true }),
        ),
      );
    }
    return layer;
  }

  private async onBuy(p: ShopProduct, fx: number, fy: number) {
    if (this.pendingProductId !== null) return;
    this.pendingProductId = p.id;
    this.renderCards();
    const result = await inventory.purchase(p);
    this.pendingProductId = null;
    this.refreshTare();
    this.renderCards();
    if (result.ok) {
      this.cottonBurst(fx, fy);
      showToast(this, `${p.name} 구매 완료!`, { y: 606 });
    } else {
      showToast(this, result.code === 'INSUFFICIENT_TARE' ? '타레가 부족합니다.' : result.message, { y: 606, error: true });
    }
  }

  // 구매 완료: 연분홍 솜 파티클 0.5초
  private cottonBurst(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(4, 8), PAL.pink, 0.9).setDepth(500);
      const a = (Math.PI * 2 * i) / 10;
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * 70, y: y + Math.sin(a) * 50 - 20, alpha: 0, duration: 500, onComplete: () => dot.destroy() });
    }
  }
}
