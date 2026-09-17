import Phaser from 'phaser';
import { mountGame } from './game';

let gameInstance: Phaser.Game | null = null;

async function start() {
  gameInstance = await mountGame('app');
}
start();

// Vite HMR: 이 모듈(또는 의존 모듈)이 바뀔 때마다 재실행되는데, 게임 인스턴스를 정리 안 하면
// 이전 인스턴스가 계속 살아있는 채로 새 인스턴스가 또 생겨서(각자 inventory.init()도 다시 호출) 누적됨
// — 실제로 이 세션에서 이렇게 좀비 인스턴스/요청이 수천 개까지 쌓인 버그를 겪음. 교체 전에 반드시 destroy.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    gameInstance?.destroy(true);
    gameInstance = null;
  });
}
