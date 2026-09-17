import Phaser from 'phaser';
import { mountGame } from './game';
import { kirbyNetwork } from './net/KirbyNetwork';

let gameInstance: Phaser.Game | null = null;

async function start() {
  // 화면 구성이 어떻게 바뀌든(9번 재설계 예정) 실시간 통신은 특정 씬에 묶이지 않고 앱 부팅 시 한 번만 연결.
  await kirbyNetwork.connect();
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
