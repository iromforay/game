import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { inventory } from '../state/inventory';
import { fetchShop } from '../api/client';
import type { ShopProduct } from '../api/client';
import slotData from '../data/equip-slots.json';
import { PAL, TEXT, feltPanel, pillButton, creamOverlay, showToast, ellipsize, itemIconKey } from '../ui/kit';
import { loadWorldImages } from '../assets/loader';
import { displayScaleOf } from '../ui/responsive';
import { watchLayout } from '../ui/relayout';
import { clampPage, marketLayout, pageOf, type MarketLayout } from '../ui/screenLayouts';

// short: 폭이 모자랄 때의 짧은 표기(공30 방6 …) — 카드 밖으로 넘치지 않게
function statText(p: ShopProduct, short = false) {
  const parts: string[] = [];
  const label = short ? { attack: '공', defense: '방', actionPower: '행', maxHp: '체' } : { attack: '공격', defense: '방어', actionPower: '행동', maxHp: '체력' };
  const sign = p.productType === 'item' ? '+' : '';
  for (const key of ['attack', 'defense', 'actionPower', 'maxHp'] as const) {
    if (p.stats[key] !== 0) parts.push(short ? `${label[key]}${sign}${p.stats[key]}` : `${label[key]} ${sign}${p.stats[key]}`);
  }
  return parts.join(short ? ' ' : '  ');
}

// 구매 버튼 상태(색만으로 구분하지 않는다 — 글자로도 알린다). 순수 판정: 테스트 대상
export type BuyState = 'buying' | 'locked' | 'short' | 'ready';
export function buyStateOf(productId: number, price: number, balance: number, pendingId: number | null): BuyState {
  if (pendingId === productId) return 'buying';
  if (pendingId !== null) return 'locked'; // 다른 상품을 구매하는 중 — 끝날 때까지 누를 수 없다
  return balance >= price ? 'ready' : 'short';
}
export const BUY_NOTE: Record<BuyState, string | null> = { buying: '구매 중…', locked: null, short: '부족', ready: null };
// 버튼 글자: 가격은 늘 보이고, 잔액이 모자라면 "… · 부족"을 붙인다
export const buyLabel = (price: number, state: BuyState) => (state === 'short' ? `${price} 타레 · ${BUY_NOTE.short}` : `${price} 타레`);

// 4.1: 마을 장터 — 기본 NPC 상점(누비/보풀이 등 터비 + 장착 아이템). 가격·잔액·지급은 서버(shop_product)가 판정하고
// 이 화면은 서버가 내려준 상품 목록을 그대로 보여주기만 한다. 좌표·글자는 marketLayout(표시 배율별), 넘치면 페이지.
export class MarketScene extends Phaser.Scene {
  private pendingProductId: number | null = null;
  private products: ShopProduct[] = [];
  private cardsLayer?: Phaser.GameObjects.Container;
  private tareText?: Phaser.GameObjects.Text;
  private pageLabel?: Phaser.GameObjects.Text;
  private spinner?: Phaser.Tweens.Tween;
  private message?: string;
  private page = 0;
  private L!: MarketLayout;
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 이전 화면의 늦은 응답이 새 화면을 건드리지 않게
  private relayoutPending = false;

  constructor() {
    super('Market');
  }

  init(data: { message?: string; page?: number }) {
    this.message = data?.message;
    this.page = data?.page ?? 0;
    this.generation++;
    this.pendingProductId = null;
    this.products = [];
    this.cardsLayer = undefined;
    this.tareText = undefined;
    this.pageLabel = undefined;
    this.spinner = undefined;
    this.relayoutPending = false;
    this.chrome = [];
  }

  preload() {
    loadWorldImages(this);
    if (!this.textures.exists('bg-village')) this.load.image('bg-village', BACKGROUND_TILES.village);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#F7E9D2');
    this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'bg-village').setOrigin(0, 0);
    creamOverlay(this, 0.78);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Village'));
    // 창 크기가 바뀌면 보던 페이지를 유지한 채 다시 그린다. 구매 요청 중이면 끝난 뒤에(응답을 잃지 않게)
    watchLayout(this, () => this.relayout());
    if (this.message) this.time.delayedCall(0, () => showToast(this, this.message!, { y: this.L?.toastY ?? 606 }));
    this.buildChrome(0);
    void this.loadProducts();
  }

  private relayout() {
    if (this.pendingProductId !== null) {
      this.relayoutPending = true;
      return;
    }
    this.scene.restart({ page: this.page });
  }

  // 머리말·잔액·돌아가기·페이지 버튼(상품 수가 정해지면 다시 그린다)
  private chrome: Phaser.GameObjects.GameObject[] = [];
  private buildChrome(count: number) {
    this.chrome.forEach((o) => o.destroy());
    const L = (this.L = marketLayout(displayScaleOf(this.scale.displaySize.width), count));
    this.page = clampPage(this.page, L.pager?.pages ?? 1);
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(feltPanel(this, L.header.x, L.header.y, L.header.w, L.header.h, { radius: 28 }));
    objs.push(this.add.text(CANVAS_WIDTH / 2, L.header.y + L.header.h / 2, '장터 — NPC 상점', { fontSize: `${L.font.header}px`, color: TEXT.body }).setOrigin(0.5));
    objs.push(feltPanel(this, L.tare.x, L.tare.y, L.tare.w, L.tare.h, { fill: PAL.sky, radius: 26 }));
    this.tareText = this.add.text(L.tare.x + L.tare.w / 2, L.tare.y + L.tare.h / 2, '', { fontSize: `${L.font.tare}px`, color: TEXT.body }).setOrigin(0.5);
    objs.push(this.tareText);
    objs.push(pillButton(this, L.back.x + L.back.w / 2, L.back.y + L.back.h / 2, L.back.w, L.back.h, '마을로 돌아가기', 'back', () => this.scene.start('Village'), undefined, L.font.button));
    this.pageLabel = undefined;
    if (L.pager) {
      const P = L.pager;
      const go = (d: number) => {
        if (this.pendingProductId !== null) return; // 구매 중에는 페이지를 넘기지 않는다
        this.page = (this.page + d + P.pages) % P.pages;
        this.renderCards();
      };
      objs.push(pillButton(this, P.prev.x + P.prev.w / 2, P.prev.y + P.prev.h / 2, P.prev.w, P.prev.h, '◀', 'secondary', () => go(-1), undefined, L.font.button));
      objs.push(pillButton(this, P.next.x + P.next.w / 2, P.next.y + P.next.h / 2, P.next.w, P.next.h, '▶', 'secondary', () => go(1), undefined, L.font.button));
      this.pageLabel = this.add.text(P.label.x, P.label.y, '', { fontSize: `${L.font.button}px`, color: TEXT.body }).setOrigin(0.5);
      objs.push(this.pageLabel);
    }
    this.chrome = objs;
    this.refreshTare();
  }

  private refreshTare() {
    this.tareText?.setText(`타레 ${inventory.getTareBalance()}`);
  }

  private async loadProducts() {
    const gen = this.generation;
    let products: ShopProduct[];
    try {
      products = await fetchShop();
    } catch {
      if (gen === this.generation && this.sys.isActive()) this.renderError();
      return;
    }
    if (gen !== this.generation || !this.sys.isActive()) return; // 응답을 기다리는 사이 화면이 바뀜
    this.products = products;
    this.buildChrome(products.length);
    this.renderCards();
  }

  // 서버 실패: 중앙 오류 패널 + 다시 시도
  private renderError() {
    this.cardsLayer?.destroy();
    const L = this.L;
    const cx = CANVAS_WIDTH / 2;
    const cy = 320;
    const objs = [
      feltPanel(this, cx - 320, cy - 130, 640, 260, { fill: PAL.cream, stroke: 0xe9b7c2 }),
      this.add.text(cx, cy - 50, '상품 목록을 불러오지 못했어요.\n서버 연결을 확인해 주세요.', { fontSize: `${L.font.name}px`, color: TEXT.error, align: 'center', lineSpacing: 6 }).setOrigin(0.5),
      pillButton(this, cx, cy + 70, 240, L.back.h, '다시 시도', 'primary', () => {
        this.cardsLayer?.destroy();
        this.cardsLayer = undefined;
        void this.loadProducts();
      }, undefined, L.font.button),
    ];
    this.cardsLayer = this.add.container(0, 0, objs);
  }

  private renderCards() {
    this.cardsLayer?.destroy();
    this.spinner?.stop();
    const L = this.L;
    const objs: Phaser.GameObjects.GameObject[] = [];

    if (this.products.length === 0) {
      objs.push(feltPanel(this, CANVAS_WIDTH / 2 - 260, 200, 520, 240, {}));
      objs.push(
        this.textures.exists('empty-basket')
          ? this.add.image(CANVAS_WIDTH / 2, 290, 'empty-basket').setDisplaySize(130, 130)
          : this.add.ellipse(CANVAS_WIDTH / 2, 290, 100, 70, PAL.cream2).setStrokeStyle(4, PAL.lavender),
      );
      objs.push(this.add.text(CANVAS_WIDTH / 2, 390, '지금은 판매 중인 상품이 없어요.', { fontSize: `${L.font.name}px`, color: TEXT.sub }).setOrigin(0.5));
    }
    const perPage = L.pager?.perPage ?? Math.max(1, L.cards.length);
    pageOf(this.products, this.page, perPage).forEach((p, i) => objs.push(this.renderCard(p, L.cards[i])));
    this.pageLabel?.setText(`${this.page + 1} / ${L.pager?.pages ?? 1}`);
    this.cardsLayer = this.add.container(0, 0, objs);
  }

  private renderCard(p: ShopProduct, card: { x: number; y: number; w: number; h: number }) {
    const s = this;
    const L = this.L;
    const I = L.inner;
    const { x, y, w } = card;
    const layer = s.add.container(0, 0);
    const state = buyStateOf(p.id, p.price, inventory.getTareBalance(), this.pendingProductId);

    layer.add(feltPanel(s, x, y, w, card.h, { radius: 24, image: 'shop-card-frame' }));

    // 왼쪽 아이콘 영역
    const ix = x + I.icon.x;
    const iy = y + I.icon.y;
    const ic = I.icon.w;
    layer.add(feltPanel(s, ix, iy, ic, ic, { fill: PAL.cream2, stroke: PAL.lavender, strokeW: 3, radius: 20 }));
    if (p.productType === 'turby' && s.textures.exists(`turby-${p.code}`)) {
      layer.add(s.add.image(ix + ic / 2, iy + ic / 2, `turby-${p.code}`).setDisplaySize(ic - 16, ic - 16));
    } else if (itemIconKey(s, p.code)) {
      layer.add(s.add.image(ix + ic / 2, iy + ic / 2, itemIconKey(s, p.code)!).setDisplaySize(ic - 16, ic - 16));
    } else {
      layer.add(s.add.circle(ix + ic / 2, iy + ic / 2, ic * 0.29, PAL.lavender).setStrokeStyle(4, PAL.cream));
      const slotLabel = slotData.find((sl) => sl.key === p.equipSlot)?.label ?? '';
      layer.add(s.add.text(ix + ic / 2, iy + ic / 2, slotLabel.slice(0, 1), { fontSize: `${L.font.name}px`, color: TEXT.body }).setOrigin(0.5));
    }

    // 오른쪽: 이름 → 종류 칩 → 설명 → 능력치
    const tx = x + I.textX;
    const tw = I.textW;
    layer.add(s.add.text(tx, y + I.nameY, ellipsize(p.name, 10), { fontSize: `${L.font.name}px`, color: TEXT.body }));
    const kindLabel = p.productType === 'turby' ? '터비' : slotData.find((sl) => sl.key === p.equipSlot)?.label ?? '아이템';
    layer.add(feltPanel(s, tx, y + I.chip.y, I.chip.w, I.chip.h, { fill: p.productType === 'turby' ? PAL.pink : PAL.sky, stroke: PAL.lavender, strokeW: 2, radius: 12, image: p.productType === 'turby' ? 'chip-turby' : 'chip-item' }));
    layer.add(s.add.text(tx + I.chip.w / 2, y + I.chip.y + I.chip.h / 2, kindLabel, { fontSize: `${L.font.chip}px`, color: TEXT.body }).setOrigin(0.5));
    layer.add(s.add.text(tx, y + I.descY, p.description, { fontSize: `${L.font.body}px`, color: TEXT.sub, wordWrap: { width: tw, useAdvancedWrap: true }, maxLines: I.descLines }));
    const stat = s.add.text(tx, y + I.statY, statText(p), { fontSize: `${L.font.body}px`, color: TEXT.onMint });
    if (stat.width > I.statW) stat.setText(statText(p, true));
    layer.add(stat);
    if (p.productType === 'item') {
      const owned = inventory.getItems().find((it) => it.code === p.code);
      layer.add(s.add.text(x + I.owned.x, y + I.owned.y, `보유 ${owned?.quantity ?? 0}`, { fontSize: `${L.font.body}px`, color: TEXT.sub }).setOrigin(0, 0.5));
    }

    // 가격 + 구매 버튼(우하단). 상태는 글자로도 알린다: 구매 중… / 타레 부족
    const B = I.buy;
    const bx = x + B.x + B.w / 2;
    const by = y + B.y + B.h / 2;
    const note = BUY_NOTE[state];
    if (state === 'buying') {
      const spin = s.textures.exists('loading-yarn') ? s.add.image(x + B.x + B.h / 2, by, 'loading-yarn').setDisplaySize(B.h - 8, B.h - 8) : s.add.circle(x + B.x + B.h / 2, by, B.h / 3, PAL.pink).setStrokeStyle(4, PAL.lavender);
      layer.add(spin);
      this.spinner = s.tweens.add({ targets: spin, angle: 360, duration: 800, repeat: -1 });
      layer.add(s.add.text(x + B.x + B.h + 4, by, note!, { fontSize: `${L.font.button}px`, color: TEXT.body }).setOrigin(0, 0.5));
    } else {
      layer.add(
        pillButton(
          s,
          bx,
          by,
          B.w,
          B.h,
          state === 'ready' ? buyLabel(p.price, state) : '',
          state === 'ready' ? 'primary' : 'disabled',
          () => void this.onBuy(p, x + w / 2, y + card.h / 2),
          () => state === 'short' && showToast(s, '타레가 부족합니다.', { y: L.toastY, error: true }),
          L.font.button,
        ),
      );
      // 누를 수 없는 상태의 글자는 흐리지 않게 따로 그린다(가격은 늘 읽혀야 한다). 잔액 부족은 색만이 아니라 "· 부족" 글자로도 알린다
      if (state !== 'ready') layer.add(s.add.text(bx, by, buyLabel(p.price, state), { fontSize: `${L.font.button}px`, color: state === 'short' ? TEXT.error : TEXT.sub }).setOrigin(0.5));
    }
    return layer;
  }

  private async onBuy(p: ShopProduct, fx: number, fy: number) {
    if (this.pendingProductId !== null) return; // 구매 요청 중 — 한 번의 탭으로 요청은 한 번만
    const gen = this.generation;
    this.pendingProductId = p.id;
    this.renderCards();
    const result = await inventory.purchase(p);
    if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 화면이 바뀜(잔액·보유는 상태 저장소에 이미 반영됨)
    this.pendingProductId = null;
    if (this.relayoutPending) {
      // 구매 중에 창 크기가 바뀌었으면 새 배율로 다시 만들면서 결과를 알린다
      this.scene.restart({ page: this.page, message: result.ok ? `${p.name} 구매 완료!` : result.code === 'INSUFFICIENT_TARE' ? '타레가 부족합니다.' : result.message });
      return;
    }
    this.refreshTare();
    this.renderCards(); // 완료 후 한 번만 갱신
    if (result.ok) {
      this.cottonBurst(fx, fy);
      showToast(this, `${p.name} 구매 완료!`, { y: this.L.toastY });
    } else {
      showToast(this, result.code === 'INSUFFICIENT_TARE' ? '타레가 부족합니다.' : result.message, { y: this.L.toastY, error: true });
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
