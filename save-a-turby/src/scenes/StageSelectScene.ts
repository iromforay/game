import Phaser from 'phaser';
import { CANVAS_WIDTH } from '../config/constants';
import { CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { loadChapterStatuses } from '../config/story';
import type { ChapterStatus } from '../config/story';
import { roomClient, RoomApiError } from '../net/roomClient';
import { PAL, TEXT, feltPanel, pillButton, creamOverlay, showToast, ellipsize } from '../ui/kit';

// docs/save_a_turby_ui_spec.md 2절 좌표
const CARD_W = 216;
const CARD_H = 452;
const GAP = 16;
const CARD_Y = 104;
// stage-card-frame.png(240×480)은 좌우 25px가 투명 — 그대로 카드 폭에 늘리면 보이는 틀이 좁아져 안쪽 내용이 틀 밖으로 넘쳤다(v2 §4 재현).
// 보이는 틀 = 카드 폭이 되도록 투명 여백만큼 넓혀 그리고, 내용은 로프 안쪽 폭(INNER_W)에 맞춘다.
const FRAME_ART = { width: 240, left: 25, right: 25 };
const ROPE = 24;
const INNER_W = CARD_W - ROPE * 2;

const STATE_STYLE = {
  cleared: { badge: '완료', badgeFill: PAL.lavender, badgeText: TEXT.body },
  current: { badge: '진행 중', badgeFill: PAL.mint, badgeText: TEXT.onMint },
  // M2: 백필 입장 권한으로 들어갈 수는 있지만 이전 장 이야기를 마치기 전(도형 배지, 에셋 없음)
  open: { badge: '탐험 가능', badgeFill: PAL.cream, badgeText: TEXT.body },
  locked: { badge: '잠김', badgeFill: PAL.cream2, badgeText: TEXT.disabled },
} as const;

// 마을 출구에서 들어오는 지역 선택. 개방·진행 상태는 서버가 판정하고(M2, story.stageAccessV2) 이 화면은 결과만 그린다.
// 서버 상태를 받지 못하면 모든 지역을 잠그고 다시 시도 버튼을 보여 준다(추측으로 열지 않음).
export class StageSelectScene extends Phaser.Scene {
  private busy = false;

  constructor() {
    super('StageSelect');
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
    this.busy = false;
    this.cameras.main.setBackgroundColor('#F7E9D2');
    if (this.textures.exists('bg-village')) this.add.tileSprite(0, 0, CANVAS_WIDTH, 720, 'bg-village').setOrigin(0, 0);
    creamOverlay(this, 0.78);

    feltPanel(this, CANVAS_WIDTH / 2 - 220, 10, 440, 72, { radius: 28 });
    this.add.text(CANVAS_WIDTH / 2, 46, '어디로 갈까요?', { fontSize: '30px', color: TEXT.body }).setOrigin(0.5);

    pillButton(this, CANVAS_WIDTH / 2, 670, 240, 64, '마을로 돌아가기', 'back', () => this.scene.start('Village'));
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Village'));

    const { ok, statuses } = await loadChapterStatuses();
    if (!ok) pillButton(this, CANVAS_WIDTH / 2, 600, 200, 52, '다시 시도', 'primary', () => this.scene.restart());
    const startX = (CANVAS_WIDTH - (statuses.length * CARD_W + (statuses.length - 1) * GAP)) / 2;
    statuses.forEach((st, i) => this.renderCard(st, startX + i * (CARD_W + GAP), CARD_Y));
  }

  // 카드 정보 순서: 장 제목 → 지역 미리보기 → 지역명(2줄) → 대표 터비 → 직접 포획 조건 → 상태 배지 → 잠금 이유
  private renderCard(st: ChapterStatus, x: number, y: number) {
    const style = STATE_STYLE[st.state];
    const locked = st.state === 'locked';
    const current = st.state === 'current';
    const code = st.chapter.stageCode;
    const cx = x + CARD_W / 2;

    const framed = this.textures.exists('stage-card-frame');
    const scale = CARD_W / (FRAME_ART.width - FRAME_ART.left - FRAME_ART.right);
    const fx = framed ? x - FRAME_ART.left * scale : x;
    const fw = framed ? FRAME_ART.width * scale : CARD_W;
    feltPanel(this, fx, y, fw, CARD_H, { fill: current ? PAL.mint : PAL.cream, stroke: PAL.lavender, strokeW: current ? 6 : 4, radius: 26, alpha: locked ? 0.92 : 1, image: 'stage-card-frame', tint: current ? PAL.mint : undefined });
    this.add.text(cx, y + 36, st.chapter.titleKo, { fontSize: '20px', color: locked ? TEXT.disabled : TEXT.body }).setOrigin(0.5);

    // 미리보기(로프 안쪽 폭, 원래 196:126 비율)
    const previewY = y + 58;
    const pw = INNER_W;
    const ph = Math.round((pw * 126) / 196);
    if (this.textures.exists(`bg-${code}`)) {
      const img = this.add.image(cx, previewY + 63, `bg-${code}`).setDisplaySize(pw, ph);
      if (locked) img.setAlpha(0.45).setTint(0xd8d0d5);
      else img.setAlpha(st.state === 'cleared' ? 0.88 : 1);
    } else {
      this.add.rectangle(cx, previewY + 63, pw, ph, PAL.cream2);
    }

    this.add
      .text(cx, y + 198, st.stageName, { fontSize: '17px', color: locked ? TEXT.sub : TEXT.body, align: 'center', wordWrap: { width: INNER_W, useAdvancedWrap: true } })
      .setOrigin(0.5, 0);

    // 대표 터비 64x64 + 이름
    const tx = x + ROPE + 32;
    const ty = y + 274;
    if (this.textures.exists(`turby-${st.chapter.clearCharacterCode}`)) {
      const t = this.add.image(tx, ty, `turby-${st.chapter.clearCharacterCode}`).setDisplaySize(64, 64);
      if (locked) t.setAlpha(0.5);
    }
    this.add.text(x + ROPE + 72, ty - 14, '대표 터비', { fontSize: '12px', color: TEXT.sub });
    this.add.text(x + ROPE + 72, ty + 2, ellipsize(st.clearCharacterName, 8), { fontSize: '16px', color: locked ? TEXT.sub : TEXT.body });
    // 구 판정(롤백 상태)에서만 참인 안내 — 신 판정에서는 포획이 장을 열지 않는다
    if (st.legacyTargetCode) this.add.text(x + ROPE, y + 318, '직접 포획하면 장 완료', { fontSize: '13px', color: TEXT.sub });

    // 잠금 이유(또는 백필 지역의 이야기 대기 안내)는 읽을 수 있게 유지한다
    if ((locked || st.state === 'open') && st.unlockHint) {
      this.add.text(x + ROPE, y + 342, st.unlockHint, { fontSize: '12px', color: TEXT.sub, wordWrap: { width: INNER_W, useAdvancedWrap: true }, lineSpacing: 2 });
    }

    // 상태 배지
    const badgeY = y + CARD_H - 38;
    const badgeKey = `badge-${st.state}`;
    if (this.textures.exists(badgeKey)) {
      this.add.image(cx, badgeY, badgeKey).setDisplaySize(130, 46);
    } else {
      const g = this.add.graphics();
      g.fillStyle(style.badgeFill, 1);
      g.fillRoundedRect(cx - 65, badgeY - 20, 130, 40, 18);
      g.lineStyle(3, PAL.lavender, 1);
      g.strokeRoundedRect(cx - 65, badgeY - 20, 130, 40, 18);
    }
    this.add.text(cx, badgeY, style.badge, { fontSize: '16px', color: style.badgeText }).setOrigin(0.5);

    if (current) this.addStrandPulse(x + CARD_W - 40, y + 30);
    if (st.state === 'cleared') this.addClearedKnot(x + CARD_W - 32, y + 32);
    if (locked) this.addLockIcon(x + CARD_W - 32, y + 32);

    this.add
      .rectangle(x, y, CARD_W, CARD_H, 0xffffff, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (!st.enterable) showToast(this, st.unlockHint ?? '아직 열리지 않았습니다.', { y: 600 });
        else void this.enterStage(st.chapter.stageCode);
      });
  }

  // 진행 중: 작은 실가닥이 천천히 맥동한다
  private addStrandPulse(x: number, y: number) {
    const dot = this.add.circle(x, y, 8, PAL.pink).setStrokeStyle(3, PAL.lavender);
    this.tweens.add({ targets: dot, scale: 1.35, alpha: 0.7, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private addClearedKnot(x: number, y: number) {
    if (this.textures.exists('icon-cleared-knot')) {
      this.add.image(x, y, 'icon-cleared-knot').setDisplaySize(40, 40);
      return;
    }
    this.add.circle(x, y, 18, PAL.cream).setStrokeStyle(4, PAL.lavender);
    this.add.text(x, y, '✓', { fontSize: '20px', color: TEXT.body }).setOrigin(0.5);
  }

  private addLockIcon(x: number, y: number) {
    if (this.textures.exists('icon-locked')) {
      this.add.image(x, y, 'icon-locked').setDisplaySize(40, 40);
      return;
    }
    const g = this.add.graphics();
    g.lineStyle(4, PAL.disabled, 1);
    g.strokeCircle(x, y - 6, 8);
    g.fillStyle(PAL.disabled, 1);
    g.fillRoundedRect(x - 12, y - 4, 24, 18, 5);
  }

  // 지역을 고르면 1인 방이 만들어진다. 서버에 연결할 수 없으면(오프라인) 기존처럼 혼자 탐험만 계속한다.
  private async enterStage(stageCode: string) {
    if (this.busy) return;
    this.busy = true;
    const stage = stageCode;
    try {
      await roomClient.startSolo(stageCode);
    } catch (err) {
      if (err instanceof RoomApiError) {
        this.busy = false;
        showToast(this, err.message, { y: 600, error: true });
        return;
      }
      console.warn('[room] 서버에 연결할 수 없어 혼자 탐험합니다:', err);
    }
    this.scene.start('Map', { stageCode: stage, capturedIndices: [], removedIndices: [] });
  }
}
