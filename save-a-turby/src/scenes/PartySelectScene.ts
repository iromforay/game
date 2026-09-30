import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES } from '../assets/registry';
import { inventory } from '../state/inventory';
import type { OwnedTurby } from '../state/inventory';
import { battleClient } from '../net/battleClient';
import { roomClient, RoomApiError } from '../net/roomClient';
import type { BattleParticipant, BattleSnapshot, BattleUpdate } from '../net/battleTypes';
import { showToast, TEXT, feltPanel } from '../ui/kit';
import { loadWorldImages } from '../assets/loader';
import coopSlots from '../data/coop-slots.json';
import { isStoryBattle, returnDestination, STORY_BADGE, STORY_NOTICE, type BattleReturn } from '../battle/battleView';

interface PartySelectInitData {
  wildCharacterCode: string;
  spawnIndex: number;
  stageCode: string;
  capturedIndices: number[];
  removedIndices: number[];
  snapshot: BattleSnapshot; // 서버가 만든 전투(초대 대기 또는 파티 선택 단계) — 파티 상한·마감 시각도 서버가 정한 값
  returnTo?: BattleReturn; // 스토리 전투: 끝나거나 나가면 돌아갈 화면
}

const slotColor = (slot: number) => coopSlots.find((c) => c.slot === slot)?.main ?? '#888888';

// 3.3/4-C 화면 5(임시 도형): 소지(가방) 중인 터비 중 상한만큼 골라 서버에 제출한다.
// 상단에 참전자(슬롯색·선택 상태), 내 선택 한도, 서버 마감 카운트다운을 보여주고, 다른 사람의 구체적인 파티는 공개하지 않는다.
// 제출한 뒤에는 다른 참전자를 기다리고(서버가 전투를 시작하면 전투 화면으로), 혼자면 바로 전투가 시작된다.
export class PartySelectScene extends Phaser.Scene {
  private initData!: PartySelectInitData;
  private snap!: BattleSnapshot;
  private selected: Set<string> = new Set();
  private cardBorders = new Map<string, Phaser.GameObjects.Rectangle>();
  private countText?: Phaser.GameObjects.Text;
  private limitText?: Phaser.GameObjects.Text;
  private timerText?: Phaser.GameObjects.Text;
  private titleText?: Phaser.GameObjects.Text;
  private chips: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private startButton?: Phaser.GameObjects.Text;
  private submitting = false;
  private submitted = false;
  private leaving = false;
  private offUpdate: (() => void) | null = null;
  private offReconnect: (() => void) | null = null;

  constructor() {
    super('PartySelect');
  }

  init(data: PartySelectInitData) {
    this.initData = data;
    this.snap = data.snapshot;
    this.selected = new Set();
    this.cardBorders = new Map();
    this.chips = [];
    this.overlay = [];
    this.submitting = false;
    this.submitted = false;
    this.leaving = false;
  }

  private get myId() {
    return roomClient.playerId;
  }

  // 스토리 전투는 이야기 누비가 서버에서 자동으로 한 칸을 쓴다(D6) — 고를 수 있는 수는 하나 적다
  private get story() {
    return isStoryBattle(this.snap);
  }

  private get maxParty() {
    return this.story ? Math.max(0, this.snap.partyLimit - 1) : this.snap.partyLimit;
  }

  private exit(outcome: 'cancelled' | null) {
    const d = returnDestination(this.initData.returnTo, { scene: 'Map', data: { stageCode: this.initData.stageCode, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices } }, outcome && this.snap.story ? { encounterKey: this.snap.story.encounterKey, outcome } : null);
    this.scene.start(d.scene, d.data);
  }

  preload() {
    loadWorldImages(this);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1030');
    this.titleText = this.add.text(CANVAS_WIDTH / 2, 24, '', { fontSize: '24px', color: '#ffe9a8' }).setOrigin(0.5);
    this.limitText = this.add.text(CANVAS_WIDTH / 2, 62, '', { fontSize: '15px', color: '#cccccc' }).setOrigin(0.5);
    this.timerText = this.add.text(CANVAS_WIDTH - 16, 16, '', { fontSize: '18px', color: '#9fe58a' }).setOrigin(1, 0);

    const bag = inventory.getBag();
    if (bag.length === 0 && !this.story) {
      this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, '가방이 비어있습니다.\n기지에서 선반의 터비를 가방으로 옮겨주세요.', { fontSize: '16px', color: '#ffb199', align: 'center' }).setOrigin(0.5);
      this.add
        .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 80, '맵으로 돌아가기', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 14, y: 8 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.backToMap());
      return;
    }

    this.renderBagGrid(bag);
    this.countText = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 92, '', { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    this.startButton = this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 50, '선택 완료', { fontSize: '20px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 20, y: 10 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.onStart(bag));
    this.add
      .text(16, CANVAS_HEIGHT - 16, '전투에서 나가기', { fontSize: '13px', color: '#ffffff', backgroundColor: '#6a3a3a', padding: { x: 8, y: 5 } })
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.backToMap());

    // 시작할 때 항상 최소 1마리(가방의 첫 개체)를 기본 선택해둬서 빈 파티로 못 나가게 함(스토리 전투는 누비가 자동 참가하므로 비워도 된다)
    if (!this.story && bag.length > 0) this.toggleSelect(bag[0].id);

    this.offUpdate = roomClient.on('battleUpdate', (u) => this.onUpdate(u));
    this.offReconnect = roomClient.on('reconnected', () => void this.resync());
    this.events.once('shutdown', () => {
      this.offUpdate?.();
      this.offReconnect?.();
    });
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateTimer() });
    this.applySnapshot();
  }

  private renderBagGrid(bag: OwnedTurby[]) {
    const cols = 8;
    const cellSize = 90;
    const startX = 100;
    const startY = 200;

    bag.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellSize;
      const y = startY + row * cellSize;

      const border = this.add.rectangle(x, y, 64, 64).setStrokeStyle(3, 0x5a3a8a, 0);
      this.cardBorders.set(item.id, border);

      const hasImage = this.textures.exists(`turby-${item.characterCode}`);
      if (hasImage) this.add.image(x, y, `turby-${item.characterCode}`).setDisplaySize(48, 48);
      else this.add.circle(x, y, 22, 0x7fc8ff);

      this.add.text(x, y + 36, item.characterName, { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5, 0);
      this.add.text(x, y + 50, `공${item.stats.attack} 체${item.stats.maxHp}`, { fontSize: '9px', color: '#998866' }).setOrigin(0.5, 0);

      this.add
        .zone(x, y, 74, 90)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.toggleSelect(item.id));
    });
  }

  private toggleSelect(id: string) {
    if (this.submitted) return; // 완료 후에는 수정할 수 없다
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      if (this.selected.size >= this.maxParty) return; // 이미 상한
      this.selected.add(id);
    }
    this.refreshSelection();
  }

  private refreshSelection() {
    for (const [id, border] of this.cardBorders) border.setStrokeStyle(3, 0x9fe58a, this.selected.has(id) ? 1 : 0);
    this.countText?.setText(`선택: ${this.selected.size}/${this.maxParty}`);
  }

  // ---------- 서버 상태 반영 ----------

  private statusOf(p: BattleParticipant): { text: string; color: string } {
    if (!p.active) return { text: p.leftReason === 'declined' ? '불참' : p.leftReason === 'invite_timeout' ? '응답 없음' : '이탈', color: TEXT.disabled };
    if (this.snap.phase === 'inviting') return p.invitePending ? { text: '응답 대기', color: TEXT.sub } : { text: '참전', color: TEXT.onMint };
    return p.partySubmitted ? { text: '선택 완료', color: TEXT.onMint } : { text: '준비 중', color: '#8B6B2A' };
  }

  private renderChips() {
    this.chips.forEach((c) => c.destroy());
    this.chips = [];
    const list = this.snap.participants;
    const w = 190;
    const startX = (CANVAS_WIDTH - (list.length * w + (list.length - 1) * 10)) / 2;
    list.forEach((p, i) => {
      const x = startX + i * (w + 10);
      const st = this.statusOf(p);
      const c = Phaser.Display.Color.HexStringToColor(slotColor(p.slot)).color;
      const sub = Phaser.Display.Color.HexStringToColor(coopSlots.find((q) => q.slot === p.slot)?.sub ?? '#FFF4DF').color;
      const frame = feltPanel(this, x, 92, w, 60, { image: 'participant-chip', tint: sub, fill: 0x241a3d, stroke: c, radius: 16, strokeW: 3, alpha: p.active ? 1 : 0.5, fit: 'width' });
      this.chips.push(frame);
      if (!p.connected && p.active && this.textures.exists('status-away')) this.chips.push(this.add.image(x + w - 22, 122, 'status-away').setDisplaySize(26, 26));
      this.chips.push(this.add.circle(x + 20, 112, 6, c));
      const you = p.playerId === this.myId ? ' (나)' : '';
      this.chips.push(this.add.text(x + 34, 102, `${p.nickname.length > 8 ? p.nickname.slice(0, 7) + '…' : p.nickname}${you}`, { fontSize: '14px', color: p.active ? TEXT.body : TEXT.disabled }));
      this.chips.push(this.add.text(x + 34, 124, st.text, { fontSize: '13px', color: st.color }));
    });
  }

  private applySnapshot() {
    const me = this.snap.participants.find((p) => p.playerId === this.myId);
    if (this.snap.phase === 'player_subturn' || this.snap.phase === 'wild_turn') {
      this.startBattle();
      return;
    }
    if (this.snap.phase === 'resolved' || !me || !me.active) {
      this.finish(me && !me.active ? (me.leftReason === 'party_timeout' ? '선택 시간이 지나 참전이 취소되었어요.' : '전투에서 빠졌어요.') : '전투가 취소되었어요.');
      return;
    }
    this.titleText?.setText(this.snap.phase === 'inviting' ? '다른 참가자의 참전 응답을 기다리는 중...' : this.story ? STORY_BADGE : '야생 터비와 조우!');
    this.limitText?.setText(
      this.snap.phase === 'inviting'
        ? '응답이 끝나면 파티를 고를 수 있어요'
        : this.story
          ? `누비는 자동으로 함께해요 · 더 데려갈 터비: 최대 ${this.maxParty}마리 · ${STORY_NOTICE}`
          : `내가 데려갈 수 있는 터비: 최대 ${this.maxParty}마리`,
    );
    // 상한이 줄면(참전자가 늘면) 선택을 잘라낸다
    while (this.selected.size > this.maxParty) this.selected.delete([...this.selected].pop()!);
    this.submitted = me.partySubmitted;
    this.refreshSelection();
    this.renderChips();
    this.updateTimer();
    this.showWaiting(this.snap.phase === 'inviting' ? '참전 응답을 기다리는 중...' : me.partySubmitted ? '다른 참가자를 기다리는 중...' : null);
    this.startButton?.setAlpha(this.snap.phase === 'party_select' && !me.partySubmitted ? 1 : 0.4);
  }

  private showWaiting(message: string | null) {
    this.overlay.forEach((o) => o.destroy());
    this.overlay = [];
    if (!message) return;
    this.overlay.push(this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.35).setOrigin(0, 0).setDepth(50).setInteractive());
    this.overlay.push(this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 60, message, { fontSize: '20px', color: '#ffe9a8', backgroundColor: '#241a3d', padding: { x: 18, y: 10 } }).setOrigin(0.5).setDepth(51));
  }

  private updateTimer() {
    const at = this.snap.expiresAt;
    if (!at) {
      this.timerText?.setText('');
      return;
    }
    this.timerText?.setText(`${Math.max(0, Math.ceil((at - roomClient.now()) / 1000))}초`);
  }

  private onUpdate(u: BattleUpdate) {
    if (u.battleId !== this.snap.battleId || u.version <= this.snap.version || this.leaving) return;
    this.snap = u.snapshot;
    this.applySnapshot();
  }

  private async resync() {
    try {
      const res = await battleClient.snapshot(this.snap.battleId);
      if (res.version >= this.snap.version) {
        this.snap = res.snapshot;
        this.applySnapshot();
      }
    } catch (err) {
      if (err instanceof RoomApiError) this.finish('전투가 사라졌어요.');
    }
  }

  private startBattle() {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start('Battle', { stageCode: this.initData.stageCode, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices, snapshot: this.snap, returnTo: this.initData.returnTo });
  }

  private finish(message: string) {
    if (this.leaving) return;
    this.leaving = true;
    showToast(this, message, { y: 600 });
    this.time.delayedCall(1200, () => this.exit('cancelled'));
  }

  // ---------- 입력 ----------

  // 파티를 못 고르고 돌아가면 서버 전투에서도 빠진다(그대로 두면 다음 조우가 이 전투를 이어받는다)
  private async backToMap() {
    if (this.leaving) return;
    this.leaving = true;
    try {
      await battleClient.leave(this.snap.battleId);
    } catch (err) {
      console.warn('[battle] 전투 정리 실패(서버가 다시 시작됐거나 이미 끝남):', err);
    }
    this.exit('cancelled');
  }

  // 고른 파티를 서버에 제출한다. 서버가 소유·가방 여부·상한을 검증하고, 서버가 거절하면 완료 상태를 되돌리고 이유를 보여준다.
  private async onStart(bag: OwnedTurby[]) {
    if ((this.selected.size === 0 && !this.story) || this.submitting || this.submitted || this.snap.phase !== 'party_select') return;
    this.submitting = true;
    const ids = bag.filter((t) => this.selected.has(t.id)).map((t) => t.id);
    try {
      const res = await battleClient.party(this.snap.battleId, ids);
      if (res.version >= this.snap.version) this.snap = res.snapshot;
      this.applySnapshot();
    } catch (err) {
      this.submitted = false;
      showToast(this, err instanceof RoomApiError ? err.message : '서버에 연결할 수 없습니다.', { y: 600, error: true });
      if (err instanceof RoomApiError && err.code === 'BATTLE_EXPIRED') this.time.delayedCall(1500, () => this.scene.start('StageSelect'));
    } finally {
      this.submitting = false;
    }
  }
}
