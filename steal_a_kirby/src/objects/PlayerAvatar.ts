import Phaser from 'phaser';
import { DEPTH } from '../config/constants';
import { getCharacterAssetUrl } from '../assets/registry';

// 이미지 2단계(DELIVERED, 2026-09-18) — docs/history/2026-09-18/steal_a_kirby/to_claude_v4_C.md
// 규칙 그대로: 시트 384x96(96x96 4프레임), 피벗(0.5,0.9) 대신 origin 기본(0.5,0.5)+그림자 별도 오브젝트로 발밑 위치 표현,
// 이동 시트 순서 down/left/right/up, 공격은 ready→backswing→strike→follow-through 1회 재생 후 이전 상태로 복귀.

export type Direction = 'down' | 'left' | 'right' | 'up';

const WALK_FRAME_RATE = 8;
const IDLE_FRAME_RATE = 4;
const ATTACK_FRAME_RATE = 14; // 4프레임 / 14fps ≈ 285ms, 기획 240~320ms 범위

let animsReady = false;

export function preloadPlayerAvatarAssets(scene: Phaser.Scene) {
  const charAsset = (key: string) => getCharacterAssetUrl(key)!;
  const sheets: [string, string][] = [
    ['player-idle-down', 'player/player-idle-sheet'],
    ['player-walk-down', 'player/player-walk-down'],
    ['player-walk-left', 'player/player-walk-left'],
    ['player-walk-right', 'player/player-walk-right'],
    ['player-walk-up', 'player/player-walk-up'],
    ['player-attack-down', 'player/player-attack-down'],
    ['player-attack-left', 'player/player-attack-left'],
    ['player-attack-right', 'player/player-attack-right'],
    ['player-attack-up', 'player/player-attack-up'],
  ];
  for (const [texKey, assetKey] of sheets) {
    if (!scene.textures.exists(texKey)) scene.load.spritesheet(texKey, charAsset(assetKey), { frameWidth: 96, frameHeight: 96 });
  }
  if (!scene.textures.exists('player-shadow-tex')) scene.load.image('player-shadow-tex', charAsset('player/player-shadow'));
}

export function ensurePlayerAvatarAnims(scene: Phaser.Scene) {
  if (animsReady) return;
  const mgr = scene.anims;
  const make = (key: string, tex: string, frameRate: number, repeat: number) => {
    if (mgr.exists(key)) return;
    mgr.create({ key, frames: mgr.generateFrameNumbers(tex, { start: 0, end: 3 }), frameRate, repeat });
  };
  make('idle-down', 'player-idle-down', IDLE_FRAME_RATE, -1);
  for (const dir of ['down', 'left', 'right', 'up'] as Direction[]) {
    make(`walk-${dir}`, `player-walk-${dir}`, WALK_FRAME_RATE, -1);
    make(`attack-${dir}`, `player-attack-${dir}`, ATTACK_FRAME_RATE, 0);
  }
  animsReady = true;
}

/** 걷기/공격 애니메이션 + 그림자를 함께 관리하는 플레이어 아바타 — Lobby/BaseScene 공용 */
export class PlayerAvatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  private dir: Direction = 'down';
  private attacking = false;

  constructor(scene: Phaser.Scene, x: number, y: number, displaySize = 64) {
    this.shadow = scene.add
      .image(x, y + displaySize * 0.42, 'player-shadow-tex')
      .setDisplaySize(displaySize * 0.85, displaySize * 0.32);
    this.sprite = scene.add.sprite(x, y, 'player-idle-down').setDisplaySize(displaySize, displaySize);
    this.sprite.play('idle-down');
    this.updateDepth();
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.shadow.setPosition(x, y + this.sprite.displayHeight * 0.42);
    this.updateDepth();
  }

  private updateDepth() {
    this.shadow.setDepth(DEPTH.ACTOR_BASE + this.sprite.y - 1);
    this.sprite.setDepth(DEPTH.ACTOR_BASE + this.sprite.y);
  }

  /** dx/dy: 이번 프레임 이동량(부호만 의미 있음). 매 프레임 호출해서 방향·재생 애니메이션을 갱신 */
  updateMovement(dx: number, dy: number) {
    if (this.attacking) return; // 공격 애니메이션 재생 중엔 이동 애니메이션으로 덮어쓰지 않음
    const moving = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
    if (moving) {
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
    const key = moving ? `walk-${this.dir}` : 'idle-down'; // idle 시트는 아래보기 1종뿐(2단계 확정 스펙)
    if (this.sprite.anims.currentAnim?.key !== key) this.sprite.play(key);
  }

  playAttack(onComplete?: () => void) {
    this.attacking = true;
    this.sprite.play(`attack-${this.dir}`);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.attacking = false;
      this.sprite.play(`walk-${this.dir}`, true);
      this.sprite.stop();
      this.sprite.play('idle-down');
      onComplete?.();
    });
  }

  private roleTint = 0xffffff;

  setTint(color: number) {
    this.roleTint = color;
    this.sprite.setTint(color);
  }

  /** 피격 순간 흰색 플래시(코덱스 확정, to_claude_v1_R.md 7절) — duration 후 역할 틴트로 복귀 */
  flashWhite(scene: Phaser.Scene, durationMs: number) {
    this.sprite.setTint(0xffffff);
    scene.time.delayedCall(durationMs, () => this.sprite.setTint(this.roleTint));
  }

  setAlpha(alpha: number) {
    this.sprite.setAlpha(alpha);
    this.shadow.setAlpha(alpha * 0.6);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
