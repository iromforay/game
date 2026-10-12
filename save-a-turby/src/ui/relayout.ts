// 창 크기가 바뀌어 배치 기준(layoutKey)이 달라지면 onChange를 부른다(v5 §4).
// 여러 번 연달아 오는 resize는 잠시 모아서 한 번만 처리하고, 씬이 끝나면 리스너를 떼어 중복 등록이 쌓이지 않는다.
import Phaser from 'phaser';
import { displayScaleOf, layoutKey } from './responsive';

export function watchLayout(scene: Phaser.Scene, onChange: () => void, settleMs = 150) {
  const keyNow = () => layoutKey(displayScaleOf(scene.scale.displaySize.width));
  let key = keyNow();
  let timer: number | null = null;
  const onResize = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (!scene.sys.isActive()) return;
      const next = keyNow();
      if (next === key) return;
      key = next;
      onChange();
    }, settleMs);
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => {
    scene.scale.off('resize', onResize);
    if (timer !== null) window.clearTimeout(timer);
  });
}
