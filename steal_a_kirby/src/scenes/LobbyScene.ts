import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT, AVATAR_SPEED, JOYSTICK_BASE_RADIUS, JOYSTICK_THUMB_RADIUS } from '../config/constants';
import { GRADE_COLORS } from '../config/gradeColors';
import { kirbyGrade, pickWeightedRandomKirby, type KirbyDef } from '../data/kirbyData';
import { kirbyNetwork } from '../net/KirbyNetwork';
import type { PlayerStateDto } from '../api/client';
import { allKirbyImageKeys, getKirbyImageUrl, PLAYER_AVATAR_URL, UI_COIN_URL } from '../assets/registry';

const kirbyTextureKey = (imageKey: string) => `kirby-${imageKey}`;

// 1280x720 캔버스 직접 좌표(loby.png 배경과 시각적으로 맞춰서 잡은 값 — 2026-09-17, 기존
// pic/loby.png 원본픽셀(1672x941) 기준 px()/py() 변환은 제거하고 결과값을 그대로 상수화함).
const PLAYER_START = { x: 624, y: 528 };
const MOVE_BOUNDS = { minX: 54, maxX: 1225, minY: 122, maxY: 689 };

// loby.png에 이미 그려진 4채 집(지무/하늘/민수/루나)의 문 위치 — 실제로는 접속 중인 플레이어를
// 동적으로 배정한다. bottomLeft는 항상 "내 기지" 고정.
const HOUSE_DOORS = {
  topLeft: { x: 188, y: 157, label: 188, labelY: 115 },
  topRight: { x: 1095, y: 157, label: 1095, labelY: 115 },
  bottomLeft: { x: 188, y: 425, label: 188, labelY: 383 },
  bottomRight: { x: 1095, y: 425, label: 1095, labelY: 383 },
} as const;
const DOOR_ENTER_RADIUS = 90;

const CARPET_Y = 360;
const CARPET_START_X = 322;
const CARPET_END_X = 942;
const CARPET_SPEED_PX_PER_SEC = 70;
const SPAWN_INTERVAL_MS = 2600;

const JOYSTICK_CENTER = { x: 115, y: 681 };

interface CarpetKirby {
  kirby: KirbyDef;
  glow: Phaser.GameObjects.Arc;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  purchasing?: boolean;
}

interface HouseSlotView {
  key: keyof typeof HOUSE_DOORS;
  zone: Phaser.GameObjects.Zone;
  nameTag: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Arc;
  targetPlayerId: string | null; // null = 내 기지
}

export class LobbyScene extends Phaser.Scene {
  private goldText!: Phaser.GameObjects.Text;
  private onlineText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private avatar!: Phaser.GameObjects.Image;
  private carpetItems: CarpetKirby[] = [];
  private houseSlots: HouseSlotView[] = [];
  private pos = { x: PLAYER_START.x, y: PLAYER_START.y };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private joyThumb!: Phaser.GameObjects.Arc;
  private joyActive = false;
  private joyVector = { x: 0, y: 0 };

  private onStateChanged = (state: PlayerStateDto) => this.refreshFromState(state);

  constructor() {
    super('LobbyScene');
  }

  preload() {
    this.load.image('lobby-bg', new URL('../assets/backgrounds/lobby.png', import.meta.url).href);
    this.load.image('player-avatar', PLAYER_AVATAR_URL);
    this.load.image('ui-coin', UI_COIN_URL);
    for (const key of allKirbyImageKeys(128)) {
      this.load.image(kirbyTextureKey(key), getKirbyImageUrl(key, 128)!);
    }
  }

  create() {
    this.carpetItems = [];
    this.houseSlots = [];
    this.pos = { ...PLAYER_START };

    this.add.image(0, 0, 'lobby-bg').setOrigin(0, 0).setDisplaySize(CANVAS_WIDTH, CANVAS_HEIGHT);

    this.add.image(95, 42, 'ui-coin').setDisplaySize(28, 28);
    this.goldText = this.add.text(115, 42, '연결 중...', { fontSize: '20px', color: '#ffe082', fontStyle: 'bold' }).setOrigin(0, 0.5);
    this.onlineText = this.add.text(1194, 92, '', { fontSize: '13px', color: '#ffffff', align: 'right' }).setOrigin(1, 0.5);
    this.messageText = this.add.text(CANVAS_WIDTH / 2, 230, '', { fontSize: '16px', color: '#ff5252' }).setOrigin(0.5);

    for (const key of Object.keys(HOUSE_DOORS) as (keyof typeof HOUSE_DOORS)[]) {
      const door = HOUSE_DOORS[key];
      const zone = this.add.zone(door.x, door.y, 130, 150).setInteractive({ useHandCursor: true });
      const ring = this.add.circle(door.x, door.y, DOOR_ENTER_RADIUS, 0xffffff, 0).setStrokeStyle(2, 0xffe082, 0);
      const nameTag = this.add
        .text(door.label, door.labelY, '', { fontSize: '13px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 3 } })
        .setOrigin(0.5);
      zone.on('pointerdown', () => void this.onHouseClick(key));
      this.houseSlots.push({ key, zone, nameTag, ring, targetPlayerId: key === 'bottomLeft' ? '' : null });
    }

    this.avatar = this.add.image(this.pos.x, this.pos.y, 'player-avatar').setDisplaySize(64, 64).setDepth(100);

    // 레드카펫 가챠 — 원작 art의 캐릭터들은 배경 장식이고, 실제 상호작용 아이템은 그 위에 겹쳐서 스폰
    this.time.addEvent({ delay: SPAWN_INTERVAL_MS, loop: true, callback: () => this.spawnCarpetKirby() });
    this.spawnCarpetKirby();

    // 가상 조이스틱(화면 좌하단, art 배치와 동일) — 마우스/터치 겸용, 데스크톱은 방향키도 지원
    this.add.circle(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, JOYSTICK_BASE_RADIUS, 0x000000, 0.25).setStrokeStyle(2, 0xffffff, 0.5);
    this.joyThumb = this.add.circle(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y, JOYSTICK_THUMB_RADIUS, 0xffffff, 0.6);
    this.setupJoystick();
    this.cursors = this.input.keyboard!.createCursorKeys();

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
      this.pos.x = Phaser.Math.Clamp(this.pos.x + (dx / len) * speed, MOVE_BOUNDS.minX, MOVE_BOUNDS.maxX);
      this.pos.y = Phaser.Math.Clamp(this.pos.y + (dy / len) * speed, MOVE_BOUNDS.minY, MOVE_BOUNDS.maxY);
      this.avatar.setPosition(this.pos.x, this.pos.y);
    }

    for (const slot of this.houseSlots) {
      const door = HOUSE_DOORS[slot.key];
      const near = Phaser.Math.Distance.Between(this.pos.x, this.pos.y, door.x, door.y) <= DOOR_ENTER_RADIUS;
      slot.ring.setStrokeStyle(2, 0xffe082, near ? 0.9 : 0);
    }

    for (const item of [...this.carpetItems]) {
      if (item.purchasing) continue; // 구매 응답 대기 중엔 카펫 밖으로 흘러나가 이중 제거되지 않게 고정
      item.sprite.x += (CARPET_SPEED_PX_PER_SEC * delta) / 1000;
      item.glow.x = item.sprite.x;
      item.label.x = item.sprite.x;
      if (item.sprite.x > CARPET_END_X) this.removeCarpetItem(item);
    }
  }

  private setupJoystick() {
    const withinBase = (x: number, y: number) => Phaser.Math.Distance.Between(x, y, JOYSTICK_CENTER.x, JOYSTICK_CENTER.y) <= JOYSTICK_BASE_RADIUS + 20;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!withinBase(p.x, p.y)) return;
      this.joyActive = true;
      this.updateJoystick(p.x, p.y);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.joyActive) return;
      this.updateJoystick(p.x, p.y);
    });
    this.input.on('pointerup', () => this.resetJoystick());
    this.input.on('pointerupoutside', () => this.resetJoystick());
  }

  private updateJoystick(x: number, y: number) {
    const dx = x - JOYSTICK_CENTER.x;
    const dy = y - JOYSTICK_CENTER.y;
    const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_BASE_RADIUS);
    const angle = Math.atan2(dy, dx);
    this.joyThumb.setPosition(JOYSTICK_CENTER.x + Math.cos(angle) * dist, JOYSTICK_CENTER.y + Math.sin(angle) * dist);
    this.joyVector = dist < 6 ? { x: 0, y: 0 } : { x: Math.cos(angle), y: Math.sin(angle) };
  }

  private resetJoystick() {
    this.joyActive = false;
    this.joyVector = { x: 0, y: 0 };
    this.joyThumb.setPosition(JOYSTICK_CENTER.x, JOYSTICK_CENTER.y);
  }

  private refreshFromState(state: PlayerStateDto) {
    this.goldText.setText(`${state.gold.toLocaleString()} G`);
    const mine = this.houseSlots.find((s) => s.key === 'bottomLeft');
    if (mine) mine.nameTag.setText(`내 기지\n${this.houseStatusLabel(state)}`);
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
    this.showMessage('도둑이 들었습니다! 내 기지로 가서 막으세요');
  };

  private spawnCarpetKirby() {
    const kirby = pickWeightedRandomKirby();
    const grade = kirbyGrade(kirby);
    const color = GRADE_COLORS[grade.id] ?? 0xffffff;
    // 7.5(에셋 가이드) 확정: 등급색은 사각형 대신 후광 용도로 — 실제 캐릭터는 kirby/128 이미지 사용
    const glow = this.add.circle(CARPET_START_X, CARPET_Y, 30, color, 0.35).setStrokeStyle(2, color, 0.9);
    const textureKey = kirby.imageKey ? kirbyTextureKey(kirby.imageKey) : null;
    const sprite = this.add
      .image(CARPET_START_X, CARPET_Y, textureKey && this.textures.exists(textureKey) ? textureKey : 'player-avatar')
      .setDisplaySize(48, 48)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(CARPET_START_X, CARPET_Y + 28, `${kirby.name}\n${grade.buyPrice}G`, { fontSize: '11px', color: '#ffffff', align: 'center' })
      .setOrigin(0.5, 0);
    const item: CarpetKirby = { kirby, glow, sprite, label };
    this.carpetItems.push(item);
    sprite.on('pointerdown', () => void this.tryBuy(item));
  }

  private removeCarpetItem(item: CarpetKirby) {
    item.glow.destroy();
    item.sprite.destroy();
    item.label.destroy();
    this.carpetItems = this.carpetItems.filter((i) => i !== item);
  }

  private async tryBuy(item: CarpetKirby) {
    if (!this.carpetItems.includes(item) || item.purchasing) return;
    item.purchasing = true;
    try {
      await kirbyNetwork.buy();
      this.removeCarpetItem(item);
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

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setAlpha(1);
    this.tweens.add({ targets: this.messageText, alpha: 0, delay: 1400, duration: 400 });
  }
}
