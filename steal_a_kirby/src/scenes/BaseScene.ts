import Phaser from 'phaser';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  AVATAR_SPEED,
  BAT_HITS_REQUIRED,
  BAT_STUN_MS,
  JOYSTICK_BASE_RADIUS,
  JOYSTICK_THUMB_RADIUS,
} from '../config/constants';
import { GRADE_COLORS } from '../config/gradeColors';
import { kirbyGrade, type KirbyDef } from '../data/kirbyData';
import { kirbyNetwork } from '../net/KirbyNetwork';
import type { KirbyInstanceDto, PlayerStateDto } from '../api/client';
import type { InvasionHitEvent, InvasionPositionEvent, InvasionResolvedEvent, InvasionStartedEvent } from '../net/KirbyNetwork';
import { getKirbyImageUrl, PLAYER_AVATAR_URL, WEAPON_BAT_URL } from '../assets/registry';
import kirbiesData from '../data/kirbies.json';

const kirbyTextureKey = (imageKey: string) => `kirby-${imageKey}`;
const IMAGE_KEY_BY_CODE: Record<string, string | null> = Object.fromEntries(
  (kirbiesData as { code: string; imageKey: string | null }[]).map((k) => [k.code, k.imageKey]),
);

// 1280x720 캔버스 직접 좌표(house.png 배경과 시각적으로 맞춰서 잡은 값 — 2026-09-17, 기존
// pic/house.png 원본픽셀(1672x941) 기준 px()/py() 변환은 제거하고 결과값을 그대로 상수화함).
const SLOTS_PER_FLOOR = 4;
const TOTAL_FLOORS = 3; // 2026-09-17 확정(docs/to_codex.md 7절): 층당 4개 × 3층 = 총 12개
// 4.1(3층 구조) 확정과 매칭되는 슬롯 배치 — house.png에 이미 그려진 러그/카펫 4자리를 그대로 사용
const SLOT_POS = [
  { x: 230, y: 245 },
  { x: 230, y: 459 },
  { x: 1087, y: 245 },
  { x: 1087, y: 467 },
];
const STAIRS_POS = { x: 1003, y: 115 };
const LOCK_PLAQUE_POS = { x: 605, y: 46 };
const HAND_ICON_POS = { x: 1194, y: 658 };
// 서버(BE/src/kirby/invasion.service.ts의 EXIT_ZONE)와 반드시 동일한 1280x720 월드 좌표를 써야
// exit() 호출이 서버의 좌표 재검증(QA 지적, 2026-09-17)을 통과함.
const EXIT_DOOR = { x: 605, y: 635, radius: 90 };
// maxY는 EXIT_DOOR(y=635, radius=90)와 겹칠 수 있도록 충분히 아래까지 잡아야 함 — 예전 값은
// 문 위치보다 위쪽이라 실제로는 아바타가 출입문 Zone에 도달할 수 없던 버그였음(QA 지적 대응 중 발견).
const MOVE_BOUNDS = { minX: 69, maxX: 1210, minY: 138, maxY: 680 };
const JOYSTICK_CENTER = { x: 110, y: CANVAS_HEIGHT - 110 };

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
  private slotViews: { bg: Phaser.GameObjects.Rectangle; icon: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }[] = [];
  private floorText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private lockText!: Phaser.GameObjects.Text;
  private offlineText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private myKirbies: KirbyInstanceDto[] = [];

  // defend/steal 전투 상태 — 아바타 스프라이트 + 역할 구분용 링(코덱스 확정 색상)
  private me!: Phaser.GameObjects.Image;
  private meRing!: Phaser.GameObjects.Arc;
  private opponent!: Phaser.GameObjects.Image;
  private opponentRing!: Phaser.GameObjects.Arc;
  private opponentPos: { x: number; y: number } | null = null;
  private myPos = { x: 0, y: 0 };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private hitText!: Phaser.GameObjects.Text;
  private hitPips: Phaser.GameObjects.Arc[] = [];
  private attackButton?: Phaser.GameObjects.Arc;
  private resolved = false;
  private lastBroadcast = 0;
  private stunnedUntil = 0; // steal 모드 로컬 전용 — 명중당 5초 이동입력 차단(코덱스 확정)

  // 가상 조이스틱(멀티터치) — 공격 버튼과 서로 다른 포인터 ID로 분리해서 동시 입력 가능(코덱스 확정)
  private joyThumb?: Phaser.GameObjects.Arc;
  private joyVector = { x: 0, y: 0 };
  private joyPointerId: number | null = null;

  constructor() {
    super('BaseScene');
  }

  preload() {
    this.load.image('house-bg', new URL('../assets/backgrounds/house.png', import.meta.url).href);
    if (!this.textures.exists('player-avatar')) this.load.image('player-avatar', PLAYER_AVATAR_URL);
    if (!this.textures.exists('weapon-bat')) this.load.image('weapon-bat', WEAPON_BAT_URL);
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
  }

  create() {
    this.slotViews = [];
    this.add.image(0, 0, 'house-bg').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT);
    this.messageText = this.add.text(CANVAS_WIDTH / 2, 92, '', { fontSize: '16px', color: '#ff5252' }).setOrigin(0.5);
    this.goldText = this.add.text(115, 42, '', { fontSize: '18px', color: '#ffe082', fontStyle: 'bold' }).setOrigin(0, 0.5);

    this.add
      .text(20, CANVAS_HEIGHT - 26, '[로비로 나가기]', { fontSize: '13px', color: '#8be9fd' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene'));

    if (this.sceneData.mode === 'manage' || this.sceneData.mode === 'select') {
      this.createBrowseUi();
    } else {
      this.createChaseUi();
    }
  }

  update(_time: number, delta: number) {
    if (this.sceneData.mode === 'defend' || this.sceneData.mode === 'steal') this.updateChase(delta);
  }

  // ----- 기지 열람(내 기지 관리 / 남의 기지에서 훔칠 대상 고르기) -----

  private createBrowseUi() {
    const isMine = this.sceneData.mode === 'manage';
    this.floorText = this.add.text(STAIRS_POS.x, STAIRS_POS.y + 40, '1층', { fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
    // 코덱스 확정(2026-09-17): 페이지네이션 없이 층 전환 시 슬롯 데이터만 교체 — house.png의 "2층으로"
    // 계단 위치를 그대로 층 전환 hotspot으로 사용, 3층까지 순환(1→2→3→1)
    this.add
      .text(STAIRS_POS.x, STAIRS_POS.y, '[층 전환]', { fontSize: '13px', color: '#50fa7b' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.floor = (this.floor + 1) % TOTAL_FLOORS;
        this.renderSlots();
      });

    for (const pos of SLOT_POS) {
      const bg = this.add.rectangle(pos.x, pos.y, 190, 150, 0x000000, 0).setStrokeStyle(2, 0xffe082, 0).setInteractive({ useHandCursor: true });
      const icon = this.add.image(pos.x, pos.y - 20, 'player-avatar').setDisplaySize(64, 64).setVisible(false);
      const label = this.add
        .text(pos.x, pos.y + 45, '', { fontSize: '12px', color: '#ffffff', align: 'center', backgroundColor: '#00000099', padding: { x: 6, y: 4 } })
        .setOrigin(0.5);
      bg.on('pointerdown', () => void this.onSlotClick(bg));
      this.slotViews.push({ bg, icon, label });
    }

    if (isMine) {
      this.lockText = this.add
        .text(LOCK_PLAQUE_POS.x, LOCK_PLAQUE_POS.y, '', { fontSize: '13px', color: '#50fa7b', backgroundColor: '#00000099', padding: { x: 8, y: 4 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.cycleLockState());
      this.offlineText = this.add
        .text(HAND_ICON_POS.x, HAND_ICON_POS.y, '', { fontSize: '13px', color: '#50fa7b', backgroundColor: '#00000099', padding: { x: 8, y: 4 } })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.toggleOfflineOperation());

      kirbyNetwork.on('stateChanged', this.onStateChanged);
      kirbyNetwork.on('invasionStarted', this.onInvasionStartedWhileManaging);
      this.events.once('shutdown', () => {
        kirbyNetwork.off('stateChanged', this.onStateChanged);
        kirbyNetwork.off('invasionStarted', this.onInvasionStartedWhileManaging);
      });

      const state = kirbyNetwork.state;
      if (state) this.onStateChanged(state);
    } else {
      this.myKirbies = this.sceneData.kirbies ?? [];
      this.goldText.setText('');
      this.renderSlots();
    }
  }

  private onStateChanged = (state: PlayerStateDto) => {
    this.goldText.setText(`${state.gold.toLocaleString()} G`);
    this.lockText.setText(`잠금상태: ${state.lockState}`);
    this.offlineText.setText(`오프라인 운영: ${state.offlineOperationEnabled ? 'ON' : 'OFF'}`);
    this.myKirbies = state.kirbies;
    this.renderSlots();
  };

  private onInvasionStartedWhileManaging = (e: InvasionStartedEvent) => {
    this.showMessage(`[${e.characterName}]를 도둑맞는 중! 슬롯을 클릭해 방어하세요`);
  };

  private renderSlots() {
    const start = this.floor * SLOTS_PER_FLOOR;
    const page = this.myKirbies.slice(start, start + SLOTS_PER_FLOOR);
    this.floorText.setText(`${this.floor + 1}층 (${this.myKirbies.length}마리 보유)`);
    for (let i = 0; i < this.slotViews.length; i++) {
      const view = this.slotViews[i];
      const kirby = page[i];
      if (!kirby) {
        view.label.setText('');
        view.bg.setStrokeStyle(2, 0xffe082, 0);
        view.icon.setVisible(false);
        continue;
      }
      const grade = kirbyGrade({ gradeId: kirby.gradeId } as KirbyDef);
      const color = GRADE_COLORS[kirby.gradeId] ?? 0xffffff;
      view.bg.setStrokeStyle(3, color, 1);
      const imageKey = IMAGE_KEY_BY_CODE[kirby.code];
      const textureKey = imageKey ? kirbyTextureKey(imageKey) : null;
      if (textureKey && this.textures.exists(textureKey)) view.icon.setTexture(textureKey).setDisplaySize(64, 64).setVisible(true);
      else view.icon.setVisible(false);
      if (kirby.status === 'stolen_in_transit') {
        view.label.setText(`${kirby.name}\n도둑맞는 중!\n(클릭해서 방어)`);
      } else if (this.sceneData.mode === 'manage') {
        view.label.setText(`${kirby.name}\n판매가 ${grade.sellPrice}G\n(클릭해서 판매)`);
      } else {
        view.label.setText(`${kirby.name}\n(클릭해서 훔치기)`);
      }
    }
  }

  private async onSlotClick(bg: Phaser.GameObjects.Rectangle) {
    const index = this.slotViews.findIndex((v) => v.bg === bg);
    const kirby = this.myKirbies.slice(this.floor * SLOTS_PER_FLOOR, this.floor * SLOTS_PER_FLOOR + SLOTS_PER_FLOOR)[index];
    if (!kirby) return;

    if (kirby.status === 'stolen_in_transit') {
      this.scene.restart({ mode: 'defend', targetPlayerId: this.sceneData.targetPlayerId, instanceId: kirby.instanceId, characterName: kirby.name });
      return;
    }

    if (this.sceneData.mode === 'manage') {
      try {
        await kirbyNetwork.sell(kirby.instanceId);
      } catch {
        this.showMessage('판매할 수 없습니다');
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
    this.add.text(20, 16, `침입 진행 중 — ${this.sceneData.characterName}`, { fontSize: '18px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } });
    this.add.text(
      20,
      46,
      role === 'owner' ? '이동해서 도둑에게 접근 후 SPACE로 타격(3회 명중시 방어 성공)' : '이동해서 아래쪽 출입문까지 도달하면 성공!',
      { fontSize: '13px', color: '#8be9fd', backgroundColor: '#00000099', padding: { x: 6, y: 4 } },
    );
    // 코덱스 확정(2026-09-17): 하트 대신 방망이 아이콘+3칸 카운터 — 아이콘 에셋 도착 전까지는 원형 pip로 구조만 반영
    this.add.text(20, 74, '명중', { fontSize: '12px', color: '#ffaaaa', backgroundColor: '#00000099', padding: { x: 6, y: 2 } });
    this.hitPips = [];
    for (let i = 0; i < BAT_HITS_REQUIRED; i++) {
      this.hitPips.push(this.add.circle(70 + i * 26, 80, 9, 0x000000, 0).setStrokeStyle(2, 0xff5555));
    }
    this.hitText = this.add.text(150, 74, `0 / ${BAT_HITS_REQUIRED}`, { fontSize: '13px', color: '#ff5555' });

    this.add.circle(EXIT_DOOR.x, EXIT_DOOR.y, EXIT_DOOR.radius, 0x50fa7b, 0.25).setStrokeStyle(2, 0x50fa7b);
    this.add.text(EXIT_DOOR.x, EXIT_DOOR.y - EXIT_DOOR.radius - 16, '출입문(탈출)', { fontSize: '12px', color: '#50fa7b' }).setOrigin(0.5);

    const startX = role === 'owner' ? MOVE_BOUNDS.minX + 100 : CANVAS_WIDTH / 2;
    const startY = role === 'owner' ? (MOVE_BOUNDS.minY + MOVE_BOUNDS.maxY) / 2 : MOVE_BOUNDS.minY + 60;
    this.myPos = { x: startX, y: startY };
    // 코덱스 확정(2026-09-17) 역할 링 색상: 소유자/방어자=금색·주황, 침입자=청록·파랑. 로컬 플레이어는 발밑 흰색 굵은 링 추가.
    this.meRing = this.add.circle(startX, startY, 22, 0x000000, 0).setStrokeStyle(4, 0xffffff, 1);
    this.me = this.add.image(startX, startY, 'player-avatar').setDisplaySize(48, 48).setTint(role === 'owner' ? 0xffb84d : 0x7ec8ff);
    this.opponentRing = this.add.circle(-100, -100, 20, 0x000000, 0).setStrokeStyle(3, role === 'owner' ? 0x22d3ee : 0xffb300, 1);
    this.opponent = this.add.image(-100, -100, 'player-avatar').setDisplaySize(48, 48).setTint(role === 'owner' ? 0x7ec8ff : 0xffb84d).setAlpha(0.9);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // 조이스틱(터치1)과 공격 버튼(터치2)을 동시에 눌러야 하므로 2번째 포인터 트래킹 활성화
    this.input.addPointer(1);
    this.add.circle(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, JOYSTICK_BASE_RADIUS, 0x000000, 0.25).setStrokeStyle(2, 0xffffff, 0.5);
    this.joyThumb = this.add.circle(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, JOYSTICK_THUMB_RADIUS, 0xffffff, 0.6);
    this.setupJoystick();

    // 코덱스 확정(2026-09-17): 방어자에게만 모바일 공격 버튼 노출, 침입자는 버튼 없음(Zone 자동판정 유지)
    if (role === 'owner') {
      this.attackButton = this.add
        .circle(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 46, 0xff5555, 0.85)
        .setStrokeStyle(3, 0xffffff)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      this.add.image(CANVAS_WIDTH - 90, CANVAS_HEIGHT - 90, 'weapon-bat').setDisplaySize(44, 44).setAngle(-45).setScrollFactor(0);
      // 조이스틱(방향키)과 공격 버튼을 서로 다른 입력 경로로 분리해서 동시 입력(멀티터치) 가능
      this.attackButton.on('pointerdown', () => void kirbyNetwork.attack(this.sceneData.targetPlayerId, this.sceneData.instanceId!));
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
    this.hitText.setText(`${p.hitCount} / ${BAT_HITS_REQUIRED}`);
    for (let i = 0; i < this.hitPips.length; i++) {
      this.hitPips[i].setFillStyle(i < p.hitCount ? 0xff5555 : 0x000000, i < p.hitCount ? 1 : 0);
    }

    // 코덱스 확정(2026-09-17): 피격 순간 흰색 플래시 80ms + 화면 흔들림. 맞는 쪽은 항상 침입자(도주자) 본인.
    const hitSprite = this.sceneData.mode === 'steal' ? this.me : this.opponent;
    const originalTint = hitSprite.tintTopLeft;
    hitSprite.setTint(0xffffff);
    this.time.delayedCall(80, () => hitSprite.setTint(originalTint));
    this.cameras.main.shake(120, 0.006);

    // 명중당 5초 기절(4.2 확정) — 침입자 로컬 클라이언트만 이동 입력을 잠그고 채도를 낮춤(서버는 명중/포획만 권위 판정)
    if (this.sceneData.mode === 'steal') {
      this.stunnedUntil = this.time.now + BAT_STUN_MS;
      hitSprite.setAlpha(0.5);
      this.time.delayedCall(BAT_STUN_MS, () => {
        if (this.time.now >= this.stunnedUntil) hitSprite.setAlpha(1);
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
    this.time.delayedCall(1800, () => this.scene.start('LobbyScene'));
  };

  private updateChase(delta: number) {
    if (this.resolved) return;
    const stunned = this.sceneData.mode === 'steal' && this.time.now < this.stunnedUntil;
    const speed = stunned ? 0 : (AVATAR_SPEED * delta) / 1000;
    let dx = stunned ? 0 : this.joyVector.x * speed;
    let dy = stunned ? 0 : this.joyVector.y * speed;
    if (this.cursors.left?.isDown) dx -= speed;
    if (this.cursors.right?.isDown) dx += speed;
    if (this.cursors.up?.isDown) dy -= speed;
    if (this.cursors.down?.isDown) dy += speed;
    this.myPos.x = Phaser.Math.Clamp(this.myPos.x + dx, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
    this.myPos.y = Phaser.Math.Clamp(this.myPos.y + dy, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);
    this.me.setPosition(this.myPos.x, this.myPos.y);
    this.meRing.setPosition(this.myPos.x, this.myPos.y);
    if (this.opponentPos) {
      this.opponent.setPosition(this.opponentPos.x, this.opponentPos.y);
      this.opponentRing.setPosition(this.opponentPos.x, this.opponentPos.y);
    }

    const now = this.time.now;
    if (now - this.lastBroadcast > 150) {
      this.lastBroadcast = now;
      void kirbyNetwork.reportMove(this.sceneData.targetPlayerId, this.sceneData.instanceId!, this.myPos.x, this.myPos.y);
    }
    if (this.sceneData.mode === 'defend' && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      void kirbyNetwork.attack(this.sceneData.targetPlayerId, this.sceneData.instanceId!);
    }
    if (this.sceneData.mode === 'steal') {
      const dist = Phaser.Math.Distance.Between(this.myPos.x, this.myPos.y, EXIT_DOOR.x, EXIT_DOOR.y);
      if (dist <= EXIT_DOOR.radius) {
        void kirbyNetwork.exit(this.sceneData.targetPlayerId, this.sceneData.instanceId!);
      }
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

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: 1600, duration: 400 });
  }
}
