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
import { actionHint, battleHudLayout, clampLabel, goalSummary, resultLayout, unitLabel, type BattleHudLayout } from '../battle/battleView';
import { watchLayout } from '../ui/relayout';
import { displayScaleOf } from '../ui/responsive';
import { ackFailureAllowsExit, RESULT_ACK_RETRY_TEXT } from '../state/restoreAttempt';
import { isStoryBattle, labelPlacement, objectiveLines, reachableCells, returnDestination, showsCornerEscape, storyResultText, targetState, STORY_BADGE, STORY_NOTICE, TARGET_HINT, type BattleReturn } from '../battle/battleView';

interface BattleInitData {
  stageCode: string;
  capturedIndices: number[];
  removedIndices: number[];
  snapshot: BattleSnapshot; // 서버가 내려준 전투 상태(파티 확정 직후 또는 새로고침 복구)
  returnTo?: BattleReturn; // 스토리 전투: 끝나면 돌아갈 화면(결과를 storyBattleEnd로 넘긴다)
  keep?: { goalOpen: boolean; selectedUnitId: string | null; doneUnits: string[]; lastRound: number; ended: BattleEnded | null; settleGaveUp: boolean }; // 창 크기 변경으로 다시 배치할 때 이어받는 화면 상태(v5 §4)
}

interface UnitView {
  container: Phaser.GameObjects.Container;
  hpText: Phaser.GameObjects.Text;
  selectRing: Phaser.GameObjects.Arc;
}

const RETRY_LIMIT = 3;
const LABEL_GAP = 30; // 유닛 중심에서 라벨까지
const LABEL_WRAP = BATTLE_TILE_SIZE * 2 - 12; // 이웃 라벨은 반대편에 있으므로 두 칸 폭까지 쓸 수 있다
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
  private hud!: BattleHudLayout;
  private goalLayer: Phaser.GameObjects.GameObject[] = [];
  private goalOpen = false;
  private blockedDrawn = '';
  private generation = 0; // 다시 배치(재시작)할 때마다 증가 — 이전 화면의 자동 재확인 루프를 멈춘다
  private relayoutPending = false;
  private goalButtonText?: Phaser.GameObjects.Text;

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
    this.generation++;
    this.relayoutPending = false;
    const k = data.keep;
    if (k) {
      this.selectedUnitId = k.selectedUnitId;
      this.doneUnits = new Set(k.doneUnits);
      this.lastRound = k.lastRound;
      this.resultEnded = k.ended;
      this.settleGaveUp = k.settleGaveUp;
    }
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

    // v3 §5: 실제 표시 배율에 맞춘 글자(턴 > 행동 안내 > 목표 순으로 크게)
    this.hud = battleHudLayout(displayScaleOf(this.scale.displaySize.width), BATTLE_TILE_SIZE);
    this.goalLayer = [];
    this.goalOpen = false;
    this.goalButtonText = undefined;
    const F = this.hud.font;
    // 화면 6 상단 턴 패널(라운드·현재 서브턴·남은 시간). 조작 안내는 화면 아래쪽 한 줄로 따로 둔다.
    // 턴 표시: 보통 화면은 가운데, 작은 화면은 목표 버튼과 턴 종료 사이 영역 가운데(누르는 영역과 겹치지 않게)
    const T = this.hud.rects.turn;
    const turnCx = this.hud.mode === 'compact' ? T.x + T.w / 2 : CANVAS_WIDTH / 2;
    if (this.textures.exists('turn-panel')) this.add.image(turnCx, 26, 'turn-panel').setDisplaySize(this.hud.mode === 'compact' ? T.w : 520, 76).setDepth(1998);
    this.statusText = this.add
      .text(turnCx, 24, '', { fontSize: `${F.status}px`, color: this.textures.exists('turn-panel') ? TEXT.body : '#ffe9a8' })
      .setOrigin(0.5)
      .setDepth(2000);
    const R = this.hud.rects;
    // 하단 안내: 나가기 버튼 오른쪽 남은 폭 안에서 한 줄(잘리거나 버튼과 겹치지 않게)
    this.hintText = this.add
      .text(R.hint.x + R.hint.w / 2, R.hint.y + R.hint.h / 2, '', { fontSize: `${F.hint}px`, color: '#e4dcff', backgroundColor: '#000000a0', padding: { x: 10, y: 4 }, align: 'center', fixedWidth: 0 })
      .setOrigin(0.5)
      .setDepth(2000);
    this.add
      .text(R.endTurn.x + R.endTurn.w / 2, R.endTurn.y + R.endTurn.h / 2, '턴 종료', { fontSize: `${F.button}px`, color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 12, y: 8 } })
      .setOrigin(0.5)
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
      .text(R.leave.x, R.leave.y + R.leave.h / 2, '전투 나가기', { fontSize: `${F.button}px`, color: '#ffffff', backgroundColor: '#6a3a3a', padding: { x: 10, y: 6 } })
      .setOrigin(0, 0.5)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.confirmLeave());
    this.time.addEvent({ delay: 250, loop: true, callback: () => {
      this.updateStatusText();
      if (this.relayoutPending) this.relayout();
    } });
    this.renderStoryPanel();
    if (this.initData.keep?.goalOpen && this.hud.objectivesCollapsible) this.toggleGoals();

    this.syncFromSnapshot();
    if (this.snap.phase === 'resolved') void this.showResult(this.initData.keep?.ended ?? null);
    watchLayout(this, () => this.relayout());
  }

  // 표시 배율이 바뀌면 새 배율의 HUD·라벨·결과창으로 다시 그린다(서버 상태는 최신 snapshot 그대로).
  // 행동 요청·재생 중이면 끝난 뒤에 한다(응답을 잃지 않게)
  private relayout() {
    if (this.busy || this.queuedUpdate) {
      this.relayoutPending = true;
      return;
    }
    this.relayoutPending = false;
    // 보통 배치는 목표가 늘 펼쳐져 있어 열림 상태가 없다 — 작은 배치에서 마지막으로 고른 상태를 그대로 넘긴다
    const goalOpen = this.hud.objectivesCollapsible ? this.goalOpen : (this.initData.keep?.goalOpen ?? false);
    const keep = { goalOpen, selectedUnitId: this.selectedUnitId, doneUnits: [...this.doneUnits], lastRound: this.lastRound, ended: this.resultEnded, settleGaveUp: this.settleGaveUp };
    this.scene.restart({ ...this.initData, snapshot: this.snap, keep });
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

  // 이웃과 엇갈리게(labelPlacement) 두되, 격자 안으로 끌어온다(맨 윗줄은 아래로, 맨 아랫줄은 위로 — 목표 패널·화면 밖으로 넘지 않게)
  private placeLabel(t: Phaser.GameObjects.Text, u: BattleUnit, x: number, y: number) {
    let above = labelPlacement(this.snap, u) === 'above';
    if (u.row === 0) above = false;
    if (u.row === this.snap.grid.rows - 1) above = true;
    const top = above ? y - LABEL_GAP - t.height : y + LABEL_GAP;
    const c = clampLabel(x, top, t.width, t.height, { x: this.offsetX, y: this.offsetY, w: this.gridW, h: this.gridH });
    t.setOrigin(0.5, 0).setPosition(c.cx, c.top);
  }

  private hpLabel(u: BattleUnit) {
    return unitLabel(u, this.hud?.mode === 'compact');
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

  // 스토리 전투 표식·현재 목표·보상 없음 안내. 보통 화면: 격자 왼쪽 여백에 세로 패널. 작은 화면: "목표" 버튼으로 접고 펼친다(v3 §5)
  private renderStoryPanel() {
    if (!isStoryBattle(this.snap)) return;
    const F = this.hud.font;
    if (!this.hud.objectivesCollapsible) {
      const x = 8;
      const w = Math.max(120, this.offsetX - 16);
      const wrap = { width: w - 16, useAdvancedWrap: true };
      const badge = this.add.text(x + 8, 68, STORY_BADGE, { fontSize: `${F.panelTitle}px`, color: '#ffd27f' }).setDepth(2001);
      const goals = this.add.text(x + 8, badge.y + badge.height + 10, objectiveLines(this.snap).map((l) => `· ${l}`).join('\n'), { fontSize: `${F.panel}px`, color: '#ffffff', lineSpacing: 6, wordWrap: wrap }).setDepth(2001);
      const notice = this.add.text(x + 8, goals.y + goals.height + 12, STORY_NOTICE, { fontSize: `${F.panel}px`, color: '#cfc6ee', wordWrap: wrap }).setDepth(2001);
      this.add.rectangle(x, 58, w, notice.y + notice.height + 10 - 58, 0x241a3d, 0.92).setOrigin(0, 0).setStrokeStyle(2, 0xffd27f, 0.9).setDepth(2000);
      return;
    }
    const gb = this.hud.rects.goalButton!;
    this.goalButtonText = this.add
      .text(gb.x, gb.y + gb.h / 2, goalSummary(objectiveLines(this.snap)), { fontSize: `${F.button}px`, color: '#241a3d', backgroundColor: '#ffd27f', padding: { x: 12, y: 8 }, fixedWidth: gb.w })
      .setOrigin(0, 0.5)
      .setDepth(2002)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleGoals());
  }

  // 작은 화면의 목표 상세(펼침) — 격자 위에 겹쳐 그리고, 요약 버튼(▴)·닫기 버튼·패널을 누르면 접힌다
  private toggleGoals() {
    this.goalLayer.forEach((o) => o.destroy());
    this.goalLayer = [];
    this.goalOpen = !this.goalOpen;
    this.goalButtonText?.setText(goalSummary(objectiveLines(this.snap), this.goalOpen)).setBackgroundColor(this.goalOpen ? '#ffe9b8' : '#ffd27f');
    if (!this.goalOpen) return;
    const F = this.hud.font;
    const P = this.hud.rects.goalPanel!;
    const { x, y, w } = P;
    const C = this.hud.rects.goalClose!;
    const wrap = { width: w - 32, useAdvancedWrap: true };
    const title = this.add.text(x + 16, y + 10, STORY_BADGE, { fontSize: `${F.panelTitle}px`, color: '#ffd27f', wordWrap: { width: C.x - x - 24, useAdvancedWrap: true } }).setDepth(2004);
    // 닫기 버튼: 패널 오른쪽 위 모서리, 제목 줄과 따로 누르는 영역(요약 버튼·턴 종료와 겹치지 않음 — 테스트)
    const close = this.add
      .text(C.x + C.w / 2, C.y + C.h / 2, '닫기 ✕', { fontSize: `${F.button}px`, color: '#241a3d', backgroundColor: '#ffd27f', fixedWidth: C.w, align: 'center', padding: { x: 0, y: Math.max(0, (C.h - F.button * 1.25) / 2) } })
      .setOrigin(0.5)
      .setDepth(2005)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggleGoals());
    const goals = this.add.text(x + 16, Math.max(title.y + title.height, C.y + C.h) + 8, objectiveLines(this.snap).map((l) => `· ${l}`).join('\n'), { fontSize: `${F.panel}px`, color: '#ffffff', lineSpacing: 6, wordWrap: wrap }).setDepth(2004);
    const notice = this.add.text(x + 16, goals.y + goals.height + 8, STORY_NOTICE, { fontSize: `${F.panel}px`, color: '#cfc6ee', wordWrap: wrap }).setDepth(2004);
    // 오른쪽 위에 반투명으로(아군이 시작하는 왼쪽 전장을 가리지 않게). 패널을 눌러도 접힌다
    const bg = this.add.rectangle(x, y, w, Math.min(P.h, notice.y + notice.height + 12 - y), 0x241a3d, 0.88).setOrigin(0, 0).setStrokeStyle(3, 0xffd27f, 1).setDepth(2003).setInteractive().on('pointerdown', () => this.toggleGoals());
    this.goalLayer.push(title, close);
    this.goalLayer.push(bg, goals, notice);
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
    // 라벨은 줄이지 않고 두 칸 폭 안에서 줄바꿈(이웃 라벨은 위·아래로 엇갈려 겹치지 않음 — labelPlacement)
    const hpText = this.add.text(x, y + LABEL_GAP, this.hpLabel(u), { fontSize: `${this.hud.font.label}px`, color: '#ffffff', align: 'center', wordWrap: { width: LABEL_WRAP, useAdvancedWrap: true }, backgroundColor: u.side === 'party' ? slotHex(u.participantSlot) : '#00000090', padding: { x: 4, y: 2 } }).setOrigin(0.5, 0).setDepth(11);

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
      view.hpText.setText(this.hpLabel(u)).setAlpha(u.stunned || u.inactive ? 0.6 : 1).setVisible(!u.fled);
      // 쓰러진·이탈한 유닛의 그림은 입력을 받지 않는다 — 그 칸으로 이동하려는 누름이 그림에 가로막히지 않게(부서진 거대 매듭의 실 칸 등)
      for (const o of view.container.list) if (o.input) o.input.enabled = !(u.stunned || u.inactive);
      this.placeLabel(view.hpText, u, x, y);
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
    // 스토리 전투는 불러낸 대화 화면으로(재도전) — 대화가 잠든 채로 남지 않게
    this.time.delayedCall(1800, () => (this.initData.returnTo ? this.exitTo('cancelled') : this.scene.start(roomClient.room ? 'Map' : 'StageSelect', { stageCode: this.initData.stageCode, capturedIndices: this.initData.capturedIndices, removedIndices: this.initData.removedIndices })));
  }

  // ---------- 상태 조회 ----------

  // 전투를 떠날 때 갈 곳: 스토리 전투는 부른 화면(returnTo)으로 결과와 함께, 그 밖에는 기존처럼 맵
  private exitTo(outcome: BattleEnded['outcome'] | 'cancelled', capturedIndices = this.initData.capturedIndices) {
    const end = this.snap.story ? { encounterKey: this.snap.story.encounterKey, outcome } : null;
    const d = returnDestination(this.initData.returnTo, { scene: 'Map', data: { stageCode: this.initData.stageCode, capturedIndices, removedIndices: this.initData.removedIndices } }, end);
    // 결과 화면이 탐험 방이 없는 상태(새 활동 거부로 방을 이미 나온 경우)에서 열렸다면 맵이 아니라 마을로 — 맵은 탐험 세션이 있어야 한다
    if (d.mode !== 'wake' && d.scene === 'Map' && !roomClient.room) return void this.scene.start('Village');
    if (d.mode === 'wake') {
      this.scene.wake(d.scene, d.data); // 대화 화면이 전투 결과를 받아 같은 위치에서 이어 간다
      this.scene.stop();
    } else this.scene.start(d.scene, d.data);
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
      hint = actionHint(u ? u.name : null, this.hud.mode === 'compact');
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
      this.time.delayedCall(1800, () => (this.initData.returnTo ? this.exitTo('cancelled') : this.scene.start('StageSelect')));
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
        this.tweens.add({ targets: view.hpText, x, y: y + (view.hpText.originY === 0 ? LABEL_GAP : -LABEL_GAP), duration: 140 });
        await wait(this, ev.unitId === 'wild' ? 400 : 170);
      }
    } else if (ev.type === 'attack') {
      const target = this.views.get(ev.targetId);
      const targetUnit = this.unit(ev.targetId);
      if (target && targetUnit) {
        target.hpText.setText(this.hpLabel({ ...targetUnit, hp: ev.targetHp, stunned: ev.targetStunned }));
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
    if ((!ended || !ended.settled) && !this.settleGaveUp) void this.autoSettle();
  }

  // 보상 기록이 아직 확정되지 않았을 때(settled:false) 제한된 지수 백오프로 서버에 다시 확인한다.
  // settled:true가 되기 전에는 보상 완료 문구를 보여주지 않는다. 자동 재시도 뒤에도 안 되면 '다시 확인' 버튼을 준다.
  private async autoSettle() {
    const gen = this.generation;
    this.settleGaveUp = false;
    for (const delay of [1000, 2000, 4000, 8000]) {
      await wait(this, delay);
      if (!this.scene.isActive() || gen !== this.generation) return; // 끝났거나 다시 배치된 화면(새 화면이 이어서 확인)
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

  private resultAcking = false;

  // 결과 확인 요청을 한 번에 하나만 보내고, 성공(또는 서버에서 이미 사라진 전투)이면 나간다. 그 밖의 실패는 화면을 닫지 않는다
  private async confirmResultThenExit(exit: () => void) {
    if (this.resultAcking) return;
    this.resultAcking = true;
    const gen = this.generation;
    try {
      await battleClient.ackResult(this.snap.battleId);
    } catch (err) {
      if (!ackFailureAllowsExit(err instanceof RoomApiError ? err.code : undefined)) {
        this.resultAcking = false;
        if (this.scene.isActive() && gen === this.generation) showToast(this, RESULT_ACK_RETRY_TEXT, { y: 660, error: true, fixed: true });
        return;
      }
    }
    this.resultAcking = false;
    if (!this.scene.isActive() || gen !== this.generation) return; // 기다리는 사이 화면이 바뀜 — 새 화면을 덮지 않는다
    exit();
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
    const rows = story ? [] : this.snap.participants.filter((p) => p.partySubmitted); // 스토리 전투는 포획·야생 보상 행이 없다
    // v5 §5.1: 표시 배율에 맞춘 결과창(작은 화면은 화면 거의 전체, 제목·그림·핵심 결과·버튼을 크게)
    const RL = resultLayout(displayScaleOf(this.scale.displaySize.width), rows.length, this.textures.exists('result-panel'));
    const P = RL.panel;

    track(this.add.rectangle(cx, cy, CANVAS_WIDTH, CANVAS_HEIGHT, 0x4a3a44, 0.68).setDepth(2999).setInteractive());
    asDepth(track(feltPanel(this, P.x, P.y, P.w, P.h, { radius: 30, strokeW: 6, image: 'result-panel' })), 3000);
    track(this.add.text(cx, RL.titleY, TITLES.title, { fontSize: `${RL.font.title}px`, color: TITLES.color }).setOrigin(0.5).setDepth(3001));
    if (!story && RL.image.size > 0 && this.textures.exists(`turby-${wild.characterCode}`)) track(this.add.image(cx, RL.image.cy, `turby-${wild.characterCode}`).setDisplaySize(RL.image.size, RL.image.size).setDepth(3001));
    const sub = story ? (won && !settled ? '이야기 진행을 저장하는 중이에요...' : TITLES.sub) : won && !settled ? '보상을 확인하는 중이에요...' : won && !mine?.capturedTurby ? '이번에는 보상이 없어요' : TITLES.sub;
    track(this.add.text(cx, RL.subY, sub, { fontSize: `${RL.font.sub}px`, color: TEXT.sub, align: 'center', wordWrap: { width: RL.rows.w, useAdvancedWrap: true } }).setOrigin(0.5).setDepth(3001));

    // 참가자별 보상 행(파티를 확정한 참가자, 최대 5명). 확정 전에는 '확인 중'만 보여준다.
    const reasonText = (r: string | null | undefined) => (r === 'left' ? '이탈 — 보상 없음' : r === 'timeout' ? '접속 만료 — 보상 없음' : r === 'party_timeout' ? '참전 취소' : '보상 없음');
    const R = RL.rows;
    rows.slice(0, 5).forEach((p, i) => {
      const top = R.y0 + i * (R.h + R.gap);
      const y = top + R.h / 2;
      const reward = ended?.rewards.find((r) => r.playerId === p.playerId);
      const rowTint = Phaser.Display.Color.HexStringToColor(coopSlots.find((q) => q.slot === p.slot)?.sub ?? '#FFF4DF').color;
      asDepth(track(feltPanel(this, R.x, top, R.w, R.h, { radius: 16, image: 'reward-row', tint: rowTint, fit: 'width' })), 3001);
      // 행 그림(reward-row): 왼쪽 타원이 이름 자리, 오른쪽 끝에 장식 — 글자가 테두리·장식에 겹치지 않게 폭 비율로 띄운다
      const inL = this.textures.exists('reward-row') ? Math.round(R.w * 0.05) : 24;
      const inR = this.textures.exists('reward-row') ? Math.round(R.w * 0.09) : 24;
      track(this.add.circle(R.x + inL, y, 7, slotNum(p.slot)).setDepth(3002));
      const nick = p.nickname.length > 10 ? `${p.nickname.slice(0, 9)}…` : p.nickname;
      track(this.add.text(R.x + inL + 16, y, `${nick}${p.playerId === this.myId ? ' (나)' : ''}`, { fontSize: `${RL.font.row}px`, color: TEXT.body }).setOrigin(0, 0.5).setDepth(3002));
      const granted = settled && reward?.rewardStatus === 'granted';
      const label = !settled ? '확인 중...' : granted ? `${reward?.capturedTurby?.characterName ?? '터비'} 획득` : reasonText(reward?.reason ?? p.leftReason);
      track(this.add.text(R.x + R.w - inR, y, label, { fontSize: `${RL.font.row}px`, color: granted ? TEXT.onMint : TEXT.sub }).setOrigin(1, 0.5).setDepth(3002));
    });

    // 버튼: 확정 전에는 '보상 확인 중', 자동 재시도 뒤에도 안 되면 '다시 확인', 확정되면 돌아가기
    const B = RL.button;
    const by = B.y + B.h / 2;
    if (!settled && !this.settleGaveUp) {
      track(pillButton(this, cx, by, B.w, B.h, story ? '저장 중...' : '보상 확인 중...', 'disabled', () => undefined, undefined, RL.font.button)).setDepth(3002);
    } else if (!settled) {
      track(
        pillButton(this, cx, by, B.w, B.h, '다시 확인', 'primary', () => {
          this.settleGaveUp = false;
          this.renderResult();
          void this.autoSettle();
        }, undefined, RL.font.button),
      ).setDepth(3002);
    } else {
      track(
        pillButton(this, cx, by, B.w, B.h, TITLES.btn, 'primary', () => {
          // 3.4: 승리=포획(재등장 안 함) / 패배=야생 도주 / 무승부·취소=재도전 가능 — 마커 상태는 서버가 소유하고 방송한다
          const spawnIndex = this.snap.spawnIndex;
          const capturedIndices = won && !story ? [...this.initData.capturedIndices, spawnIndex] : this.initData.capturedIndices;
          // 10-06 v3 §2: 일반 전투는 결과를 확인했다고 서버에 알린 뒤에만 나간다(실패하면 결과 화면을 그대로 두고 다시 누를 수 있다). 스토리 전투는 대화 흐름이 복원한다
          if (story) return this.exitTo(outcome, capturedIndices);
          void this.confirmResultThenExit(() => this.exitTo(outcome, capturedIndices));
        }, undefined, RL.font.button),
      ).setDepth(3002);
    }
  }
}
