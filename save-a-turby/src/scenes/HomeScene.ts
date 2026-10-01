import Phaser from 'phaser';
import { loadWorldImages } from '../assets/loader';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { inventory } from '../state/inventory';
import { EquipPanel } from '../ui/EquipPanel';
import type { OwnedTurby } from '../state/inventory';
import { showToast } from '../ui/kit';
import { displayScaleOf } from '../ui/responsive';
import { watchLayout } from '../ui/relayout';
import { clampPage, homeLayout, pageOf, type HomeLayout } from '../ui/screenLayouts';

const SHELF_SLOT_COUNT = 40; // 4.4: 8열x5행 제안

type HomeInit = { pages?: [number, number]; equipFor?: string | null };

// 4.4 기지(집) — 마을(Village) 안 "내 집"에서 진입. 가방(소지)/선반(전시) 구분 표시, 버튼으로 서로 이동, 터비별 장비 창.
// 좌표·글자는 homeLayout(표시 배율별). 터비가 한 줄을 넘으면 구역마다 페이지로 넘긴다.
export class HomeScene extends Phaser.Scene {
  private busy = false;
  private equipPanel!: EquipPanel;
  private pages: [number, number] = [0, 0];
  private L!: HomeLayout;
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 이전 화면의 늦은 응답이 새 화면을 건드리지 않게
  private relayoutPending = false;
  private initEquipFor: string | null = null;
  private busyNote?: Phaser.GameObjects.Text;

  constructor() {
    super('Home');
  }

  init(data: HomeInit) {
    this.pages = data?.pages ? [data.pages[0], data.pages[1]] : [0, 0];
    this.initEquipFor = data?.equipFor ?? null;
    this.busy = false;
    this.relayoutPending = false;
    this.busyNote = undefined;
    this.generation++;
  }

  preload() {
    loadWorldImages(this);
    if (!this.textures.exists('bg-home')) this.load.image('bg-home', BACKGROUND_TILES.home);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    const L = (this.L = homeLayout(displayScaleOf(this.scale.displaySize.width)));
    this.equipPanel = new EquipPanel(this);
    this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'bg-home').setOrigin(0, 0);
    this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x1a1030, 0.45).setOrigin(0, 0); // 글자가 배경 무늬에 묻히지 않게

    this.add.text(CANVAS_WIDTH / 2, L.titleY, '터비 구하기 — 기지', { fontSize: `${L.font.title}px`, color: '#ffe9a8' }).setOrigin(0.5);
    // 4.1/4.5: 재화(타레)
    this.add.text(L.tare.x, L.tare.y, `타레: ${inventory.getTareBalance()}`, { fontSize: `${L.font.section}px`, color: '#ffe9a8', backgroundColor: '#00000060', padding: { x: 8, y: 4 } }).setOrigin(0, 0);

    this.renderSection(0, '가방 (소지 — 원정 파티 후보)', inventory.getBag(), '선반으로', (id) => this.onMoveToShelf(id));
    this.renderSection(1, '선반 (기지 보관 — 전시)', inventory.getShelf(), '가방으로', (id) => this.onMoveToBag(id));

    const E = L.exit;
    this.button(E, '마을로 나가기', L.font.button + 4, '#ffffff', '#5a3a8a', () => {
      if (!this.busy) this.scene.start('Village');
    });

    // 창 크기가 바뀌면 보던 페이지·열어 둔 장비 창을 유지한 채 다시 그린다. 이동 요청 중이면 끝난 뒤에
    watchLayout(this, () => this.relayout());
    if (this.initEquipFor && inventory.getAll().some((t) => t.id === this.initEquipFor)) this.equipPanel.open(this.initEquipFor);
  }

  private relayout() {
    if (this.busy || this.equipPanel.isBusy) {
      this.relayoutPending = true;
      return;
    }
    this.scene.restart({ pages: this.pages, equipFor: this.equipPanel.openTurbyId } satisfies HomeInit);
  }

  update() {
    if (this.relayoutPending && !this.busy && !this.equipPanel.isBusy) {
      this.relayoutPending = false;
      this.relayout();
    }
  }

  // 글자 버튼(영역 고정): 누르는 영역이 글자 길이와 상관없이 r 전체
  private button(r: { x: number; y: number; w: number; h: number }, label: string, font: number, color: string, bg: string, onClick: () => void) {
    const box = this.add.rectangle(r.x, r.y, r.w, r.h, Phaser.Display.Color.HexStringToColor(bg).color, 0.92).setOrigin(0, 0).setStrokeStyle(2, 0xffffff, 0.35);
    this.add.text(r.x + r.w / 2, r.y + r.h / 2, label, { fontSize: `${font}px`, color }).setOrigin(0.5);
    box.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    return box;
  }

  private renderSection(index: 0 | 1, title: string, items: OwnedTurby[], actionLabel: string, onAction: (turbyId: string) => void) {
    const L = this.L;
    const S = L.sections[index];
    const pages = Math.max(1, Math.ceil(items.length / L.perRow));
    this.pages[index] = clampPage(this.pages[index], pages);
    const page = this.pages[index];
    this.add.text(S.title.x, S.title.y, `${title} · ${items.length}마리`, { fontSize: `${L.font.section}px`, color: '#ffffff' });

    if (items.length === 0) {
      this.add.text(S.cells[0].x, S.cells[0].y + 8, '비어있습니다.', { fontSize: `${L.font.name}px`, color: '#cccccc' });
      return;
    }
    if (pages > 1) {
      const go = (d: number) => {
        if (this.busy) return;
        const pagesNow: [number, number] = [this.pages[0], this.pages[1]];
        pagesNow[index] = (page + d + pages) % pages;
        this.scene.restart({ pages: pagesNow } satisfies HomeInit);
      };
      this.button(S.pager.prev, '◀', L.font.button + 4, '#ffffff', '#3d2f66', () => go(-1));
      this.button(S.pager.next, '▶', L.font.button + 4, '#ffffff', '#3d2f66', () => go(1));
      this.add.text(S.pager.label.x, S.pager.label.y, `${page + 1} / ${pages}`, { fontSize: `${L.font.section}px`, color: '#dddddd' }).setOrigin(1, 0.5);
    }

    pageOf(items, page, L.perRow).forEach((item, i) => {
      const c = S.cells[i];
      const cx = c.x + c.w / 2;
      this.add.rectangle(c.x, c.y, c.w, c.h, 0x2c2148, 0.7).setOrigin(0, 0).setStrokeStyle(2, 0x5a3a8a);
      if (this.textures.exists(`turby-${item.characterCode}`)) this.add.image(cx, c.y + L.cell.image / 2 + 2, `turby-${item.characterCode}`).setDisplaySize(L.cell.image - 4, L.cell.image - 4);
      else this.add.circle(cx, c.y + L.cell.image / 2 + 2, L.cell.image / 2 - 6, 0x7fc8ff);
      this.add.text(cx, c.y + L.cell.nameY, item.characterName, { fontSize: `${L.font.name}px`, color: '#ffffff' }).setOrigin(0.5, 0);
      const M = L.cell.move;
      const Q = L.cell.equip;
      this.button({ x: c.x + M.x, y: c.y + M.y, w: M.w, h: M.h }, actionLabel, L.font.button, '#ffe9a8', '#4a3a2a', () => onAction(item.id));
      this.button({ x: c.x + Q.x, y: c.y + Q.y, w: Q.w, h: Q.h }, '장비', L.font.button, '#bff0c8', '#24402e', () => {
        if (!this.busy) this.equipPanel.open(item.id);
      });
    });
  }

  private nextEmptySlotIndex(): number | null {
    const used = new Set(inventory.getShelf().map((t) => t.slotIndex));
    for (let i = 0; i < SHELF_SLOT_COUNT; i++) if (!used.has(i)) return i;
    return null; // 선반이 가득 참
  }

  // 이동 요청 중: 다른 입력을 받지 않고(busy) 화면에 "옮기는 중…"을 보여 준다
  private setBusy(on: boolean) {
    this.busy = on;
    this.busyNote?.destroy();
    this.busyNote = on ? this.add.text(CANVAS_WIDTH / 2, this.L.toastY, '옮기는 중…', { fontSize: `${this.L.font.button}px`, color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 12, y: 6 } }).setOrigin(0.5).setDepth(50) : undefined;
  }

  private async move(run: () => Promise<{ ok: boolean }>, failText: string) {
    if (this.busy) return; // 한 번의 탭으로 요청은 한 번만
    const gen = this.generation;
    this.setBusy(true);
    const result = await run();
    if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 화면이 바뀜
    this.setBusy(false);
    if (result.ok) this.scene.restart({ pages: this.pages } satisfies HomeInit);
    else showToast(this, failText, { y: this.L.toastY, error: true });
  }

  private async onMoveToShelf(turbyId: string) {
    if (this.busy) return;
    const slotIndex = this.nextEmptySlotIndex();
    if (slotIndex === null) {
      showToast(this, '선반이 가득 찼습니다.', { y: this.L.toastY, error: true });
      return;
    }
    await this.move(() => inventory.moveToShelf(turbyId, slotIndex), '선반 이동 실패(오프라인?)');
  }

  private async onMoveToBag(turbyId: string) {
    await this.move(() => inventory.moveToBag(turbyId), '가방 이동 실패(오프라인?)');
  }
}
