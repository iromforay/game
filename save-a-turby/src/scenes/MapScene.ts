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
import { SPRITESHEET_FRAMES } from '../assets/registry';
import { ensureUiPlaceholders } from '../assets/placeholders';
import { ensureMapMarkerTextures } from '../assets/mapMarkers';
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
import { MAP_DEPTH, planStageRender, type StageRenderPlan } from '../story/mapRender';
import { recoverUnackedResult } from '../state/unackedResult';
import { deferredRestore } from '../state/restoreAttempt';
import { resumeBattle } from './VillageScene';
import { frostFactorAt, needlePhaseAt, needleUnder, type NeedlePhase } from '../story/fridgeHazards';
import { DEEP_WATER_TEXT, FROST_ZONE_TEXT, NEEDLE_RETURN_TEXT, NoticeGate, POSITION_CORRECTED_TEXT, WILD_HINT_ENGAGED, WILD_HINT_NEAR, WILD_NOTICE_REPEAT_MS, wildNoticeKey, wildUnreachableText } from '../story/mapNotices';

// 배치된 자리 바로 옆(조우 반경 안)의 야생은 반경의 이 배수 밖으로 벗어난 뒤에야 다시 조우한다. 서버 반경이 크게 바뀌어도 같은 비율로 동작한다
const THICKET_KEY = 'hidden-area-thicket-locked'; // 개방 전 숨은 구역을 가리는 수풀 오버레이(미니맵 썸네일에도 같이 그린다)
const QUIET_EXIT_FACTOR = 1.1;
const WILD_RECHECK_MS = 1500; // 서버가 "닿지 않는다"고 한 야생을 다시 물어보기까지의 간격
const AVATAR_HALF = CLIENT_BODY_HALF; // 막힌 곳 판정에 쓰는 아바타 몸 반지름(px) — 서버와 같은 geometry 계약의 값
const DEPTH_GROUND = MAP_DEPTH.greybox;
const TRAP_SLOW_MS = 1200; // 서버 덫 지속 시간(lake.json blackThreadTraps.slowMs)과 같은 값 — 연출 길이용이며 판정은 서버
const MAP_TARGET_GLOW = 0xf6dfa8; // 임무 대상 외곽광 색(크림)
const DEPTH_STORY = MAP_DEPTH.story; // 이야기 지점·오브젝트 표식·문(아바타·야생 터비보다 아래)

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
  shownGoal: string | null = null; // 상단 목표 패널에 지금 표시 중인 문구(진단 전용)
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
  private trapSlowUntil = 0; // 검은 실 덫에 묶인 시각까지 이동 속도 50%(서버가 알려 준 시간 — 서버도 같은 상한을 건다)
  private pushRemain: { x: number; y: number } | null = null; // 물살에 밀린 거리 중 아직 화면에 반영하지 않은 만큼(10-13 C2-2: 짧은 보간 — 입력은 그대로 이어진다)
  private waterEvents = { currentPushes: 0, deepReturns: 0, trapSnares: 0, lastCurrentFieldId: null as string | null, needleReturns: 0, lastNeedleId: null as string | null };
  // 10-23 C4-1 4장: 서리 구역(이동 0.7배 + 화면 가장자리 서리)·바늘 칸(서버 시각 주기 표시). 판정은 서버
  private inFrost = false;
  private frostEdge: Phaser.GameObjects.GameObject[] = [];
  private needleViews: { id: string; warn: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle; strike: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle; phase: NeedlePhase | null }[] = [];
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
    this.inFrost = false;
    this.frostEdge = [];
    this.needleViews = [];
    this.waterEvents = { currentPushes: 0, deepReturns: 0, trapSnares: 0, lastCurrentFieldId: null, needleReturns: 0, lastNeedleId: null };
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
    this.bgImage = undefined; // 씬을 다시 시작하면 이전 배경 객체는 파괴됐다

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
    ensureMapMarkerTextures(this); // 지도 기호(정식 UI)
    // 지도 크기는 서버의 지역 화면 응답이 정한다(서버 충돌 판정과 같은 값). 응답을 받지 못했을 때만 설정의 임시 크기를 쓴다
    const width = (this.stageWidth = view?.size?.width ?? stage.width);
    const height = (this.stageHeight = view?.size?.height ?? stage.height);

    this.cameras.main.setBackgroundColor('#20301c');
    // 렌더링 계획(10-06 v2): 대형 배경 한 장(최종) / 회색상자(임시) / 반복 타일(지역 배치가 없는 다른 지역)을 서버 화면 데이터와 로드된 텍스처로 정한다.
    // 최종 배경 텍스처가 없으면(미납품·로드 실패) 임시 회색상자가 그대로 남는다. tileSprite는 최종 숲 분기에서 쓰지 않는다
    const plan = planStageRender(view, (key) => this.textures.exists(key), { width, height });
    this.cameras.main.setBounds(plan.bounds.x, plan.bounds.y, plan.bounds.width, plan.bounds.height);
    this.renderMode = plan.background.mode;
    if (plan.background.mode === 'final') this.bgImage = this.add.image(0, 0, plan.background.assetKey).setOrigin(0, 0).setDisplaySize(plan.background.width, plan.background.height).setDepth(MAP_DEPTH.background);
    else if (plan.background.mode === 'greybox' && view?.layout) this.drawGreybox(view, width, height);
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
    // 물 구역(10-13 C2-2): 얕은 물은 밝은 청록, 깊은 물은 어두운 남색 — 50% 축소에서도 구분된다. 마른 발판은 모래색 원
    for (const w of L.water ?? []) {
      if (w.kind === 'shallow') g.fillStyle(0x5aa6b8, 0.5).fillRect(w.x, w.y, w.width, w.height);
    }
    for (const w of L.water ?? []) {
      if (w.kind !== 'deep') continue;
      g.fillStyle(0x0d2347, 0.96).fillRect(w.x, w.y, w.width, w.height).lineStyle(3, 0x050f24, 1).strokeRect(w.x, w.y, w.width, w.height);
      this.add.text(w.x + w.width / 2, w.y + w.height / 2, '깊은 물', { fontSize: '15px', color: '#8fb4e8' }).setOrigin(0.5).setDepth(DEPTH_GROUND + 1);
    }
    for (const a of L.anchors ?? []) {
      g.fillStyle(0xd9c58f, 0.92).fillCircle(a.x, a.y, a.radius).lineStyle(3, 0x8a7440, 1).strokeCircle(a.x, a.y, a.radius);
    }
    // 4장(10-23 C4-1): 서리 구역은 옅은 하늘색, 바늘 칸은 줄무늬 테두리(회색상자 단계의 임시 표시 — 최종 배경이 오면 그림이 대신한다)
    for (const z of L.frost ?? []) g.fillStyle(0xbfe3f2, 0.35).fillRect(z.x, z.y, z.width, z.height);
    for (const n of L.needles ?? []) g.lineStyle(3, 0x9fb8cc, 0.8).strokeRect(n.x, n.y, n.width, n.height);
    g.lineStyle(10, 0x9aa59c, 0.45);
    for (const path of L.paths) for (let i = 1; i < path.length; i++) g.lineBetween(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    for (const b of L.blockers) {
      g.fillStyle(0x1f2420, 1).fillRect(b.x, b.y, b.width, b.height).lineStyle(2, 0x0f120f, 1).strokeRect(b.x, b.y, b.width, b.height);
      if (b.label) this.add.text(b.x + b.width / 2, b.y + b.height / 2, b.label, { fontSize: '13px', color: '#9aa59c' }).setOrigin(0.5).setDepth(DEPTH_GROUND + 1);
    }
    // 물 구역이 있는 지도(호수)에서는 가운데 동선을 가리지 않게 아래쪽 가장자리에 둔다
    const noteY = L.water && L.water.length > 0 ? height - 36 : height / 2 + 70;
    this.add.text(width / 2, noteY, '회색상자(임시 배치) — 기능·동선 확인용', { fontSize: '15px', color: '#e8c96a', backgroundColor: '#00000066', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(DEPTH_GROUND + 1);
  }

  // ----- 개발 전용 충돌 디버그 오버레이(10-14 C2-7A) -----
  // 서버가 내려 준 막힌 곳·문·깊은 물·마른 발판·이야기 지점 반경을 반투명 선으로 그린다. 개발 모드(import.meta.env.DEV)에서만 켤 수 있고 운영 빌드에는 들어가지 않는다.
  // 판정에는 쓰이지 않는다(서버 값을 그대로 보여 줄 뿐). 켜고 끄기: window.__dev.collisionDebug(true|false)
  private collisionDebug?: Phaser.GameObjects.Graphics;
  private collisionLegend: Phaser.GameObjects.GameObject[] = [];
  private collisionDebugOn = false;
  setCollisionDebug(on: boolean) {
    if (!import.meta.env.DEV) return;
    this.collisionDebugOn = on;
    this.drawCollisionDebug();
  }
  private drawCollisionDebug() {
    if (!import.meta.env.DEV) return;
    this.collisionDebug?.destroy();
    this.collisionDebug = undefined;
    this.collisionLegend.forEach((o) => o.destroy());
    this.collisionLegend = [];
    const view = this.stageView;
    if (!this.collisionDebugOn || !view) return;
    const g = (this.collisionDebug = this.add.graphics().setDepth(1500));
    const rect = (r: { x: number; y: number; width: number; height: number }, color: number, fill: number, line = 3) => g.fillStyle(color, fill).fillRect(r.x, r.y, r.width, r.height).lineStyle(line, color, 0.9).strokeRect(r.x, r.y, r.width, r.height);
    for (const w of view.layout?.water ?? []) rect(w, w.kind === 'deep' ? 0x2040ff : 0x40d0e0, 0.18);
    // blocker: 병합된 사각형들의 합집합을 옅은 단색 면 한 겹 + 바깥 외곽선으로(겹친 사각형 안쪽 선·겹친 면을 그리지 않는다, 10-15 C2-7C)
    this.drawBlockerUnion(g, view.layout?.blockers ?? []);
    for (const gt of view.gates) rect(gt, gt.open ? 0x40ff80 : 0xffa030, 0.22);
    for (const a of view.layout?.anchors ?? []) g.lineStyle(3, 0x30ff30, 0.9).strokeCircle(a.x, a.y, a.radius);
    for (const p of view.points) g.lineStyle(3, 0xffff30, 0.9).strokeCircle(p.x, p.y, p.radius);
    for (const t of view.layout?.traps ?? []) g.lineStyle(3, 0xff30ff, 0.9).strokeCircle(t.x, t.y, t.radius);
    // 물살: 자주색 영역 + 힘 방향 화살표(영역 중심에서 영역 길이의 절반만큼)
    for (const c of view.layout?.currents ?? []) {
      rect(c, 0xc040ff, 0.2);
      const cx = c.x + c.width / 2;
      const cy = c.y + c.height / 2;
      const len = Math.min(Math.max(c.width, c.height) * 0.4, 90);
      const ex = cx + c.dx * len;
      const ey = cy + c.dy * len;
      g.lineStyle(5, 0xffffff, 1).lineBetween(cx - c.dx * len, cy - c.dy * len, ex, ey);
      g.fillStyle(0xffffff, 1).fillTriangle(ex, ey, ex - c.dx * 18 - c.dy * 10, ey - c.dy * 18 + c.dx * 10, ex - c.dx * 18 + c.dy * 10, ey - c.dy * 18 - c.dx * 10);
    }
    // 범례(화면 고정): 색 ↔ 의미. 왼쪽 아래 가장자리의 작은 패널(화면을 가리지 않게 글자 11px)
    const legend: [number, string][] = [[0xff3030, 'blocker'], [0xffa030, 'gate(닫힘)'], [0x40ff80, 'gate(열림)'], [0x2040ff, 'deep water'], [0x40d0e0, 'shallow'], [0xc040ff, 'current(→힘 방향)'], [0x30ff30, 'safe anchor'], [0xffff30, 'story·rescue 반경'], [0xff30ff, 'trap 반경']];
    const top = this.scale.height - 8 - legend.length * 13;
    this.collisionLegend.push(this.add.rectangle(4, top - 4, 128, legend.length * 13 + 8, 0x000000, 0.55).setOrigin(0, 0).setScrollFactor(0).setDepth(1501));
    legend.forEach(([color, text], i) => {
      const y = top + i * 13;
      this.collisionLegend.push(this.add.rectangle(8, y + 2, 10, 8, color).setOrigin(0, 0).setScrollFactor(0).setDepth(1502));
      this.collisionLegend.push(this.add.text(22, y, text, { fontSize: '11px', color: '#ffffff' }).setOrigin(0, 0).setScrollFactor(0).setDepth(1502));
    });
  }
  // 개발 전용: blocker 합집합을 8px 칸으로 칠해 행마다 이어진 칸을 한 번만 채우고, 칠한 칸과 빈 칸 사이 경계만 선으로 긋는다
  private drawBlockerUnion(g: Phaser.GameObjects.Graphics, blockers: StageRect[]) {
    const CELL = 8;
    const gw = Math.ceil(this.stageWidth / CELL);
    const gh = Math.ceil(this.stageHeight / CELL);
    const on = new Uint8Array(gw * gh);
    for (const b of blockers)
      for (let y = Math.max(0, Math.floor(b.y / CELL)); y < Math.min(gh, Math.ceil((b.y + b.height) / CELL)); y++)
        for (let x = Math.max(0, Math.floor(b.x / CELL)); x < Math.min(gw, Math.ceil((b.x + b.width) / CELL)); x++) on[y * gw + x] = 1;
    const cell = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && on[y * gw + x] === 1;
    g.fillStyle(0xff3030, 0.16);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; ) {
        if (!cell(x, y)) {
          x++;
          continue;
        }
        const s = x;
        while (cell(x, y)) x++;
        g.fillRect(s * CELL, y * CELL, (x - s) * CELL, CELL);
      }
    g.lineStyle(1.5, 0xff3030, 0.9);
    // 가로 경계(위·아래 칸이 다름)와 세로 경계(왼쪽·오른쪽 칸이 다름)를 이어진 구간으로 묶어 긋는다
    for (let y = 0; y <= gh; y++)
      for (let x = 0; x < gw; ) {
        if (cell(x, y - 1) === cell(x, y)) {
          x++;
          continue;
        }
        const s = x;
        while (x < gw && cell(x, y - 1) !== cell(x, y)) x++;
        g.lineBetween(s * CELL, y * CELL, x * CELL, y * CELL);
      }
    for (let x = 0; x <= gw; x++)
      for (let y = 0; y < gh; ) {
        if (cell(x - 1, y) === cell(x, y)) {
          y++;
          continue;
        }
        const s = y;
        while (y < gh && cell(x - 1, y) !== cell(x, y)) y++;
        g.lineBetween(x * CELL, s * CELL, x * CELL, y * CELL);
      }
  }
  // 개발 전용: 카메라를 월드 좌표에 맞춘다(플레이어는 움직이지 않는다). 캡처·정합성 측정용
  lookAt(x: number, y: number) {
    if (!import.meta.env.DEV) return;
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(x, y);
  }

  // 서버가 내려 준 화면 상태로 맞춘다: 문·오브젝트·지점 표식, 막힌 곳, 지도 마커, 안내 버튼
  private applyStageView(view: StageView | null) {
    this.stageView = view;
    this.drawCollisionDebug();
    this.solids = solidRects(view);
    this.storyLayer.forEach((o) => o.destroy());
    this.storyLayer = [];
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.storyLayer.push(o);
      return o;
    };
    // 같은 서버 화면 데이터(view) 한 번으로 문 그림·오버레이·충돌(this.solids)을 함께 바꾼다 — 숨은 길의 그림과 통과 가능 여부가 어긋나지 않는다
    const plan: StageRenderPlan = planStageRender(view, (key) => this.textures.exists(key), { width: this.stageWidth, height: this.stageHeight });
    this.lastPlan = plan;
    // 잠금 배경 ↔ 기존 배경 전환: 같은 이미지 객체의 텍스처만 바꾼다(플레이어·카메라·충돌·소품은 그대로)
    if (plan.background.mode === 'final' && this.bgImage && this.bgImage.texture.key !== plan.background.assetKey) this.bgImage.setTexture(plan.background.assetKey).setDisplaySize(plan.background.width, plan.background.height);
    for (const o of plan.overlays) {
      const sheet = SPRITESHEET_FRAMES[o.assetKey];
      if (sheet) {
        // 4프레임 idle 시트(호수 일반 적): 첫 프레임부터 반복 재생. 알파는 충돌·상호작용 판정에 쓰지 않는다
        const animKey = `${o.assetKey}-idle`;
        if (!this.anims.exists(animKey)) this.anims.create({ key: animKey, frames: this.anims.generateFrameNumbers(o.assetKey, { start: 0, end: sheet.frames - 1 }), frameRate: sheet.fps, repeat: -1 });
        keep(this.add.sprite(o.x, o.y, o.assetKey).setOrigin(o.pivot[0], o.pivot[1]).setDisplaySize(o.width, o.height).setAngle(o.rotation).setAlpha(o.alpha).setDepth(o.depth).play(animKey));
        continue;
      }
      const img = keep(this.add.image(o.x, o.y, o.assetKey).setOrigin(o.pivot[0], o.pivot[1]).setDisplaySize(o.width, o.height).setAngle(o.rotation).setAlpha(o.alpha).setDepth(o.depth));
      // 10-23 C4-6 QA-11: 겹쳐 그리는 층(박힌 가느리의 실 땀 등)에만 외곽광
      if (o.glow && img.preFX) {
        img.preFX.setPadding(12);
        img.preFX.addGlow(MAP_TARGET_GLOW, 3, 0, false, 0.1, 12);
      }
    }
    for (const g of plan.gates) {
      const gate = view!.gates.find((x) => x.id === g.id)!;
      if (g.art) keep(this.add.image(g.art.x, g.art.y, g.art.assetKey).setOrigin(g.art.pivot[0], g.art.pivot[1]).setDisplaySize(g.art.width, g.art.height).setDepth(DEPTH_STORY));
      for (const q of g.pieces) {
        // 열림 그림의 일부(원본 px 사각형)를 이름 붙은 프레임으로 한 번 등록해 그 프레임만 그린다(PNG는 그대로)
        const tex = this.textures.get(q.assetKey);
        const frame = `piece-${q.frame.join('-')}`;
        if (!tex.has(frame)) tex.add(frame, 0, q.frame[0], q.frame[1], q.frame[2], q.frame[3]);
        keep(this.add.image(q.x, q.y, q.assetKey, frame).setOrigin(q.pivot[0], q.pivot[1]).setDisplaySize(q.width, q.height).setDepth(DEPTH_STORY));
      }
      if (!g.placeholder) continue; // 그림이 있거나 열린 문 — 임시 사각형은 닫힌 문의 그림이 없을 때만
      keep(this.add.rectangle(gate.x, gate.y, gate.width, gate.height, 0x6b5a8a, 0.95).setOrigin(0, 0).setStrokeStyle(2, 0xdcd3f4, 1).setDepth(DEPTH_STORY));
      keep(this.add.text(gate.x + gate.width / 2, gate.y - 6, gate.label, { fontSize: '13px', color: '#dcd3f4' }).setOrigin(0.5, 1).setDepth(DEPTH_STORY));
    }
    for (const o of view?.objects ?? []) {
      const locked = o.state === 'locked';
      const c = keep(this.add.container(o.x, o.y).setDepth(DEPTH_STORY));
      const ao = plan.objects.find((x) => x.id === o.id);
      const art = ao?.assetKey;
      if (art) {
        // 최종 그림이 있으면 그림으로(잠긴 것은 흐리게). 수집 반경 원·글자는 일반 화면에 내지 않는다
        c.add(this.add.image(0, 0, art).setDisplaySize(96, 96).setAlpha(locked ? 0.45 : 1)); // 규격 96×96 그대로
        continue;
      }
      // 임시 도형(마름모): 최종 에셋이 없을 때만
      const shape = this.add.graphics();
      shape.fillStyle(locked ? 0x8a8a8a : 0xffd23f, 1).fillPoints([{ x: 0, y: -16 }, { x: 14, y: 0 }, { x: 0, y: 16 }, { x: -14, y: 0 }], true);
      shape.lineStyle(2, 0x2a2a2a, 1).strokePoints([{ x: 0, y: -16 }, { x: 14, y: 0 }, { x: 0, y: 16 }, { x: -14, y: 0 }], true);
      c.add([this.add.circle(0, 0, o.radius).setStrokeStyle(1, locked ? 0x8a8a8a : 0xffd23f, 0.35), shape, this.add.text(0, 22, locked ? `${o.label} · 잠김` : o.label, { fontSize: '12px', color: locked ? '#b5b5b5' : '#ffe9a8' }).setOrigin(0.5, 0)]);
    }
    for (const pt of view?.points ?? []) {
      const c = keep(this.add.container(pt.x, pt.y).setDepth(DEPTH_STORY));
      const ap = plan.points.find((x) => x.id === pt.id);
      const art = ap?.assetKey;
      if (art) {
        const sized = ap!.art; // 서버 지역 데이터의 표시 크기 — 원본 PNG 크기(예: 1254px)를 그대로 쓰지 않는다
        const img = this.add.image(0, 0, art).setOrigin(sized?.pivot[0] ?? 0.5, sized?.pivot[1] ?? 0.7);
        c.add(sized ? img.setDisplaySize(sized.width, sized.height) : img.setScale(1));
        // 임무 대상 외곽광(10-16 C3-6 QA-01): 배경과 맞는 크림색, 불투명도 약 0.5. WebGL에서만(캔버스는 그림만)
        if (sized?.glow && img.preFX) {
          img.preFX.setPadding(12);
          img.preFX.addGlow(MAP_TARGET_GLOW, 3, 0, false, 0.1, 12);
        }
      }
      // 임시 표식(고리·글자): 지금(fallback)은 그림이 있어도 눈에 띄는 고리를 함께 둔다 — 목표를 놓치지 않게. 최종 모드(final)에서는 그림이 있는 대상에서 없앤다
      if (ap?.marker ?? true) {
        // 최종 모드(final)에서 그림이 없는 필수 지점: 작은 식별 고리만(반경 원·임시 글자 없음, 10-15 C2-7D). 목표는 상단 목표 문구·상호작용 버튼이 안내한다
        if (plan.markerMode === 'final') c.add([this.add.circle(0, 0, 20).setStrokeStyle(4, 0xb9a6ee, 1), this.add.circle(0, 0, 8, 0xb9a6ee)]);
        else {
          c.add([this.add.circle(0, 0, pt.radius).setStrokeStyle(2, 0xb9a6ee, 0.5), this.add.circle(0, 0, 20).setStrokeStyle(4, 0xb9a6ee, 1), this.add.circle(0, 0, 8, 0xb9a6ee)]);
          if (!art) c.add(this.add.text(0, 28, pt.label, { fontSize: '13px', color: '#e6dcff' }).setOrigin(0.5, 0));
        }
      }
    }
    this.refreshMiniMap();
    this.setActiveTarget(null);
    if (this.hud) this.showDelivery(this.lastDelivery); // 이야기 목표 문구는 지역 화면 데이터와 함께 바뀐다
  }

  // 미니맵·전체 지도에 놓이는 것을 지금 상태로 다시 그린다: 야생 터비(서버 좌표), 이야기 지점·오브젝트, 회색상자 지형
  private refreshMiniMap() {
    const view = this.stageView;
    const storyMarkers: MapMarker[] = [
      ...(view?.points ?? []).map((pt, i) => ({ id: pt.id, type: 'story' as const, name: pt.label, x: pt.x, y: pt.y, hint: pt.prompt, order: i })), // 서버가 내려 준 순서 = 이야기 진행 순서
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
    // 최종 배경이면 배경 그림을 축소해 지도로 쓰고(가려진 구역은 수풀 오버레이 그대로), 임시 도형은 그리지 않는다
    const plan = this.lastPlan;
    const art = plan?.background.mode === 'final' ? { assetKey: plan.background.assetKey, covers: plan.overlays.filter((o) => o.assetKey === THICKET_KEY).map((o) => ({ assetKey: o.assetKey, x: o.x - o.width * o.pivot[0], y: o.y - o.height * o.pivot[1], width: o.width, height: o.height })) } : undefined;
    const terrain = !art && view?.layout ? { zones: view.layout.zones, paths: view.layout.paths, blockers: view.layout.blockers, gates: view.gates } : undefined;
    this.miniMap?.setScene({ ...this.mapView, greybox: terrain, art }, [...wildMarkers, ...storyMarkers]);
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
    this.shownGoal = null;
    // 수집 목표(서버 인벤토리 수량)가 우선, 없으면 서버가 정한 이야기 목표 문구(2장 호수 등)
    const goalLabel = this.goalTextOverride ?? (delivery ? deliveryGoalText(delivery) : (this.stageView?.goal?.text ?? null));
    if (!goalLabel) return;
    this.shownGoal = goalLabel;
    const G = this.hud.goal;
    const goalFont = this.hud.font.goal;
    const cx = G.x + G.w / 2;
    const goal = this.add.text(cx, G.y + 10, goalLabel, { fontSize: `${goalFont}px`, color: '#ffe9a8', align: 'center', wordWrap: { width: G.w - 28, useAdvancedWrap: true } }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2001);
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
      // 10-06 v4 §1: 확인하지 않은 전투 결과가 있어 서버가 맵 입장을 거부했다 — 그 결과 화면으로 간다(조회가 실패하면 마을에서 복원 안내)
      if (await recoverUnackedResult(err, { fetchSnapshot: (id) => battleClient.snapshot(id).then((r) => r.snapshot), showResult: (snap) => resumeBattle(this, snap), fallbackToVillage: () => { deferredRestore.mark(); this.scene.start('Village'); }, isStale: () => !this.sys.isActive() })) return;
      console.warn('[room] 맵 입장 실패:', err);
    }
  }

  private renderMode: StageRenderPlan['background']['mode'] = 'tile';
  private lastPlan: StageRenderPlan | null = null;
  private bgImage?: Phaser.GameObjects.Image;

  // 진단용 요약(렌더링): 배경 방식·오버레이·문 그림·tileSprite 수 — 최종 에셋 연결 전후를 눈으로 보지 않고도 확인한다
  get debugRender() {
    const plan = planStageRender(this.stageView, (key) => this.textures.exists(key), { width: this.stageWidth, height: this.stageHeight });
    return {
      background: this.renderMode,
      overlays: plan.overlays.map((o) => o.assetKey),
      overlayPlans: plan.overlays.map((o) => ({ id: o.id, assetKey: o.assetKey, x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation, alpha: o.alpha, depth: o.depth })), // 월드 그림의 실제 표시 값(캡처·시험용)
      pointArts: plan.points.map((p) => ({ id: p.id, assetKey: p.assetKey, art: p.art })),
      gates: plan.gates.map((g) => ({ id: g.id, open: g.open, art: g.art?.assetKey ?? null, placeholder: g.placeholder })),
      tileSprites: this.children.list.filter((c) => c.type === 'TileSprite').length,
      collisionDebug: !!this.collisionDebug, // 개발 전용 충돌 오버레이가 지금 그려져 있는가(C2-7A)
      camera: { x: Math.round(this.cameras.main.worldView.x), y: Math.round(this.cameras.main.worldView.y), w: Math.round(this.cameras.main.worldView.width), h: Math.round(this.cameras.main.worldView.height) },
      imageObjects: this.storyLayer.filter((o) => o.type === 'Image').length,
      ...this.debugPlaceholders(plan),
    };
  }

  // 개발 진단 전용(사용자 화면에 표시하지 않는다): 정상 로드 상태의 최종 숲에서 임시 표시가 0인지 확인하는 수치
  private debugPlaceholders(plan: StageRenderPlan) {
    const flat: Phaser.GameObjects.GameObject[] = [];
    const walk = (o: Phaser.GameObjects.GameObject) => {
      flat.push(o);
      if (o.type === 'Container') for (const c of (o as Phaser.GameObjects.Container).list) walk(c);
    };
    for (const o of this.storyLayer) walk(o);
    const texts = flat.filter((o) => o.type === 'Text') as Phaser.GameObjects.Text[];
    const sceneTexts = this.children.list.filter((o) => o.type === 'Text') as Phaser.GameObjects.Text[];
    return {
      worldImages: flat.filter((o) => o.type === 'Image').length + plan.overlays.length, // 실제 에셋 월드 오브젝트(이야기 대상 그림 + 오버레이)
      placeholderMarkers: this.storyLayer.filter((o) => o.type === 'Container' && (o as Phaser.GameObjects.Container).list.some((c) => c.type === 'Arc' || c.type === 'Graphics')).length, // 임시 고리·마름모
      placeholderGates: plan.gates.filter((g) => g.placeholder).length + flat.filter((o) => o.type === 'Rectangle').length, // 임시 문 사각형
      tempLabels: texts.length + sceneTexts.filter((t) => /\(임시\)/.test(t.text)).length, // 임시 대상 label(대상·문 글자)
      greyboxNotices: sceneTexts.filter((t) => t.text.includes('회색상자')).length,
    };
  }

  // 진단용 요약(화면 상태만): 서버가 정한 위치에 배치됐는가, 서버 보정 횟수와 마지막 사유
  get debugPosition() {
    return {
      positioned: this.positioned, corrections: this.corrections, lastCorrection: this.lastCorrectionReason, unreachableWilds: this.unreachableWilds,
      ...this.waterEvents, pushing: this.pushRemain !== null, inFrost: this.inFrost, needles: this.needleViews.map((n) => ({ id: n.id, phase: n.phase })),
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
  private applyCorrection(pos: { x: number; y: number; reason?: string; currentFieldId?: string | null }) {
    // 검은 실 덫: 위치는 그대로, 서버가 정한 시간 동안만 느려진다(짧은 실 고리 연출). 시간·배율을 화면이 정하지 않는다
    if (pos.reason === 'trap') {
      this.waterEvents.trapSnares++;
      this.trapSlowUntil = this.time.now + TRAP_SLOW_MS;
      this.threadLoop(this.avatar.x, this.avatar.y);
      return;
    }
    this.lastSent = { x: pos.x, y: pos.y }; // 서버 위치와 다른 값을 다시 보내지 않는다(다시 움직이면 그때 보낸다)
    this.lastSentAt = 0;
    if (Math.abs(this.avatar.x - pos.x) < 0.5 && Math.abs(this.avatar.y - pos.y) < 0.5) return;
    // 10-13 C2-2: 서버가 옮긴 위치(물살·깊은 물 복귀). 서버가 정한 값만 쓴다 — 방향·거리를 화면이 계산하지 않는다
    if (pos.reason === 'current') {
      this.waterEvents.currentPushes++;
      this.trapSlowUntil = 0; // 덫에 묶인 채 맞은 밀림이면 서버가 속박을 함께 풀었다
      this.waterEvents.lastCurrentFieldId = pos.currentFieldId ?? null;
      this.lastCorrectionReason = 'current';
      this.pushRemain = { x: pos.x - this.avatar.x, y: pos.y - this.avatar.y };
      this.cameras.main.shake(140, 0.002); // 1회 흔들림
      this.waterBubbles(this.avatar.x, this.avatar.y);
      return;
    }
    // 10-23 C4-1: 내려찍는 바늘 칸 → 서버가 정한 안전 앵커로 돌아간다(피해·진행 손실 없음)
    if (pos.reason === 'needle') {
      this.waterEvents.needleReturns++;
      this.waterEvents.lastNeedleId = pos.currentFieldId ?? null;
      this.lastCorrectionReason = 'needle';
      this.pushRemain = null;
      this.avatar.setPosition(pos.x, pos.y);
      this.needleHint();
      return;
    }
    if (pos.reason === 'deep_water') {
      this.waterEvents.deepReturns++;
      this.lastCorrectionReason = 'deep_water';
      this.pushRemain = null;
      this.waterBubbles(this.avatar.x, this.avatar.y);
      this.avatar.setPosition(pos.x, pos.y);
      this.deepWaterHint();
      return;
    }
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

  // 물방울 몇 개가 떠올랐다 사라진다(물살 적용·깊은 물 복귀 표시). 판정과 무관한 연출
  private waterBubbles(x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      const b = this.add.circle(x + (i - 1.5) * 12, y + 10, 4 + (i % 2) * 2, 0xdff6ff, 0.8).setDepth(DEPTH_STORY + 2);
      this.tweens.add({ targets: b, y: y - 22 - i * 4, alpha: 0, duration: 420, delay: i * 40, onComplete: () => b.destroy() });
    }
  }

  // 덫에 걸린 순간의 짧은 실 고리 연출(판정과 무관)
  private threadLoop(x: number, y: number) {
    const ring = this.add.ellipse(x, y + 16, 70, 36).setStrokeStyle(4, 0x1d2a44, 0.9).setDepth(DEPTH_STORY + 2);
    this.tweens.add({ targets: ring, scaleX: 0.5, scaleY: 0.5, alpha: 0, duration: TRAP_SLOW_MS, onComplete: () => ring.destroy() });
  }

  // ---------- 4장 서리 구역·바늘 칸(10-23 C4-1) ----------
  // 지역 화면 데이터가 바뀔 때 바늘 칸 표식을 다시 만든다. 그림(needle-warn·needle-strike)이 있으면 그것을, 없으면 임시 사각형을 쓴다
  private buildNeedleViews() {
    this.needleViews.forEach((n) => {
      n.warn.destroy();
      n.strike.destroy();
    });
    this.needleViews = (this.stageView?.layout?.needles ?? []).map((f) => {
      const make = (key: string, color: number, alpha: number) =>
        (this.textures.exists(key) ? this.add.image(f.x, f.y, key).setOrigin(0, 0).setDisplaySize(f.width, f.height) : this.add.rectangle(f.x, f.y, f.width, f.height, color, alpha).setOrigin(0, 0)).setDepth(DEPTH_STORY - 0.5).setVisible(false);
      return { id: f.id, warn: make('needle-warn', 0x9fb8cc, 0.35), strike: make('needle-strike', 0xf2fbff, 0.75), phase: null };
    });
  }

  // 매 프레임: 바늘 칸 단계(서버 시각 보정)를 그리고, 내려찍기가 시작될 때 아바타가 그 칸 안에 서 있으면 위치를 한 번 다시 보고해 서버가 판정하게 한다.
  // 서리 구역에 들어서면 화면 가장자리에 서리를 두르고 처음 한 번 안내한다(안내 버튼은 지연하지 않는다 — 10-23 Codex 의견 P-02)
  private updateFridgeHazards() {
    const L = this.stageView?.layout;
    if (L?.needles && L.needles.length > 0) {
      if (this.needleViews.length !== L.needles.length) this.buildNeedleViews();
      const now = roomClient.now();
      const under = needleUnder(L.needles, this.avatar);
      for (const f of L.needles) {
        const v = this.needleViews.find((x) => x.id === f.id)!;
        const phase = needlePhaseAt(f, now);
        if (phase === 'strike' && v.phase !== 'strike' && under?.id === f.id && this.inRoomMap) {
          roomClient.sendMove(this.avatar.x, this.avatar.y, this.facing);
          this.lastSent = { x: this.avatar.x, y: this.avatar.y };
          this.lastSentAt = 0;
        }
        v.phase = phase;
        v.warn.setVisible(phase === 'warn');
        v.strike.setVisible(phase === 'strike');
      }
    }
    const frost = frostFactorAt(L?.frost, this.avatar) < 1;
    if (frost === this.inFrost) return;
    this.inFrost = frost;
    this.frostEdge.forEach((o) => o.destroy());
    this.frostEdge = [];
    if (!frost) return;
    const { width, height } = this.scale;
    if (this.textures.exists('voice-frost')) this.frostEdge.push(this.add.image(0, 0, 'voice-frost').setOrigin(0, 0).setDisplaySize(width, height).setScrollFactor(0).setAlpha(0.8).setDepth(DEPTH_STORY + 50)); // C4-6 QA-13: 둔해짐이 읽히게 0.6 → 0.8
    else {
      // 임시 표시(서리 그림 전): 화면 가장자리 네 변의 옅은 하늘색 띠. 가운데는 비운다
      const band = Math.round(Math.min(width, height) * 0.08);
      for (const [x, y, w, h] of [[0, 0, width, band], [0, height - band, width, band], [0, 0, band, height], [width - band, 0, band, height]]) this.frostEdge.push(this.add.rectangle(x, y, w, h, 0xdff3fb, 0.22).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_STORY + 50));
    }
    if (this.notices.once('frost-zone')) this.notice(FROST_ZONE_TEXT);
  }

  // 깊은 물에서 돌아왔을 때의 안내 — 한 탐험 세션(이 화면)에서 처음 한 번만
  private deepWaterHint() {
    if (this.notices.once('deep-water')) this.notice(DEEP_WATER_TEXT);
  }

  // 바늘에 닿아 돌아왔을 때의 안내 — 한 화면에서 처음 한 번만
  private needleHint() {
    if (this.notices.once('needle-return')) this.notice(NEEDLE_RETURN_TEXT);
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
      const speed = AVATAR_SPEED * (this.time.now < this.trapSlowUntil ? 0.5 : 1) * frostFactorAt(this.stageView?.layout?.frost, this.avatar); // 서리 구역: 서버와 같은 배율
      const to = { x: Phaser.Math.Clamp(this.avatar.x + x * speed * dt, 0, this.stageWidth), y: Phaser.Math.Clamp(this.avatar.y + y * speed * dt, 0, this.stageHeight) };
      const next = stepWithSolids(this.solids, { x: this.avatar.x, y: this.avatar.y }, to, AVATAR_HALF);
      this.avatar.setPosition(next.x, next.y);
      this.moveAngle = Math.atan2(y, x);
      this.facing = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
    }
    // 물살에 밀린 거리를 짧게(약 0.2초) 나눠 반영한다. 입력 이동은 위에서 그대로 적용되어 조작이 끊기지 않는다
    if (this.pushRemain) {
      const f = Math.min(1, delta / 200);
      const step = { x: this.pushRemain.x * f, y: this.pushRemain.y * f };
      this.pushRemain = { x: this.pushRemain.x - step.x, y: this.pushRemain.y - step.y };
      if (Math.hypot(this.pushRemain.x, this.pushRemain.y) < 0.5) this.pushRemain = null;
      this.avatar.setPosition(Phaser.Math.Clamp(this.avatar.x + step.x, 0, this.stageWidth), Phaser.Math.Clamp(this.avatar.y + step.y, 0, this.stageHeight));
    }
    this.syncRoom(delta);
    this.updateFridgeHazards();
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
      if (await recoverUnackedResult(err, { fetchSnapshot: (id) => battleClient.snapshot(id).then((r) => r.snapshot), showResult: (snap) => resumeBattle(this, snap), fallbackToVillage: () => { deferredRestore.mark(); this.scene.start('Village'); }, isStale: stale })) return; // 10-06 v4 §1
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
