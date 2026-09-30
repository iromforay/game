import Phaser from 'phaser';
import { BATTLE_TILE_SIZE, CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { CHARACTER_IMAGES } from '../assets/registry';
import { inventory } from '../state/inventory';
import { withIGa } from '../utils/korean';
import { roomClient, RoomApiError } from '../net/roomClient';
import { battleClient } from '../net/battleClient';
import type { ActionBody, BattleEnded, BattleEvent, BattleResponse, BattleSnapshot, BattleUnit, BattleUpdate } from '../net/battleTypes';
import { showToast, feltPanel, pillButton, TEXT } from '../ui/kit';
import { loadWorldImages } from '../assets/loader';
import coopSlots from '../data/coop-slots.json';
import { isStoryBattle, objectiveLines, reachableCells, returnDestination, showsCornerEscape, storyResultText, targetState, unitTags, STORY_BADGE, STORY_NOTICE, TARGET_HINT, type BattleReturn } from '../battle/battleView';

interface BattleInitData {
  stageCode: string;
  capturedIndices: number[];
  removedIndices: number[];
  snapshot: BattleSnapshot; // 서버가 내려준 전투 상태(파티 확정 직후 또는 새로고침 복구)
  returnTo?: BattleReturn; // 스토리 전투: 끝나면 돌아갈 화면(결과를 storyBattleEnd로 넘긴다)
}

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpText: Phaser.GameObjects.Text;
  selectRing: Phaser.GameObjects.Arc;
}

const RETRY_LIMIT = 3;
const asDepth = (o: Phaser.GameObjects.GameObject, depth: number) => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(depth);
const slotHex = (slot: number) => coopSlots.find((c) => c.slot === slot)?.main ?? '#888888';
const slotNum = (slot: number) => Phaser.Display.Color.HexStringToColor(slotHex(slot)).color;
const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((resolve) => scene.time.delayedCall(ms, resolve));

// 4-B: 서버 권위 전투의 렌더러 겸 입력기. 규칙(이동·공격·AI·승패)은 전부 서버가 계산하고,
// 이 씬은 서버 snapshot을 그리고 이동/공격/턴 종료 "의도"만 보낸다. 임시 도형 UI(디자인 확정 전)는 그대로 유지한다.
export class BattleScene extends Phaser.Scene {
  private initData!: BattleInitData;
  private snap!: BattleSnapshot;
  private views = new Map<string, UnitView>();
  private selectedUnitId: string | null = null;
  private doneUnits = new Set<string>(); // "이 유닛은 더 안 움직임" 선택 표시(서버 개념이 아니라 선택 UI 편의)
  private lastRound = 0;
  private busy = false;
  private resultShown = false;
  private moveHighlights: Phaser.GameObjects.Rectangle[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private leavingRemoved = false;
  private resultObjs: Phaser.GameObjects.GameObject[] = [];
  private settleGaveUp = false;
  private resultEnded: BattleEnded | null = null;
  private offUpdate: (() => void) | null = null;
  private offReconnect: (() => void) | null = null;
  private chipObjs: Phaser.GameObjects.GameObject[] = [];
  private band?: Phaser.GameObjects.Rectangle;
  private leaveLayer: Phaser.GameObjects.GameObject[] = [];
  private queuedUpdate: BattleUpdate | null = null; // 내 요청·재생 중에 도착한 알림(가장 최신 것만 유지)
  private gridW = 0;
  private gridH = 0;
  private offsetX = 0;
  private offsetY = 0;
  private blockedObjs: Phaser.GameObjects.GameObject[] = [];
  private blockedDrawn = '';

  constructor() {
    super('Battle');
  }

  init(data: BattleInitData) {
    this.initData = data;
    this.snap = data.snapshot;
    this.views = new Map();
    this.selectedUnitId = null;
    this.doneUnits = new Set();
    this.lastRound = 0;
    this.busy = false;
    this.resultShown = false;
    this.moveHighlights = [];
    this.chipObjs = [];
    this.leaveLayer = [];
    this.queuedUpdate = null;
    this.resultObjs = [];
    this.settleGaveUp = false;
    this.resultEnded = null;
    this.leavingRemoved = false;
    this.blockedObjs = [];
    this.blockedDrawn = '';
  }

  preload() {
    loadWorldImages(this);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
  }

  create() {
    // 새로고침 복구로 파티 선택 단계에 돌아온 경우는 파티 선택 화면으로 보낸다
    if (this.snap.phase === 'party_select' || this.snap.phase === 'inviting') {
      const me = this.snap.participants.find((p) => p.playerId === this.myId);
      // 응답하지 않은 초대는 맵의 초대 팝업으로, 그 밖에는 파티 선택 화면으로
      if (me?.invitePending) this.scene.start('Map', { stageCode: this.initData.stageCode, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices, invite: this.snap });
      else this.scene.start('PartySelect', { stageCode: this.initData.stageCode, wildCharacterCode: this.snap.wildCharacterCode, spawnIndex: this.snap.spawnIndex, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices, snapshot: this.snap, returnTo: this.initData.returnTo });
      return;
    }

    this.cameras.main.setBackgroundColor('#1a1030');
    this.gridW = this.snap.grid.cols * BATTLE_TILE_SIZE;
    this.gridH = this.snap.grid.rows * BATTLE_TILE_SIZE;
    this.offsetX = (CANVAS_WIDTH - this.gridW) / 2;
    this.offsetY = (CANVAS_HEIGHT - this.gridH) / 2;
    this.drawGrid();

    // 화면 6 상단 중앙 턴 패널(라운드·현재 서브턴·남은 시간). 조작 안내는 화면 아래쪽 한 줄로 따로 둔다.
    if (this.textures.exists('turn-panel')) this.add.image(CANVAS_WIDTH / 2, 26, 'turn-panel').setDisplaySize(520, 76).setDepth(1998);
    this.statusText = this.add
      .text(CANVAS_WIDTH / 2, 24, '', { fontSize: '18px', color: this.textures.exists('turn-panel') ? TEXT.body : '#ffe9a8' })
      .setOrigin(0.5)
      .setDepth(2000);
    this.hintText = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 18, '', { fontSize: '13px', color: '#cfc6ee', backgroundColor: '#00000060', padding: { x: 8, y: 3 } }).setOrigin(0.5).setDepth(2000);
    this.add
      .text(CANVAS_WIDTH - 16, 16, '턴 종료', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.endTurn());

    // 다른 참전자의 행동이나 서버가 스스로 일으킨 변화(이탈로 인한 취소 등)를 받는다. 이미 반영한 버전 이하는 무시한다.
    this.offUpdate = roomClient.on('battleUpdate', (u) => void this.onServerUpdate(u));
    // 연결이 끊겼다 돌아오면 서버 전투 상태를 다시 받아 맞춘다(유예 안에 돌아오면 그대로 이어서 진행)
    this.offReconnect = roomClient.on('reconnected', () => void this.resync());
    this.events.once('shutdown', () => {
      this.offUpdate?.();
      this.offReconnect?.();
    });

    this.band = this.add.rectangle(0, 0, CANVAS_WIDTH, 6, 0x000000, 0).setOrigin(0, 0).setDepth(1999);
    this.add
      .text(16, CANVAS_HEIGHT - 16, '전투 나가기', { fontSize: '13px', color: '#ffffff', backgroundColor: '#6a3a3a', padding: { x: 8, y: 5 } })
      .setOrigin(0, 1)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.confirmLeave());
    this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateStatusText() });
    this.renderStoryPanel();

    this.syncFromSnapshot();
    if (this.snap.phase === 'resolved') void this.showResult(null);
  }

  // ---------- 그리기 ----------

  private drawGrid() {
    const g = this.add.graphics();
    g.fillStyle(0x241a3d, 1);
    g.fillRect(this.offsetX, this.offsetY, this.gridW, this.gridH);
    g.lineStyle(1, 0x3d2f66, 1);
    for (let c = 0; c <= this.snap.grid.cols; c++) g.lineBetween(this.offsetX + c * BATTLE_TILE_SIZE, this.offsetY, this.offsetX + c * BATTLE_TILE_SIZE, this.offsetY + this.gridH);
    for (let r = 0; r <= this.snap.grid.rows; r++) g.lineBetween(this.offsetX, this.offsetY + r * BATTLE_TILE_SIZE, this.offsetX + this.gridW, this.offsetY + r * BATTLE_TILE_SIZE);

    // 퇴각존(네 꼭짓점, 3.4/3.5.2 확정) — 스토리(정의) 전투는 정의가 켠 경우만
    if (!showsCornerEscape(this.snap)) return;
    const lastCol = this.snap.grid.cols - 1;
    const lastRow = this.snap.grid.rows - 1;
    for (const [col, row] of [[0, 0], [lastCol, 0], [0, lastRow], [lastCol, lastRow]]) {
      g.fillStyle(0xffe9a8, 0.18);
      g.fillRect(this.offsetX + col * BATTLE_TILE_SIZE, this.offsetY + row * BATTLE_TILE_SIZE, BATTLE_TILE_SIZE, BATTLE_TILE_SIZE);
    }
  }

  private tileToWorld(col: number, row: number) {
    return { x: this.offsetX + col * BATTLE_TILE_SIZE + BATTLE_TILE_SIZE / 2, y: this.offsetY + row * BATTLE_TILE_SIZE + BATTLE_TILE_SIZE / 2 };
  }

  private hpLabel(u: BattleUnit) {
    const tags = unitTags(u);
    return `${u.name} HP ${u.hp}/${u.maxHp}${tags.length > 0 ? ` (${tags.join(' · ')})` : ''}`;
  }

  // 통행 불가 칸(스토리 전투 지형). 지형 규칙으로 바뀌면 다시 그린다 — 임시 도형(에셋 확정 전)
  private drawBlocked(blocked: string[]) {
    const key = blocked.join('|');
    if (key === this.blockedDrawn) return;
    this.blockedDrawn = key;
    this.blockedObjs.forEach((o) => o.destroy());
    this.blockedObjs = blocked.map((k) => {
      const [col, row] = k.split(',').map(Number);
      const { x, y } = this.tileToWorld(col, row);
      return this.add.rectangle(x, y, BATTLE_TILE_SIZE - 4, BATTLE_TILE_SIZE - 4, 0x0d0818, 0.85).setStrokeStyle(2, 0x6a5a8a, 0.9).setDepth(5);
    });
  }

  // 스토리 전투 표식·현재 목표·보상 없음 안내 — 격자 왼쪽 여백에 세로로(격자를 가리지 않게). 임시 텍스트 패널
  private renderStoryPanel() {
    if (!isStoryBattle(this.snap)) return;
    const x = 8;
    const w = Math.max(120, this.offsetX - 16);
    const wrap = { width: w - 16, useAdvancedWrap: true };
    const badge = this.add.text(x + 8, 68, STORY_BADGE, { fontSize: '16px', color: '#ffd27f' }).setDepth(2001);
    const goals = this.add.text(x + 8, badge.y + badge.height + 10, objectiveLines(this.snap).map((l) => `· ${l}`).join('\n'), { fontSize: '13px', color: '#ffffff', lineSpacing: 6, wordWrap: wrap }).setDepth(2001);
    const notice = this.add.text(x + 8, goals.y + goals.height + 12, STORY_NOTICE, { fontSize: '12px', color: '#cfc6ee', wordWrap: wrap }).setDepth(2001);
    this.add.rectangle(x, 58, w, notice.y + notice.height + 10 - 58, 0x241a3d, 0.92).setOrigin(0, 0).setStrokeStyle(2, 0xffd27f, 0.9).setDepth(2000);
  }

  private createView(u: BattleUnit): UnitView {
    const { x, y } = this.tileToWorld(u.col, u.row);
    const container = this.add.container(x, y);
    const hasImage = this.textures.exists(`turby-${u.characterCode}`);
    const fill = u.side === 'party' ? 0xffd27f : u.side === 'neutral' ? 0x9fe58a : 0x7fc8ff;
    const body = hasImage ? this.add.image(0, 0, `turby-${u.characterCode}`).setDisplaySize(52, 52) : this.add.circle(0, 0, u.partOf ? 16 : 24, fill);
    const selectRing = this.add.circle(0, 0, 29).setStrokeStyle(3, 0x9fe58a, 0);
    const ring = this.add.circle(0, 0, 26).setStrokeStyle(3, u.side === 'party' ? slotNum(u.participantSlot) : u.side === 'neutral' ? 0x4a9a4a : 0x2d6fa3);
    container.add([selectRing, ring, body]);
    container.setDepth(10);
    const hpText = this.add.text(x, y + 34, this.hpLabel(u), { fontSize: '11px', color: '#ffffff', backgroundColor: u.side === 'party' ? slotHex(u.participantSlot) : '#00000090', padding: { x: 4, y: 2 } }).setOrigin(0.5, 0).setDepth(10);

    body.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (u.side === 'wild') void this.onWildClicked(u.unitId);
      else if (u.side === 'party') this.onPartyUnitClicked(u.unitId);
    });
    return { container, hpText, selectRing };
  }

  // snapshot의 모든 상태(위치·HP·기절·선택)를 화면에 맞춘다 — 애니메이션 뒤에 항상 이걸로 서버 상태와 일치시킨다
  private syncFromSnapshot() {
    for (const u of this.snap.units) {
      let view = this.views.get(u.unitId);
      if (!view) {
        view = this.createView(u);
        this.views.set(u.unitId, view);
      }
      const { x, y } = this.tileToWorld(u.col, u.row);
      view.container.setPosition(x, y).setAlpha(u.stunned || u.inactive ? 0.4 : 1).setVisible(!u.fled);
      view.hpText.setPosition(x, y + 34).setText(this.hpLabel(u)).setAlpha(u.stunned || u.inactive ? 0.6 : 1).setVisible(!u.fled);
    }
    this.drawBlocked(this.snap.blocked ?? []);
    if (this.snap.round !== this.lastRound) {
      this.doneUnits.clear();
      this.lastRound = this.snap.round;
    }
    this.ensureSelection();
    this.refreshSelectionRings();
    this.updateStatusText();
    this.renderChips();
    this.showMoveHighlights();
    this.checkRemoved();
  }

  // 45초 유예가 지나 전투에서 제외된 경우(다시 접속해도 기존 전투·보상 자격은 돌아오지 않는다) 안내하고 지역 선택으로 돌아간다
  private checkRemoved() {
    const me = this.snap.participants.find((p) => p.playerId === this.myId);
    if (this.resultShown || this.snap.phase === 'resolved' || !me || me.active || this.leavingRemoved) return;
    this.leavingRemoved = true;
    const why = me.leftReason === 'timeout' ? '접속이 오래 끊겨 전투에서 제외되었어요.' : '전투에서 빠졌어요.';
    showToast(this, why, { y: 660, error: true });
    this.time.delayedCall(1800, () => this.scene.start(roomClient.room ? 'Map' : 'StageSelect', { stageCode: this.initData.stageCode, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices }));
  }

  // ---------- 상태 조회 ----------

  // 전투를 떠날 때 갈 곳: 스토리 전투는 부른 화면(returnTo)으로 결과와 함께, 그 밖에는 기존처럼 맵
  private exitTo(outcome: BattleEnded['outcome'] | 'cancelled', capturedIndices = this.initData.capturedIndices) {
    const end = this.snap.story ? { encounterKey: this.snap.story.encounterKey, outcome } : null;
    const d = returnDestination(this.initData.returnTo, { scene: 'Map', data: { stageCode: this.initData.stageCode, capturedIndices, removedIndices: this.initData.removedIndices } }, end);
    this.scene.start(d.scene, d.data);
  }

  private get myId() {
    return roomClient.playerId;
  }

  private get isMyTurn() {
    return this.snap.phase === 'player_subturn' && this.snap.currentPlayerId === this.myId;
  }

  private myUnits() {
    return this.snap.units.filter((u) => u.side === 'party' && u.ownerPlayerId === this.myId);
  }

  private unit(id: string | null) {
    return this.snap.units.find((u) => u.unitId === id);
  }

  private get wildUnit() {
    return this.snap.units.find((u) => u.side === 'wild')!;
  }

  private actionable(u: BattleUnit) {
    return !u.stunned && !u.inactive && u.ap > 0;
  }

  private ensureSelection() {
    const current = this.unit(this.selectedUnitId);
    if (current && current.ownerPlayerId === this.myId && this.actionable(current) && !this.doneUnits.has(current.unitId)) return;
    const next = this.myUnits().find((u) => this.actionable(u) && !this.doneUnits.has(u.unitId)) ?? this.myUnits().find((u) => this.actionable(u));
    this.selectedUnitId = next?.unitId ?? null;
  }

  private refreshSelectionRings() {
    for (const [id, view] of this.views) view.selectRing.setStrokeStyle(3, 0x9fe58a, id === this.selectedUnitId && this.isMyTurn ? 1 : 0);
  }

  private updateStatusText() {
    if (!this.statusText) return;
    const multi = this.snap.participants.filter((p) => p.active).length > 1;
    const left = this.snap.expiresAt ? ` · ${Math.max(0, Math.ceil((this.snap.expiresAt - roomClient.now()) / 1000))}초` : '';
    const round = multi ? `라운드 ${this.snap.round} · ` : '';
    const who = this.snap.participants.find((p) => p.playerId === this.snap.currentPlayerId);
    this.band?.setFillStyle(who ? slotNum(who.slot) : 0x000000, who ? 1 : 0);
    let hint = '';
    if (this.snap.phase === 'resolved') {
      this.statusText.setText('');
    } else if (this.snap.phase === 'wild_turn') {
      this.statusText.setText(`${round}야생 터비 차례...`);
    } else if (this.isMyTurn) {
      const u = this.unit(this.selectedUnitId);
      this.statusText.setText(`${round}내 차례${left}`);
      hint = u ? `${u.name}: 이동할 칸/다른 유닛 선택, 더 할 게 없으면 자신을 눌러 다음 유닛으로` : '행동할 수 있는 유닛이 없습니다. 턴 종료를 눌러주세요';
    } else {
      this.statusText.setText(who ? `${round}${who.nickname}님의 차례${left}` : round.trim());
    }
    this.hintText?.setText(hint).setVisible(hint.length > 0);
  }

  // 참전자 칩(화면 6): 슬롯색·닉네임·남은 활성 유닛 수, 연결이 끊기면(away) 알파 0.55, 이탈한 사람은 회색
  private renderChips() {
    this.chipObjs.forEach((c) => c.destroy());
    this.chipObjs = [];
    const list = this.snap.participants;
    if (list.filter((p) => p.active).length <= 1 && list.length <= 1) return; // 혼자면 표시하지 않는다
    list.forEach((p, i) => {
      const x = 8;
      const y = 60 + i * 52;
      const dim = !p.active ? 0.35 : !p.connected ? 0.55 : 1;
      const live = this.snap.units.filter((u) => u.ownerPlayerId === p.playerId && !u.stunned && !u.inactive).length;
      const current = p.playerId === this.snap.currentPlayerId;
      const sub = Phaser.Display.Color.HexStringToColor(coopSlots.find((q) => q.slot === p.slot)?.sub ?? '#FFF4DF').color;
      const frame = feltPanel(this, x, y, 148, 46, { image: 'participant-chip', tint: sub, fill: 0x241a3d, stroke: slotNum(p.slot), radius: 12, strokeW: current ? 4 : 2, fit: 'width' });
      (frame as Phaser.GameObjects.Image).setAlpha(dim).setDepth(2000);
      this.chipObjs.push(frame);
      if (current) this.chipObjs.push(this.add.rectangle(x, y, 148, 46).setOrigin(0, 0).setStrokeStyle(4, slotNum(p.slot), 1).setDepth(2001));
      this.chipObjs.push(this.add.circle(x + 16, y + 15, 5, slotNum(p.slot)).setAlpha(dim).setDepth(2001));
      const nick = p.nickname.length > 7 ? `${p.nickname.slice(0, 6)}…` : p.nickname;
      this.chipObjs.push(this.add.text(x + 28, y + 6, `${nick}${p.playerId === this.myId ? ' (나)' : ''}`, { fontSize: '12px', color: TEXT.body }).setAlpha(dim).setDepth(2001));
      const state = !p.active ? '이탈' : !p.connected ? '접속 끊김' : `남은 유닛 ${live}`;
      this.chipObjs.push(this.add.text(x + 28, y + 25, state, { fontSize: '11px', color: !p.connected && p.active ? TEXT.error : TEXT.sub }).setAlpha(dim).setDepth(2001));
      if (!p.connected && p.active && this.textures.exists('status-away')) this.chipObjs.push(this.add.image(x + 130, y + 23, 'status-away').setDisplaySize(24, 24).setDepth(2002));
    });
  }

  private clearHighlights() {
    this.moveHighlights.forEach((h) => h.destroy());
    this.moveHighlights = [];
  }

  private showMoveHighlights() {
    this.clearHighlights();
    const unit = this.unit(this.selectedUnitId);
    if (this.busy || !this.isMyTurn || !unit || !this.actionable(unit)) return;
    // 막힌 칸 우회·속박 감소량까지 반영한 서버와 같은 이동 규칙(최종 판정은 서버)
    for (const { col, row } of reachableCells(this.snap, unit)) {
      const { x, y } = this.tileToWorld(col, row);
      const rect = this.add
        .rectangle(x, y, BATTLE_TILE_SIZE - 6, BATTLE_TILE_SIZE - 6, 0x9fe58a, 0.22)
        .setStrokeStyle(2, 0x9fe58a, 0.6)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.send({ type: 'move', unitId: unit.unitId, targetCol: col, targetRow: row }));
      this.moveHighlights.push(rect);
    }
  }

  // ---------- 입력(의도 전송) ----------

  private onPartyUnitClicked(unitId: string) {
    const u = this.unit(unitId);
    if (this.busy || !this.isMyTurn || !u || u.ownerPlayerId !== this.myId || u.stunned || u.inactive) return;
    if (unitId === this.selectedUnitId) {
      if (u.ap > 0) this.showExhaustConfirm(u);
      return;
    }
    this.selectedUnitId = unitId;
    this.refreshSelectionRings();
    this.updateStatusText();
    this.showMoveHighlights();
  }

  private async onWildClicked(targetId: string) {
    const u = this.unit(this.selectedUnitId);
    const target = this.unit(targetId);
    if (this.busy || !this.isMyTurn || !u || !this.actionable(u) || !target) return;
    const st = targetState(this.snap, target);
    if (st === 'not_target') return;
    if (st !== 'ok') {
      showToast(this, TARGET_HINT[st], { y: 660 }); // 부위 순서·중심부 보호 — 서버도 같은 규칙(PART_ORDER/TARGET_PROTECTED)
      return;
    }
    if (Math.abs(u.col - target.col) + Math.abs(u.row - target.row) !== 1) return;
    await this.send({ type: 'attack', unitId: u.unitId, targetUnitId: target.unitId });
  }

  private async endTurn() {
    if (this.busy || !this.isMyTurn) return;
    await this.send({ type: 'end' });
  }

  // 유닛 하나의 행동을 마치고 다음 유닛으로 — 서버는 유닛 전환이 자유라 이건 선택 표시만 바꾼다. 남은 유닛이 없으면 턴을 끝낸다.
  private showExhaustConfirm(unit: BattleUnit) {
    this.clearHighlights();
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;
    const layer: Phaser.GameObjects.GameObject[] = [];
    const close = () => layer.forEach((o) => o.destroy());

    layer.push(this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.5).setDepth(3999).setInteractive());
    layer.push(this.add.rectangle(cx, cy, 340, 160, 0x241a3d, 0.97).setStrokeStyle(3, 0x5a3a8a).setDepth(4000));
    layer.push(this.add.text(cx, cy - 40, `남은 기력 ${unit.ap}을(를) 남기고\n다음 유닛으로 넘기시겠습니까?`, { fontSize: '14px', color: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(4001));
    layer.push(
      this.add
        .text(cx - 60, cy + 40, '예', { fontSize: '16px', color: '#ffffff', backgroundColor: '#4a7a3a', padding: { x: 20, y: 8 } })
        .setOrigin(0.5)
        .setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          close();
          this.doneUnits.add(unit.unitId);
          const next = this.myUnits().find((u) => this.actionable(u) && !this.doneUnits.has(u.unitId));
          if (!next) {
            void this.endTurn();
            return;
          }
          this.selectedUnitId = next.unitId;
          this.refreshSelectionRings();
          this.updateStatusText();
          this.showMoveHighlights();
        }),
    );
    layer.push(
      this.add
        .text(cx + 60, cy + 40, '아니오', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 20, y: 8 } })
        .setOrigin(0.5)
        .setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          close();
          this.showMoveHighlights();
        }),
    );
  }

  // 서버에 행동을 보내고 결과를 재생한다. 네트워크 오류는 같은 actionId로 재전송한다(서버가 중복이면 최초 응답을 돌려줌).
  private async send(body: ActionBody) {
    if (this.busy) return;
    this.busy = true;
    this.clearHighlights();
    const actionId = crypto.randomUUID();
    const version = this.snap.version;
    try {
      let res: BattleResponse | null = null;
      for (let attempt = 0; attempt <= RETRY_LIMIT && !res; attempt++) {
        try {
          res = await battleClient.action(this.snap.battleId, version, body, actionId);
        } catch (err) {
          if (err instanceof RoomApiError) throw err;
          if (attempt === RETRY_LIMIT) throw err;
          showToast(this, '연결이 불안정해요. 다시 시도하는 중...', { y: 660, error: true });
          await wait(this, 1000);
        }
      }
      await this.playResponse(res!);
    } catch (err) {
      await this.handleError(err);
    } finally {
      this.busy = false;
      this.syncFromSnapshot();
      this.drainQueued();
    }
  }

  private async handleError(err: unknown) {
    if (!(err instanceof RoomApiError)) {
      showToast(this, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', { y: 660, error: true });
      return;
    }
    if (err.code === 'STATE_MISMATCH' && err.snapshot) {
      this.snap = err.snapshot; // 서버 상태가 기준 — 최신으로 맞춘다
      showToast(this, '전투 상태가 달라져 화면을 맞췄어요.', { y: 660 });
    } else if (err.code === 'BATTLE_EXPIRED' || err.code === 'NOT_PARTICIPANT') {
      showToast(this, '전투가 사라졌어요. 지역 선택으로 돌아갑니다.', { y: 660, error: true });
      this.time.delayedCall(1800, () => this.scene.start('StageSelect'));
    } else if (err.code === 'BATTLE_RESOLVED') {
      const res = await battleClient.snapshot(this.snap.battleId).catch(() => null);
      if (res) await this.playResponse(res);
    } else {
      showToast(this, err.message, { y: 660, error: true });
    }
  }

  private async resync() {
    if (this.busy || this.resultShown) return;
    try {
      const res = await battleClient.snapshot(this.snap.battleId);
      if (res.version >= this.snap.version) {
        this.snap = res.snapshot;
        this.syncFromSnapshot();
        if (this.snap.phase === 'resolved') await this.showResult(res.ended);
      }
    } catch (err) {
      if (err instanceof RoomApiError && ['BATTLE_EXPIRED', 'NOT_PARTICIPANT'].includes(err.code)) await this.handleError(err);
    }
  }

  // 전투 도중 나가기: 보상 자격이 없어지고(남은 참전자는 계속 진행) 맵으로 돌아간다
  private confirmLeave() {
    if (this.leaveLayer.length > 0 || this.resultShown) return;
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;
    const close = () => {
      this.leaveLayer.forEach((o) => o.destroy());
      this.leaveLayer = [];
    };
    this.leaveLayer.push(this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 0.5).setDepth(3999).setInteractive());
    this.leaveLayer.push(this.add.rectangle(cx, cy, 380, 170, 0x241a3d, 0.97).setStrokeStyle(3, 0x6a3a3a).setDepth(4000));
    const leaveText = isStoryBattle(this.snap) ? '전투에서 나가시겠어요?\n전투 직전부터 다시 도전하게 돼요.' : '전투에서 나가시겠어요?\n나가면 이번 전투의 보상을 받을 수 없어요.';
    this.leaveLayer.push(this.add.text(cx, cy - 40, leaveText, { fontSize: '14px', color: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(4001));
    this.leaveLayer.push(
      this.add
        .text(cx - 70, cy + 45, '나가기', { fontSize: '16px', color: '#ffffff', backgroundColor: '#8a3a3a', padding: { x: 18, y: 8 } })
        .setOrigin(0.5)
        .setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', async () => {
          close();
          try {
            await battleClient.leave(this.snap.battleId);
          } catch (err) {
            console.warn('[battle] 나가기 요청 실패:', err);
          }
          this.exitTo('cancelled');
        }),
    );
    this.leaveLayer.push(
      this.add
        .text(cx + 70, cy + 45, '계속 싸우기', { fontSize: '16px', color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 14, y: 8 } })
        .setOrigin(0.5)
        .setDepth(4001)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', close),
    );
  }

  // ---------- 서버 결과 재생 ----------

  private async onServerUpdate(update: BattleUpdate) {
    if (update.battleId !== this.snap.battleId || update.version <= this.snap.version || this.resultShown) return;
    if (this.busy) {
      // 내 요청·재생 중에 온 알림은 끝난 뒤에 처리한다(중간 알림을 놓쳐도 최신 snapshot이 기준이라 상태는 맞는다)
      if (!this.queuedUpdate || update.version > this.queuedUpdate.version) this.queuedUpdate = update;
      return;
    }
    this.busy = true;
    try {
      await this.playResponse(update);
    } finally {
      this.busy = false;
      this.syncFromSnapshot();
      this.drainQueued();
    }
  }

  private drainQueued() {
    const next = this.queuedUpdate;
    this.queuedUpdate = null;
    if (next) void this.onServerUpdate(next);
  }

  private async playResponse(res: BattleResponse) {
    if (res.version < this.snap.version) return; // 오래된 응답은 무시
    for (const ev of res.events) if (ev.version > this.snap.version) await this.playEvent(ev);
    this.snap = res.snapshot;
    this.syncFromSnapshot();
    if (this.snap.phase === 'resolved') await this.showResult(res.ended);
  }

  private async playEvent(ev: BattleEvent) {
    if (ev.type === 'move') {
      const view = this.views.get(ev.unitId);
      if (view) {
        const { x, y } = this.tileToWorld(ev.toCol, ev.toRow);
        this.tweens.add({ targets: view.container, x, y, duration: 140 });
        this.tweens.add({ targets: view.hpText, x, y: y + 34, duration: 140 });
        await wait(this, ev.unitId === 'wild' ? 400 : 170);
      }
    } else if (ev.type === 'attack') {
      const target = this.views.get(ev.targetId);
      const targetUnit = this.unit(ev.targetId);
      if (target && targetUnit) {
        target.hpText.setText(`${targetUnit.name} HP ${ev.targetHp}/${targetUnit.maxHp}${ev.targetStunned ? ' (기절)' : ''}`);
        target.container.setAlpha(ev.targetStunned ? 0.4 : 1);
        this.tweens.add({ targets: target.container, scale: 1.25, duration: 100, yoyo: true });
        await wait(this, ev.attackerId === 'wild' ? 400 : 250);
      }
    } else if (ev.type === 'unit_exit') {
      const view = this.views.get(ev.unitId);
      if (view) {
        this.tweens.add({ targets: [view.container, view.hpText], alpha: 0, duration: 300 });
        await wait(this, 320);
      }
    } else if (ev.type === 'part_broken') {
      showToast(this, ev.coreExposed ? '바깥 부위를 모두 끊었어요! 이제 중심을 노릴 수 있어요' : '부위 하나를 끊었어요', { y: 660 });
      await wait(this, 250);
    } else if (ev.type === 'terrain') {
      this.drawBlocked(ev.blocked);
      await wait(this, 200);
    } else if (ev.type === 'subturn' && ev.phase === 'wild_turn') {
      this.statusText.setText('야생 터비 차례...');
      await wait(this, 500);
    }
  }

  // ---------- 결과 ----------

  private async showResult(endedIn: BattleEnded | null) {
    if (this.resultShown) return;
    this.resultShown = true;
    this.clearHighlights();

    // 새로고침 뒤 종료 상태로 들어오면 종료 응답(보상)이 없으므로 서버에서 다시 받는다
    let ended = endedIn;
    if (!ended) ended = (await battleClient.snapshot(this.snap.battleId).catch(() => null))?.ended ?? null;
    this.resultEnded = ended;
    this.renderResult();
    if (!ended || !ended.settled) void this.autoSettle();
  }

  // 보상 기록이 아직 확정되지 않았을 때(settled:false) 제한된 지수 백오프로 서버에 다시 확인한다.
  // settled:true가 되기 전에는 보상 완료 문구를 보여주지 않는다. 자동 재시도 뒤에도 안 되면 '다시 확인' 버튼을 준다.
  private async autoSettle() {
    this.settleGaveUp = false;
    for (const delay of [1000, 2000, 4000, 8000]) {
      await wait(this, delay);
      if (!this.scene.isActive()) return;
      const res = await battleClient.snapshot(this.snap.battleId).catch(() => null);
      if (res?.ended?.settled) {
        this.resultEnded = res.ended;
        this.renderResult();
        return;
      }
    }
    this.settleGaveUp = true;
    this.renderResult();
  }

  private renderResult() {
    this.resultObjs.forEach((o) => o.destroy());
    this.resultObjs = [];
    const track = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.resultObjs.push(o);
      return o;
    };
    const ended = this.resultEnded;
    const outcome = this.snap.outcome ?? 'cancelled';
    const settled = !!ended && ended.settled;
    const mine = ended?.rewards.find((r) => r.playerId === this.myId);
    if (settled && mine?.capturedTurby) inventory.addFromServer(mine.capturedTurby); // 3.2: 서버가 지급한 포획 터비를 보유 목록에 반영(같은 id는 중복 추가되지 않음)
    const wild = this.wildUnit;
    const story = isStoryBattle(this.snap);

    const TITLES = story ? { ...storyResultText(outcome), color: outcome === 'win' ? '#8A6B2A' : '#5E7FA8' } : {
      win: { title: '포획 성공!', color: '#8A6B2A', sub: `${withIGa(wild.name)} 가방에 들어왔어요`, btn: '가방에 넣고 돌아가기' },
      lose: { title: '야생 터비가 도망쳤어요', color: '#B85C70', sub: '다음 기회에 다시 도전해보세요', btn: '맵으로 돌아가기' },
      draw: { title: '무승부 — 퇴각', color: '#5E7FA8', sub: '같은 자리에서 다시 도전할 수 있어요', btn: '맵으로 돌아가기' },
      cancelled: { title: '전투가 취소됐어요', color: '#5E7FA8', sub: '같은 자리에서 다시 도전할 수 있어요', btn: '맵으로 돌아가기' },
    }[outcome];
    const won = outcome === 'win';
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;

    track(this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x4a3a44, 0.68).setDepth(2999).setInteractive());
    asDepth(track(feltPanel(this, cx - 400, cy - 270, 800, 540, { radius: 30, strokeW: 6, image: 'result-panel' })), 3000);
    track(this.add.text(cx, cy - 178, TITLES.title, { fontSize: '28px', color: TITLES.color }).setOrigin(0.5).setDepth(3001));
    if (!story && this.textures.exists(`turby-${wild.characterCode}`)) track(this.add.image(cx, cy - 112, `turby-${wild.characterCode}`).setDisplaySize(80, 80).setDepth(3001));
    const sub = story ? (won && !settled ? '이야기 진행을 저장하는 중이에요...' : TITLES.sub) : won && !settled ? '보상을 확인하는 중이에요...' : won && !mine?.capturedTurby ? '이번에는 보상이 없어요' : TITLES.sub;
    track(this.add.text(cx, cy - 56, sub, { fontSize: '15px', color: TEXT.sub }).setOrigin(0.5).setDepth(3001));

    // 참가자별 보상 행(파티를 확정한 참가자, 최대 5명). 확정 전에는 '확인 중'만 보여준다.
    const rows = story ? [] : this.snap.participants.filter((p) => p.partySubmitted); // 스토리 전투는 포획·야생 보상 행이 없다
    const reasonText = (r: string | null | undefined) => (r === 'left' ? '이탈 — 보상 없음' : r === 'timeout' ? '접속 만료 — 보상 없음' : r === 'party_timeout' ? '참전 취소' : '보상 없음');
    rows.forEach((p, i) => {
      const y = cy - 14 + i * 42;
      const reward = ended?.rewards.find((r) => r.playerId === p.playerId);
      const rowTint = Phaser.Display.Color.HexStringToColor(coopSlots.find((q) => q.slot === p.slot)?.sub ?? '#FFF4DF').color;
      asDepth(track(feltPanel(this, cx - 340, y - 22, 680, 46, { radius: 16, image: 'reward-row', tint: rowTint, fit: 'width' })), 3001);
      track(this.add.circle(cx - 316, y, 7, slotNum(p.slot)).setDepth(3002));
      const nick = p.nickname.length > 10 ? `${p.nickname.slice(0, 9)}…` : p.nickname;
      track(this.add.text(cx - 296, y, `${nick}${p.playerId === this.myId ? ' (나)' : ''}`, { fontSize: '16px', color: TEXT.body }).setOrigin(0, 0.5).setDepth(3002));
      const granted = settled && reward?.rewardStatus === 'granted';
      const label = !settled ? '확인 중...' : granted ? `${reward?.capturedTurby?.characterName ?? '터비'} 획득` : reasonText(reward?.reason ?? p.leftReason);
      track(this.add.text(cx + 316, y, label, { fontSize: '15px', color: granted ? TEXT.onMint : TEXT.sub }).setOrigin(1, 0.5).setDepth(3002));
    });

    // 버튼: 확정 전에는 '보상 확인 중', 자동 재시도 뒤에도 안 되면 '다시 확인', 확정되면 돌아가기
    const by = cy + 188;
    if (!settled && !this.settleGaveUp) {
      track(pillButton(this, cx, by, 260, 48, story ? '저장 중...' : '보상 확인 중...', 'disabled', () => undefined)).setDepth(3002);
    } else if (!settled) {
      track(
        pillButton(this, cx, by, 240, 48, '다시 확인', 'primary', () => {
          this.renderResult();
          void this.autoSettle();
        }),
      ).setDepth(3002);
    } else {
      track(
        pillButton(this, cx, by, 300, 48, TITLES.btn, 'primary', () => {
          // 3.4: 승리=포획(재등장 안 함) / 패배=야생 도주 / 무승부·취소=재도전 가능 — 마커 상태는 서버가 소유하고 방송한다
          const spawnIndex = this.snap.spawnIndex;
          const capturedIndices = won && !story ? [...this.initData.capturedIndices, spawnIndex] : this.initData.capturedIndices;
          this.exitTo(outcome, capturedIndices);
        }),
      ).setDepth(3002);
    }
  }
}
