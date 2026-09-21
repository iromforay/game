import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { BACKGROUND_TILES } from '../assets/registry';
import { loadWorldImages } from '../assets/loader';
import { roomClient, RoomApiError } from '../net/roomClient';
import type { RoomState, RoomSummary } from '../net/roomClient';
import { getStoryChapters, getChapterStatuses } from '../config/story';
import { inventory } from '../state/inventory';
import { PAL, TEXT, feltPanel, pillButton, creamOverlay, showToast, ellipsize } from '../ui/kit';
import { getStage } from '../config/stages';
import coopSlots from '../data/coop-slots.json';

export type CoopMode = 'create' | 'join' | 'lobby';

interface CoopInitData {
  mode: CoopMode;
  stageCode: string;
  stageName?: string;
}

const PANEL = { x: 180, y: 70, w: 920, h: 560 }; // ui/coop/room-panel.png 규격
const slotNum = (slot: number) => Phaser.Display.Color.HexStringToColor(coopSlots.find((c) => c.slot === slot)?.main ?? '#888888').color;
const domInput = (size: number, width: number, height: number) =>
  `width:${width}px;height:${height}px;font-size:${size}px;box-sizing:border-box;padding:0 20px;background:#FFF4DF;border:4px solid #DCD3F4;border-radius:20px;color:#695B67;outline:none;font-family:inherit;`;

// 화면 2·3(방 만들기·참가·로비). 서버가 방을 소유하므로 이 화면은 요청을 보내고 room:state를 그린다.
export class CoopScene extends Phaser.Scene {
  private mode: CoopMode = 'create';
  private stageCode = 'forest';
  private stageName = '';
  private layer: Phaser.GameObjects.GameObject[] = [];
  private dom: Phaser.GameObjects.DOMElement[] = [];
  private offState: (() => void) | null = null;
  private offReconnect: (() => void) | null = null;
  private lobbyBusy = false;
  private lastHostId: string | null = null;
  private awaySince = new Map<string, number>();
  private lobbyTimer: Phaser.Time.TimerEvent | null = null;
  private lobbyTexts = new Map<string, Phaser.GameObjects.Text>();

  // 방 만들기 폼 상태
  private form = { maxPlayers: 3, visibility: 'private' as 'public' | 'private' };
  private lockedStages = new Set<string>();

  constructor() {
    super('Coop');
  }

  init(data: CoopInitData) {
    this.mode = data.mode;
    this.stageCode = data.stageCode;
    this.stageName = data.stageName ?? '';
    this.layer = [];
    this.dom = [];
    this.lobbyBusy = false;
    this.lastHostId = null;
    this.awaySince = new Map();
    this.lobbyTexts = new Map();
    this.form = { maxPlayers: 3, visibility: 'private' };
  }

  preload() {
    loadWorldImages(this);
    if (!this.textures.exists('bg-village')) this.load.image('bg-village', BACKGROUND_TILES.village);
  }

  async create() {
    this.cameras.main.setBackgroundColor('#F7E9D2');
    this.add.tileSprite(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 'bg-village').setOrigin(0, 0);
    creamOverlay(this, 0.78);

    const statuses = getChapterStatuses(await getStoryChapters(), inventory.getAll());
    this.lockedStages = new Set(statuses.filter((s) => s.state === 'locked').map((s) => s.chapter.stageCode));
    if (!this.stageName) this.stageName = statuses.find((s) => s.chapter.stageCode === this.stageCode)?.stageName ?? this.stageCode;

    // 방 상태 변화(다른 사람의 입장·퇴장·호스트 승계·시작)를 받는다. 방이 사라지면 지역 선택으로 돌아간다.
    this.offState = roomClient.on('state', (room) => this.onRoomState(room));
    this.offReconnect = roomClient.on('reconnected', () => this.onRoomState(roomClient.room));
    this.events.once('shutdown', () => {
      this.offState?.();
      this.offReconnect?.();
      this.clearLayer();
      this.lobbyTimer?.remove(false);
    });
    this.input.keyboard?.on('keydown-ESC', () => void this.back());
    this.show(roomClient.room && roomClient.room.phase === 'lobby' ? 'lobby' : this.mode);
  }

  // ---------- 공통 ----------

  private clearLayer() {
    this.layer.forEach((o) => o.destroy());
    this.layer = [];
    this.dom.forEach((d) => d.destroy());
    this.dom = [];
    this.lobbyTexts.clear();
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.push(o);
    return o;
  }

  private show(mode: CoopMode) {
    this.mode = mode;
    this.clearLayer();
    this.lobbyTimer?.remove(false);
    this.lobbyTimer = null;
    if (mode === 'create') this.buildCreate();
    else if (mode === 'join') this.buildJoin();
    else this.buildLobby();
  }

  private panel(title: string) {
    this.add2(feltPanel(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { radius: 30, strokeW: 6, image: 'room-panel' }));
    if (title) this.add2(this.add.text(CANVAS_WIDTH / 2, PANEL.y + 116, title, { fontSize: '26px', color: TEXT.body })).setOrigin(0.5);
  }

  private async back() {
    if (this.mode === 'lobby') {
      await this.leaveLobby();
      return;
    }
    this.scene.start('StageSelect');
  }

  private errorMessage(err: unknown) {
    return err instanceof RoomApiError ? err.message : '서버에 연결할 수 없습니다.';
  }

  // ---------- 화면 2 — 방 만들기 ----------

  private buildCreate() {
    this.panel('방 만들기');
    const cx = CANVAS_WIDTH / 2;
    const left = PANEL.x + 110;

    this.add2(this.add.text(left, PANEL.y + 140, '방 이름', { fontSize: '16px', color: TEXT.sub }));
    const nameDom = this.add.dom(cx, PANEL.y + 180, 'input', domInput(20, 520, 52));
    const nameEl = nameDom.node as HTMLInputElement;
    nameEl.maxLength = 20;
    nameEl.placeholder = '방 이름 (최대 20자)';
    this.dom.push(nameDom);
    const nameError = this.add2(this.add.text(cx, PANEL.y + 216, '', { fontSize: '14px', color: TEXT.error }).setOrigin(0.5));

    this.add2(this.add.text(left, PANEL.y + 240, '최대 인원', { fontSize: '16px', color: TEXT.sub }));
    const seg: Phaser.GameObjects.Container[] = [];
    const drawSeg = () => {
      seg.forEach((b) => b.destroy());
      seg.length = 0;
      for (let n = 1; n <= 5; n++) {
        const b = pillButton(this, left + 40 + (n - 1) * 84, PANEL.y + 284, 72, 52, String(n), this.form.maxPlayers === n ? 'primary' : 'secondary', () => {
          this.form.maxPlayers = n;
          drawSeg();
        });
        seg.push(b);
        this.layer.push(b);
      }
    };
    drawSeg();

    this.add2(this.add.text(left + 480, PANEL.y + 240, '공개 여부', { fontSize: '16px', color: TEXT.sub }));
    const vis: Phaser.GameObjects.Container[] = [];
    const drawVis = () => {
      vis.forEach((b) => b.destroy());
      vis.length = 0;
      (['private', 'public'] as const).forEach((v, i) => {
        const b = pillButton(this, left + 540 + i * 130, PANEL.y + 284, 120, 52, v === 'private' ? '비공개' : '공개', this.form.visibility === v ? 'primary' : 'secondary', () => {
          this.form.visibility = v;
          drawVis();
        });
        vis.push(b);
        this.layer.push(b);
      });
    };
    drawVis();

    this.add2(this.add.text(left, PANEL.y + 332, `지역: ${this.stageName} (변경할 수 없어요)`, { fontSize: '16px', color: TEXT.body }));
    const hint = this.add2(this.add.text(left, PANEL.y + 360, '', { fontSize: '14px', color: TEXT.error }));

    let busy = false;
    this.add2(
      pillButton(this, cx - 130, PANEL.y + 430, 240, 56, '만들기', 'primary', async () => {
        if (busy) return;
        const name = nameEl.value.trim();
        nameError.setText(name.length < 1 || name.length > 20 ? '방 이름은 1~20자로 입력해 주세요.' : '');
        hint.setText('');
        if (name.length < 1 || name.length > 20) return;
        busy = true;
        try {
          await roomClient.createRoom({ name, maxPlayers: this.form.maxPlayers, visibility: this.form.visibility, stageCode: this.stageCode });
          this.show('lobby');
        } catch (err) {
          showToast(this, this.errorMessage(err), { y: 600, error: true });
        } finally {
          busy = false;
        }
      }),
    );
    this.add2(pillButton(this, cx + 150, PANEL.y + 430, 180, 52, '취소', 'secondary', () => void this.back()));
  }

  // ---------- 화면 2 — 방 참가 ----------

  private buildJoin() {
    this.panel('방 참가');
    const listX = PANEL.x + 72;
    const listY = PANEL.y + 138;
    const rightX = PANEL.x + 640;

    const status = this.add2(this.add.text(listX + 270, listY + 150, '방 목록을 불러오는 중...', { fontSize: '18px', color: TEXT.sub }).setOrigin(0.5));
    const rowLayer: Phaser.GameObjects.GameObject[] = [];

    const refreshIcon = this.textures.exists('loading-yarn') ? this.add.image(rightX + 186, PANEL.y + 146, 'loading-yarn').setDisplaySize(40, 40) : this.add.circle(rightX + 186, PANEL.y + 146, 18, PAL.pink);
    this.add2(refreshIcon);
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      const spin = this.tweens.add({ targets: refreshIcon, angle: 360, duration: 800, repeat: -1 });
      rowLayer.forEach((o) => o.destroy());
      rowLayer.length = 0;
      status.setText('방 목록을 불러오는 중...').setVisible(true);
      try {
        const rooms = await roomClient.listRooms();
        status.setVisible(rooms.length === 0).setText('참가할 수 있는 공개 방이 없어요.\n방 코드를 알고 있다면 오른쪽에 입력하세요.');
        rooms.slice(0, 4).forEach((r, i) => this.buildRoomRow(r, listX, listY + i * 70, rowLayer));
        rowLayer.forEach((o) => this.layer.push(o));
      } catch (err) {
        status.setText(this.errorMessage(err)).setVisible(true);
      } finally {
        spin.stop();
        refreshIcon.setAngle(0);
        loading = false;
      }
    };
    refreshIcon.setInteractive({ useHandCursor: true }).on('pointerdown', () => void load());
    void load();

    this.add2(this.add.text(rightX, PANEL.y + 140, '방 코드로 참가', { fontSize: '16px', color: TEXT.sub }));
    const codeDom = this.add.dom(rightX + 100, PANEL.y + 196, 'input', domInput(26, 200, 56) + 'text-align:center;letter-spacing:6px;text-transform:uppercase;');
    const codeEl = codeDom.node as HTMLInputElement;
    codeEl.maxLength = 5;
    codeEl.placeholder = 'A1B2C';
    // 영대문자·숫자만 남긴다(서버 검증은 그대로 유지)
    codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)));
    this.dom.push(codeDom);
    const codeError = this.add2(this.add.text(rightX + 100, PANEL.y + 232, '', { fontSize: '13px', color: TEXT.error, wordWrap: { width: 260 }, align: 'center' }).setOrigin(0.5, 0));
    let busy = false;
    this.add2(
      pillButton(this, rightX + 100, PANEL.y + 296, 200, 56, '참가', 'primary', async () => {
        if (busy) return;
        if (codeEl.value.length !== 5) {
          codeError.setText('5자리 코드를 입력해 주세요.');
          return;
        }
        codeError.setText('');
        busy = true;
        try {
          await roomClient.joinRoom(codeEl.value);
          this.show('lobby');
        } catch (err) {
          showToast(this, this.errorMessage(err), { y: 600, error: true });
        } finally {
          busy = false;
        }
      }),
    );
    this.add2(pillButton(this, rightX + 100, PANEL.y + 366, 160, 52, '뒤로', 'secondary', () => void this.back()));
  }

  private buildRoomRow(r: RoomSummary, x: number, y: number, into: Phaser.GameObjects.GameObject[]) {
    const full = r.memberCount >= r.maxPlayers;
    const locked = this.lockedStages.has(r.stageCode);
    const disabled = full || locked;
    const w = 540;
    const h = 66;
    const bg = feltPanel(this, x, y, w, h, { radius: 22, image: 'room-row', alpha: disabled ? 0.5 : 1, fit: 'width' });
    const stageName = getStageLabel(r.stageCode);
    const name = this.add.text(x + 30, y + 14, ellipsize(r.name, 14), { fontSize: '18px', color: disabled ? TEXT.disabled : TEXT.body });
    const meta = this.add.text(x + 30, y + 38, `${stageName} · 방장 ${ellipsize(r.hostNickname, 8)}`, { fontSize: '13px', color: TEXT.sub });
    const count = this.add.text(x + w - 130, y + 14, `${r.memberCount}/${r.maxPlayers}명`, { fontSize: '18px', color: disabled ? TEXT.disabled : TEXT.body });
    const phase = this.add.text(x + w - 130, y + 38, full ? '가득 참' : locked ? '잠긴 지역' : r.phase === 'playing' ? '진행 중' : '대기 중', { fontSize: '14px', color: disabled ? TEXT.error : TEXT.onMint });
    const zone = this.add.rectangle(x, y, w, h, 0xffffff, 0).setOrigin(0, 0);
    if (!disabled) {
      zone.setInteractive({ useHandCursor: true }).on('pointerdown', async () => {
        try {
          await roomClient.joinRoom(r.code);
          this.show('lobby');
        } catch (err) {
          showToast(this, this.errorMessage(err), { y: 600, error: true });
        }
      });
    }
    into.push(bg, name, meta, count, phase, zone);
  }

  // ---------- 화면 3 — 방 로비 ----------

  private buildLobby() {
    const room = roomClient.room;
    if (!room) {
      this.scene.start('StageSelect');
      return;
    }
    if (room.phase === 'playing') {
      // 이미 시작된 방에 들어온 경우 로비를 거치지 않고 바로 지도로 간다
      this.scene.start('Map', { stageCode: room.stageCode, capturedIndices: [], removedIndices: [] });
      return;
    }
    this.lastHostId = room.hostPlayerId;
    this.panel('');
    const left = PANEL.x + 84;
    // 상단 왼쪽: 방 이름·지역·공개 상태, 오른쪽: 방 코드(실타래 타일 5개)와 복사
    this.add2(this.add.text(left, PANEL.y + 104, ellipsize(room.name, 14), { fontSize: '26px', color: TEXT.body }));
    this.add2(this.add.text(left, PANEL.y + 140, `${getStageLabel(room.stageCode)} · ${room.visibility === 'public' ? '공개' : '비공개'} · 최대 ${room.maxPlayers}명`, { fontSize: '15px', color: TEXT.sub }));
    const tileX0 = PANEL.x + 500;
    [...room.code].forEach((ch, i) => {
      const x = tileX0 + i * 60;
      this.add2(feltPanel(this, x - 26, PANEL.y + 100, 52, 52, { radius: 14, image: 'code-tile' }));
      this.add2(this.add.text(x, PANEL.y + 126, ch, { fontSize: '26px', color: TEXT.body }).setOrigin(0.5));
    });
    this.add2(
      pillButton(this, tileX0 + 5 * 60 + 38, PANEL.y + 126, 84, 48, '복사', 'secondary', async () => {
        try {
          await navigator.clipboard.writeText(room.code);
          showToast(this, '방 코드를 복사했어요.', { y: 600 });
        } catch {
          showToast(this, `방 코드: ${room.code}`, { y: 600 });
        }
      }),
    );

    this.renderMembers(room);
    this.renderLobbyButtons(room);
    this.lobbyTimer = this.time.addEvent({ delay: 500, loop: true, callback: () => this.tickAway() });
  }

  private memberObjs: Phaser.GameObjects.GameObject[] = [];

  private renderMembers(room: RoomState) {
    this.memberObjs.forEach((o) => o.destroy());
    this.memberObjs = [];
    this.lobbyTexts.clear();
    const rowW = 700;
    const rowH = 44;
    const x0 = CANVAS_WIDTH / 2 - rowW / 2;
    const y0 = PANEL.y + 178;
    for (let i = 0; i < 5; i++) {
      const y = y0 + i * (rowH + 6);
      const m = room.members[i];
      const track = (o: Phaser.GameObjects.GameObject) => {
        this.memberObjs.push(o);
        return o;
      };
      track(feltPanel(this, x0, y, rowW, rowH, { radius: 20, image: 'member-row', alpha: m ? 1 : 0.45, fit: 'width' }));
      if (i >= room.maxPlayers) {
        track(this.add.text(x0 + rowW / 2, y + rowH / 2, '—', { fontSize: '18px', color: TEXT.disabled }).setOrigin(0.5));
        continue;
      }
      if (!m) {
        track(this.add.text(x0 + 84, y + rowH / 2, '기다리는 중...', { fontSize: '18px', color: TEXT.sub }).setOrigin(0, 0.5));
        continue;
      }
      // 슬롯 링(입장 순서 색, 호스트가 바뀌어도 그대로)
      const ringKey = this.textures.exists('avatar-ring') ? 'avatar-ring' : null;
      if (ringKey) track(this.add.image(x0 + 44, y + rowH / 2, ringKey).setDisplaySize(52, 30).setTint(slotNum(i + 1)));
      else track(this.add.ellipse(x0 + 44, y + rowH / 2, 52, 28).setStrokeStyle(4, slotNum(i + 1)));
      track(this.add.text(x0 + 44, y + rowH / 2, String(i + 1), { fontSize: '14px', color: TEXT.body }).setOrigin(0.5));
      const you = m.playerId === roomClient.playerId ? ' (나)' : '';
      track(this.add.text(x0 + 84, y + rowH / 2, `${ellipsize(m.nickname, 12)}${you}`, { fontSize: '19px', color: m.connected ? TEXT.body : TEXT.disabled }).setOrigin(0, 0.5));
      if (m.playerId === room.hostPlayerId) {
        const badge = this.textures.exists('badge-host') ? this.add.image(x0 + 360, y + rowH / 2, 'badge-host').setDisplaySize(26, 26) : this.add.text(x0 + 360, y + rowH / 2, '♛', { fontSize: '22px', color: '#9276D2' }).setOrigin(0.5);
        track(badge);
        track(this.add.text(x0 + 380, y + rowH / 2, '방장', { fontSize: '16px', color: TEXT.sub }).setOrigin(0, 0.5));
        // 호스트 승계 시 새 방장 배지가 0.4초 부드럽게 나타난다
        if (this.lastHostId !== null && this.lastHostChanged) {
          (badge as Phaser.GameObjects.Image).setAlpha(0);
          this.tweens.add({ targets: badge, alpha: 1, duration: 400 });
        }
      }
      if (!m.connected) {
        if (!this.awaySince.has(m.playerId)) this.awaySince.set(m.playerId, this.time.now);
        if (this.textures.exists('status-away')) track(this.add.image(x0 + rowW - 230, y + rowH / 2, 'status-away').setDisplaySize(26, 26));
        const t = this.add.text(x0 + rowW - 208, y + rowH / 2, '', { fontSize: '16px', color: TEXT.error }).setOrigin(0, 0.5);
        this.lobbyTexts.set(m.playerId, t);
        track(t);
      } else {
        this.awaySince.delete(m.playerId);
        track(this.add.text(x0 + rowW - 34, y + rowH / 2, '접속 중', { fontSize: '16px', color: TEXT.onMint }).setOrigin(1, 0.5));
      }
    }
    this.lastHostChanged = false;
    this.tickAway();
  }

  private lastHostChanged = false;

  // 접속이 끊긴 참가자의 자리를 유지하며 재접속 대기 시간을 센다(서버 유예 45초와 같은 값을 표시용으로 쓴다)
  private tickAway() {
    for (const [id, t] of this.lobbyTexts) {
      const since = this.awaySince.get(id) ?? this.time.now;
      const left = Math.max(0, 45 - Math.floor((this.time.now - since) / 1000));
      t.setText(`재접속 대기 ${left}초`);
    }
  }

  private buttonObjs: Phaser.GameObjects.GameObject[] = [];

  private renderLobbyButtons(room: RoomState) {
    this.buttonObjs.forEach((o) => o.destroy());
    this.buttonObjs = [];
    const isHost = room.hostPlayerId === roomClient.playerId;
    const cx = CANVAS_WIDTH / 2;
    const y = PANEL.y + 448;
    const start = pillButton(
      this,
      cx - 130,
      y,
      240,
      56,
      this.lobbyBusy ? '시작하는 중...' : isHost ? '시작' : '방장을 기다려요',
      isHost && !this.lobbyBusy ? 'primary' : 'disabled',
      async () => {
        this.lobbyBusy = true;
        this.renderLobbyButtons(room);
        try {
          await roomClient.startRoom();
        } catch (err) {
          showToast(this, this.errorMessage(err), { y: 600, error: true });
        } finally {
          this.lobbyBusy = false;
          if (this.mode === 'lobby' && roomClient.room) this.renderLobbyButtons(roomClient.room);
        }
      },
    );
    const leave = pillButton(this, cx + 150, y, 180, 52, '나가기', 'secondary', () => void this.leaveLobby());
    this.buttonObjs.push(start, leave);
    this.layer.push(start, leave);
  }

  private async leaveLobby() {
    try {
      await roomClient.leaveRoom();
    } catch (err) {
      console.warn('[room] 나가기 실패:', err);
    }
    this.scene.start('StageSelect');
  }

  // 방 상태가 바뀌었다: 시작되면 지도로, 방이 사라졌으면(서버 재시작·마지막 사람 퇴장) 지역 선택으로 이유와 함께 돌아간다
  private onRoomState(room: RoomState | null) {
    if (this.mode !== 'lobby') return;
    if (!room) {
      showToast(this, '방이 사라졌어요. 지역 선택으로 돌아갑니다.', { y: 600, error: true });
      this.time.delayedCall(1500, () => this.scene.start('StageSelect'));
      return;
    }
    if (room.phase === 'playing') {
      this.scene.start('Map', { stageCode: room.stageCode, capturedIndices: [], removedIndices: [] });
      return;
    }
    if (room.hostPlayerId !== this.lastHostId) this.lastHostChanged = true;
    this.lastHostId = room.hostPlayerId;
    this.renderMembers(room);
    this.renderLobbyButtons(room);
  }
}

function getStageLabel(stageCode: string) {
  try {
    return getStage(stageCode).name.split(' (')[0]; // 지역명(설정 파일 기준)만 짧게
  } catch {
    return stageCode;
  }
}
