import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT, AVATAR_SPEED, JOYSTICK_BASE_RADIUS, JOYSTICK_THUMB_RADIUS, DEPTH } from '../config/constants';
import { GRADE_COLORS } from '../config/gradeColors';
import { kirbyGrade, pickWeightedRandomKirby, type KirbyDef } from '../data/kirbyData';
import { kirbyNetwork } from '../net/KirbyNetwork';
import type { PlayerStateDto } from '../api/client';
import { allKirbyImageKeys, getKirbyImageUrl, getLobbyAssetUrl, getUiAssetUrl, PLAYER_AVATAR_URL, UI_COIN_URL } from '../assets/registry';
import { PlayerAvatar, ensurePlayerAvatarAnims, preloadPlayerAvatarAssets } from '../objects/PlayerAvatar';

const kirbyTextureKey = (imageKey: string) => `kirby-${imageKey}`;

// 2026-09-18: 이미지 1단계(DELIVERED) 반영 — 전부 1280x720 기준 네이티브 좌표라 px()/py() 변환 불필요.
const PLAYER_START = { x: 640, y: 620 };
const MOVE_BOUNDS = { minX: 90, maxX: 1190, minY: 190, maxY: 670 };
// lobby-collision-mask.png 기준 분수 발판 위치(원형 차단 구역) — 플레이어가 안으로 못 들어가게 밀어냄
const FOUNTAIN_BLOCK = { x: 640, y: 230, radius: 150 };

// 4채 집(S1-L03~L06) — bottomLeft(초록)는 항상 "내 기지" 고정, 나머지 3곳은 접속 중인 플레이어를 동적 배정
// 코덱스 확정(to_claude_v3_C.md 규칙3): 하단 전경(lobby-front-foliage)은 플레이어보다 높은 depth를
// 유지해야 해서, 아래쪽 두 집은 전경 띠(y 500~720)와 살짝만 겹치도록(발밑 화단 정도) 위로 당겨둠.
const HOUSE_DOORS = {
  topLeft: { x: 165, y: 165, texture: 'house-red' },
  topRight: { x: 1115, y: 165, texture: 'house-blue' },
  bottomLeft: { x: 165, y: 430, texture: 'house-green' },
  bottomRight: { x: 1115, y: 430, texture: 'house-orange' },
} as const;
const HOUSE_DISPLAY_SIZE = 220;
const DOOR_ENTER_RADIUS = 110;

// 2026-09-18 로직 변경: 카펫이 흐르는 방식 대신, market-stage.png의 좌대 4곳에 각자 스폿(스폰
// 지점)을 두고 7초간 전시 후 사라졌다가 다른 캐릭터로 재스폰. 좌표는 market-stage.png(760x190
// 네이티브, 배치 위치 (640, CARPET_Y+40)) 위 4개 원형 좌대 중심을 눈대중 산출.
const CARPET_Y = 470;
const SPOT_LIFETIME_MS = 7000;
const SPOT_RESPAWN_GAP_MS = 300;
const SPOT_FADE_MS = 350; // 사용자 지적(2026-09-18): 재스폰이 즉시 사라짐/등장이라 깜빡임처럼 보임 — 페이드아웃/인으로 대체
const SPOT_POS = [
  { x: 404, y: 495 },
  { x: 564, y: 495 },
  { x: 724, y: 495 },
  { x: 883, y: 495 },
];

const JOYSTICK_CENTER = { x: 115, y: 650 };

// 3단계(HUD·모바일 컨트롤, DELIVERED 2026-09-18) — 미니맵 위젯 배치(우측 하단 온라인 패널 아래)
const MINIMAP_CENTER = { x: 1210, y: 150 };
const MINIMAP_DISPLAY = 130; // minimap-frame.png 표시 지름
const MINIMAP_RANGE = 110; // 이 픽셀 반경 안에 월드 전체(1280x720)를 눌러 담음

function truncateKirbyName(name: string, max = 12): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

interface SpotKirby {
  kirby: KirbyDef;
  glow: Phaser.GameObjects.Arc;
  tagBg: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  priceText: Phaser.GameObjects.Text;
  timer: Phaser.Time.TimerEvent;
  purchasing?: boolean;
}

interface HouseSlotView {
  key: keyof typeof HOUSE_DOORS;
  zone: Phaser.GameObjects.Zone;
  nameTag: Phaser.GameObjects.Text;
  doorGlow: Phaser.GameObjects.Image;
  targetPlayerId: string | null; // null = 내 기지
  wasNear: boolean; // 근접 진입 이벤트를 "들어온 순간"에만 1회 발동시키기 위한 엣지 감지용
}

export class LobbyScene extends Phaser.Scene {
  private goldText!: Phaser.GameObjects.Text;
  private onlineText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private avatar!: PlayerAvatar;
  private minimapArrow!: Phaser.GameObjects.Image;
  private myBaseStatusIcon!: Phaser.GameObjects.Image;
  private spots: (SpotKirby | null)[] = [null, null, null, null];
  private houseSlots: HouseSlotView[] = [];
  private pos = { x: PLAYER_START.x, y: PLAYER_START.y };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private joyThumb!: Phaser.GameObjects.Image;
  private joyPointerId: number | null = null;
  private joyVector = { x: 0, y: 0 };

  private onStateChanged = (state: PlayerStateDto) => this.refreshFromState(state);

  constructor() {
    super('LobbyScene');
  }

  preload() {
    // 이미지 1단계(DELIVERED, 2026-09-18) — docs/Steal a Kirby_image_generation_plan.md 4.3
    const lobbyAsset = (key: string) => getLobbyAssetUrl(key)!;
    this.load.image('lobby-ground', lobbyAsset('background/lobby-ground'));
    this.load.image('house-red', lobbyAsset('buildings/base-house-red'));
    this.load.image('house-blue', lobbyAsset('buildings/base-house-blue'));
    this.load.image('house-green', lobbyAsset('buildings/base-house-green'));
    this.load.image('house-orange', lobbyAsset('buildings/base-house-orange'));
    this.load.image('fountain-base', lobbyAsset('landmarks/fountain-base'));
    this.load.image('market-stage', lobbyAsset('landmarks/market-stage'));
    this.load.image('market-sign', lobbyAsset('landmarks/market-sign'));
    this.load.image('lobby-front-foliage', lobbyAsset('foreground/lobby-front-foliage'));
    this.load.image('door-glow', lobbyAsset('buildings/base-door-glow'));

    this.load.image('player-avatar', PLAYER_AVATAR_URL); // 레드카펫 텍스처 로딩 실패 시 폴백용으로만 유지
    preloadPlayerAvatarAssets(this);
    this.load.image('ui-coin', UI_COIN_URL);
    for (const key of allKirbyImageKeys(128)) {
      this.load.image(kirbyTextureKey(key), getKirbyImageUrl(key, 128)!);
    }

    // 이미지 3단계(DELIVERED, 2026-09-18) — HUD/미니맵/조이스틱 UI
    const uiAsset = (key: string) => getUiAssetUrl(key)!;
    this.load.image('ui-coin-panel', uiAsset('hud/coin-panel'));
    this.load.image('ui-online-panel', uiAsset('hud/online-panel'));
    this.load.image('ui-lobby-title-panel', uiAsset('hud/lobby-title-panel'));
    this.load.image('ui-shop-price-tag', uiAsset('hud/shop-price-tag'));
    this.load.image('ui-shop-slot-glow', uiAsset('hud/shop-slot-glow'));
    this.load.image('ui-status-lock', uiAsset('hud/status-lock'));
    this.load.image('ui-status-offline', uiAsset('hud/status-offline'));
    this.load.image('ui-status-stealing', uiAsset('hud/status-stealing'));
    this.load.image('ui-minimap-frame', uiAsset('minimap/minimap-frame'));
    this.load.image('ui-minimap-ground', uiAsset('minimap/minimap-ground'));
    this.load.image('ui-player-arrow', uiAsset('minimap/player-arrow'));
    this.load.image('ui-base-dot', uiAsset('minimap/base-dot'));
    this.load.image('ui-joystick-base', uiAsset('controls/joystick-base'));
    this.load.image('ui-joystick-thumb', uiAsset('controls/joystick-thumb'));
  }

  create() {
    this.spots = [null, null, null, null];
    this.houseSlots = [];
    this.pos = { ...PLAYER_START };

    // depth 레이어 체계(2026-09-18): Ground→Buildings→DoorGlow→Actors(100+y)→Foreground→WorldLabel→HUD→Controls→Modal
    this.add.image(0, 0, 'lobby-ground').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT).setDepth(DEPTH.GROUND);

    this.add.image(FOUNTAIN_BLOCK.x, FOUNTAIN_BLOCK.y, 'fountain-base').setDepth(DEPTH.BUILDINGS);
    this.add.image(CANVAS_WIDTH / 2, 380, 'market-sign').setDepth(DEPTH.BUILDINGS);
    // 사용자 지적(2026-09-18, to_claude_v7 P1): 시장 명패가 항상 비어있었음 — 기본 지역명 표기
    this.add.text(CANVAS_WIDTH / 2, 380, '커비 마을 시장', { fontSize: '16px', color: '#3d2410', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.BUILDINGS + 1);
    // 이미지 3단계(DELIVERED) — 상단 로비 타이틀 패널(빈 장식판 대신 지역명 상시 표기)
    this.add.image(CANVAS_WIDTH / 2, 105, 'ui-lobby-title-panel').setDisplaySize(300, 72).setDepth(DEPTH.HUD - 1);
    this.add.text(CANVAS_WIDTH / 2, 105, '커비 마을', { fontSize: '20px', color: '#3d2410', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.add.image(CANVAS_WIDTH / 2, CARPET_Y + 40, 'market-stage').setDepth(DEPTH.BUILDINGS);
    // 이미지 3단계(DELIVERED) — 좌대 4곳에 상시 표시되는 상점 슬롯 프레임(스폰/재스폰과 무관하게 고정)
    for (const spot of SPOT_POS) {
      this.add.image(spot.x, spot.y, 'ui-shop-slot-glow').setDisplaySize(90, 90).setDepth(DEPTH.BUILDINGS + 1);
    }

    for (const key of Object.keys(HOUSE_DOORS) as (keyof typeof HOUSE_DOORS)[]) {
      const door = HOUSE_DOORS[key];
      this.add.image(door.x, door.y, door.texture).setDisplaySize(HOUSE_DISPLAY_SIZE, HOUSE_DISPLAY_SIZE).setDepth(DEPTH.BUILDINGS);
      const zone = this.add.zone(door.x, door.y, HOUSE_DISPLAY_SIZE, HOUSE_DISPLAY_SIZE).setInteractive({ useHandCursor: true }).setDepth(DEPTH.BUILDINGS + 1);
      // 이미지 2단계(DELIVERED) — base-door-glow.png를 문 위치에 겹쳐서 근접 시 알파로 표시
      const isMine = key === 'bottomLeft';
      // 버그성 지적(2026-09-18) 반영: 내 기지는 "어디가 내 것인지" 한눈에 알아보게 근접 여부와
      // 무관하게 항상 은은한 후광 + 왕관 아이콘 + 금색 강조 라벨로 표시(다른 집은 근접 시에만 표시).
      const doorGlow = this.add.image(door.x, door.y, 'door-glow').setDisplaySize(140, 140).setAlpha(isMine ? 0.4 : 0).setDepth(DEPTH.DOOR_GLOW);
      if (isMine) {
        doorGlow.setTint(0xffd700);
        this.add
          .text(door.x, door.y - HOUSE_DISPLAY_SIZE / 2 - 8, '★ 내 기지 ★', { fontSize: '15px', color: '#ffd700', fontStyle: 'bold', backgroundColor: '#00000099', padding: { x: 8, y: 4 } })
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.WORLD_LABEL);
      }
      const nameTag = this.add
        .text(door.x, door.y + HOUSE_DISPLAY_SIZE / 2 + 14, '', {
          fontSize: '13px',
          color: isMine ? '#ffd700' : '#ffffff',
          align: 'center',
          backgroundColor: '#00000099',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 0)
        .setDepth(DEPTH.WORLD_LABEL);
      // 이미지 3단계(DELIVERED) 규칙11: 역할/상태는 색상만으로 구분하지 않고 아이콘도 이름표 옆에 표시
      if (isMine) {
        this.myBaseStatusIcon = this.add
          .image(door.x - 60, door.y + HOUSE_DISPLAY_SIZE / 2 + 24, 'ui-status-offline')
          .setDisplaySize(22, 22)
          .setVisible(false)
          .setDepth(DEPTH.WORLD_LABEL);
      }
      // 클릭은 데스크톱 테스트/보조 입력으로 유지 — 실제 진입 트리거는 update()의 근접 감지(캐릭터가 만남)
      zone.on('pointerdown', () => void this.onHouseClick(key));
      this.houseSlots.push({ key, zone, nameTag, doorGlow, targetPlayerId: isMine ? '' : null, wasNear: false });
    }

    // 코덱스 확정(to_claude_v3_C.md 규칙3): 전경은 플레이어보다 높은 depth 유지 — 아래쪽 두 집을
    // 위로 당겨둬서(HOUSE_DOORS 참고) 화단 정도만 겹치고 지붕·문은 가려지지 않게 함
    this.add.image(0, CANVAS_HEIGHT - 220, 'lobby-front-foliage').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, 220).setDepth(DEPTH.FOREGROUND);

    // 이미지 3단계(DELIVERED) — 골드 배경을 반투명 사각형 대신 실제 코인 패널로 교체
    // (사용자 지적 2026-09-18: 연한 노란 글씨가 황금색 배경에 묻히던 문제도 진한 목재색 패널로 해결)
    this.add.image(75, 42, 'ui-coin-panel').setDisplaySize(190, 58).setOrigin(0, 0.5).setDepth(DEPTH.HUD - 1);
    this.add.image(95, 42, 'ui-coin').setDisplaySize(28, 28).setDepth(DEPTH.HUD);
    this.goldText = this.add.text(115, 42, '연결 중...', { fontSize: '20px', color: '#ffe082', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(DEPTH.HUD);
    this.add.image(1190, 20, 'ui-online-panel').setDisplaySize(150, 46).setOrigin(0, 0).setDepth(DEPTH.HUD - 1);
    this.onlineText = this.add.text(1265, 43, '', { fontSize: '13px', color: '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(DEPTH.HUD);
    // 이미지 3단계 — 미니맵(온라인 패널 아래): 배경(지형)+틀+내 위치 화살표+내 기지 점
    this.add.image(MINIMAP_CENTER.x, MINIMAP_CENTER.y, 'ui-minimap-ground').setDisplaySize(MINIMAP_DISPLAY, MINIMAP_DISPLAY).setDepth(DEPTH.HUD - 1);
    for (const key of Object.keys(HOUSE_DOORS) as (keyof typeof HOUSE_DOORS)[]) {
      const door = HOUSE_DOORS[key];
      this.addMinimapDot(door.x, door.y, key === 'bottomLeft' ? 0xffd700 : 0xffffff); // 내 기지만 금색으로 구분
    }
    this.minimapArrow = this.add.image(MINIMAP_CENTER.x, MINIMAP_CENTER.y, 'ui-player-arrow').setDisplaySize(18, 18).setDepth(DEPTH.HUD + 1);
    this.add.image(MINIMAP_CENTER.x, MINIMAP_CENTER.y, 'ui-minimap-frame').setDisplaySize(MINIMAP_DISPLAY + 20, MINIMAP_DISPLAY + 20).setDepth(DEPTH.HUD + 2);
    this.messageText = this.add
      .text(CANVAS_WIDTH / 2, 130, '', { fontSize: '16px', color: '#ff5252', backgroundColor: '#00000099', padding: { x: 10, y: 6 } })
      .setOrigin(0.5)
      .setDepth(DEPTH.MODAL);

    ensurePlayerAvatarAnims(this);
    // 사용자 지적(2026-09-18, to_claude_v7 P1) — 로컬 플레이어 시인성 확보를 위해 약 20% 확대(64→76)
    this.avatar = new PlayerAvatar(this, this.pos.x, this.pos.y, 76);

    // 마켓 가챠(2026-09-18 로직 변경) — market-stage.png 좌대 4곳에 각자 캐릭터가 스폰되어 7초간
    // 전시되다 사라지고 다른 캐릭터로 재스폰. 동시에 다 같이 바뀌지 않도록 초기 스폰을 살짝 어긋나게 시작.
    SPOT_POS.forEach((_, i) => this.time.delayedCall(i * 400, () => this.spawnAtSpot(i)));

    // 가상 조이스틱(화면 좌하단) — 마우스/터치 겸용, 데스크톱은 방향키도 지원
    // 이미지 3단계(DELIVERED) — 도형 대신 실제 조이스틱 에셋(고대비 청록색 베이스+테두리)
    this.input.addPointer(1);
    this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-base').setDisplaySize(JOYSTICK_BASE_RADIUS * 2.2, JOYSTICK_BASE_RADIUS * 2.2).setDepth(DEPTH.CONTROLS);
    this.joyThumb = this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-thumb').setDisplaySize(JOYSTICK_THUMB_RADIUS * 2.2, JOYSTICK_THUMB_RADIUS * 2.2).setDepth(DEPTH.CONTROLS + 1);
    this.setupJoystick();
    this.cursors = this.input.keyboard!.createCursorKeys(); // 데스크톱 테스트용 보조 입력 — 실제 조작은 조이스틱(모바일)

    kirbyNetwork.on('stateChanged', this.onStateChanged);
    kirbyNetwork.on('invasionStarted', this.onInvasionStarted);
    this.events.once('shutdown', () => {
      kirbyNetwork.off('stateChanged', this.onStateChanged);
      kirbyNetwork.off('invasionStarted', this.onInvasionStarted);
    });

    if (kirbyNetwork.state) this.refreshFromState(kirbyNetwork.state);
    this.refreshOnlinePlayers();
    this.time.addEvent({ delay: 4000, loop: true, callback: () => this.refreshOnlinePlayers() });
  }

  update(_time: number, delta: number) {
    const speed = (AVATAR_SPEED * delta) / 1000;
    let dx = this.joyVector.x;
    let dy = this.joyVector.y;
    if (this.cursors.left?.isDown) dx -= 1;
    if (this.cursors.right?.isDown) dx += 1;
    if (this.cursors.up?.isDown) dy -= 1;
    if (this.cursors.down?.isDown) dy += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      let nx = Phaser.Math.Clamp(this.pos.x + (dx / len) * speed, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
      let ny = Phaser.Math.Clamp(this.pos.y + (dy / len) * speed, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);
      // lobby-collision-mask.png 기준 분수 발판 눈대중 원형 차단 — 안으로 들어가면 가장자리로 밀어냄
      const fdx = nx - FOUNTAIN_BLOCK.x;
      const fdy = ny - FOUNTAIN_BLOCK.y;
      const fdist = Math.hypot(fdx, fdy);
      if (fdist < FOUNTAIN_BLOCK.radius && fdist > 0) {
        nx = FOUNTAIN_BLOCK.x + (fdx / fdist) * FOUNTAIN_BLOCK.radius;
        ny = FOUNTAIN_BLOCK.y + (fdy / fdist) * FOUNTAIN_BLOCK.radius;
      }
      const movedX = nx - this.pos.x;
      const movedY = ny - this.pos.y;
      this.pos.x = nx;
      this.pos.y = ny;
      this.avatar.setPosition(this.pos.x, this.pos.y);
      this.avatar.updateMovement(movedX, movedY);
      this.minimapArrow.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
    } else {
      this.avatar.updateMovement(0, 0);
    }
    const mm = this.worldToMinimap(this.pos.x, this.pos.y);
    this.minimapArrow.setPosition(mm.x, mm.y);

    for (const slot of this.houseSlots) {
      const door = HOUSE_DOORS[slot.key];
      const isMine = slot.key === 'bottomLeft';
      const near = Phaser.Math.Distance.Between(this.pos.x, this.pos.y, door.x, door.y) <= DOOR_ENTER_RADIUS;
      // 내 기지는 항상 은은하게 보이다가 근접 시 더 밝아짐, 남의 기지는 근접 시에만 표시(기존 규칙 유지)
      slot.doorGlow.setAlpha(near ? 0.85 : isMine ? 0.4 : 0);
      // 버그성 지적(2026-09-18) 반영: 기지 진입은 클릭이 아니라 캐릭터와 기지가 "만나는" 순간(근접 진입 엣지) 자동 발동.
      // 클릭 핸들러(onHouseClick)는 그대로 두어 데스크톱 보조 입력으로 유지.
      if (near && !slot.wasNear) void this.onHouseClick(slot.key);
      slot.wasNear = near;
    }
  }

  private setupJoystick() {
    // 모바일 게임 — 조이스틱이 실제 이동을 담당하는 1차 입력. 터치 포인터 ID로 추적해서(BaseScene과
    // 동일 패턴) 다른 터치(집 클릭 등)가 겹쳐도 조이스틱 상태가 엉키지 않게 함.
    const withinBase = (x: number, y: number) => Phaser.Math.Distance.Between(x, y, JOYSTICK_CENTER.x, JOYSTICK_CENTER.y) <= JOYSTICK_BASE_RADIUS + 20;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.joyPointerId !== null || !withinBase(p.x, p.y)) return;
      this.joyPointerId = p.id;
      this.updateJoystick(p.x, p.y);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.joyPointerId) return;
      this.updateJoystick(p.x, p.y);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.releaseJoystick(p.id));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.releaseJoystick(p.id));
  }

  private updateJoystick(x: number, y: number) {
    const dx = x - JOYSTICK_CENTER.x;
    const dy = y - JOYSTICK_CENTER.y;
    const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_BASE_RADIUS);
    const angle = Math.atan2(dy, dx);
    this.joyThumb.setPosition(JOYSTICK_CENTER.x + Math.cos(angle) * dist, JOYSTICK_CENTER.y + Math.sin(angle) * dist);
    this.joyVector = dist < 6 ? { x: 0, y: 0 } : { x: Math.cos(angle), y: Math.sin(angle) };
  }

  private releaseJoystick(pointerId: number) {
    if (pointerId !== this.joyPointerId) return;
    this.joyPointerId = null;
    this.joyVector = { x: 0, y: 0 };
    this.joyThumb.setPosition(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y);
  }

  // 이미지 3단계(DELIVERED) 미니맵 — 월드 좌표(1280x720)를 미니맵 원(반경 MINIMAP_RANGE) 안으로 눌러 담음
  private worldToMinimap(x: number, y: number) {
    return {
      x: MINIMAP_CENTER.x + ((x - CANVAS_WIDTH / 2) / (CANVAS_WIDTH / 2)) * MINIMAP_RANGE,
      y: MINIMAP_CENTER.y + ((y - CANVAS_HEIGHT / 2) / (CANVAS_HEIGHT / 2)) * MINIMAP_RANGE,
    };
  }

  private addMinimapDot(worldX: number, worldY: number, tint: number) {
    const p = this.worldToMinimap(worldX, worldY);
    this.add.image(p.x, p.y, 'ui-base-dot').setDisplaySize(12, 12).setTint(tint).setDepth(DEPTH.HUD);
  }

  private refreshFromState(state: PlayerStateDto) {
    this.goldText.setText(`${state.gold.toLocaleString()} G`);
    const mine = this.houseSlots.find((s) => s.key === 'bottomLeft');
    if (mine) mine.nameTag.setText(this.houseStatusLabel(state)); // "내 기지" 표기는 myBaseIcon(★)이 항상 담당
    // 이미지 3단계 규칙11: 상태 아이콘도 색상과 별개로 표시(도난중>잠김>오프라인 우선순위는 기존과 동일)
    if (state.kirbies.some((k) => k.status === 'stolen_in_transit')) {
      this.myBaseStatusIcon.setTexture('ui-status-stealing').setVisible(true);
    } else if (state.lockState === 'locked' || state.lockState === 'conditional') {
      this.myBaseStatusIcon.setTexture('ui-status-lock').setVisible(true);
    } else if (!state.offlineOperationEnabled) {
      this.myBaseStatusIcon.setTexture('ui-status-offline').setVisible(true);
    } else {
      this.myBaseStatusIcon.setVisible(false);
    }
  }

  // 코덱스 확정(2026-09-17) 상태 표시 우선순위: 도난중 > 잠김 > 오프라인 > 보관중 > 빈슬롯
  private houseStatusLabel(state: PlayerStateDto): string {
    if (state.kirbies.some((k) => k.status === 'stolen_in_transit')) return '⚠ 도난중';
    if (state.lockState === 'locked') return '잠김';
    if (state.lockState === 'conditional') return '조건부잠김';
    if (!state.offlineOperationEnabled) return '오프라인 미운영';
    if (state.kirbies.length > 0) return '보관중';
    return '빈 슬롯';
  }

  private async refreshOnlinePlayers() {
    try {
      const res = await kirbyNetwork.listOnlinePlayers();
      if (!res.ok) return;
      this.onlineText.setText(`접속 중: ${res.playerIds.length + 1}명`);
      const otherSlots = this.houseSlots.filter((s) => s.key !== 'bottomLeft');
      otherSlots.forEach((slot, i) => {
        const targetId = res.playerIds[i] ?? null;
        slot.targetPlayerId = targetId;
        slot.nameTag.setText(targetId ? `침입 가능\n#${targetId.slice(-4)}` : '빈 기지');
      });
    } catch {
      /* BE 미접속 등 — 다음 주기에 다시 시도 */
    }
  }

  private onInvasionStarted = () => {
    // 침입 안내는 일반 안내(showMessage, 1.4초)보다 눈에 띄고 오래 남아야 함 — 별도로 더 크고 길게 표시
    this.showMessage('🚨 도둑이 들었습니다! 내 기지로 가서 막으세요', 3200, '#ff1744', '20px');
  };

  // 2026-09-18 로직 변경: 좌대 index 하나에 캐릭터 하나를 스폰, 7초 후 사라지고 잠깐 간격을 둔 뒤 재스폰.
  // 사용자 지적(2026-09-18): 등장/퇴장이 즉시 나타났다 사라지면 깜빡이는 것처럼 보여서 페이드인/아웃으로 처리.
  private spawnAtSpot(index: number) {
    if (this.spots[index]) return; // 이미 점유 중이면 무시(안전장치)
    const pos = SPOT_POS[index];
    const kirby = pickWeightedRandomKirby();
    const grade = kirbyGrade(kirby);
    const color = GRADE_COLORS[grade.id] ?? 0xffffff;
    // 7.5(에셋 가이드) 확정: 등급색은 사각형 대신 후광 용도로 — 실제 캐릭터는 kirby/128 이미지 사용
    const glow = this.add.circle(pos.x, pos.y, 30, color, 0.35).setStrokeStyle(2, color, 0.9).setAlpha(0).setDepth(DEPTH.ACTOR_BASE + pos.y - 1);
    const textureKey = kirby.imageKey ? kirbyTextureKey(kirby.imageKey) : null;
    const sprite = this.add
      .image(pos.x, pos.y, textureKey && this.textures.exists(textureKey) ? textureKey : 'player-avatar')
      .setDisplaySize(48, 48)
      .setInteractive({ useHandCursor: true })
      .setAlpha(0)
      .setDepth(DEPTH.ACTOR_BASE + pos.y);
    // 이미지 3단계(DELIVERED, to_claude_v7 P1) — 이름 최대 2줄(말줄임)+가격은 항상 같은 y(고정 기준선)
    const tagBg = this.add.image(pos.x, pos.y + 44, 'ui-shop-price-tag').setDisplaySize(96, 31).setAlpha(0).setDepth(DEPTH.WORLD_LABEL - 1);
    const nameText = this.add
      .text(pos.x, pos.y + 27, truncateKirbyName(kirby.name), { fontSize: '11px', color: '#ffffff', align: 'center', wordWrap: { width: 90 } })
      .setOrigin(0.5, 0)
      .setAlpha(0)
      .setDepth(DEPTH.WORLD_LABEL);
    const priceText = this.add
      .text(pos.x, pos.y + 44, `${grade.buyPrice}G`, { fontSize: '12px', color: '#ffe082', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(DEPTH.WORLD_LABEL);
    this.tweens.add({ targets: [glow, sprite, tagBg, nameText, priceText], alpha: 1, duration: SPOT_FADE_MS });
    const timer = this.time.delayedCall(SPOT_LIFETIME_MS, () => this.despawnSpot(index));
    const item: SpotKirby = { kirby, glow, tagBg, sprite, nameText, priceText, timer };
    this.spots[index] = item;
    sprite.on('pointerdown', () => void this.tryBuy(index));
  }

  private despawnSpot(index: number) {
    const item = this.spots[index];
    if (!item) return;
    item.timer.remove();
    this.spots[index] = null; // 즉시 점유 해제 — 페이드 아웃 중 중복 despawn/구매 방지
    this.tweens.add({
      targets: [item.glow, item.sprite, item.tagBg, item.nameText, item.priceText],
      alpha: 0,
      duration: SPOT_FADE_MS,
      onComplete: () => {
        item.glow.destroy();
        item.sprite.destroy();
        item.tagBg.destroy();
        item.nameText.destroy();
        item.priceText.destroy();
        this.time.delayedCall(SPOT_RESPAWN_GAP_MS, () => this.spawnAtSpot(index));
      },
    });
  }

  private async tryBuy(index: number) {
    const item = this.spots[index];
    if (!item || item.purchasing) return;
    item.purchasing = true;
    try {
      await kirbyNetwork.buy();
      this.despawnSpot(index); // 구매 성공 시 즉시 사라지고 새 캐릭터로 교체
    } catch {
      this.showMessage('돈이 부족합니다');
      item.purchasing = false;
    }
  }

  private async onHouseClick(key: keyof typeof HOUSE_DOORS) {
    const slot = this.houseSlots.find((s) => s.key === key)!;
    if (key === 'bottomLeft') {
      this.scene.start('BaseScene', { mode: 'manage', targetPlayerId: kirbyNetwork.playerId });
      return;
    }
    if (!slot.targetPlayerId) {
      this.showMessage('빈 기지입니다');
      return;
    }
    const res = await kirbyNetwork.enterBase(slot.targetPlayerId);
    if (!res.ok) {
      this.showMessage(res.reason === 'locked' ? '기지가 잠겨 있습니다' : '침입할 수 없습니다(기지 없음)');
      return;
    }
    this.scene.start('BaseScene', { mode: 'select', targetPlayerId: slot.targetPlayerId, kirbies: res.kirbies ?? [] });
  }

  private showMessage(text: string, delayMs = 1400, color = '#ff5252', fontSize = '16px') {
    this.messageText.setText(text).setColor(color).setFontSize(parseInt(fontSize, 10));
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: delayMs, duration: 400 });
  }
}
