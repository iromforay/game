import Phaser from 'phaser';
import { JOYSTICK_BASE_RADIUS, JOYSTICK_THUMB_RADIUS } from '../config/constants';

// 4.6/3.5.1: 이동 조작은 가상 조이스틱(확정). 화면 좌하단 고정(scrollFactor 0) UI로,
// 눌린 지점을 기준(base) 삼아 손가락을 뗄 때까지 그 자리에서 동작(고정 위치 아님).
export class VirtualJoystick {
  private base: Phaser.GameObjects.Arc;
  private thumb: Phaser.GameObjects.Arc;
  private pointerId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private dirX = 0;
  private dirY = 0;
  private magnitude = 0;
  private enabled = true;

  constructor(scene: Phaser.Scene) {
    this.base = scene.add.circle(0, 0, JOYSTICK_BASE_RADIUS, 0xffffff, 0.15).setScrollFactor(0).setDepth(1000).setVisible(false);
    this.thumb = scene.add.circle(0, 0, JOYSTICK_THUMB_RADIUS, 0xffffff, 0.35).setScrollFactor(0).setDepth(1001).setVisible(false);

    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this);
  }

  // 인벤토리 창 등 UI 오버레이가 떠 있는 동안 이동 입력을 막을 때 사용
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.onPointerUp({ id: this.pointerId } as Phaser.Input.Pointer);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) {
    if (currentlyOver.length > 0) return; // 미니맵·프롬프트 같은 UI를 누를 때는 이동 입력으로 취급하지 않음
    if (!this.enabled || this.pointerId !== null) return; // 이미 다른 손가락으로 조작 중
    this.pointerId = pointer.id;
    this.baseX = pointer.x;
    this.baseY = pointer.y;
    this.base.setPosition(this.baseX, this.baseY).setVisible(true);
    this.thumb.setPosition(this.baseX, this.baseY).setVisible(true);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (pointer.id !== this.pointerId) return;
    const dx = pointer.x - this.baseX;
    const dy = pointer.y - this.baseY;
    const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_BASE_RADIUS);
    const angle = Math.atan2(dy, dx);
    this.thumb.setPosition(this.baseX + Math.cos(angle) * dist, this.baseY + Math.sin(angle) * dist);
    this.magnitude = dist / JOYSTICK_BASE_RADIUS;
    this.dirX = this.magnitude > 0.05 ? Math.cos(angle) : 0;
    this.dirY = this.magnitude > 0.05 ? Math.sin(angle) : 0;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    if (pointer.id !== this.pointerId) return;
    this.pointerId = null;
    this.dirX = 0;
    this.dirY = 0;
    this.magnitude = 0;
    this.base.setVisible(false);
    this.thumb.setVisible(false);
  }

  getVector(): { x: number; y: number; magnitude: number } {
    return { x: this.dirX, y: this.dirY, magnitude: this.magnitude };
  }
}
