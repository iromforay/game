import Phaser from 'phaser';
import { AVATAR_SPEED, ENCOUNTER_RADIUS, CANVAS_WIDTH } from '../config/constants';
import { getStage } from '../config/stages';
import type { WildSpawn } from '../config/stages';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { InventoryPanel } from '../ui/InventoryPanel';
import { InventoryWindow } from '../ui/InventoryWindow';
import { displayScaleOf, fontPx, MIN_BUTTON_PX } from '../ui/responsive';
import { devFlags } from '../story/devFlags';
import { playStory } from '../story/playStory';
import { MiniMap } from '../ui/MiniMap';
import type { MapMarker, MapView } from '../ui/MiniMap';
import { loadWorldImages } from '../assets/loader';
import { ensureUiPlaceholders } from '../assets/placeholders';
import { loadChapterStatuses, getCurrentChapter } from '../config/story';
import { roomClient, RoomApiError } from '../net/roomClient';
import { battleClient } from '../net/battleClient';
import type { BattleSnapshot, BattleUpdate, WildState } from '../net/battleTypes';
import { showToast, feltPanel, pillButton, PAL, TEXT } from '../ui/kit';
import coopSlots from '../data/coop-slots.json';
import type { Facing, MapPlayer } from '../net/roomClient';
import charactersData from '../data/characters.json';
import { AVATAR_IMAGE, CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { fetchStory, triggerStory } from '../api/client';
import { deliveryGoalText, shortageText, type StoryDelivery, type StoryPlay } from '../story/storyFlow';

interface WildMarker {
  spawn: WildSpawn;
  index: number;
  gfx: Phaser.GameObjects.Container;
  encountered: boolean;
  retryAt?: number; // 조우 시작에 실패한 뒤 다시 시도하기까지의 대기(ms 시각)
  state: WildState; // 서버가 소유한 상태(free/engaged/captured/removed)
  ring: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Text;
  pulse?: Phaser.Tweens.Tween;
}

interface MapInitData {
  stageCode?: string;
  capturedIndices?: number[];
  removedIndices?: number[];
  invite?: BattleSnapshot; // 새로고침·재접속으로 돌아와 응답하지 않은 참전 초대가 남아 있는 경우
}

// 3.5.1 맵(탐험) 자유이동 프로토타입(7-5) — 아바타 이동 + 카메라 추적 + 조우 시 배틀그리드(7-6) 진입까지.
// 아트는 최소 플레이스홀더(assets/registry.ts) — 원화 완성되면 이미지만 교체(3.1.1).
// 파티/인벤토리 시스템 이전이라 획득 결과는 capturedIndices로만 임시 추적(7-7에서 실제 보유 터비로 대체 예정).
export class MapScene extends Phaser.Scene {
  private joystick!: VirtualJoystick;
  private inventoryPanel!: InventoryPanel;
  private inventoryWindow!: InventoryWindow;
  private avatar!: Phaser.GameObjects.Image;
  private markers: WildMarker[] = [];
  private stageWidth = 0;
  private stageHeight = 0;
  private capturedIndices: number[] = [];
  private removedIndices: number[] = [];
  private encounterLocked = false;
  private stageCode = 'forest';
  private miniMap!: MiniMap;
  private moveAngle = 0;
  private ready = false;
  private facing: Facing = 'down';
  private inRoomMap = false;
  private peers = new Map<string, { container: Phaser.GameObjects.Container; tx: number; ty: number }>();
  private roomUnsubs: (() => void)[] = [];
  private lastSentAt = 0;
  private lastSent = { x: -1, y: -1 };
  private roomLabel?: Phaser.GameObjects.Text;
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 응답을 기다리던 이전 create가 새 화면에 덧그리거나 리스너를 중복 등록하지 않게
  private pendingInvite: BattleSnapshot | null = null;
  private inviteLayer: Phaser.GameObjects.Container | null = null;
  private inviteTimer: Phaser.Time.TimerEvent | null = null;
  private inviteBattleId: string | null = null;
  private selfRing?: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image;
  private deliveryLayer: Phaser.GameObjects.GameObject[] = [];
  private delivering = false;

  constructor() {
    super('Map');
  }

  init(data: MapInitData) {
    this.stageCode = data.stageCode ?? 'forest';
    this.ready = false;
    this.capturedIndices = data.capturedIndices ?? [];
    this.removedIndices = data.removedIndices ?? [];
    this.encounterLocked = false;
    this.pendingInvite = data.invite ?? null;
    this.inviteLayer = null;
    this.inviteTimer = null;
    this.inviteBattleId = null;
    this.deliveryLayer = [];
    this.delivering = false;
    this.roomLabel = undefined; // 같은 씬 인스턴스를 다시 쓰므로 이전 화면의 글자 참조를 비운다(파괴된 객체에 setText 방지)
    this.generation++;
  }

  preload() {
    // WebGL은 <img> 소스로 직접 SVG를 텍스처 업로드하면 검게 나오는 경우가 있어(래스터화 안 됨),
    // load.image 대신 load.svg로 명시적 크기를 줘서 내부적으로 캔버스에 먼저 그려서 텍스처화함.
    if (!this.textures.exists('avatar')) this.load.image('avatar', AVATAR_IMAGE);
    if (!this.textures.exists(`bg-${this.stageCode}`)) this.load.image(`bg-${this.stageCode}`, BACKGROUND_TILES[this.stageCode]);
    for (const [code, url] of Object.entries(CHARACTER_IMAGES)) {
      if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, url);
    }
    loadWorldImages(this);
  }

  async create() {
    // v15: 재접속 시 서버가 오프닝 미완료로 탐험 세션을 닫으면 마을로 돌아간다(오래된 화면 상태로 머물지 않음)
    const offReturn = roomClient.on('returnToVillage', () => this.scene.start('Village'));
    this.events.once('shutdown', offReturn);
    // Phaser는 scene.start()로 재진입해도 같은 씬 인스턴스를 재사용하므로, 여기서 초기화 안 하면
    // 맵 복귀할 때마다(전투 후 등) 마커가 중복 누적됨(실제로 겪은 버그) — 매번 새로 채움
    this.markers = [];

    const stage = getStage(this.stageCode);
    const gen = this.generation;
    const current = getCurrentChapter((await loadChapterStatuses()).statuses);
    if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 화면이 바뀜(마을 복귀 등)
    ensureUiPlaceholders(this);
    this.stageWidth = stage.width;
    this.stageHeight = stage.height;

    this.cameras.main.setBackgroundColor('#20301c');
    this.cameras.main.setBounds(0, 0, stage.width, stage.height);

    this.add.tileSprite(0, 0, stage.width, stage.height, `bg-${stage.code}`).setOrigin(0, 0);

    this.avatar = this.add.image(stage.width / 2, stage.height / 2, 'avatar').setDisplaySize(44, 44);
    this.cameras.main.startFollow(this.avatar, true, 0.1, 0.1);

    // 3.4/4-C: 포획됨·도망(패배)한 개체는 재등장하지 않는다 — 상태는 서버가 소유하고 같은 방 모두에게 공유된다(roomClient.wilds)
    stage.wildSpawns.forEach((spawn, index) => this.markers.push(this.createMarker(spawn, index)));
    this.markers.forEach((m) => this.applyWildState(m.index, roomClient.wilds.get(m.index) ?? 'free')); // 마지막으로 알려진 서버 상태로 먼저 그린다

    this.joystick = new VirtualJoystick(this);

    // 구 판정(롤백 상태)일 때만: 지금 열린 장이 이 맵이면 대표 터비 스폰 위치를 별로 표시. 신 판정에서는 포획이 장을 열지 않아 표시하지 않는다.
    const targets: MapMarker[] = [];
    if (current && current.legacyTargetCode && current.chapter.stageCode === stage.code) {
      stage.wildSpawns.forEach((spawn, index) => {
        if (spawn.characterCode !== current.legacyTargetCode || ['captured', 'removed'].includes(roomClient.wilds.get(index) ?? 'free')) return;
        targets.push({ id: `target-${index}`, type: 'target', name: `대표 터비 ${current.clearCharacterName}`, x: spawn.x, y: spawn.y, hint: `${current.chapter.titleKo}: '${current.clearCharacterName}'를 조우해 직접 포획하면 다음 지역이 열려요.` });
      });
    }
    const view: MapView = { title: stage.name, width: stage.width, height: stage.height, bounds: { x: 0, y: 0, w: stage.width, h: stage.height } };
    this.miniMap = new MiniMap(this, view, targets, '', (open) => {
      this.joystick.setEnabled(!open);
    });

    this.add
      .text(16, 16, `포획: ${this.capturedIndices.length}`, { fontSize: '18px', color: '#ffffff', backgroundColor: '#00000080', padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(2000);

    // 4.1: 마을(입구) — 야생 맵에서 언제든 안전지대로 복귀 가능
    this.add
      .text(16, 54, '마을로', { fontSize: '14px', color: '#ffffff', backgroundColor: '#4a7a3a', padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        // 4.1/방: 마을로 나가는 것은 방 퇴장 — 서버 연결이 안 돼도 마을로는 돌아간다
        roomClient.leaveRoom().catch(() => undefined).finally(() => this.scene.start('Village'));
      });

    this.inventoryPanel = new InventoryPanel(this, () => this.joystick.setEnabled(true));
    // v3 M4-D: 아이템 인벤토리(공용 창)와 보유 터비 창을 나눈다. 버튼 글자는 실제 표시 배율에 맞춰 14px 이상
    const hudFont = fontPx(displayScaleOf(this.scale.displaySize.width), 16, MIN_BUTTON_PX);
    this.inventoryWindow = new InventoryWindow(this, { onClose: () => this.joystick.setEnabled(true), onPlay: (play) => this.launchStory(play) });
    const invBtn = this.add
      .text(CANVAS_WIDTH - 16, 192, '인벤토리', { fontSize: `${hudFont}px`, color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        if (this.inventoryWindow.isVisible) return;
        this.joystick.setEnabled(false);
        void this.inventoryWindow.open();
      });
    this.add
      .text(CANVAS_WIDTH - 16, invBtn.y + invBtn.height + 8, '터비', { fontSize: `${hudFont}px`, color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 10, y: 6 } })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        const opening = !this.inventoryPanel.isVisible;
        this.inventoryPanel.toggle();
        if (opening) this.joystick.setEnabled(false); // 닫을 때는 InventoryPanel의 onClose 콜백이 다시 켜줌
      });
    this.ready = true;
    // M4-C: 이야기 대화가 끝나 이 화면이 깨어나면 전달 목표를 서버 기준으로 다시 그린다
    const onWake = () => {
      this.joystick.setEnabled(true);
      void this.refreshDelivery();
    };
    this.events.on('wake', onWake);
    this.events.once('shutdown', () => this.events.off('wake', onWake));
    this.setupRoom();
  }

  // ----- M4-C: 1장 이야기 연결(서버가 정한 구간만 재생) -----

  private launchStory(play: StoryPlay) {
    this.joystick.setEnabled(false);
    playStory(this, play, this.stageCode);
  }

  private async refreshDelivery() {
    const gen = this.generation;
    try {
      const story = await fetchStory();
      if (gen !== this.generation || !this.sys.isActive()) return; // 기다리는 사이 화면이 바뀜 — 끝난 화면에 그리지 않는다
      this.showDelivery(story.delivery);
    } catch (err) {
      console.warn('[story] 목표를 불러오지 못했습니다:', err);
    }
  }

  // 퀘스트 추적(빛나는 실가루 n/10, 서버 인벤토리 수량). 운영 화면에는 추적 정보만 — 원격 전달 버튼은 좌표·보풀이 NPC 확정 전이라
  // 개발 미리보기(devFlags.remoteDelivery)에서만 보인다(v3 §4). 서버 npc_bopuli 트리거와 검증은 그대로다.
  private showDelivery(delivery: StoryDelivery | null) {
    this.deliveryLayer.forEach((o) => o.destroy());
    this.deliveryLayer = [];
    if (!delivery) return;
    const cx = CANVAS_WIDTH / 2;
    const scale = displayScaleOf(this.scale.displaySize.width);
    const goalFont = fontPx(scale, 17, 13);
    const withButton = devFlags.remoteDelivery;
    const panelH = withButton ? goalFont * 2 + 44 : goalFont + 26;
    const panel = this.add.rectangle(cx, 8 + panelH / 2, Math.max(440, goalFont * 17), panelH, 0x241a3d, 0.9).setStrokeStyle(2, 0xffd27f, 0.9).setScrollFactor(0).setDepth(2000);
    const goal = this.add.text(cx, 8 + (withButton ? goalFont * 0.9 + 6 : panelH / 2), deliveryGoalText(delivery), { fontSize: `${goalFont}px`, color: '#ffe9a8' }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.deliveryLayer.push(panel, goal);
    if (!withButton) return;
    const button = this.add
      .text(cx, 8 + panelH - goalFont * 0.9 - 8, '보풀이에게 실가루 전달(개발용)', { fontSize: `${goalFont}px`, color: '#ffffff', backgroundColor: '#5a3a8a', padding: { x: 12, y: 5 } })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2001)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.deliver(delivery.triggerId));
    this.deliveryLayer.push(button);
  }

  // 서버가 수량·진행·위치를 판정한다. 부족하면 부족 수량만, 충분하면 서버가 소비·지급을 확정한 뒤 제작 장면을 재생한다
  private async deliver(triggerId: string) {
    if (this.delivering) return; // 이중 클릭(서버도 멱등)
    this.delivering = true;
    const gen = this.generation;
    try {
      const res = await triggerStory(triggerId);
      if (gen !== this.generation || !this.sys.isActive()) return;
      this.showDelivery(res.story.delivery);
      if (res.shortage) showToast(this, shortageText(res.shortage), { y: 660, fixed: true });
      if (res.play) this.launchStory(res.play);
    } catch (err) {
      if (gen === this.generation && this.sys.isActive()) showToast(this, err instanceof Error && err.message ? err.message : '서버에 연결할 수 없습니다.', { y: 660, error: true, fixed: true });
    } finally {
      this.delivering = false;
    }
  }

  // ----- 4-A: 같은 방 플레이어 위치 동기화(개발용 표시 — 최종 표현은 코덱스 디자인 확정 후 교체) -----

  private setupRoom() {
    const room = roomClient.room;
    if (!room || room.stageCode !== this.stageCode) return;
    this.roomLabel = this.add.text(16, 84, '', { fontSize: '12px', color: '#ffffff', backgroundColor: '#00000080', padding: { x: 6, y: 3 } }).setScrollFactor(0).setDepth(2000);
    this.refreshRoomLabel();

    this.roomUnsubs.push(
      roomClient.on('state', (r) => {
        this.refreshRoomLabel();
        this.refreshPeerStatus();
        if (r && r.phase === 'playing' && !this.inRoomMap) void this.enterRoomMap();
      }),
      roomClient.on('joined', (p) => this.upsertPeer(p)),
      roomClient.on('moved', (p) => {
        const peer = this.peers.get(p.playerId);
        if (peer) {
          peer.tx = p.x;
          peer.ty = p.y;
        }
      }),
      roomClient.on('left', ({ playerId }) => this.removePeer(playerId)),
      roomClient.on('correct', ({ x, y }) => this.avatar.setPosition(x, y)),
      roomClient.on('wildChanged', (w) => this.applyWildState(w.index, w.state)),
      roomClient.on('battleInvite', (i) => this.showInvite(i.snapshot)),
      roomClient.on('battleUpdate', (u) => this.onBattleUpdate(u)),
    );
    // Phaser는 씬을 재사용하므로 다른 씬으로 넘어갈 때 반드시 리스너·표시를 정리한다
    this.events.once('shutdown', () => this.teardownRoom());

    if (room.phase === 'playing') void this.enterRoomMap();
    if (this.pendingInvite) this.showInvite(this.pendingInvite);
  }

  private async enterRoomMap() {
    if (this.inRoomMap) return;
    this.inRoomMap = true;
    try {
      const players = await roomClient.enterMap(this.avatar.x, this.avatar.y, this.facing);
      if (!this.inRoomMap) return; // 입장 응답을 기다리는 사이 씬이 끝남
      players.forEach((p) => this.upsertPeer(p));
      this.markers.forEach((m) => this.applyWildState(m.index, roomClient.wilds.get(m.index) ?? 'free'));
      if (!this.selfRing) this.selfRing = this.makeRing(this.slotColor(roomClient.slotOf(roomClient.playerId ?? ''))).setDepth(5);
      // M4-C: 서버가 이 입장에 붙여 준 이야기(숲 첫 진입 → 첫 길, 새로고침 → 복귀 구간) — 서버가 정한 구간만 재생
      const story = roomClient.storyOnEnter;
      this.showDelivery(story?.delivery ?? null);
      if (story?.play) this.launchStory(story.play);
    } catch (err) {
      this.inRoomMap = false;
      console.warn('[room] 맵 입장 실패:', err);
    }
  }

  // 발밑 슬롯색 링(전달받은 avatar-ring.png를 슬롯색으로 tint, 없으면 도형)
  private makeRing(color: number) {
    if (this.textures.exists('avatar-ring')) return this.add.image(0, 0, 'avatar-ring').setDisplaySize(86, 44).setTint(color);
    return this.add.ellipse(0, 0, 86, 44).setStrokeStyle(4, color, 1);
  }

  private slotColor(slot: number) {
    const c = coopSlots.find((x) => x.slot === slot) ?? coopSlots[0];
    return Phaser.Display.Color.HexStringToColor(c.main).color;
  }

  // 다른 플레이어: 발밑 슬롯색 링 + 머리 위 닉네임 명패(슬롯색 점, 방장은 왕관), 접속이 끊기면(away) 알파 0.55
  private upsertPeer(p: MapPlayer) {
    if (p.playerId === roomClient.playerId) return;
    const existing = this.peers.get(p.playerId);
    if (existing) {
      existing.tx = p.x;
      existing.ty = p.y;
      return;
    }
    const slot = roomClient.slotOf(p.playerId);
    const color = this.slotColor(slot);
    const ring = this.makeRing(color).setPosition(0, 18);
    const body = this.add.image(0, 0, 'avatar').setDisplaySize(44, 44);
    const plate = this.add.graphics();
    const nick = p.nickname.length > 10 ? `${p.nickname.slice(0, 9)}…` : p.nickname;
    const label = this.add.text(8, -34, nick, { fontSize: '13px', color: TEXT.body }).setOrigin(0.5, 1);
    const w = Math.min(140, label.width + 34);
    plate.fillStyle(PAL.cream, 1).fillRoundedRect(-w / 2 + 8, -34 - 26, w, 26, 12);
    plate.fillStyle(color, 1).fillCircle(-w / 2 + 22, -34 - 13, 5);
    label.setX(8 + 6);
    const crown = (this.textures.exists('badge-host') ? this.add.image(w / 2 + 12, -34 - 13, 'badge-host').setDisplaySize(24, 24) : this.add.text(w / 2 + 12, -34 - 26, '♛', { fontSize: '18px', color: '#9276D2' }).setOrigin(0.5)).setVisible(roomClient.room?.hostPlayerId === p.playerId);
    const away = (this.textures.exists('status-away') ? this.add.image(-w / 2 + 8, -34 - 13, 'status-away').setDisplaySize(24, 24) : this.add.text(-w / 2 + 8, -34 - 13, '☁', { fontSize: '16px', color: '#8B7C86' }).setOrigin(0.5)).setVisible(false);
    const container = this.add.container(p.x, p.y, [ring, body, plate, label, crown, away]).setDepth(900);
    this.peers.set(p.playerId, { container, tx: p.x, ty: p.y });
    this.refreshPeerStatus();
  }

  private refreshPeerStatus() {
    const room = roomClient.room;
    if (!room) return;
    for (const [id, peer] of this.peers) {
      const member = room.members.find((m) => m.playerId === id);
      peer.container.setAlpha(member && !member.connected ? 0.55 : 1);
      (peer.container.list[4] as Phaser.GameObjects.Image).setVisible(room.hostPlayerId === id);
      (peer.container.list[5] as Phaser.GameObjects.Image).setVisible(!!member && !member.connected); // away: 회색 실구름
    }
  }

  private removePeer(playerId: string) {
    this.peers.get(playerId)?.container.destroy();
    this.peers.delete(playerId);
  }

  private refreshRoomLabel() {
    const room = roomClient.room;
    if (!room) return;
    const away = room.members.filter((m) => !m.connected).length;
    this.roomLabel?.setText(`방 ${room.code} · ${room.members.length}/${room.maxPlayers}명${away ? ` (접속 끊김 ${away})` : ''}`);
  }

  private syncRoom(delta: number) {
    if (!this.inRoomMap) return;
    // 이동 보고: 120ms 주기(docs 3.5.4), 위치가 바뀐 경우만
    this.lastSentAt += delta;
    if (this.lastSentAt >= 120 && (Math.abs(this.avatar.x - this.lastSent.x) > 0.5 || Math.abs(this.avatar.y - this.lastSent.y) > 0.5)) {
      roomClient.sendMove(this.avatar.x, this.avatar.y, this.facing);
      this.lastSent = { x: this.avatar.x, y: this.avatar.y };
      this.lastSentAt = 0;
    }
    // 다른 사람은 받은 좌표로 부드럽게 보간해서 표시
    for (const peer of this.peers.values()) {
      peer.container.x += (peer.tx - peer.container.x) * 0.3;
      peer.container.y += (peer.ty - peer.container.y) * 0.3;
    }
    this.selfRing?.setPosition(this.avatar.x, this.avatar.y + 18);
    this.miniMap.setPeers([...this.peers].map(([id, p]) => ({ id, x: p.container.x, y: p.container.y, slot: roomClient.slotOf(id), color: this.slotColor(roomClient.slotOf(id)) })));
  }

  private teardownRoom() {
    this.roomUnsubs.forEach((off) => off());
    this.roomUnsubs = [];
    this.peers.forEach((p) => p.container.destroy());
    this.peers.clear();
    this.selfRing?.destroy();
    this.selfRing = undefined;
    this.closeInvite();
    this.inRoomMap = false;
    this.lastSent = { x: -1, y: -1 };
    this.lastSentAt = 0;
  }

  private createMarker(spawn: WildSpawn, index: number): WildMarker {
    const character = (charactersData as { code: string; name: string }[]).find((c) => c.code === spawn.characterCode);
    const container = this.add.container(spawn.x, spawn.y);
    const hasImage = this.textures.exists(`turby-${spawn.characterCode}`);
    const sprite = hasImage
      ? this.add.image(0, 0, `turby-${spawn.characterCode}`).setDisplaySize(40, 40)
      : this.add.circle(0, 0, 18, 0x7fc8ff).setStrokeStyle(2, 0x2d6fa3);
    const label = this.add.text(0, -34, character?.name ?? spawn.characterCode, { fontSize: '13px', color: '#eaf6ff' }).setOrigin(0.5, 1);
    // 교전 중 표시: 라벤더 펄스 링 + 명패(다른 사람이 이미 싸우는 중이라 재조우할 수 없다)
    const ring = (this.textures.exists('engaged-ring') ? this.add.image(0, 0, 'engaged-ring').setDisplaySize(84, 84) : this.add.circle(0, 0, 30).setStrokeStyle(4, 0xb9a6ee, 1)).setVisible(false);
    const badge = this.add.text(0, 30, '교전 중', { fontSize: '12px', color: '#695B67', backgroundColor: '#FFF4DF', padding: { x: 6, y: 2 } }).setOrigin(0.5, 0).setVisible(false);
    container.add([ring, sprite, label, badge]);
    return { spawn, index, gfx: container, encountered: false, state: 'free', ring, badge };
  }

  // 서버가 알려준 야생 상태를 마커에 반영: 포획·도망은 사라지고, 교전 중은 흐리게 + 링, free는 원래대로(무승부·취소로 되돌아옴)
  private applyWildState(index: number, state: WildState) {
    const m = this.markers.find((x) => x.index === index);
    if (!m) return;
    m.state = state;
    m.pulse?.stop();
    m.pulse = undefined;
    m.gfx.setVisible(state === 'free' || state === 'engaged');
    m.gfx.setAlpha(state === 'engaged' ? 0.65 : 1);
    m.ring.setVisible(state === 'engaged');
    m.badge.setVisible(state === 'engaged');
    // 교전 중에는 링이 맥동한다. 끝나면 원래 크기로 되돌린다.
    if (m.ring instanceof Phaser.GameObjects.Image) m.ring.setDisplaySize(84, 84);
    else m.ring.setScale(1);
    m.ring.setAlpha(1);
    if (state === 'engaged') m.pulse = this.tweens.add({ targets: m.ring, scale: m.ring.scale * 1.2, alpha: 0.5, duration: 800, yoyo: true, repeat: -1 });
    // 스토리 목적지 별: 다른 참가자가 대표 터비를 포획·도망시켰거나(사라짐) 다시 만날 수 있게 되면(free) 즉시 갱신한다
    this.miniMap?.setMarkerVisible(`target-${index}`, state === 'free' || state === 'engaged');
    if (state === 'free') m.encountered = false;
  }

  // ----- 4-C: 참전 초대 팝업(화면 4, 임시 도형) -----

  private showInvite(snap: BattleSnapshot) {
    const me = snap.participants.find((p) => p.playerId === roomClient.playerId);
    if (this.inviteLayer || !me?.invitePending || snap.phase !== 'inviting') return;
    this.pendingInvite = null;
    this.inviteBattleId = snap.battleId;
    this.encounterLocked = true;
    this.joystick.setEnabled(false);

    const cx = CANVAS_WIDTH / 2;
    const cy = 360;
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(this.add.rectangle(cx, cy, CANVAS_WIDTH, 720, 0x4a3a44, 0.55).setInteractive());
    objs.push(feltPanel(this, cx - 310, cy - 180, 620, 360, { radius: 28, strokeW: 6, image: 'invite-panel' }));
    const encounterer = snap.participants.find((p) => p.playerId === snap.encounterPlayerId);
    objs.push(this.add.text(cx, cy - 86, `${encounterer?.nickname ?? '동료'}님이 야생 터비와 조우했어요!`, { fontSize: '17px', color: TEXT.body }).setOrigin(0.5));
    if (this.textures.exists(`turby-${snap.wildCharacterCode}`)) objs.push(this.add.image(cx - 150, cy + 14, `turby-${snap.wildCharacterCode}`).setDisplaySize(112, 112));
    objs.push(this.add.text(cx - 60, cy - 52, snap.wildName, { fontSize: '26px', color: TEXT.body }));
    const stage = getStage(snap.stageCode);
    objs.push(this.add.text(cx - 60, cy - 18, stage.name, { fontSize: '15px', color: TEXT.sub, wordWrap: { width: 260 } }));
    // 남은 시간: 실타래 타이머 이미지 위에 숫자(서버 시각 기준으로 보정해 표시)
    if (this.textures.exists('invite-timer')) objs.push(this.add.image(cx + 220, cy - 4, 'invite-timer').setDisplaySize(104, 104));
    const countdown = this.add.text(cx + 220, cy - 4, '', { fontSize: '34px', color: TEXT.body }).setOrigin(0.5);
    objs.push(countdown);
    objs.push(this.add.text(cx - 60, cy + 34, '시간이 지나면 불참으로 처리돼요', { fontSize: '14px', color: TEXT.sub }));
    const respond = async (join: boolean) => {
      try {
        const res = await battleClient.respond(snap.battleId, join);
        this.closeInvite();
        if (join) this.goPartySelect(res.snapshot);
      } catch (err) {
        this.closeInvite();
        showToast(this, err instanceof RoomApiError ? err.message : '서버에 연결할 수 없습니다.', { y: 620, error: true, fixed: true });
      }
    };
    objs.push(pillButton(this, cx - 120, cy + 120, 220, 64, '참전', 'primary', () => void respond(true)));
    objs.push(pillButton(this, cx + 130, cy + 122, 180, 60, '불참', 'secondary', () => void respond(false)));
    this.inviteLayer = this.add.container(0, 0, objs).setDepth(3000).setScrollFactor(0);
    for (const o of objs) (o as Phaser.GameObjects.Text).setScrollFactor?.(0);
    for (const o of objs) if (o instanceof Phaser.GameObjects.Container) o.list.forEach((c) => (c as Phaser.GameObjects.Text).setScrollFactor?.(0));

    const tick = () => countdown.setText(String(Math.max(0, Math.ceil(((snap.expiresAt ?? 0) - roomClient.now()) / 1000))));
    tick();
    this.inviteTimer = this.time.addEvent({ delay: 250, loop: true, callback: tick });
  }

  private closeInvite() {
    this.inviteTimer?.remove(false);
    this.inviteTimer = null;
    this.inviteLayer?.destroy();
    this.inviteLayer = null;
    if (this.inviteBattleId) {
      this.inviteBattleId = null;
      this.encounterLocked = false;
      this.joystick?.setEnabled(true);
    }
  }

  // 초대가 열려 있는 동안 서버가 대신 처리한 변화(시간 초과로 불참 처리, 전투 종료 등)를 반영한다
  private onBattleUpdate(u: BattleUpdate) {
    if (u.battleId !== this.inviteBattleId) return;
    const me = u.snapshot.participants.find((p) => p.playerId === roomClient.playerId);
    if (!me || !me.invitePending) {
      this.closeInvite();
      if (me && !me.active) showToast(this, '참전 시간이 지나 불참 처리되었어요.', { y: 620, fixed: true });
    }
  }

  private goPartySelect(snapshot: BattleSnapshot) {
    this.scene.start('PartySelect', { stageCode: this.stageCode, wildCharacterCode: snapshot.wildCharacterCode, spawnIndex: snapshot.spawnIndex, capturedIndices: this.capturedIndices, removedIndices: this.removedIndices, snapshot });
  }

  update(_time: number, delta: number) {
    if (!this.ready || this.encounterLocked || this.inventoryPanel.isVisible) return;
    if (this.miniMap.isOpen) {
      this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);
      return;
    }

    const { x, y, magnitude } = this.joystick.getVector();
    if (magnitude > 0) {
      const dt = delta / 1000;
      const nextX = Phaser.Math.Clamp(this.avatar.x + x * AVATAR_SPEED * magnitude * dt, 0, this.stageWidth);
      const nextY = Phaser.Math.Clamp(this.avatar.y + y * AVATAR_SPEED * magnitude * dt, 0, this.stageHeight);
      this.avatar.setPosition(nextX, nextY);
      this.moveAngle = Math.atan2(y, x);
      this.facing = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
    }
    this.syncRoom(delta);
    this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);

    for (const marker of this.markers) {
      if (marker.encountered || marker.state !== 'free' || (marker.retryAt ?? 0) > Date.now()) continue;
      const dist = Phaser.Math.Distance.Between(this.avatar.x, this.avatar.y, marker.spawn.x, marker.spawn.y);
      if (dist <= ENCOUNTER_RADIUS) {
        this.triggerEncounter(marker);
        break;
      }
    }
  }

  // 3.2/3.3/4-B: 조우는 서버가 확인한다 — 서버가 (지역, 마커 번호)의 야생 종류를 정하고 전투를 만든 뒤에야 파티 선택으로 넘어간다.
  // 서버에 닿지 않으면 전투를 시작하지 않고 잠시 뒤 다시 시도할 수 있다(전투는 서버에서만 진행됨).
  private async triggerEncounter(marker: WildMarker) {
    marker.encountered = true;
    this.encounterLocked = true;
    try {
      const snapshot = await battleClient.start(marker.index);
      this.goPartySelect(snapshot);
    } catch (err) {
      marker.encountered = false;
      marker.retryAt = Date.now() + 4000;
      this.encounterLocked = false;
      const message = err instanceof RoomApiError ? err.message : '서버에 연결할 수 없어 전투를 시작할 수 없습니다.';
      if (err instanceof RoomApiError && ['WILD_ENGAGED', 'WILD_GONE'].includes(err.code)) marker.retryAt = Date.now() + 1500; // 이미 누가 선점한 야생 — 곧 상태 방송이 표시를 바꾼다
      showToast(this, message, { y: 620, error: true, width: 640, fixed: true });
    }
  }
}
