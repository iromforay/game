import Phaser from 'phaser';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  AVATAR_SPEED,
  BAT_HITS_REQUIRED,
  BAT_STUN_MS,
  JOYSTICK_BASE_RADIUS,
  JOYSTICK_THUMB_RADIUS,
  DEPTH,
} from '../config/constants';
import { kirbyGrade, type KirbyDef } from '../data/kirbyData';
import { kirbyNetwork } from '../net/KirbyNetwork';
import type { KirbyInstanceDto, PlayerStateDto } from '../api/client';
import type { InvasionHitEvent, InvasionPositionEvent, InvasionResolvedEvent, InvasionStartedEvent } from '../net/KirbyNetwork';
import { getBaseAssetUrl, getCharacterAssetUrl, getKirbyImageUrl, getUiAssetUrl, PLAYER_AVATAR_URL, WEAPON_BAT_URL } from '../assets/registry';
import { PlayerAvatar, ensurePlayerAvatarAnims, preloadPlayerAvatarAssets } from '../objects/PlayerAvatar';
import kirbiesData from '../data/kirbies.json';
import { FLOOR_STAIRS, STAIR_INPUT_LOCK_MS, STAIR_MARKER_OFFSET_Y, STAIR_MARKER_RADIUS, STAIR_PIVOT_Y, STAIR_TRIGGER_RADIUS, type StairDef } from '../config/stairs';

const kirbyTextureKey = (imageKey: string) => `kirby-${imageKey}`;
const IMAGE_KEY_BY_CODE: Record<string, string | null> = Object.fromEntries(
  (kirbiesData as { code: string; imageKey: string | null }[]).map((k) => [k.code, k.imageKey]),
);

// 2026-09-18: 이미지 1단계(DELIVERED) 반영 — base-ground-floor-1.png에 이미 그려진 4자리 슬롯
// 윤곽선 좌표를 그대로 사용(전부 네이티브 1280x720 기준이라 px()/py() 변환 불필요).
const SLOTS_PER_FLOOR = 4;
const SLOT_POS = [
  { x: 261, y: 238 },
  { x: 261, y: 431 },
  { x: 1023, y: 238 },
  { x: 1023, y: 431 },
];
const FLOOR_INFO_POS = { x: 1150, y: 210 }; // 층 정보(N층·보유수) 명판 — 계단 재설계로 우측 상단 계단이 없어져 고정 위치로 분리
// 잠금/오프라인 라벨이 2줄로 늘어나면서(2026-09-18) 계단 아이콘(x:1150 기준 220px 폭)과 겹쳐서
// x를 왼쪽으로 옮김 — 계단 이미지 바운딩박스(x:1040~1260, y:60~240) 밖에 위치하도록 조정.
const LOCK_PLAQUE_POS = { x: 1080, y: 45 }; // 계단 재설계(우측 A계단 x:710~930)와 안 겹치게 더 오른쪽으로
const HAND_ICON_POS = { x: 1080, y: 100 };
// 서버(BE/src/kirby/invasion.service.ts의 EXIT_ZONE)와 반드시 동일한 1280x720 월드 좌표를 써야
// exit() 호출이 서버의 좌표 재검증(QA 지적, 2026-09-17)을 통과함.
const EXIT_DOOR = { x: 605, y: 635, radius: 90 };
// base-collision-mask.png(S1-B04) 기준 방 전체 경계 눈대중값 — 가구 개별 충돌은 아직 없음.
const MOVE_BOUNDS = { minX: 90, maxX: 1180, minY: 220, maxY: 680 };
const JOYSTICK_CENTER = { x: 110, y: CANVAS_HEIGHT - 110 };
// 초당 발생 재화(2026-09-18 요청) — 표시 주기. 실제 정산은 collect() 호출 시 서버가 재계산.
// QA 지적(to_claude_v7 P2): 매초 4칸이 동시에 뜨면 너무 산만함 — 2.5초 간격으로 완화.
const INCOME_TICK_MS = 2500;

export interface BaseSceneData {
  mode: 'manage' | 'select' | 'defend' | 'steal';
  targetPlayerId: string; // 이 기지의 소유자 playerId
  kirbies?: KirbyInstanceDto[]; // select 모드에서 LobbyScene이 enterBase() 결과로 넘겨줌
  instanceId?: string; // defend/steal 모드에서 진행 중인 침입 대상
  characterName?: string;
}

export class BaseScene extends Phaser.Scene {
  private sceneData!: BaseSceneData;
  private floor = 0;
  private slotViews: {
    zone: Phaser.GameObjects.Zone;
    pedestal: Phaser.GameObjects.Image;
    icon: Phaser.GameObjects.Image;
    overlay: Phaser.GameObjects.Image;
    label: Phaser.GameObjects.Text;
    pulse: Phaser.GameObjects.Sprite;
    statusIcon: Phaser.GameObjects.Image; // 기지 전체 상태(잠금/오프라인)·도난을 점유 슬롯 모서리에 표시(코덱스 to_claude_v3)
  }[] = [];
  private floorOverlay?: Phaser.GameObjects.Image;
  // 계단 재설계(to_claude_v2_C) — 모든 층의 계단을 만들어두고 현재 층 것만 표시. 계단별 inside 상태로 엣지 진입 판정
  private stairViews: { def: StairDef; floor: number; img: Phaser.GameObjects.Image; marker: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; inside: boolean }[] = [];
  private exitGlow!: Phaser.GameObjects.Image;
  // 기지 열람(관리/선택) 모드용 아바타 — 버그성 지적(2026-09-18): 클릭 대신 캐릭터가 실제로 걸어다니며
  // 계단/숨겨진 통로와 "만나면" 층 이동, 집 캐릭터를 터치하면 수금(재화 획득) 하도록 필요해짐.
  private browseAvatar?: PlayerAvatar;
  private browsePos = { x: 0, y: 0 };
  private stairLockUntil = 0;
  private leavingToLobby = false; // 출입문 근접 시 로비 이탈을 1회만 트리거하기 위한 가드
  private wasNearExit = false; // 캐릭터 스폰 위치가 이미 출입문 반경 안이라 즉시 트리거되는 걸 막는 엣지 감지
  private floorText!: Phaser.GameObjects.Text;
  private floorBadge!: Phaser.GameObjects.Text; // 사용자 지적(2026-09-18): 층 이동 후 몇 층인지 화면 중앙에 크게 표시
  private floorBadgeBg!: Phaser.GameObjects.Image;
  private goldText!: Phaser.GameObjects.Text;
  private lockText!: Phaser.GameObjects.Text;
  private offlineText!: Phaser.GameObjects.Text;
  // 도난 알림 배너(관리 화면) — 침입이 끝날 때까지 남고, 배너나 도난 슬롯을 누르면 방어 화면 진입
  private invasionAlert?: Phaser.GameObjects.Text;
  private alertInstance: { instanceId: string; characterName: string } | null = null;
  private lockIcon!: Phaser.GameObjects.Image; // 이미지 3단계 status-lock (열림 상태일 땐 숨김)
  private offlineIcon!: Phaser.GameObjects.Image; // 이미지 3단계 status-offline (오프라인 운영 ON이면 숨김)
  private messageText!: Phaser.GameObjects.Text;
  private myKirbies: KirbyInstanceDto[] = [];

  // defend/steal 전투 상태 — 아바타 스프라이트(2단계 걷기/공격 애니메이션) + 역할 구분용 링(코덱스 확정 색상)
  private me!: PlayerAvatar;
  private meRing!: Phaser.GameObjects.Arc;
  private opponent!: PlayerAvatar;
  private opponentRing!: Phaser.GameObjects.Arc;
  private opponentPos: { x: number; y: number } | null = null;
  private opponentPrevPos: { x: number; y: number } | null = null;
  private myPos = { x: 0, y: 0 };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private hitText!: Phaser.GameObjects.Text;
  private hitSockets: Phaser.GameObjects.Arc[] = []; // 이미지 3단계 hit-counter-panel의 3개 소켓 위 채움 원
  private attackButton?: Phaser.GameObjects.Image;
  private resolved = false;
  private lastBroadcast = 0;
  private stunnedUntil = 0; // steal 모드 로컬 전용 — 명중당 5초 이동입력 차단(코덱스 확정)
  // 이미지 3단계(DELIVERED) stun-timer-ring — 기절 중 남은 시간을 링 진행량으로 표시
  private stunRing?: Phaser.GameObjects.Image;
  // 이미지 4단계(DELIVERED) 전투 FX — stun-stars: 기절 대상 머리 위 반복 재생(침입자 본인/방어자 화면의 상대 모두)
  private stunStars?: Phaser.GameObjects.Sprite;
  private stunStarsTarget: 'me' | 'opponent' = 'me';
  private localRing?: Phaser.GameObjects.Image; // S4-U03 로컬 플레이어 식별 링(침입 화면에서는 기존 흰 원 링을 대체)
  private stunProgress?: Phaser.GameObjects.Graphics;

  // 가상 조이스틱(멀티터치) — 공격 버튼과 서로 다른 포인터 ID로 분리해서 동시 입력 가능(코덱스 확정)
  private joyThumb?: Phaser.GameObjects.Image;
  private joyVector = { x: 0, y: 0 };
  private joyPointerId: number | null = null;

  constructor() {
    super('BaseScene');
  }

  preload() {
    // 이미지 1단계(DELIVERED, 2026-09-18) — docs/Steal a Kirby_image_generation_plan.md 4.4
    const baseAsset = (key: string) => getBaseAssetUrl(key)!;
    this.load.image('base-ground-floor-1', baseAsset('background/base-ground-floor-1'));
    this.load.image('base-floor-2-overlay', baseAsset('background/base-floor-2-overlay'));
    this.load.image('base-floor-3-overlay', baseAsset('background/base-floor-3-overlay'));
    this.load.image('base-back-wall', baseAsset('structures/base-back-wall'));
    this.load.image('base-stairs-up', baseAsset('structures/base-stairs-up'));
    this.load.image('base-stairs-down', baseAsset('structures/base-stairs-down'));
    this.load.image('base-exit-door', baseAsset('structures/base-exit-door'));
    this.load.image('base-exit-glow', baseAsset('structures/base-exit-glow'));
    this.load.image('base-front-wall', baseAsset('foreground/base-front-wall'));
    // 이미지 2단계(DELIVERED, 2026-09-18) — 슬롯 상태 오버레이
    this.load.image('base-slot-pedestal', baseAsset('slots/base-slot-pedestal'));
    this.load.image('base-slot-selected', baseAsset('slots/base-slot-selected'));
    this.load.image('base-slot-locked', baseAsset('slots/base-slot-locked'));
    this.load.image('base-slot-stealing', baseAsset('slots/base-slot-stealing'));

    if (!this.textures.exists('player-avatar')) this.load.image('player-avatar', PLAYER_AVATAR_URL);
    if (!this.textures.exists('weapon-bat')) this.load.image('weapon-bat', WEAPON_BAT_URL);
    preloadPlayerAvatarAssets(this);

    // 이미지 3단계(DELIVERED, 2026-09-18) — HUD/미니맵/컨트롤 UI
    const uiAsset = (key: string) => getUiAssetUrl(key)!;
    if (!this.textures.exists('ui-coin-panel')) this.load.image('ui-coin-panel', uiAsset('hud/coin-panel'));
    this.load.image('ui-floor-panel', uiAsset('hud/floor-panel'));
    this.load.image('ui-base-nameplate', uiAsset('hud/base-nameplate'));
    this.load.image('ui-hit-counter-panel', uiAsset('hud/hit-counter-panel'));
    this.load.image('ui-stun-timer-ring', uiAsset('hud/stun-timer-ring'));
    this.load.image('ui-interaction-prompt', uiAsset('hud/interaction-prompt'));
    this.load.image('ui-role-owner-icon', uiAsset('hud/role-owner-icon'));
    this.load.image('ui-role-intruder-icon', uiAsset('hud/role-intruder-icon'));
    this.load.image('ui-status-lock', uiAsset('hud/status-lock'));
    this.load.image('ui-status-offline', uiAsset('hud/status-offline'));
    this.load.image('ui-status-stealing', uiAsset('hud/status-stealing'));
    if (!this.textures.exists('ui-joystick-base')) this.load.image('ui-joystick-base', uiAsset('controls/joystick-base-v2')); // S4-U04 고대비 조이스틱 v2
    if (!this.textures.exists('ui-joystick-thumb')) this.load.image('ui-joystick-thumb', uiAsset('controls/joystick-thumb'));
    this.load.image('ui-action-button', uiAsset('controls/action-button'));
    this.load.image('ui-action-hand-icon', uiAsset('controls/action-hand-icon'));
    this.load.image('ui-attack-button', uiAsset('controls/attack-button'));
    this.load.image('ui-stair-up-marker', uiAsset('hud/stair-up-marker'));
    this.load.image('ui-stair-down-marker', uiAsset('hud/stair-down-marker'));

    // 이미지 4단계(DELIVERED, to_claude_v1_C 2026-09-21) — 전투 FX
    const fxAsset = (key: string) => getBaseAssetUrl(key)!;
    this.load.spritesheet('fx-hit-spark', fxAsset('fx/hit-spark-sheet'), { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('fx-stun-stars', fxAsset('fx/stun-stars-sheet'), { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('fx-stealing-pulse', fxAsset('fx/stealing-pulse-sheet'), { frameWidth: 128, frameHeight: 128 });
    this.load.spritesheet('fx-exit-arrow', fxAsset('fx/exit-arrow-sheet'), { frameWidth: 96, frameHeight: 96 });
    this.load.image('fx-capture-badge', fxAsset('fx/capture-badge'));
    this.load.spritesheet('fx-collect-burst', fxAsset('fx/collect-burst-sheet'), { frameWidth: 128, frameHeight: 128 });
    this.load.image('fx-local-ring', getCharacterAssetUrl('player/player-local-ring')!);
    for (const imageKey of Object.values(IMAGE_KEY_BY_CODE)) {
      if (!imageKey) continue;
      const key = kirbyTextureKey(imageKey);
      const url = getKirbyImageUrl(imageKey, 128);
      if (url && !this.textures.exists(key)) this.load.image(key, url);
    }
  }

  init(data: BaseSceneData) {
    this.sceneData = data;
    this.floor = 0;
    this.resolved = false;
    this.opponentPos = null;
    this.leavingToLobby = false;
  }

  create() {
    this.slotViews = [];
    this.stunStars = undefined;
    this.localRing = undefined;
    this.createFxAnims();
    this.createStairs();
    // 이미지 1단계(DELIVERED, 2026-09-18) — 층 공통 골격(base-ground-floor-1) 위에 층별 오버레이를
    // 얹는 방식. 벽/문/출입구 구조물을 depth 레이어에 맞춰 배치.
    this.add.image(0, 0, 'base-ground-floor-1').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT).setDepth(DEPTH.GROUND);
    this.floorOverlay = this.add
      .image(0, 0, 'base-floor-2-overlay')
      .setOrigin(0, 0)
      .setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT)
      .setDepth(DEPTH.GROUND + 1)
      .setVisible(false);
    this.add.image(0, 0, 'base-back-wall').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, 300).setDepth(DEPTH.BUILDINGS);
    // 코덱스 확정(to_claude_v3_C.md 규칙3): 전경(front-wall)은 플레이어보다 높은 depth 유지.
    // 출입문/탈출 효과는 전경보다도 더 위에 둬서 항상 클릭·인지 가능하게 함.
    this.add.image(0, CANVAS_HEIGHT - 220, 'base-front-wall').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, 220).setDepth(DEPTH.FOREGROUND);
    this.exitGlow = this.add.image(EXIT_DOOR.x, EXIT_DOOR.y, 'base-exit-glow').setDepth(DEPTH.FOREGROUND + 1);
    this.add.image(EXIT_DOOR.x, EXIT_DOOR.y, 'base-exit-door').setDepth(DEPTH.FOREGROUND + 2);

    this.messageText = this.add
      .text(CANVAS_WIDTH / 2, 92, '', { fontSize: '16px', color: '#ff5252', backgroundColor: '#00000099', padding: { x: 10, y: 6 } })
      .setOrigin(0.5)
      .setDepth(DEPTH.MODAL);
    // 이미지 3단계(DELIVERED) — 골드 배경을 반투명 사각형 대신 실제 코인 패널로 교체
    this.add.image(75, 42, 'ui-coin-panel').setDisplaySize(190, 58).setOrigin(0, 0.5).setDepth(DEPTH.HUD - 1);
    this.goldText = this.add.text(115, 42, '', { fontSize: '18px', color: '#ffe082', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(DEPTH.HUD);

    // 사용자 지적(2026-09-18): 층 이동 후 지금 몇 층인지 화면 중앙에서 바로 보여야 함(계단 옆 작은
    // 표시만으로는 부족) — 층 전환 시 renderSlots()에서 갱신. 이미지 3단계 floor-panel로 배경 교체.
    this.floorBadgeBg = this.add.image(CANVAS_WIDTH / 2, 34, 'ui-floor-panel').setDisplaySize(160, 50).setDepth(DEPTH.HUD - 1);
    this.floorBadge = this.add.text(CANVAS_WIDTH / 2, 34, '1층', { fontSize: '20px', color: '#3d2410', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.HUD);

    this.add
      .text(20, CANVAS_HEIGHT - 26, '[로비로 나가기]', { fontSize: '13px', color: '#8be9fd', backgroundColor: '#00000099', padding: { x: 6, y: 3 } })
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH.CONTROLS)
      .on('pointerdown', () => this.scene.start('LobbyScene'));

    if (this.sceneData.mode === 'manage' || this.sceneData.mode === 'select') {
      this.createBrowseUi();
    } else {
      this.floorBadge.setVisible(false); // 층 개념이 없는 방어/도주 화면에서는 표시 안 함
      this.floorBadgeBg.setVisible(false);
      this.createChaseUi();
    }
  }

  update(_time: number, delta: number) {
    if (this.sceneData.mode === 'defend' || this.sceneData.mode === 'steal') this.updateChase(delta);
    else this.updateBrowse(delta);
  }

  // ----- 기지 열람(내 기지 관리 / 남의 기지에서 훔칠 대상 고르기) -----

  private createBrowseUi() {
    const isMine = this.sceneData.mode === 'manage';
    // 이미지 3단계(DELIVERED) — base-nameplate로 배경 교체
    this.add.image(FLOOR_INFO_POS.x, FLOOR_INFO_POS.y, 'ui-base-nameplate').setDisplaySize(150, 44).setDepth(DEPTH.HUD - 1);
    this.floorText = this.add.text(FLOOR_INFO_POS.x, FLOOR_INFO_POS.y, '1층', { fontSize: '13px', color: '#3d2410' }).setOrigin(0.5).setDepth(DEPTH.HUD);
    // 이미지 3단계 interaction-prompt — 새로 생긴 근접 이동 방식 온보딩 힌트(사용자 지적 2026-09-18: 로비 나가는 법이 안 보임 등)
    this.add.image(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 34, 'ui-interaction-prompt').setDisplaySize(360, 44).setDepth(DEPTH.CONTROLS - 1);
    this.add
      .text(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 34, '계단·출입문에 닿으면 이동', { fontSize: '13px', color: '#3d2410' })
      .setOrigin(0.5)
      .setDepth(DEPTH.CONTROLS);

    // 이미지 2단계(DELIVERED) — base-slot-pedestal(기본)+selected/locked/stealing(상태 오버레이,
    // 같은 중심 좌표에 겹침). 우선순위: stealing > locked > selected > base(to_claude_v4_C.md 규칙8/9)
    // 슬롯 상호작용 분리(2026-09-18 요청): 관리 모드에서는 캐릭터(pedestal/icon) 터치=수금,
    // 라벨(가격표) 터치=판매로 나눔 — zone은 라벨 영역을 피해서 위쪽만 덮도록 축소.
    for (const pos of SLOT_POS) {
      const pedestal = this.add.image(pos.x, pos.y, 'base-slot-pedestal').setDepth(DEPTH.BUILDINGS);
      const zone = this.add
        .zone(pos.x, pos.y - 10, 200, 110)
        .setInteractive({ useHandCursor: true })
        .setDepth(DEPTH.BUILDINGS + 1);
      const icon = this.add.image(pos.x, pos.y - 15, 'player-avatar').setDisplaySize(64, 64).setVisible(false).setDepth(DEPTH.BUILDINGS + 2);
      const overlay = this.add.image(pos.x, pos.y, 'base-slot-selected').setVisible(false).setDepth(DEPTH.BUILDINGS + 3);
      const label = this.add
        .text(pos.x, pos.y + 55, '', { fontSize: '12px', color: '#ffffff', align: 'center', backgroundColor: '#00000099', padding: { x: 6, y: 4 } })
        .setOrigin(0.5)
        .setDepth(DEPTH.WORLD_LABEL);
      zone.on('pointerdown', () => void this.onSlotClick(zone));
      if (isMine) label.setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.onSlotSell(zone));
      const pulse = this.add.sprite(pos.x, pos.y - 15, 'fx-stealing-pulse').setDisplaySize(120, 120).setVisible(false).setDepth(DEPTH.BUILDINGS + 2);
      // 캐릭터 원화·이름·가격표·터치 영역을 가리지 않도록 좌대 오른쪽 위 모서리에 작게, 비상호작용 이미지
      const statusIcon = this.add.image(pos.x + 84, pos.y - 62, 'ui-status-lock').setDisplaySize(26, 26).setVisible(false).setDepth(DEPTH.BUILDINGS + 4);
      this.slotViews.push({ zone, pedestal, icon, overlay, label, pulse, statusIcon });
    }

    // 관리/선택 화면도 실제로 캐릭터가 걸어다니게(버그성 지적 2026-09-18) — 조이스틱 1차 조작
    // 방 중앙에서 시작(출입문 근처에서 시작하면 스폰하자마자 로비로 튕겨나가는 버그가 있었음 — 아래 참고)
    ensurePlayerAvatarAnims(this);
    this.browsePos = { x: (MOVE_BOUNDS.minX + MOVE_BOUNDS.maxX) / 2, y: (MOVE_BOUNDS.minY + MOVE_BOUNDS.maxY) / 2 };
    // 혹시라도 스폰 위치가 출입문 반경 안이면 "이미 안에 있던 것"으로 취급해서 즉시 트리거되지 않게 함
    this.wasNearExit = Phaser.Math.Distance.Between(this.browsePos.x, this.browsePos.y, EXIT_DOOR.x, EXIT_DOOR.y) <= EXIT_DOOR.radius;
    this.localRing = this.add.image(this.browsePos.x, this.browsePos.y + 24, 'fx-local-ring').setDisplaySize(80, 40).setDepth(DEPTH.ACTOR_BASE);
    this.browseAvatar = new PlayerAvatar(this, this.browsePos.x, this.browsePos.y, 56);
    this.cursors = this.input.keyboard!.createCursorKeys();
    // 이미지 3단계(DELIVERED) — 도형 대신 실제 조이스틱 에셋
    this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-base').setDisplaySize(JOYSTICK_BASE_RADIUS * 2.2, JOYSTICK_BASE_RADIUS * 2.2).setDepth(DEPTH.CONTROLS);
    this.joyThumb = this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-thumb').setDisplaySize(JOYSTICK_THUMB_RADIUS * 2.2, JOYSTICK_THUMB_RADIUS * 2.2).setDepth(DEPTH.CONTROLS + 1);
    this.setupJoystick();

    // 이미지 3단계 action-button+action-hand-icon — 우하단 문맥 버튼(이 화면의 기본 문맥 동작=로비로 나가기)
    this.add
      .image(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 'ui-action-button')
      .setDisplaySize(76, 76)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH.CONTROLS)
      .on('pointerdown', () => this.scene.start('LobbyScene'));
    this.add.image(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 'ui-action-hand-icon').setDisplaySize(40, 40).setDepth(DEPTH.CONTROLS + 1);
    this.add.text(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 46, '나가기', { fontSize: '12px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 2 } }).setOrigin(0.5).setDepth(DEPTH.CONTROLS);

    if (isMine) {
      // 초당 발생 재화(2026-09-18 요청) — 화면에 보이는 슬롯 중 idle 상태인 내 커비 위로 주기적으로
      // "+수입" 텍스트를 띄워서 재화가 발생하고 있음을 시각적으로 알림(실제 정산은 캐릭터 터치 시 collect()).
      this.time.addEvent({ delay: INCOME_TICK_MS, loop: true, callback: () => this.tickIncomeIndicators() });
    }

    if (isMine) {
      // 사용자 지적(2026-09-18): 잠금 버튼이 있다는 걸 알아보기 어려움 — 자물쇠 아이콘+"탭하여 변경"
      // 힌트+테두리를 추가해서 눈에 띄는 버튼처럼 보이게 함(클릭 동작 자체는 기존 cycleLockState 그대로).
      this.lockText = this.add
        .text(LOCK_PLAQUE_POS.x, LOCK_PLAQUE_POS.y, '', { fontSize: '13px', color: '#50fa7b', backgroundColor: '#00000099', padding: { x: 8, y: 4 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setStroke('#ffffff', 1)
        .setDepth(DEPTH.HUD)
        .on('pointerdown', () => void this.cycleLockState());
      // 이미지 3단계 status-lock — 잠김/조건부잠김일 때만 실제 자물쇠 아이콘 표시(열림이면 숨김)
      this.lockIcon = this.add.image(LOCK_PLAQUE_POS.x - 55, LOCK_PLAQUE_POS.y, 'ui-status-lock').setDisplaySize(20, 20).setVisible(false).setDepth(DEPTH.HUD);
      this.offlineText = this.add
        .text(HAND_ICON_POS.x, HAND_ICON_POS.y, '', { fontSize: '13px', color: '#50fa7b', backgroundColor: '#00000099', padding: { x: 8, y: 4 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .setStroke('#ffffff', 1)
        .setDepth(DEPTH.HUD)
        .on('pointerdown', () => void this.toggleOfflineOperation());
      this.add
        .text(HAND_ICON_POS.x, HAND_ICON_POS.y + 40, '※ 잠금·오프라인은 기지 전체 설정', { fontSize: '11px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 5, y: 2 } })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
      this.offlineIcon = this.add.image(HAND_ICON_POS.x - 55, HAND_ICON_POS.y, 'ui-status-offline').setDisplaySize(20, 20).setVisible(false).setDepth(DEPTH.HUD);

      kirbyNetwork.on('stateChanged', this.onStateChanged);
      kirbyNetwork.on('invasionStarted', this.onInvasionStartedWhileManaging);
      kirbyNetwork.on('invasionResolved', this.onManageInvasionResolved);
      this.events.once('shutdown', () => {
        kirbyNetwork.off('stateChanged', this.onStateChanged);
        kirbyNetwork.off('invasionStarted', this.onInvasionStartedWhileManaging);
        kirbyNetwork.off('invasionResolved', this.onManageInvasionResolved);
        this.hideInvasionAlert();
      });

      const state = kirbyNetwork.state;
      if (state) this.onStateChanged(state);
      this.invasionAlert = undefined;
      this.alertInstance = null;
      const stolenNow = state?.kirbies.find((k) => k.status === 'stolen_in_transit');
      if (stolenNow) this.showInvasionAlert(stolenNow.instanceId, stolenNow.name);
    } else {
      this.myKirbies = this.sceneData.kirbies ?? [];
      this.goldText.setText('');
      this.renderSlots();
    }
  }

  private onStateChanged = (state: PlayerStateDto) => {
    this.goldText.setText(`${state.gold.toLocaleString()} G`);
    // 사용자 지적(2026-09-18): 잠금 버튼임을 알아보기 쉽게 아이콘+"(탭하여 변경)" 힌트 +
    // 상태별 색상(열림=초록/잠김=빨강/조건부=주황)으로 한눈에 구분되게 함(이미지 3단계 status-lock 아이콘 사용)
    const lockColor = state.lockState === 'open' ? '#50fa7b' : state.lockState === 'locked' ? '#ff5555' : '#ffb84d';
    const lockLabel = state.lockState === 'open' ? '열림' : state.lockState === 'locked' ? '잠김' : '조건부잠김';
    this.lockText.setText(`${lockLabel}\n(탭하여 변경)`).setColor(lockColor);
    this.lockIcon.setVisible(state.lockState !== 'open');
    this.offlineText.setText(`오프라인 운영: ${state.offlineOperationEnabled ? 'ON' : 'OFF'}\n(탭하여 변경)`);
    this.offlineIcon.setVisible(!state.offlineOperationEnabled);
    this.myKirbies = state.kirbies;
    this.renderSlots();
  };

  private onInvasionStartedWhileManaging = (e: InvasionStartedEvent) => {
    this.showInvasionAlert(e.instanceId, e.characterName);
  };

  private onManageInvasionResolved = (p: InvasionResolvedEvent) => {
    if (this.alertInstance?.instanceId === p.instanceId) this.hideInvasionAlert();
  };

  private showInvasionAlert(instanceId: string, characterName: string) {
    this.hideInvasionAlert();
    this.alertInstance = { instanceId, characterName };
    const alert = this.add
      .text(CANVAS_WIDTH / 2, 92, `🚨 [${characterName}]를 도둑맞는 중!  터치해서 방어하러 가기`, {
        fontSize: '18px',
        color: '#ffffff',
        fontStyle: 'bold',
        backgroundColor: '#c62828',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.MODAL)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.enterDefenseFromAlert());
    this.tweens.add({ targets: alert, alpha: 0.65, duration: 600, yoyo: true, repeat: -1 });
    this.invasionAlert = alert;
  }

  private hideInvasionAlert() {
    if (this.invasionAlert) {
      this.tweens.killTweensOf(this.invasionAlert);
      this.invasionAlert.destroy();
    }
    this.invasionAlert = undefined;
    this.alertInstance = null;
  }

  private enterDefenseFromAlert() {
    const target = this.alertInstance;
    if (!target) return;
    this.scene.restart({ mode: 'defend', targetPlayerId: this.sceneData.targetPlayerId, instanceId: target.instanceId, characterName: target.characterName });
  }

  private renderSlots() {
    const start = this.floor * SLOTS_PER_FLOOR;
    const page = this.myKirbies.slice(start, start + SLOTS_PER_FLOOR);
    this.floorText.setText(`${this.floor + 1}층 (${this.myKirbies.length}마리 보유)`);
    this.floorBadge.setText(`${this.floor + 1}층`);
    // 층별 오버레이(base-floor-2/3-overlay)와 전환 아이콘(계단/숨겨진통로) 갱신
    this.floorOverlay?.setVisible(this.floor > 0).setTexture(this.floor === 2 ? 'base-floor-3-overlay' : 'base-floor-2-overlay');
    this.refreshStairs();
    for (let i = 0; i < this.slotViews.length; i++) {
      const view = this.slotViews[i];
      const kirby = page[i];
      if (!kirby) {
        view.label.setText('');
        view.icon.setVisible(false);
        view.overlay.setVisible(false);
        view.pulse.setVisible(false).stop();
        view.statusIcon.setVisible(false); // 빈 슬롯에는 상태 아이콘을 붙이지 않음
        continue;
      }
      const grade = kirbyGrade({ gradeId: kirby.gradeId } as KirbyDef);
      const imageKey = IMAGE_KEY_BY_CODE[kirby.code];
      const textureKey = imageKey ? kirbyTextureKey(imageKey) : null;
      if (textureKey && this.textures.exists(textureKey)) view.icon.setTexture(textureKey).setDisplaySize(64, 64).setVisible(true);
      else view.icon.setVisible(false);

      this.applySlotStatusIcon(view.statusIcon, kirby.status === 'stolen_in_transit');

      // 상태 우선순위(to_claude_v4_C.md 규칙9): stealing > locked > selected > base — 동시에 여러 주효과 표시 안 함
      if (kirby.status === 'stolen_in_transit') {
        view.overlay.setTexture('base-slot-stealing').setVisible(true);
        view.pulse.setVisible(true).play('fx-stealing-pulse', true); // S4-B05 도난 중 붉은 펄스
        view.label.setText(`${kirby.name}\n도둑맞는 중!\n(클릭해서 방어)`);
      } else if (this.sceneData.mode === 'select') {
        view.pulse.setVisible(false).stop();
        view.overlay.setTexture('base-slot-selected').setVisible(true);
        view.label.setText(`${kirby.name}\n(클릭해서 훔치기)`);
      } else {
        view.pulse.setVisible(false).stop();
        view.overlay.setVisible(false);
        // 상호작용 분리(2026-09-18): 캐릭터 터치=수금, 가격표(이 라벨) 터치=판매
        view.label.setText(`${kirby.name}\n판매가 ${grade.sellPrice}G\n(가격표 클릭시 판매)`);
      }
    }
  }

  // 코덱스 to_claude_v3 §2 — 기지 전체 상태를 소유자 관리 화면의 점유 슬롯에 알려주는 표시 전용 아이콘(슬롯별 설정 아님).
  // 우선순위: 도난 중 > 잠김/조건부잠김 > 오프라인 운영 꺼짐 > 없음(둘 다 해당하면 자물쇠만). 서버 응답(kirbyNetwork.state)을 최종값으로 사용.
  private applySlotStatusIcon(icon: Phaser.GameObjects.Image, stolen: boolean) {
    if (this.sceneData.mode !== 'manage') {
      icon.setVisible(false); // 타인 기지 선택/침입 화면에서는 슬롯별 기능처럼 복제하지 않음
      return;
    }
    const base = kirbyNetwork.state;
    if (stolen) icon.setTexture('ui-status-stealing').setVisible(true);
    else if (base && base.lockState !== 'open') icon.setTexture('ui-status-lock').setVisible(true);
    else if (base && !base.offlineOperationEnabled) icon.setTexture('ui-status-offline').setVisible(true);
    else icon.setVisible(false);
    icon.setDisplaySize(26, 26); // setTexture 직후 이전 텍스처 scale이 남는 문제 방지
  }

  private async onSlotClick(zone: Phaser.GameObjects.Zone) {
    const index = this.slotViews.findIndex((v) => v.zone === zone);
    const kirby = this.myKirbies.slice(this.floor * SLOTS_PER_FLOOR, this.floor * SLOTS_PER_FLOOR + SLOTS_PER_FLOOR)[index];
    if (!kirby) return;

    if (kirby.status === 'stolen_in_transit') {
      this.scene.restart({ mode: 'defend', targetPlayerId: this.sceneData.targetPlayerId, instanceId: kirby.instanceId, characterName: kirby.name });
      return;
    }

    if (this.sceneData.mode === 'manage') {
      // 상호작용 분리(2026-09-18 요청): 캐릭터(zone) 터치 = 수금, 가격표(label) 터치 = 판매(onSlotSell)
      try {
        const collected = await kirbyNetwork.collect(kirby.instanceId);
        if (collected > 0) {
          this.playCollectBurst(this.slotViews[index].pedestal.x, this.slotViews[index].pedestal.y - 20); // S4-B06 수금 성공
          this.showCollectPopup(this.slotViews[index].pedestal.x, this.slotViews[index].pedestal.y, collected);
        }
      } catch {
        this.showMessage('수금할 수 없습니다');
      }
      return;
    }

    const res = await kirbyNetwork.selectTarget(this.sceneData.targetPlayerId, kirby.instanceId);
    if (!res.ok) {
      this.showMessage('이미 다른 사람이 노리고 있습니다');
      return;
    }
    this.scene.restart({ mode: 'steal', targetPlayerId: this.sceneData.targetPlayerId, instanceId: kirby.instanceId, characterName: kirby.name });
  }

  private async onSlotSell(zone: Phaser.GameObjects.Zone) {
    const index = this.slotViews.findIndex((v) => v.zone === zone);
    const kirby = this.myKirbies.slice(this.floor * SLOTS_PER_FLOOR, this.floor * SLOTS_PER_FLOOR + SLOTS_PER_FLOOR)[index];
    if (!kirby || kirby.status === 'stolen_in_transit') return;
    try {
      await kirbyNetwork.sell(kirby.instanceId);
    } catch {
      this.showMessage('판매할 수 없습니다');
    }
  }

  // ----- 계단(to_claude_v2_C, 2026-09-21) -----

  private createStairs() {
    this.stairViews = [];
    const browse = this.sceneData.mode === 'manage' || this.sceneData.mode === 'select';
    for (const [floorStr, defs] of Object.entries(FLOOR_STAIRS)) {
      const floor = Number(floorStr) - 1;
      if (!browse && floor !== 0) continue; // 침입/방어 화면은 층 개념이 없어 1층 배치만 보여줌(같은 정의 공유)
      for (const def of defs) {
        const img = this.add
          .image(def.x, def.y, def.type === 'up' ? 'base-stairs-up' : 'base-stairs-down')
          .setOrigin(0.5, STAIR_PIVOT_Y)
          .setDepth(DEPTH.BUILDINGS + 2);
        const marker = this.add
          .image(def.x, def.y + STAIR_MARKER_OFFSET_Y, def.type === 'up' ? 'ui-stair-up-marker' : 'ui-stair-down-marker')
          .setVisible(false)
          .setDepth(DEPTH.WORLD_LABEL);
        const label = this.add
          .text(def.x, def.y + STAIR_MARKER_OFFSET_Y + 42, `${def.targetFloor}층으로`, { fontSize: '13px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#000000aa', padding: { x: 6, y: 2 } })
          .setOrigin(0.5)
          .setVisible(false)
          .setDepth(DEPTH.WORLD_LABEL);
        const view = { def, floor, img, marker, label, inside: false };
        if (browse) img.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.useStair(view)); // 클릭은 데스크톱 보조 입력
        this.stairViews.push(view);
      }
    }
    this.refreshStairs();
  }

  // 현재 층의 계단만 표시하고, 계단별 진입 상태를 초기화(도착 직후 재발동 방지)
  private refreshStairs() {
    for (const v of this.stairViews) {
      const here = v.floor === this.floor;
      v.img.setVisible(here);
      if (!here) {
        v.marker.setVisible(false);
        v.label.setVisible(false);
        v.inside = false;
      } else {
        v.inside = this.isInsideStair(v.def);
      }
    }
  }

  private footPos() {
    // 발 중심 = 아바타 스프라이트 중심에서 아래쪽(그림자 위치)
    return { x: this.browsePos.x, y: this.browsePos.y + 20 };
  }

  private isInsideStair(def: StairDef) {
    const foot = this.footPos();
    return Phaser.Math.Distance.Between(foot.x, foot.y, def.x, def.y) <= STAIR_TRIGGER_RADIUS;
  }

  private useStair(view: { def: StairDef; floor: number }) {
    if (this.time.now < this.stairLockUntil) return; // 전환 직후 입력 잠금/전환 진행 중에는 무시
    if (view.floor !== this.floor) return;
    const target = view.def.targetFloor - 1;
    if (target < 0 || target > 2 || Math.abs(target - this.floor) !== 1) return; // 현재 상태와 대조: 인접 층만 이동 가능
    this.stairLockUntil = this.time.now + STAIR_INPUT_LOCK_MS;
    this.floor = target;
    this.browsePos = { x: view.def.arrivalX, y: view.def.arrivalY }; // 도착 위치는 트리거 반경 밖
    this.browseAvatar?.setPosition(this.browsePos.x, this.browsePos.y);
    this.renderSlots(); // 내부에서 refreshStairs()로 계단별 진입 상태 초기화
    // 층 전환 순간을 눈에 띄게(사용자 지적 2026-09-18)
    this.floorBadge.setScale(1.4);
    this.tweens.add({ targets: this.floorBadge, scale: 1, duration: 300, ease: 'Back.Out' });
  }

  private updateStairs() {
    for (const v of this.stairViews) {
      if (v.floor !== this.floor) continue;
      const foot = this.footPos();
      const dist = Phaser.Math.Distance.Between(foot.x, foot.y, v.def.x, v.def.y);
      const near = dist <= STAIR_MARKER_RADIUS;
      v.marker.setVisible(near);
      v.label.setVisible(near);
      if (near) v.marker.setAlpha(0.925 + 0.075 * Math.sin(this.time.now / 250)); // 알파 0.85~1.0 천천히 펄스
      const inside = dist <= STAIR_TRIGGER_RADIUS;
      if (inside && !v.inside) this.useStair(v); // inside → outside → inside 엣지 진입만 발동
      v.inside = inside;
    }
  }

  // 초당 발생 재화(2026-09-18 요청) 시각 표시 — 실제 골드는 캐릭터 터치(collect) 시에만 반영됨
  private tickIncomeIndicators() {
    if (this.sceneData.mode !== 'manage') return;
    const page = this.myKirbies.slice(this.floor * SLOTS_PER_FLOOR, this.floor * SLOTS_PER_FLOOR + SLOTS_PER_FLOOR);
    for (let i = 0; i < this.slotViews.length; i++) {
      const kirby = page[i];
      if (!kirby || kirby.status !== 'idle' || kirby.incomePerTick <= 0) continue;
      const view = this.slotViews[i];
      const text = this.add
        .text(view.pedestal.x, view.pedestal.y - 40, `+${kirby.incomePerTick}`, { fontSize: '14px', color: '#ffe082', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH.WORLD_LABEL + 1);
      this.tweens.add({ targets: text, y: text.y - 30, alpha: 0, duration: 900, onComplete: () => text.destroy() });
    }
  }

  private showCollectPopup(x: number, y: number, amount: number) {
    const text = this.add.text(x, y - 60, `+${amount} G 획득!`, { fontSize: '16px', color: '#50fa7b', fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.MODAL);
    this.tweens.add({ targets: text, y: text.y - 34, alpha: 0, duration: 1100, onComplete: () => text.destroy() });
  }

  private async cycleLockState() {
    if (!kirbyNetwork.state) return;
    const order: PlayerStateDto['lockState'][] = ['open', 'locked', 'conditional'];
    const next = order[(order.indexOf(kirbyNetwork.state.lockState) + 1) % order.length];
    await kirbyNetwork.updateSettings({ lockState: next });
  }

  private async toggleOfflineOperation() {
    if (!kirbyNetwork.state) return;
    await kirbyNetwork.updateSettings({ offlineOperationEnabled: !kirbyNetwork.state.offlineOperationEnabled });
  }

  // ----- 실시간 침입(방어/도주) -----

  private createChaseUi() {
    const role = this.sceneData.mode === 'defend' ? 'owner' : 'viewer';
    // 이미지 3단계 role-owner-icon/role-intruder-icon — 규칙11: 역할은 색상뿐 아니라 아이콘으로도 구분
    this.add.image(20, 16, role === 'owner' ? 'ui-role-owner-icon' : 'ui-role-intruder-icon').setDisplaySize(28, 28).setOrigin(0, 0.5).setDepth(DEPTH.HUD);
    this.add
      .text(40, 16, `침입 진행 중 — ${this.sceneData.characterName}`, { fontSize: '18px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.HUD);
    this.add
      .text(
        20,
        46,
        role === 'owner' ? '이동해서 도둑에게 접근 후 SPACE로 타격(3회 명중시 방어 성공)' : '이동해서 아래쪽 출입문까지 도달하면 성공!',
        { fontSize: '13px', color: '#8be9fd', backgroundColor: '#00000099', padding: { x: 6, y: 4 } },
      )
      .setDepth(DEPTH.HUD);
    // 이미지 3단계 hit-counter-panel — 원형 pip 대신 실제 패널(내장 3소켓)을 채워서 표시
    // 규칙8: 하트 UI로 대체하지 않음, 3소켓 로컬 오프셋은 패널 이미지 실측값(중심 기준 -30/+23/+75, y=0)
    const hitPanelPos = { x: 150, y: 80 };
    this.add.image(hitPanelPos.x, hitPanelPos.y, 'ui-hit-counter-panel').setDisplaySize(260, 70).setDepth(DEPTH.HUD - 1);
    this.hitSockets = [-30, 23, 75].map((dx) =>
      this.add.circle(hitPanelPos.x + dx, hitPanelPos.y, 15, 0xff5555, 0).setDepth(DEPTH.HUD),
    );
    this.hitText = this.add
      .text(hitPanelPos.x, hitPanelPos.y + 42, `0 / ${BAT_HITS_REQUIRED} 명중`, { fontSize: '12px', color: '#ffaaaa', backgroundColor: '#00000099', padding: { x: 6, y: 2 } })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    // 출입문 이미지·하이라이트 원은 create()에서 이미 배치함(모든 모드 공용) — 여기선 라벨만 추가
    this.add
      .text(EXIT_DOOR.x, EXIT_DOOR.y - EXIT_DOOR.radius - 16, '출입문(탈출)', { fontSize: '12px', color: '#50fa7b' })
      .setOrigin(0.5)
      .setDepth(DEPTH.WORLD_LABEL);
    // S4-B04 탈출 방향 화살표 — 침입자에게만 출입문 위에서 반복 재생
    if (role === 'viewer') {
      this.add.sprite(EXIT_DOOR.x, EXIT_DOOR.y - EXIT_DOOR.radius + 10, 'fx-exit-arrow').setDisplaySize(72, 72).setAngle(180).setDepth(DEPTH.WORLD_LABEL).play('fx-exit-arrow');
    }

    ensurePlayerAvatarAnims(this);
    const startX = role === 'owner' ? MOVE_BOUNDS.minX + 100 : CANVAS_WIDTH / 2;
    const startY = role === 'owner' ? (MOVE_BOUNDS.minY + MOVE_BOUNDS.maxY) / 2 : MOVE_BOUNDS.minY + 60;
    this.myPos = { x: startX, y: startY };
    // 코덱스 확정(2026-09-17) 역할 링 색상: 소유자/방어자=금색·주황, 침입자=청록·파랑. 로컬 플레이어는 발밑 흰색 굵은 링 추가.
    this.meRing = this.add.circle(startX, startY, 22, 0x000000, 0).setStrokeStyle(4, 0xffffff, 1).setDepth(DEPTH.ACTOR_BASE + startY - 1);
    this.meRing.setVisible(false); // 기존 흰 원 링은 실제 에셋(player-local-ring)으로 대체
    this.localRing = this.add.image(startX, startY + 24, 'fx-local-ring').setDisplaySize(80, 40).setDepth(DEPTH.ACTOR_BASE + startY - 2);
    this.me = new PlayerAvatar(this, startX, startY, 56);
    this.me.setTint(role === 'owner' ? 0xffb84d : 0x7ec8ff);
    this.opponentRing = this.add.circle(-100, -100, 20, 0x000000, 0).setStrokeStyle(3, role === 'owner' ? 0x22d3ee : 0xffb300, 1).setDepth(DEPTH.ACTOR_BASE - 1);
    this.opponent = new PlayerAvatar(this, -100, -100, 56);
    this.opponent.setTint(role === 'owner' ? 0x7ec8ff : 0xffb84d);
    this.opponent.setAlpha(0.9);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // 조이스틱(터치1)과 공격 버튼(터치2)을 동시에 눌러야 하므로 2번째 포인터 트래킹 활성화
    this.input.addPointer(1);
    // 이미지 3단계(DELIVERED) — 도형 대신 실제 조이스틱 에셋
    this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-base').setDisplaySize(JOYSTICK_BASE_RADIUS * 2.2, JOYSTICK_BASE_RADIUS * 2.2).setDepth(DEPTH.CONTROLS);
    this.joyThumb = this.add.image(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, 'ui-joystick-thumb').setDisplaySize(JOYSTICK_THUMB_RADIUS * 2.2, JOYSTICK_THUMB_RADIUS * 2.2).setDepth(DEPTH.CONTROLS + 1);
    this.setupJoystick();

    // 코덱스 확정(2026-09-17): 방어자에게만 모바일 공격 버튼 노출, 침입자는 버튼 없음(Zone 자동판정 유지)
    // 이미지 3단계(DELIVERED) 규칙6 — 공격 역할은 attack-button 전용 에셋 사용(action-button과 구분)
    if (role === 'owner') {
      this.attackButton = this.add
        .image(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 'ui-attack-button')
        .setDisplaySize(92, 92)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(DEPTH.CONTROLS);
      this.add.image(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 'weapon-bat').setDisplaySize(44, 44).setAngle(-45).setScrollFactor(0).setDepth(DEPTH.CONTROLS + 1);
      // 조이스틱(방향키)과 공격 버튼을 서로 다른 입력 경로로 분리해서 동시 입력(멀티터치) 가능
      this.attackButton.on('pointerdown', () => {
        this.me.playAttack();
        void kirbyNetwork.attack(this.sceneData.targetPlayerId, this.sceneData.instanceId!);
      });
    }

    kirbyNetwork.on('invasionPosition', this.onPosition);
    kirbyNetwork.on('invasionHit', this.onHit);
    kirbyNetwork.on('invasionResolved', this.onResolved);
    this.events.once('shutdown', () => {
      kirbyNetwork.off('invasionPosition', this.onPosition);
      kirbyNetwork.off('invasionHit', this.onHit);
      kirbyNetwork.off('invasionResolved', this.onResolved);
    });
  }

  private onPosition = (p: InvasionPositionEvent) => {
    if (p.instanceId !== this.sceneData.instanceId || p.playerId === kirbyNetwork.playerId) return;
    this.opponentPos = { x: p.x, y: p.y };
  };

  private onHit = (p: InvasionHitEvent) => {
    if (p.instanceId !== this.sceneData.instanceId) return;
    this.hitText.setText(`${p.hitCount} / ${BAT_HITS_REQUIRED} 명중`);
    for (let i = 0; i < this.hitSockets.length; i++) {
      this.hitSockets[i].setFillStyle(i < p.hitCount ? 0xff5555 : 0x000000, i < p.hitCount ? 1 : 0);
    }

    // 코덱스 확정(2026-09-17): 피격 순간 흰색 플래시 80ms + 화면 흔들림. 맞는 쪽은 항상 침입자(도주자) 본인.
    const hitAvatar = this.sceneData.mode === 'steal' ? this.me : this.opponent;
    hitAvatar.flashWhite(this, 80);
    this.cameras.main.shake(120, 0.006);
    this.playHitSpark(hitAvatar.x, hitAvatar.y - 10); // S4-B01 타격 스파크
    this.showStunStars(this.sceneData.mode === 'steal' ? 'me' : 'opponent'); // S4-B02 기절 별(양쪽 화면 모두)

    // 명중당 5초 기절(4.2 확정) — 침입자 로컬 클라이언트만 이동 입력을 잠그고 채도를 낮춤(서버는 명중/포획만 권위 판정)
    if (this.sceneData.mode === 'steal') {
      this.stunnedUntil = this.time.now + BAT_STUN_MS;
      hitAvatar.setAlpha(0.5);
      // 이미지 3단계 stun-timer-ring — 머리 위에 남은 기절 시간을 진행률 링으로 표시(규칙9)
      this.stunRing?.destroy();
      this.stunProgress?.destroy();
      this.stunRing = this.add.image(this.myPos.x, this.myPos.y - 50, 'ui-stun-timer-ring').setDisplaySize(36, 36).setDepth(DEPTH.WORLD_LABEL);
      this.stunProgress = this.add.graphics().setDepth(DEPTH.WORLD_LABEL);
      this.time.delayedCall(BAT_STUN_MS, () => {
        if (this.time.now >= this.stunnedUntil) hitAvatar.setAlpha(1);
        this.hideStunStars();
        this.stunRing?.destroy();
        this.stunRing = undefined;
        this.stunProgress?.destroy();
        this.stunProgress = undefined;
      });
    }
  };

  private onResolved = (p: InvasionResolvedEvent) => {
    if (p.instanceId !== this.sceneData.instanceId || this.resolved) return;
    this.resolved = true;
    const iAmIntruder = this.sceneData.mode === 'steal';
    const message =
      p.result === 'success'
        ? iAmIntruder
          ? '훔치기 성공! 커비를 데리고 나왔습니다.'
          : '침입자를 막지 못했습니다...'
        : iAmIntruder
          ? '실패했습니다 — 붙잡혔거나 기지가 잠겼습니다.'
          : '방어 성공! 침입자를 붙잡았습니다.';
    this.showMessage(message);
    if (p.result === 'failed' && p.reason === 'captured') this.showCaptureFinish(iAmIntruder);
    this.time.delayedCall(p.reason === 'captured' ? 2600 : 1800, () => this.scene.start('LobbyScene'));
  };

  // ----- 이미지 4단계 전투 FX (to_claude_v1_C, 2026-09-21) -----

  private createFxAnims() {
    const make = (key: string, tex: string, frameRate: number, repeat: number, end = 3) => {
      if (this.anims.exists(key)) return;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(tex, { start: 0, end }), frameRate, repeat });
    };
    make('fx-hit-spark', 'fx-hit-spark', 14, 0); // 타격 14fps 1회
    make('fx-stun-stars', 'fx-stun-stars', 8, -1); // 기절 8fps 반복
    make('fx-stealing-pulse', 'fx-stealing-pulse', 8, -1); // 도난 8fps 반복
    make('fx-exit-arrow', 'fx-exit-arrow', 8, -1); // 탈출 8fps 반복
    if (!this.anims.exists('fx-collect-burst')) {
      this.anims.create({ key: 'fx-collect-burst', frames: this.anims.generateFrameNumbers('fx-collect-burst', { start: 0, end: 5 }), frameRate: 12, repeat: 0 }); // 수금 12fps 1회
    }
  }

  private playCollectBurst(x: number, y: number) {
    const burst = this.add.sprite(x, y, 'fx-collect-burst').setDisplaySize(150, 150).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.WORLD_LABEL);
    burst.play('fx-collect-burst');
    burst.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => burst.destroy());
  }

  private playHitSpark(x: number, y: number) {
    const spark = this.add.sprite(x, y, 'fx-hit-spark').setDisplaySize(110, 110).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.WORLD_LABEL);
    spark.play('fx-hit-spark');
    spark.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => spark.destroy());
  }

  private showStunStars(target: 'me' | 'opponent') {
    this.stunStars?.destroy();
    this.stunStarsTarget = target;
    const at = target === 'me' ? this.myPos : this.opponentPos ?? this.opponent;
    this.stunStars = this.add.sprite(at.x, at.y - 46, 'fx-stun-stars').setDisplaySize(90, 90).setDepth(DEPTH.WORLD_LABEL);
    this.stunStars.play('fx-stun-stars');
    this.time.delayedCall(BAT_STUN_MS, () => {
      if (this.time.now >= this.stunnedUntil) this.hideStunStars();
    });
    if (target === 'opponent') this.stunnedUntil = this.time.now + BAT_STUN_MS; // 방어자 화면은 별 표시 수명 기준으로만 사용(이동 입력엔 영향 없음)
  }

  private hideStunStars() {
    this.stunStars?.destroy();
    this.stunStars = undefined;
  }

  // S4-B03 3회 명중 완료 배지 — 마지막 타격 스파크·기절 별과 함께 화면 중앙에 팝업(붙잡힘 = 훔친 커비 원위치)
  private showCaptureFinish(iAmIntruder: boolean) {
    // 3번째 명중은 서버가 hit가 아니라 resolved(captured)로 보내므로 카운터가 2/3에서 멈추지 않게 여기서 3/3으로 채움
    this.hitText.setText(`${BAT_HITS_REQUIRED} / ${BAT_HITS_REQUIRED} 명중`);
    for (const socket of this.hitSockets) socket.setFillStyle(0xff5555, 1);
    const target = iAmIntruder ? this.me : this.opponent;
    this.playHitSpark(target.x, target.y - 10);
    this.showStunStars(iAmIntruder ? 'me' : 'opponent');
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2 - 40;
    const badge = this.add.image(cx, cy, 'fx-capture-badge').setDisplaySize(40, 40).setAlpha(0).setDepth(DEPTH.MODAL);
    this.tweens.add({ targets: badge, alpha: 1, displayWidth: 180, displayHeight: 180, duration: 450, ease: 'Back.Out' });
    const label = this.add
      .text(cx, cy + 118, iAmIntruder ? '붙잡혔다! 커비는 원래 주인에게' : '3회 명중! 커비를 되찾았다', { fontSize: '20px', color: '#ffe082', fontStyle: 'bold', backgroundColor: '#000000aa', padding: { x: 12, y: 6 } })
      .setOrigin(0.5)
      .setDepth(DEPTH.MODAL);
    this.tweens.add({ targets: [badge, label], alpha: 0, delay: 1700, duration: 500 });
  }

  private updateChase(delta: number) {
    if (this.resolved) return;
    const stunned = this.sceneData.mode === 'steal' && this.time.now < this.stunnedUntil;
    // 기절 시각효과(반투명·별·링)를 이동 잠금과 같은 기준(stunnedUntil)으로 끝냄 — 별도 타이머와 최대 1초 어긋나던 문제(2026-09-21 실검증에서 발견)
    if (this.sceneData.mode === 'steal' && !stunned && this.stunRing) {
      this.me.setAlpha(1);
      this.stunRing.destroy();
      this.stunRing = undefined;
      this.stunProgress?.destroy();
      this.stunProgress = undefined;
      this.hideStunStars();
    }
    const speed = stunned ? 0 : (AVATAR_SPEED * delta) / 1000;
    let dx = stunned ? 0 : this.joyVector.x * speed;
    let dy = stunned ? 0 : this.joyVector.y * speed;
    if (this.cursors.left?.isDown) dx -= speed;
    if (this.cursors.right?.isDown) dx += speed;
    if (this.cursors.up?.isDown) dy -= speed;
    if (this.cursors.down?.isDown) dy += speed;
    const prevX = this.myPos.x;
    const prevY = this.myPos.y;
    this.myPos.x = Phaser.Math.Clamp(this.myPos.x + dx, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
    this.myPos.y = Phaser.Math.Clamp(this.myPos.y + dy, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);
    this.me.setPosition(this.myPos.x, this.myPos.y);
    this.me.updateMovement(this.myPos.x - prevX, this.myPos.y - prevY);
    this.meRing.setPosition(this.myPos.x, this.myPos.y).setDepth(DEPTH.ACTOR_BASE + this.myPos.y - 1);
    this.localRing?.setPosition(this.myPos.x, this.myPos.y + 24).setDepth(DEPTH.ACTOR_BASE + this.myPos.y - 2);

    if (stunned && this.stunRing && this.stunProgress) {
      this.stunRing.setPosition(this.myPos.x, this.myPos.y - 50);
      const remaining = Phaser.Math.Clamp((this.stunnedUntil - this.time.now) / BAT_STUN_MS, 0, 1);
      this.stunProgress.clear();
      this.stunProgress.lineStyle(4, 0xff5555, 1);
      this.stunProgress.beginPath();
      this.stunProgress.arc(this.myPos.x, this.myPos.y - 50, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining, false);
      this.stunProgress.strokePath();
    }
    if (this.stunStars) {
      const t = this.stunStarsTarget === 'me' ? this.myPos : this.opponentPos;
      if (t) this.stunStars.setPosition(t.x, t.y - 46);
    }
    if (this.opponentPos) {
      const prevOpp = this.opponentPrevPos;
      this.opponent.setPosition(this.opponentPos.x, this.opponentPos.y);
      this.opponent.updateMovement(prevOpp ? this.opponentPos.x - prevOpp.x : 0, prevOpp ? this.opponentPos.y - prevOpp.y : 0);
      this.opponentPrevPos = { ...this.opponentPos };
      this.opponentRing.setPosition(this.opponentPos.x, this.opponentPos.y).setDepth(DEPTH.ACTOR_BASE + this.opponentPos.y - 1);
    }
    // 탈출 가능 여부와 무관하게 항상 보이던 정적 원을 대신해, 실제 이미지(2단계)는 항상 표시하되
    // 확보 여부에 따라 강조만 다르게(현재는 select 트리거=확보로 취급하는 기존 설계 유지)
    this.exitGlow.setAlpha(this.sceneData.mode === 'steal' ? 1 : 0.6);

    const now = this.time.now;
    if (now - this.lastBroadcast > 150) {
      this.lastBroadcast = now;
      void kirbyNetwork.reportMove(this.sceneData.targetPlayerId, this.sceneData.instanceId!, this.myPos.x, this.myPos.y);
    }
    if (this.sceneData.mode === 'defend' && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.me.playAttack();
      void kirbyNetwork.attack(this.sceneData.targetPlayerId, this.sceneData.instanceId!);
    }
    if (this.sceneData.mode === 'steal') {
      const dist = Phaser.Math.Distance.Between(this.myPos.x, this.myPos.y, EXIT_DOOR.x, EXIT_DOOR.y);
      if (dist <= EXIT_DOOR.radius) {
        void kirbyNetwork.exit(this.sceneData.targetPlayerId, this.sceneData.instanceId!);
      }
    }
  }

  // 기지 열람(관리/선택) 모드 이동 — 조이스틱 1차, 방향키는 데스크톱 테스트용 보조 입력.
  // 층별 상행/하행 계단에 근접(엣지 진입)하면 자동으로 층 이동(클릭은 보조 입력).
  private updateBrowse(delta: number) {
    if (!this.browseAvatar) return;
    const speed = (AVATAR_SPEED * delta) / 1000;
    let dx = this.joyVector.x * speed;
    let dy = this.joyVector.y * speed;
    if (this.cursors.left?.isDown) dx -= speed;
    if (this.cursors.right?.isDown) dx += speed;
    if (this.cursors.up?.isDown) dy -= speed;
    if (this.cursors.down?.isDown) dy += speed;
    const prevX = this.browsePos.x;
    const prevY = this.browsePos.y;
    this.browsePos.x = Phaser.Math.Clamp(this.browsePos.x + dx, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
    this.browsePos.y = Phaser.Math.Clamp(this.browsePos.y + dy, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);
    this.browseAvatar.setPosition(this.browsePos.x, this.browsePos.y);
    this.browseAvatar.updateMovement(this.browsePos.x - prevX, this.browsePos.y - prevY);
    this.localRing?.setPosition(this.browsePos.x, this.browsePos.y + 24).setDepth(DEPTH.ACTOR_BASE + this.browsePos.y - 2);

    this.updateStairs();

    // 사용자 지적(2026-09-18): 로비로 나가는 방법이 텍스트 링크뿐이라 발견하기 어려움 — 출입문에
    // 캐릭터가 닿으면(1층에서만, 침입 화면의 EXIT_DOOR와 동일 지점) 자동으로 로비 복귀. 근접 "진입
    // 순간"에만 발동하는 엣지 감지를 써서, 스폰 위치가 우연히 반경 안이어도 즉시 튕겨나가지 않게 함.
    if (!this.leavingToLobby && this.floor === 0) {
      const nearExit = Phaser.Math.Distance.Between(this.browsePos.x, this.browsePos.y, EXIT_DOOR.x, EXIT_DOOR.y) <= EXIT_DOOR.radius;
      if (nearExit && !this.wasNearExit) {
        this.leavingToLobby = true;
        this.scene.start('LobbyScene');
      }
      this.wasNearExit = nearExit;
    }
  }

  private setupJoystick() {
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
    this.joyThumb?.setPosition(JOYSTICK_CENTER.x + Math.cos(angle) * dist, JOYSTICK_CENTER.y + Math.sin(angle) * dist);
    this.joyVector = dist < 6 ? { x: 0, y: 0 } : { x: Math.cos(angle), y: Math.sin(angle) };
  }

  private releaseJoystick(pointerId: number) {
    if (pointerId !== this.joyPointerId) return;
    this.joyPointerId = null;
    this.joyVector = { x: 0, y: 0 };
    this.joyThumb?.setPosition(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y);
  }

  private showMessage(text: string, delayMs = 1600, color = '#ff5252', fontSize = '16px') {
    this.messageText.setText(text).setColor(color).setFontSize(parseInt(fontSize, 10));
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: delayMs, duration: 400 });
  }
}
