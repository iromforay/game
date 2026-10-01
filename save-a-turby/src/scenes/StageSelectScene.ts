import Phaser from 'phaser';
import { CANVAS_WIDTH } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { loadChapterStatuses } from '../config/story';
import type { ChapterStatus } from '../config/story';
import { roomClient, RoomApiError } from '../net/roomClient';
import { PAL, TEXT, feltPanel, pillButton, creamOverlay, showToast, ellipsize } from '../ui/kit';
import { displayScaleOf } from '../ui/responsive';
import { watchLayout } from '../ui/relayout';
import { clampPage, pageOf, stageSelectLayout, type StageSelectLayout } from '../ui/screenLayouts';
import { stageBadgeLabel } from '../ui/screenStates';

// stage-card-frame.png(240×480)은 좌우 25px가 투명 — 그대로 카드 폭에 늘리면 보이는 틀이 좁아져 안쪽 내용이 틀 밖으로 넘쳤다(v2 §4 재현).
// 보이는 틀 = 카드 폭이 되도록 투명 여백만큼 넓혀 그리고, 내용은 안쪽 폭에 맞춘다. 좌표·글자는 stageSelectLayout(표시 배율별).
const FRAME_ART = { width: 240, left: 25, right: 25 };

const STATE_STYLE = {
  // 배지 문구는 ui/screenStates.ts(stageBadgeLabel): 상태 + 할 수 있는 행동. 색만으로 구분하지 않는다
  cleared: { badgeFill: PAL.lavender, badgeText: TEXT.body },
  current: { badgeFill: PAL.mint, badgeText: TEXT.onMint },
  // M2: 백필 입장 권한으로 들어갈 수는 있지만 이전 장 이야기를 마치기 전(도형 배지, 에셋 없음)
  open: { badgeFill: PAL.cream, badgeText: TEXT.body },
  locked: { badgeFill: PAL.cream2, badgeText: TEXT.sub },
} as const;

// 마을 출구에서 들어오는 지역 선택. 개방·진행 상태는 서버가 판정하고(M2, story.stageAccessV2) 이 화면은 결과만 그린다.
// 서버 상태를 받지 못하면 모든 지역을 잠그고 다시 시도 버튼을 보여 준다(추측으로 열지 않음).
export class StageSelectScene extends Phaser.Scene {
  private busy = false;
  private page = 0;
  private L!: StageSelectLayout;
  private statuses: ChapterStatus[] = [];
  private cardLayer: Phaser.GameObjects.GameObject[] = [];
  private pageLabel?: Phaser.GameObjects.Text;
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 이전 화면의 늦은 응답이 새 화면을 건드리지 않게

  constructor() {
    super('StageSelect');
  }

  init(data: { page?: number }) {
    this.page = data?.page ?? 0;
    this.busy = false;
    this.cardLayer = [];
    this.pageLabel = undefined;
    this.statuses = [];
    this.generation++;
  }

  preload() {
    loadWorldImages(this);
    for (const [code, url] of Object.entries(BACKGROUND_TILES)) {
      if (!this.textures.exists(`bg-${code}`)) this.load.image(`bg-${code}`, url);
    }
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  async create() {
    const gen = this.generation;
    const scale = displayScaleOf(this.scale.displaySize.width);
    this.cameras.main.setBackgroundColor('#F7E9D2');
    if (this.textures.exists('bg-village')) this.add.tileSprite(0, 0, CANVAS_WIDTH, 720, 'bg-village').setOrigin(0, 0);
    creamOverlay(this, 0.78);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Village'));
    // 창 크기가 바뀌어 배치 기준이 달라지면 보던 페이지를 유지한 채 다시 그린다(입장 요청 중이면 곧 화면이 바뀌므로 생략)
    watchLayout(this, () => {
      if (!this.busy) this.scene.restart({ page: this.page });
    });

    const { ok, statuses } = await loadChapterStatuses();
    if (gen !== this.generation || !this.sys.isActive()) return; // 응답을 기다리는 사이 화면이 바뀜
    this.statuses = statuses;
    const L = (this.L = stageSelectLayout(scale, statuses.length));
    this.page = clampPage(this.page, L.pager?.pages ?? 1);

    feltPanel(this, L.header.x, L.header.y, L.header.w, L.header.h, { radius: 28 });
    this.add.text(CANVAS_WIDTH / 2, L.header.y + L.header.h / 2, '어디로 갈까요?', { fontSize: `${L.font.header}px`, color: TEXT.body }).setOrigin(0.5);
    pillButton(this, L.back.x + L.back.w / 2, L.back.y + L.back.h / 2, L.back.w, L.back.h, '마을로 돌아가기', 'back', () => this.scene.start('Village'), undefined, L.font.button);
    if (!ok) pillButton(this, CANVAS_WIDTH / 2, L.toastY - 30, 240, L.back.h, '다시 시도', 'primary', () => this.scene.restart({ page: this.page }), undefined, L.font.button);
    if (L.pager) {
      const P = L.pager;
      const go = (d: number) => {
        this.page = (this.page + d + P.pages) % P.pages;
        this.renderPage();
      };
      pillButton(this, P.prev.x + P.prev.w / 2, P.prev.y + P.prev.h / 2, P.prev.w, P.prev.h, '◀', 'secondary', () => go(-1), undefined, L.font.button);
      pillButton(this, P.next.x + P.next.w / 2, P.next.y + P.next.h / 2, P.next.w, P.next.h, '▶', 'secondary', () => go(1), undefined, L.font.button);
      this.pageLabel = this.add.text(P.label.x, P.label.y, '', { fontSize: `${L.font.button}px`, color: TEXT.body }).setOrigin(0.5);
    }
    this.renderPage();
  }

  private renderPage() {
    const L = this.L;
    this.cardLayer.forEach((o) => o.destroy());
    this.cardLayer = [];
    const perPage = L.pager?.perPage ?? L.cards.length;
    pageOf(this.statuses, this.page, perPage).forEach((st, i) => this.renderCard(st, L.cards[i]));
    this.pageLabel?.setText(`${this.page + 1} / ${L.pager?.pages ?? 1}`);
  }

  // 카드 정보 순서: 장 제목 → 지역 미리보기 → 지역명 → 대표 터비 → 잠금 이유 → 상태·행동 배지
  private renderCard(st: ChapterStatus, card: { x: number; y: number; w: number; h: number }) {
    const L = this.L;
    const I = L.inner;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.cardLayer.push(o);
      return o;
    };
    const { x, y, w, h } = card;
    const style = STATE_STYLE[st.state];
    const locked = st.state === 'locked';
    const current = st.state === 'current';
    const code = st.chapter.stageCode;
    const cx = x + w / 2;
    const iw = w - I.pad * 2;

    const framed = this.textures.exists('stage-card-frame');
    const fscale = w / (FRAME_ART.width - FRAME_ART.left - FRAME_ART.right);
    const fx = framed ? x - FRAME_ART.left * fscale : x;
    const fw = framed ? FRAME_ART.width * fscale : w;
    keep(feltPanel(this, fx, y, fw, h, { fill: current ? PAL.mint : PAL.cream, stroke: PAL.lavender, strokeW: current ? 6 : 4, radius: 26, alpha: locked ? 0.92 : 1, image: 'stage-card-frame', tint: current ? PAL.mint : undefined }));
    keep(this.add.text(cx, y + I.titleY, st.chapter.titleKo, { fontSize: `${L.font.title}px`, color: locked ? TEXT.sub : TEXT.body }).setOrigin(0.5));

    const P = I.preview;
    if (this.textures.exists(`bg-${code}`)) {
      const img = keep(this.add.image(cx, y + P.y + P.h / 2, `bg-${code}`).setDisplaySize(P.w, P.h));
      if (locked) img.setAlpha(0.45).setTint(0xd8d0d5);
      else img.setAlpha(st.state === 'cleared' ? 0.88 : 1);
    } else {
      keep(this.add.rectangle(cx, y + P.y + P.h / 2, P.w, P.h, PAL.cream2));
    }

    keep(
      this.add
        .text(cx, y + I.nameY, st.stageName, { fontSize: `${L.font.name}px`, color: locked ? TEXT.sub : TEXT.body, align: 'center', wordWrap: { width: iw, useAdvancedWrap: true }, maxLines: L.mode === 'compact' ? 1 : 2 })
        .setOrigin(0.5, 0),
    );

    // 대표 터비 그림 + 이름
    const R = I.rep;
    const ty = y + R.y + R.size / 2;
    if (this.textures.exists(`turby-${st.chapter.clearCharacterCode}`)) {
      const t = keep(this.add.image(x + I.pad + R.size / 2, ty, `turby-${st.chapter.clearCharacterCode}`).setDisplaySize(R.size, R.size));
      if (locked) t.setAlpha(0.5);
    }
    const repX = x + I.pad + R.size + 8;
    keep(this.add.text(repX, ty - 2, '대표 터비', { fontSize: `${L.font.small}px`, color: TEXT.sub }).setOrigin(0, 1));
    keep(this.add.text(repX, ty + 2, ellipsize(st.clearCharacterName, 8), { fontSize: `${L.font.name}px`, color: locked ? TEXT.sub : TEXT.body }));

    // 잠금 이유(또는 백필 지역의 이야기 대기 안내)·구 판정 안내 — 잘리지 않게 카드 안쪽 폭에서 줄바꿈
    const hints = [st.legacyTargetCode ? '직접 포획하면 장 완료' : null, (locked || st.state === 'open') && st.unlockHint ? st.unlockHint : null].filter((t): t is string => !!t);
    if (hints.length > 0) {
      keep(this.add.text(x + I.pad, y + I.hintY, hints.join('\n'), { fontSize: `${L.font.small}px`, color: TEXT.sub, wordWrap: { width: iw, useAdvancedWrap: true }, lineSpacing: 2, maxLines: I.hintLines }));
    }

    // 상태·행동 배지(입장 가능하면 "… · 입장")
    const B = I.badge;
    const g = keep(this.add.graphics());
    g.fillStyle(style.badgeFill, 1);
    g.fillRoundedRect(x + B.x, y + B.y, B.w, B.h, 18);
    g.lineStyle(3, st.enterable ? 0x9fbfae : PAL.lavender, 1);
    g.strokeRoundedRect(x + B.x, y + B.y, B.w, B.h, 18);
    keep(this.add.text(cx, y + B.y + B.h / 2, stageBadgeLabel(st.state, st.enterable), { fontSize: `${L.font.badge}px`, color: style.badgeText }).setOrigin(0.5));

    if (current) this.cardLayer.push(...this.addStrandPulse(x + w - 40, y + 30));
    if (st.state === 'cleared') this.cardLayer.push(...this.addClearedKnot(x + w - 32, y + 32));
    if (locked) this.cardLayer.push(...this.addLockIcon(x + w - 32, y + 32));

    // 카드 전체가 누르는 영역(카드끼리는 간격만큼 떨어져 있어 겹치지 않는다)
    keep(
      this.add
        .rectangle(x, y, w, h, 0xffffff, 0)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          if (!st.enterable) showToast(this, st.unlockHint ?? '아직 열리지 않았습니다.', { y: L.toastY });
          else void this.enterStage(st.chapter.stageCode);
        }),
    );
  }

  // 진행 중: 작은 실가닥이 천천히 맥동한다
  private addStrandPulse(x: number, y: number): Phaser.GameObjects.GameObject[] {
    const dot = this.add.circle(x, y, 8, PAL.pink).setStrokeStyle(3, PAL.lavender);
    this.tweens.add({ targets: dot, scale: 1.35, alpha: 0.7, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return [dot];
  }

  private addClearedKnot(x: number, y: number): Phaser.GameObjects.GameObject[] {
    if (this.textures.exists('icon-cleared-knot')) return [this.add.image(x, y, 'icon-cleared-knot').setDisplaySize(40, 40)];
    return [this.add.circle(x, y, 18, PAL.cream).setStrokeStyle(4, PAL.lavender), this.add.text(x, y, '✓', { fontSize: '20px', color: TEXT.body }).setOrigin(0.5)];
  }

  private addLockIcon(x: number, y: number): Phaser.GameObjects.GameObject[] {
    if (this.textures.exists('icon-locked')) return [this.add.image(x, y, 'icon-locked').setDisplaySize(40, 40)];
    const g = this.add.graphics();
    g.lineStyle(4, PAL.disabled, 1);
    g.strokeCircle(x, y - 6, 8);
    g.fillStyle(PAL.disabled, 1);
    g.fillRoundedRect(x - 12, y - 4, 24, 18, 5);
    return [g];
  }

  // 지역을 고르면 1인 방이 만들어진다. 서버에 연결할 수 없으면(오프라인) 기존처럼 혼자 탐험만 계속한다.
  private async enterStage(stageCode: string) {
    if (this.busy) return; // 입장 요청 중 — 한 번의 탭으로 요청은 한 번만
    this.busy = true;
    const gen = this.generation;
    // 요청 중임을 보여 준다(다른 카드·버튼 입력은 이 가림막이 막는다)
    const wait = [
      this.add.rectangle(0, 0, CANVAS_WIDTH, 720, 0x4a3a44, 0.35).setOrigin(0, 0).setDepth(900).setInteractive(),
      this.add.text(CANVAS_WIDTH / 2, 360, '입장하는 중…', { fontSize: `${this.L.font.button}px`, color: TEXT.body, backgroundColor: '#fff4df', padding: { x: 20, y: 12 } }).setOrigin(0.5).setDepth(901),
    ];
    try {
      await roomClient.startSolo(stageCode);
    } catch (err) {
      if (gen !== this.generation || !this.sys.isActive()) return;
      if (err instanceof RoomApiError) {
        wait.forEach((o) => o.destroy());
        this.busy = false;
        showToast(this, err.message, { y: this.L.toastY, error: true });
        return;
      }
      console.warn('[room] 서버에 연결할 수 없어 혼자 탐험합니다:', err);
    }
    if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 다른 화면으로 나감
    this.scene.start('Map', { stageCode, capturedIndices: [], removedIndices: [] });
  }
}
