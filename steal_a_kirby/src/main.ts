import Phaser from 'phaser';
import { mountGame } from './game';
import { kirbyNetwork } from './net/KirbyNetwork';

let gameInstance: Phaser.Game | null = null;

async function start() {
  // 허브 연동(2026-09-18): 소켓 연결은 mountGame() 내부로 옮김(save-a-turby와 동일 패턴) —
  // 허브가 main.ts를 거치지 않고 mountGame()을 직접 호출해도 동작해야 하기 때문.
  gameInstance = await mountGame('app');
  // 헤드리스 프리뷰에서 Phaser 타이머(time.addEvent)가 안 도는 경우가 있어(save-a-turby에서 겪은 이슈와 동일),
  // 개발 중 씬 메서드를 직접 호출해 로직만 검증할 수 있도록 디버그용으로 노출해둠.
  (window as unknown as { __game?: Phaser.Game; __net?: typeof kirbyNetwork }).__game = gameInstance;
  (window as unknown as { __net?: typeof kirbyNetwork }).__net = kirbyNetwork;
}
start();

// Vite HMR: save-a-turby에서 겪은 좀비 인스턴스 누적 버그 방지 — 교체 전 반드시 destroy
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    gameInstance?.destroy(true);
    gameInstance = null;
  });
}
