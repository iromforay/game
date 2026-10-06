import Phaser from 'phaser';
import { AVATAR_SPEED, CANVAS_WIDTH } from '../config/constants';
import { getStage } from '../config/stages';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { InventoryPanel } from '../ui/InventoryPanel';
import { InventoryWindow } from '../ui/InventoryWindow';
import { displayScaleOf } from '../ui/responsive';
import { watchLayout } from '../ui/relayout';
import { mapHudLayout, type MapHudLayout } from '../ui/screenLayouts';
import { capturedLabel } from '../ui/screenStates';
import { playStory } from '../story/playStory';
import { MiniMap } from '../ui/MiniMap';
import type { MapMarker, MapView } from '../ui/MiniMap';
import { loadWorldImages } from '../assets/loader';
import { ensureUiPlaceholders } from '../assets/placeholders';
import { loadChapterStatuses, getCurrentChapter } from '../config/story';
import { roomClient, RoomApiError } from '../net/roomClient';
import { battleClient } from '../net/battleClient';
import type { BattleSnapshot, BattleUpdate, WildInfo, WildState } from '../net/battleTypes';
import { showToast, feltPanel, pillButton, PAL, TEXT } from '../ui/kit';
import coopSlots from '../data/coop-slots.json';
import type { Facing, MapPlayer } from '../net/roomClient';
import charactersData from '../data/characters.json';
import { AVATAR_IMAGE, CHARACTER_IMAGES, BACKGROUND_TILES } from '../assets/registry';
import { collectStoryObject, fetchStageView, fetchStory, triggerStory } from '../api/client';
import { DELIVERY_ITEM_NAME, deliveryGoalText, shortageText, type StoryDelivery, type StoryPlay } from '../story/storyFlow';
import { CLIENT_BODY_HALF, collectedText, nearestInteractable, promptText, solidRects, stepWithSolids, type Interactable, type StageRect, type StageView } from '../story/storyStage';
import { NoticeGate, POSITION_CORRECTED_TEXT, WILD_HINT_ENGAGED, WILD_HINT_NEAR, WILD_NOTICE_REPEAT_MS, wildNoticeKey, wildUnreachableText } from '../story/mapNotices';

// 배치된 자리 바로 옆(조우 반경 안)의 야생은 반경의 이 배수 밖으로 벗어난 뒤에야 다시 조우한다. 서버 반경이 크게 바뀌어도 같은 비율로 동작한다
const QUIET_EXIT_FACTOR = 1.1;
const WILD_RECHECK_MS = 1500; // 서버가 "닿지 않는다"고 한 야생을 다시 물어보기까지의 간격
const AVATAR_HALF = CLIENT_BODY_HALF; // 막힌 곳 판정에 쓰는 아바타 몸 반지름(px) — 서버와 같은 geometry 계약의 값
const DEPTH_GROUND = -20;
const DEPTH_STORY = -5; // 이야기 지점·오브젝트 표식(아바타·야생 터비보다 아래)

interface WildMarker {
  info: WildInfo; // 서버가 내려 준 마커(위치·종류) — 클라이언트 설정에는 야생 좌표가 없다
  index: number; // 서버 야생 마커 ID
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
  private hud!: MapHudLayout;
  private hudObjs: Phaser.GameObjects.GameObject[] = [];
  private areaName = '';
  private roomJoined = false;
  private leaving = false;
  private lastDelivery: StoryDelivery | null = null;
  private goalTextOverride: string | null = null; // 개발·시험용: 긴 목표 문구 표시 확인(운영 코드는 설정하지 않는다)
  private generation = 0; // 화면을 다시 만들 때마다 증가 — 응답을 기다리던 이전 create가 새 화면에 덧그리거나 리스너를 중복 등록하지 않게
  private pendingInvite: BattleSnapshot | null = null;
  private inviteLayer: Phaser.GameObjects.Container | null = null;
  private inviteTimer: Phaser.Time.TimerEvent | null = null;
  private inviteBattleId: string | null = null;
  private selfRing?: Phaser.GameObjects.Ellipse | Phaser.GameObjects.Image;
  private deliveryLayer: Phaser.GameObjects.GameObject[] = [];
  // 10-02 v4: 서버 권위 위치. positioned = 서버가 정한 위치에 배치됐는가(그 전에는 움직이지 않는다)
  private positioned = false;
  private corrections = 0; // 서버 보정 횟수(진단용)
  private lastCorrectionReason: string | null = null;
  private unreachableWilds = 0; // 서버가 가로막힘으로 거부한 조우 요청 수(진단용)
  private notices = new NoticeGate(); // 안내 반복 억제(같은 야생·같은 사유 3초, 위치 보정 안내는 한 번)
  private noticeLog: string[] = []; // 띄운 안내(진단용)
  private legacyTarget: { code: string; name: string; title: string } | null = null;
  private capturedShown = -1;
  private lastViewSyncAt = 0;
  private quietWilds = new Set<number>(); // 배치된 자리 바로 옆의 야생 터비 — 한 번 벗어나기 전에는 조우를 다시 시작하지 않는다
  // 10-02 v3: 지역 스토리 화면(서버가 내려 준 남은 오브젝트·활성 지점·문) — 좌표·문구·에셋 키는 전부 서버 데이터
  private stageView: StageView | null = null;
  private storyLayer: Phaser.GameObjects.GameObject[] = [];
  private solids: StageRect[] = [];
  private activeTarget: Interactable | null = null;
  private storyBusy = false;
  private interactBox?: Phaser.GameObjects.Rectangle;
  private interactLabel?: Phaser.GameObjects.Text;
  private mapView!: MapView;
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space' | 'enter', Phaser.Input.Keyboard.Key>;

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
    this.positioned = false;
    this.notices = new NoticeGate();
    this.noticeLog = [];
    this.legacyTarget = null;
    this.capturedShown = -1;
    this.quietWilds = new Set();
    this.roomLabel = undefined; // 같은 씬 인스턴스를 다시 쓰므로 이전 화면의 글자 참조를 비운다(파괴된 객체에 setText 방지)
    this.hudObjs = [];
    this.roomJoined = false;
    this.leaving = false;
    this.lastDelivery = null;
    this.goalTextOverride = null;
    this.stageView = null;
    this.storyLayer = [];
    this.solids = [];
    this.activeTarget = null;
    this.storyBusy = false;
    this.interactBox = undefined;
    this.interactLabel = undefined;
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
    // 지역 스토리 화면 데이터(없거나 실패해도 탐험은 된다 — 이야기 지점만 보이지 않는다)
    const view = await fetchStageView(stage.code).catch((err: unknown) => {
      console.warn('[story] 지역 이야기 정보를 불러오지 못했습니다:', err);
      return null;
    });
    if (gen !== this.generation || !this.sys.isActive()) return;
    ensureUiPlaceholders(this);
    // 지도 크기는 서버의 지역 화면 응답이 정한다(서버 충돌 판정과 같은 값). 응답을 받지 못했을 때만 설정의 임시 크기를 쓴다
    const width = (this.stageWidth = view?.size?.width ?? stage.width);
    const height = (this.stageHeight = view?.size?.height ?? stage.height);

    this.cameras.main.setBackgroundColor('#20301c');
    this.cameras.main.setBounds(0, 0, width, height);

    // 회색상자(임시) 배치가 있으면 반복 배경 대신 배치를 그린다 — 최종 지도가 오면 이 분기만 바꾼다
    if (view?.greybox && view.layout) this.drawGreybox(view, width, height);
    else this.add.tileSprite(0, 0, width, height, `bg-${stage.code}`).setOrigin(0, 0);

    this.avatar = this.add.image(width / 2, height / 2, 'avatar').setDisplaySize(44, 44);
    this.cameras.main.startFollow(this.avatar, true, 0.1, 0.1);

    this.joystick = new VirtualJoystick(this);
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = { up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT), w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D), e: kb.addKey(K.E), space: kb.addKey(K.SPACE), enter: kb.addKey(K.ENTER) };
    }

    // 구 판정(롤백 상태)일 때만: 지금 열린 장이 이 맵이면 대표 터비 스폰 위치를 별로 표시. 신 판정에서는 포획이 장을 열지 않아 표시하지 않는다.
    if (current && current.legacyTargetCode && current.chapter.stageCode === stage.code) this.legacyTarget = { code: current.legacyTargetCode, name: current.clearCharacterName, title: current.chapter.titleKo };
    const mapView: MapView = (this.mapView = { title: stage.name, width, height, bounds: { x: 0, y: 0, w: width, h: height } });
    this.miniMap = new MiniMap(this, mapView, [], '', (open) => {
      this.joystick.setEnabled(!open);
    });

    // 창은 한 번만 만든다(HUD를 다시 그려도 열린 창·리스너가 늘지 않게). v3 M4-D: 아이템 인벤토리(공용 창)와 보유 터비 창을 나눈다
    this.inventoryPanel = new InventoryPanel(this, () => this.joystick.setEnabled(true));
    this.inventoryWindow = new InventoryWindow(this, { onClose: () => this.joystick.setEnabled(true), onPlay: (play) => this.launchStory(play) });
    this.areaName = stage.name;
    this.buildHud();
    this.applyStageView(view);
    // 3.4/4-C·10-02 v6 §1: 야생 마커는 서버가 내려 준 것만 놓는다(위치·종류·상태 모두 서버 값). 이 지역의 탐험 세션이 있을 때만
    // 마지막으로 받은 값으로 먼저 그리고, 맵 입장 응답이 오면 다시 맞춘다. 서버에 없는 마커는 만들지 않는다
    if (roomClient.room?.stageCode === stage.code) this.syncWilds();
    // 창 크기가 바뀌면 맵을 다시 시작하지 않고 HUD·미니맵·목표 표시만 새 배율로 다시 그린다(위치·탐험 세션·목표 상태 유지)
    watchLayout(this, () => this.relayoutHud());
    this.ready = true;
    // M4-C: 이야기 대화가 끝나 이 화면이 깨어나면 전달 목표를 서버 기준으로 다시 그린다
    const onWake = () => {
      this.joystick.setEnabled(true);
      void this.refreshDelivery();
      void this.refreshStageView(); // 대화·전투로 진행이 바뀌었을 수 있다(지점이 닫히고 다음 지점·문이 열림)
    };
    this.events.on('wake', onWake);
    this.events.once('shutdown', () => this.events.off('wake', onWake));
    this.setupRoom();
  }

  // ----- 탐험 HUD(10-01 v2 §3): 지역 이름·포획 수·마을로·인벤토리·터비 — mapHudLayout(표시 배율별), 화면 위쪽 띠 안 -----

  private buildHud() {
    this.hudObjs.forEach((o) => o.destroy());
    this.hudObjs = [];
    const L = (this.hud = mapHudLayout(displayScaleOf(this.scale.displaySize.width)));
    const fix = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      (o as unknown as Phaser.GameObjects.Image).setScrollFactor(0);
      this.hudObjs.push(o);
      return o;
    };
    // 글자 상자: 영역 높이에 맞춘 반투명 배경 + 글자(긴 지역 이름은 자르지 않고 글자를 줄여 폭에 맞춘다)
    const label = (r: { x: number; y: number; w: number; h: number }, text: string, font: number, minFont: number) => {
      const t = fix(this.add.text(r.x + 8, r.y + r.h / 2, text, { fontSize: `${font}px`, color: '#ffffff' }).setOrigin(0, 0.5).setDepth(2001));
      for (let size = font - 1; t.width > r.w - 16 && size >= minFont; size--) t.setFontSize(size);
      fix(this.add.rectangle(r.x, r.y, Math.min(r.w, t.width + 16), r.h, 0x000000, 0.5).setOrigin(0, 0).setDepth(2000));
      return t;
    };
    const button = (r: { x: number; y: number; w: number; h: number }, text: string, color: number, onClick: () => void) => {
      const box = fix(this.add.rectangle(r.x, r.y, r.w, r.h, color).setOrigin(0, 0).setStrokeStyle(2, 0xffffff, 0.3).setDepth(2000));
      fix(this.add.text(r.x + r.w / 2, r.y + r.h / 2, text, { fontSize: `${L.font.button}px`, color: '#ffffff' }).setOrigin(0.5).setDepth(2001));
      box.setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    };
    label(L.area, this.areaName, L.font.area, Math.round(L.font.room));
    label(L.captured, capturedLabel(this.capturedCount()), L.font.label, L.font.label);
    // 4.1: 마을(입구) — 야생 맵에서 언제든 안전지대로 복귀 가능
    button(L.home, '마을로', 0x4a7a3a, () => {
      if (this.leaving) return; // 한 번만
      this.leaving = true;
      // 4.1/방: 마을로 나가는 것은 방 퇴장 — 서버 연결이 안 돼도 마을로는 돌아간다
      roomClient.leaveRoom().catch(() => undefined).finally(() => this.scene.start('Village'));
    });
    button(L.inventory, '인벤토리', 0x5a3a8a, () => {
      if (this.inventoryWindow.isVisible || this.inventoryPanel.isVisible || this.miniMap.isOpen) return;
      this.joystick.setEnabled(false);
      void this.inventoryWindow.open();
    });
    button(L.turbys, '터비', 0x5a3a8a, () => {
      if (this.inventoryWindow.isVisible || this.miniMap.isOpen) return;
      const opening = !this.inventoryPanel.isVisible;
      this.inventoryPanel.toggle();
      if (opening) this.joystick.setEnabled(false); // 닫을 때는 InventoryPanel의 onClose 콜백이 다시 켜줌
    });
    // 수집·이야기 지점 상호작용 버튼: 대상 가까이 있을 때만 보인다(조이스틱 영역 밖)
    this.interactBox = fix(this.add.rectangle(L.interact.x, L.interact.y, L.interact.w, L.interact.h, 0x241a3d, 0.92).setOrigin(0, 0).setStrokeStyle(3, 0xffd27f, 1).setDepth(2000));
    this.interactLabel = fix(this.add.text(L.interact.x + L.interact.w / 2, L.interact.y + L.interact.h / 2, '', { fontSize: `${L.font.button}px`, color: '#ffe9a8' }).setOrigin(0.5).setDepth(2001));
    this.interactBox.setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.interact());
    this.showInteract();
    // 방·참가자 상태(방에 있을 때만)
    this.roomLabel = undefined;
    if (this.roomJoined) {
      this.roomLabel = fix(this.add.text(L.room.x, L.room.y, '', { fontSize: `${L.font.room}px`, color: '#ffffff', backgroundColor: '#00000080', padding: { x: 6, y: 3 } }).setDepth(2000));
      this.refreshRoomLabel();
    }
  }

  private relayoutHud() {
    this.buildHud();
    this.miniMap.relayout();
    this.showDelivery(this.lastDelivery);
    this.inventoryPanel.relayout();
  }

  // ----- 10-02 v3: 지역 스토리 화면 — 회색상자 배치, 고유 오브젝트 수집, 이야기 지점 -----

  // 회색상자(임시): 구역·길·막힌 곳을 도형으로만 그린다. 좌표는 서버 지역 데이터 — 최종 지도와 에셋이 오면 이 그리기만 바꾼다
  private drawGreybox(view: StageView, width: number, height: number) {
    const L = view.layout!;
    const g = this.add.graphics().setDepth(DEPTH_GROUND);
    g.fillStyle(0x3b423c, 1).fillRect(0, 0, width, height);
    g.lineStyle(1, 0x4a524b, 1);
    for (let x = 0; x <= width; x += 200) g.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += 200) g.lineBetween(0, y, width, y);
    for (const z of L.zones) {
      g.fillStyle(0x566058, 0.55).fillRect(z.x, z.y, z.width, z.height).lineStyle(2, 0x8a968c, 0.9).strokeRect(z.x, z.y, z.width, z.height);
      this.add.text(z.x + 8, z.y + 6, z.label, { fontSize: '16px', color: '#cfd8d0' }).setDepth(DEPTH_GROUND + 1);
    }
    g.lineStyle(10, 0x9aa59c, 0.45);
    for (const path of L.paths) for (let i = 1; i < path.length; i++) g.lineBetween(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    for (const b of L.blockers) {
      g.fillStyle(0x1f2420, 1).fillRect(b.x, b.y, b.width, b.height).lineStyle(2, 0x0f120f, 1).strokeRect(b.x, b.y, b.width, b.height);
      if (b.label) this.add.text(b.x + b.width / 2, b.y + b.height / 2, b.label, { fontSize: '13px', color: '#9aa59c' }).setOrigin(0.5).setDepth(DEPTH_GROUND + 1);
    }
    this.add.text(width / 2, height / 2 + 70, '회색상자(임시 배치) — 기능·동선 확인용', { fontSize: '15px', color: '#e8c96a', backgroundColor: '#00000066', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(DEPTH_GROUND + 1);
  }

  // 서버가 내려 준 화면 상태로 맞춘다: 문·오브젝트·지점 표식, 막힌 곳, 지도 마커, 안내 버튼
  private applyStageView(view: StageView | null) {
    this.stageView = view;
    this.solids = solidRects(view);
    this.storyLayer.forEach((o) => o.destroy());
    this.storyLayer = [];
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.storyLayer.push(o);
      return o;
    };
    for (const gate of view?.gates ?? []) {
      if (gate.open) continue;
      keep(this.add.rectangle(gate.x, gate.y, gate.width, gate.height, 0x6b5a8a, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xdcd3f4, 1).setDepth(DEPTH_STORY));
      keep(this.add.text(gate.x + gate.width / 2, gate.y - 6, gate.label, { fontSize: '13px', color: '#dcd3f4' }).setOrigin(0.5, 1).setDepth(DEPTH_STORY));
    }
    for (const o of view?.objects ?? []) {
      const locked = o.state === 'locked';
      const c = keep(this.add.container(o.x, o.y).setDepth(DEPTH_STORY));
      // 임시 도형(마름모): 최종 에셋이 오면 o.assetKey로 그림을 바꾼다
      const shape = this.add.graphics();
      shape.fillStyle(locked ? 0x8a8a8a : 0xffd23f, 1).fillPoints([{ x: 0, y: -16 }, { x: 14, y: 0 }, { x: 0, y: 16 }, { x: -14, y: 0 }], true);
      shape.lineStyle(2, 0x2a2a2a, 1).strokePoints([{ x: 0, y: -16 }, { x: 14, y: 0 }, { x: 0, y: 16 }, { x: -14, y: 0 }], true);
      c.add([this.add.circle(0, 0, o.radius).setStrokeStyle(1, locked ? 0x8a8a8a : 0xffd23f, 0.35), shape, this.add.text(0, 22, locked ? `${o.label} · 잠김` : o.label, { fontSize: '12px', color: locked ? '#b5b5b5' : '#ffe9a8' }).setOrigin(0.5, 0)]);
    }
    for (const pt of view?.points ?? []) {
      const c = keep(this.add.container(pt.x, pt.y).setDepth(DEPTH_STORY));
      c.add([this.add.circle(0, 0, pt.radius).setStrokeStyle(2, 0xb9a6ee, 0.5), this.add.circle(0, 0, 20).setStrokeStyle(4, 0xb9a6ee, 1), this.add.circle(0, 0, 8, 0xb9a6ee), this.add.text(0, 28, pt.label, { fontSize: '13px', color: '#e6dcff' }).setOrigin(0.5, 0)]);
    }
    this.refreshMiniMap();
    this.setActiveTarget(null);
  }

  // 미니맵·전체 지도에 놓이는 것을 지금 상태로 다시 그린다: 야생 터비(서버 좌표), 이야기 지점·오브젝트, 회색상자 지형
  private refreshMiniMap() {
    const view = this.stageView;
    const storyMarkers: MapMarker[] = [
      ...(view?.points ?? []).map((pt) => ({ id: pt.id, type: 'story' as const, name: pt.label, x: pt.x, y: pt.y, hint: pt.prompt })),
      ...(view?.objects ?? []).map((o) => ({ id: o.id, type: 'dust' as const, name: o.label, x: o.x, y: o.y, hint: o.state === 'locked' ? '아직 모을 수 없어요' : o.prompt })),
    ];
    // 야생 터비: 지금 보이는 것만(포획·도망은 서버가 visible=false로 내려 준다). 좌표는 화면의 마커와 같은 서버 값
    const shown = this.markers.filter((m) => m.info.visible);
    const target = this.legacyTarget; // 구 판정(롤백 상태)일 때만: 지금 열린 장의 대표 터비는 별로 표시
    const wildMarkers: MapMarker[] = shown.map((m) =>
      target && m.info.characterCode === target.code
        ? { id: `target-${m.index}`, type: 'target' as const, name: `대표 터비 ${target.name}`, x: m.info.x, y: m.info.y, hint: `${target.title}: '${target.name}'를 조우해 직접 포획하면 다음 지역이 열려요.` }
        : { id: `wild-${m.index}`, type: 'wild' as const, name: this.characterName(m.info.characterCode), x: m.info.x, y: m.info.y, hint: m.info.state === 'engaged' ? WILD_HINT_ENGAGED : WILD_HINT_NEAR },
    );
    // 전체 지도·미니맵: 회색상자 모드에서만 길·벽·문·공개된 구역을 임시 도형으로 그린다(최종 지도가 오면 이 임시 배경은 없어진다)
    const terrain = view?.greybox && view.layout ? { zones: view.layout.zones, paths: view.layout.paths, blockers: view.layout.blockers, gates: view.gates } : undefined;
    this.miniMap?.setScene({ ...this.mapView, greybox: terrain }, [...wildMarkers, ...storyMarkers]);
  }

  // ----- 10-02 v6 §1: 야생 마커 — 서버가 내려 준 목록(roomClient.wilds)과 화면을 맞춘다 -----

  // 서버에 있는 마커만 남기고(없어진 것은 지운다), 새 마커는 만들고, 좌표·종류가 바뀐 마커는 안전하게 옮기거나 다시 만든다
  private syncWilds() {
    const server = roomClient.wilds;
    for (const m of this.markers.filter((x) => !server.has(x.index) || server.get(x.index)!.characterCode !== x.info.characterCode)) this.dropMarker(m);
    for (const info of server.values()) {
      const m = this.markers.find((x) => x.index === info.index) ?? this.addMarker(info);
      m.info = info;
      m.gfx.setPosition(info.x, info.y);
      this.applyWildState(info.index, info.state);
    }
    this.refreshMiniMap();
    this.refreshCaptured();
  }

  private addMarker(info: WildInfo): WildMarker {
    const m = this.createMarker(info);
    this.markers.push(m);
    return m;
  }

  private dropMarker(m: WildMarker) {
    m.pulse?.stop();
    m.gfx.destroy();
    this.quietWilds.delete(m.index);
    this.markers = this.markers.filter((x) => x !== m);
  }

  // 서버의 야생 상태 방송: 같은 마커 ID의 상태(와 좌표)를 반영한다. 모르는 마커거나 종류가 바뀌었으면 목록 전체를 다시 맞춘다
  private onWildChanged(info: WildInfo) {
    const m = this.markers.find((x) => x.index === info.index);
    if (!m || m.info.characterCode !== info.characterCode) return this.syncWilds();
    const redraw = m.info.x !== info.x || m.info.y !== info.y || m.info.visible !== info.visible || m.info.state !== info.state;
    m.info = info;
    m.gfx.setPosition(info.x, info.y);
    this.applyWildState(info.index, info.state);
    if (redraw) this.refreshMiniMap();
    this.refreshCaptured();
  }

  private characterName(code: string) {
    return (charactersData as { code: string; name: string }[]).find((c) => c.code === code)?.name ?? code;
  }

  // 포획 수: 이 탐험 세션에서 서버가 포획됨으로 표시한 야생 수(새로고침 뒤에도 같다). 탐험 세션이 없으면 화면이 넘겨받은 값
  private capturedCount() {
    return this.roomJoined ? this.markers.filter((m) => m.state === 'captured').length : this.capturedIndices.length;
  }

  private refreshCaptured() {
    const n = this.capturedCount();
    if (n === this.capturedShown || !this.hud) return;
    this.capturedShown = n;
    this.buildHud();
  }

  // 짧은 안내(이동을 막지 않는다 — 글자만 잠깐 보인다)
  private notice(text: string) {
    this.noticeLog.push(text);
    showToast(this, text, { y: this.hud.toastY, fixed: true });
  }

  private async refreshStageView() {
    const gen = this.generation;
    try {
      const view = await fetchStageView(this.stageCode);
      if (gen !== this.generation || !this.sys.isActive()) return;
      this.applyStageView(view);
    } catch (err) {
      console.warn('[story] 지역 이야기 정보를 불러오지 못했습니다:', err);
    }
  }

  private setActiveTarget(it: Interactable | null) {
    if ((it?.target.id ?? null) === (this.activeTarget?.target.id ?? null) && (it?.type ?? null) === (this.activeTarget?.type ?? null)) {
      this.activeTarget = it; // 같은 대상(상태만 바뀌었을 수 있음)
      this.showInteract();
      return;
    }
    this.activeTarget = it;
    this.showInteract();
  }

  private showInteract() {
    const it = this.activeTarget;
    const on = !!it && !this.storyBusy;
    this.interactBox?.setVisible(on);
    this.interactLabel?.setVisible(on);
    if (it) this.interactLabel?.setText(promptText(it));
    if (this.interactBox?.input) this.interactBox.input.enabled = on;
  }

  // 수집·지점 발동: 대상 ID만 보낸다. 허용 여부·수량·진행은 서버가 정하고, 거절되면 서버 상태로 다시 맞춘다
  private async interact() {
    const it = this.activeTarget;
    if (!it || this.storyBusy || !this.ready || this.encounterLocked) return;
    if (this.roomJoined && !this.positioned) return; // 복원·입장이 끝나기 전에는 수집·발동 요청을 보내지 않는다
    this.storyBusy = true;
    this.showInteract();
    const gen = this.generation;
    const stale = () => gen !== this.generation || !this.sys.isActive();
    if (this.inRoomMap) roomClient.sendMove(this.avatar.x, this.avatar.y, this.facing); // 서버가 아는 내 위치를 지금 자리로
    try {
      if (it.type === 'object') {
        const res = await collectStoryObject(it.target.objectiveKey, it.target.id);
        if (stale()) return;
        this.applyStageView(res.stage);
        const name = DELIVERY_ITEM_NAME[res.grants[0]?.itemCode ?? ''] ?? '빛나는 실가루';
        showToast(this, collectedText(name, res.collected, res.required), { y: this.hud.toastY, fixed: true });
        void this.refreshDelivery();
      } else {
        const res = await triggerStory(it.target.id);
        if (stale()) return;
        this.showDelivery(res.story.delivery);
        if (res.shortage) showToast(this, shortageText(res.shortage), { y: this.hud.toastY, fixed: true });
        if (res.play) this.launchStory(res.play); // 끝나면 wake에서 화면을 다시 맞춘다
        else await this.refreshStageView();
      }
    } catch (err) {
      if (stale()) return;
      showToast(this, err instanceof Error && err.message ? err.message : '서버에 연결할 수 없습니다.', { y: this.hud.toastY, error: true, fixed: true });
      await this.refreshStageView();
    } finally {
      this.storyBusy = false;
      if (!stale()) this.showInteract();
    }
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

  // 퀘스트 추적(빛나는 실가루 n/10, 서버 인벤토리 수량). 전달은 보풀이 지점의 안내 버튼으로 한다(원격 전달 버튼은 없다).
  // 목표가 없으면 패널을 남기지 않는다. 긴 목표 문구는 왼쪽 HUD와 미니맵 사이 폭 안에서 줄바꿈한다(자르지 않음)
  private showDelivery(delivery: StoryDelivery | null) {
    this.lastDelivery = delivery;
    this.deliveryLayer.forEach((o) => o.destroy());
    this.deliveryLayer = [];
    if (!delivery) return;
    const G = this.hud.goal;
    const goalFont = this.hud.font.goal;
    const cx = G.x + G.w / 2;
    const goal = this.add.text(cx, G.y + 10, this.goalTextOverride ?? deliveryGoalText(delivery), { fontSize: `${goalFont}px`, color: '#ffe9a8', align: 'center', wordWrap: { width: G.w - 28, useAdvancedWrap: true } }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2001);
    const panelW = Math.min(G.w, Math.max(Math.min(G.w, 440), goal.width + 28));
    const panelH = goal.height + 20;
    const panel = this.add.rectangle(cx, G.y + panelH / 2, panelW, panelH, 0x241a3d, 0.9).setStrokeStyle(2, 0xffd27f, 0.9).setScrollFactor(0).setDepth(2000);
    this.deliveryLayer.push(panel, goal);
  }

  // ----- 4-A: 같은 방 플레이어 위치 동기화(개발용 표시 — 최종 표현은 코덱스 디자인 확정 후 교체) -----

  private setupRoom() {
    const room = roomClient.room;
    if (!room || room.stageCode !== this.stageCode) return;
    this.roomJoined = true;
    this.buildHud(); // 방 상태 줄을 포함해 다시 그린다

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
      roomClient.on('correct', (pos) => this.applyCorrection(pos)),
      roomClient.on('wildChanged', (w) => this.onWildChanged(w)),
      roomClient.on('reconnected', () => this.syncWilds()), // 재접속 인증이 새로 내려 준 야생 목록(공개·비공개 변화 포함)으로 다시 맞춘다
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
      const players = await roomClient.enterMap(this.facing);
      if (!this.inRoomMap) return; // 입장 응답을 기다리는 사이 씬이 끝남
      this.syncWilds(); // 서버가 이 입장에 내려 준 야생 마커(위치·종류·상태)로 맞춘다
      this.placeAt(roomClient.selfOnEnter);
      // 10-02 v6 §4.1: 저장돼 있던 위치를 쓸 수 없어 서버가 시작 지점으로 보정했다 — 한 번만 알린다(작은 이동 보정에는 알리지 않는다)
      if (roomClient.selfOnEnter?.corrected && this.notices.once('position-corrected')) this.notice(POSITION_CORRECTED_TEXT);
      players.forEach((p) => this.upsertPeer(p));
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

  // 진단용 요약(화면 상태만): 서버가 정한 위치에 배치됐는가, 서버 보정 횟수와 마지막 사유
  get debugPosition() {
    return {
      positioned: this.positioned, corrections: this.corrections, lastCorrection: this.lastCorrectionReason, unreachableWilds: this.unreachableWilds,
      notices: [...this.noticeLog], size: { width: this.stageWidth, height: this.stageHeight }, captured: this.capturedCount(),
      // 화면에 놓인 야생 마커(서버 마커 ID·화면 좌표·상태)
      wilds: this.markers.map((m) => ({ index: m.index, characterCode: m.info.characterCode, x: m.gfx.x, y: m.gfx.y, state: m.state, visible: m.gfx.visible })),
    };
  }

  // 서버가 확정한 위치에 배치한다(첫 입장 = 시작 지점, 재입장 = 마지막 승인 위치). 그 자리 바로 옆의 야생 터비는 한 번 벗어난 뒤에야 다시 조우한다
  private placeAt(self: { x: number; y: number } | null) {
    if (self) {
      this.avatar.setPosition(self.x, self.y);
      this.lastSent = { x: self.x, y: self.y };
      this.cameras.main.centerOn(self.x, self.y);
      for (const m of this.markers) if (Phaser.Math.Distance.Between(self.x, self.y, m.info.x, m.info.y) <= roomClient.encounterRadius) this.quietWilds.add(m.index);
    }
    this.positioned = true;
  }

  // 서버가 이동을 승인하지 않았다: 마지막 승인 위치로 되돌린다. 입력은 막지 않고, 같은 보정을 여러 번 받아도 한 번만 움직인다.
  // 벽·문 때문이면 화면의 문 상태가 서버와 다를 수 있으므로 지역 화면을 다시 받는다(1초에 한 번까지)
  private applyCorrection(pos: { x: number; y: number; reason?: string }) {
    this.lastSent = { x: pos.x, y: pos.y }; // 서버 위치와 다른 값을 다시 보내지 않는다(다시 움직이면 그때 보낸다)
    this.lastSentAt = 0;
    if (Math.abs(this.avatar.x - pos.x) < 0.5 && Math.abs(this.avatar.y - pos.y) < 0.5) return;
    this.avatar.setPosition(pos.x, pos.y);
    this.corrections++;
    this.lastCorrectionReason = pos.reason ?? null;
    if (pos.reason && pos.reason !== 'speed' && this.time.now - this.lastViewSyncAt > 1000) {
      this.lastViewSyncAt = this.time.now;
      void this.refreshStageView();
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

  // 이름·그림 같은 표시 정보만 클라이언트 데이터(characters.json)에서 고른다. 위치와 종류는 서버 마커 그대로
  private createMarker(info: WildInfo): WildMarker {
    const container = this.add.container(info.x, info.y);
    const hasImage = this.textures.exists(`turby-${info.characterCode}`);
    const sprite = hasImage
      ? this.add.image(0, 0, `turby-${info.characterCode}`).setDisplaySize(40, 40)
      : this.add.circle(0, 0, 18, 0x7fc8ff).setStrokeStyle(2, 0x2d6fa3);
    const label = this.add.text(0, -34, this.characterName(info.characterCode), { fontSize: '13px', color: '#eaf6ff' }).setOrigin(0.5, 1);
    // 교전 중 표시: 라벤더 펄스 링 + 명패(다른 사람이 이미 싸우는 중이라 재조우할 수 없다)
    const ring = (this.textures.exists('engaged-ring') ? this.add.image(0, 0, 'engaged-ring').setDisplaySize(84, 84) : this.add.circle(0, 0, 30).setStrokeStyle(4, 0xb9a6ee, 1)).setVisible(false);
    const badge = this.add.text(0, 30, '교전 중', { fontSize: '12px', color: '#695B67', backgroundColor: '#FFF4DF', padding: { x: 6, y: 2 } }).setOrigin(0.5, 0).setVisible(false);
    container.add([ring, sprite, label, badge]);
    return { info, index: info.index, gfx: container, encountered: false, state: 'free', ring, badge };
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
    if (this.roomJoined && !this.positioned) return; // 서버가 위치를 정해 주기 전
    if (this.miniMap.isOpen) {
      this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);
      return;
    }

    if (this.inventoryWindow.isVisible) return;
    // 이동: 조이스틱 + 키보드(방향키·WASD). 막힌 곳(먼지풀·닫힌 문)은 지나가지 못하고 벽을 따라 미끄러진다
    const joy = this.joystick.getVector();
    const k = this.keys;
    let x = joy.x * joy.magnitude + (k && (k.right.isDown || k.d.isDown) ? 1 : 0) - (k && (k.left.isDown || k.a.isDown) ? 1 : 0);
    let y = joy.y * joy.magnitude + (k && (k.down.isDown || k.s.isDown) ? 1 : 0) - (k && (k.up.isDown || k.w.isDown) ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (len > 0.05) {
      const dt = delta / 1000;
      const to = { x: Phaser.Math.Clamp(this.avatar.x + x * AVATAR_SPEED * dt, 0, this.stageWidth), y: Phaser.Math.Clamp(this.avatar.y + y * AVATAR_SPEED * dt, 0, this.stageHeight) };
      const next = stepWithSolids(this.solids, { x: this.avatar.x, y: this.avatar.y }, to, AVATAR_HALF);
      this.avatar.setPosition(next.x, next.y);
      this.moveAngle = Math.atan2(y, x);
      this.facing = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
    }
    this.syncRoom(delta);
    this.miniMap.update(this.avatar.x, this.avatar.y, this.moveAngle);

    // 가까이 있는 수집 오브젝트·이야기 지점: 안내 버튼을 보이고, 키(E·스페이스·엔터)로도 누를 수 있다
    this.setActiveTarget(this.storyBusy ? null : nearestInteractable(this.stageView, this.avatar.x, this.avatar.y));
    if (this.activeTarget && k && [k.e, k.space, k.enter].some((key) => Phaser.Input.Keyboard.JustDown(key))) void this.interact();

    for (const marker of this.markers) {
      if (marker.encountered || marker.state !== 'free' || (marker.retryAt ?? 0) > Date.now()) continue;
      const dist = Phaser.Math.Distance.Between(this.avatar.x, this.avatar.y, marker.info.x, marker.info.y);
      if (this.quietWilds.has(marker.index)) {
        if (dist > roomClient.encounterRadius * QUIET_EXIT_FACTOR) this.quietWilds.delete(marker.index);
        continue;
      }
      if (dist <= roomClient.encounterRadius) {
        this.triggerEncounter(marker);
        break;
      }
    }
  }

  // 3.2/3.3/4-B: 조우는 서버가 확인한다 — 서버가 (지역, 마커 번호)의 야생 종류를 정하고 전투를 만든 뒤에야 파티 선택으로 넘어간다.
  // 10-06 v1 §4: 요청하는 동안에도 이동 입력을 잠그지 않는다. 같은 야생으로의 중복 요청만 막고(marker.encountered),
  // 실제 조우가 승인돼 전투 전환이 시작될 때만 잠근다(encounterLocked). 늦게 도착한 응답은 이미 시작된 전환이나 다시 맞춘 마커를 덮지 않는다.
  // 서버에 닿지 않으면 전투를 시작하지 않고 잠시 뒤 다시 시도할 수 있다(전투는 서버에서만 진행됨).
  private async triggerEncounter(marker: WildMarker) {
    marker.encountered = true;
    const gen = this.generation;
    // 이 응답이 아직 유효한가: 화면이 그대로이고, 다른 조우가 이미 승인돼 전환 중이 아니며, 이 마커가 아직 화면에 있다
    const stale = () => gen !== this.generation || !this.sys.isActive() || this.encounterLocked || !this.markers.includes(marker);
    try {
      const snapshot = await battleClient.start(marker.index);
      if (stale()) return;
      this.encounterLocked = true; // 승인됨 — 이제부터 이동 입력을 잠그고 전투 화면으로 넘어간다
      this.goPartySelect(snapshot);
    } catch (err) {
      if (stale()) return;
      marker.encountered = false;
      marker.retryAt = Date.now() + 4000;
      // 10-02 v5 §1·v6 §3: 벽·닫힌 문 너머라 서버가 거부한 야생 — 전투도 마커도 그대로 두고,
      // 매 프레임 묻지 않게 1.5초 뒤에 다시 확인한다. 고장으로 보이지 않게 사유별 안내를 띄우되 같은 야생·같은 사유는 3초 안에 반복하지 않는다
      if (err instanceof RoomApiError && err.code === 'WILD_UNREACHABLE') {
        marker.retryAt = Date.now() + WILD_RECHECK_MS;
        this.unreachableWilds++;
        if (this.notices.allow(wildNoticeKey(marker.index, err.reason), Date.now(), WILD_NOTICE_REPEAT_MS)) this.notice(wildUnreachableText(err.reason));
        return;
      }
      const message = err instanceof RoomApiError ? err.message : '서버에 연결할 수 없어 전투를 시작할 수 없습니다.';
      if (err instanceof RoomApiError && ['WILD_ENGAGED', 'WILD_GONE'].includes(err.code)) marker.retryAt = Date.now() + 1500; // 이미 누가 선점한 야생 — 곧 상태 방송이 표시를 바꾼다
      showToast(this, message, { y: 620, error: true, width: 640, fixed: true });
    }
  }
}
