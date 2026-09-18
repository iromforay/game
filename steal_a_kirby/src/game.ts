import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/constants';
import { LobbyScene } from './scenes/LobbyScene';
import { BaseScene } from './scenes/BaseScene';
import { kirbyNetwork } from './net/KirbyNetwork';

export async function mountGame(parent: HTMLElement | string): Promise<Phaser.Game> {
  // 허브 연동(2026-09-18): main.ts가 아니라 이 mountGame()이 진입점이 되므로(save-a-turby와
  // 동일 패턴), 소켓 연결은 여기서 해야 단독 실행/허브 임베드 양쪽에서 다 동작함.
  await kirbyNetwork.connect();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#1a1030',
    scale: {
      mode: Phaser.Scale.FIT,
      // hub 연동 시 부모 컨테이너가 flex 중앙정렬을 담당(save-a-turby에서 겪은 이중 중앙정렬 버그 방지)
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [LobbyScene, BaseScene],
  };

  return new Phaser.Game(config);
}

export * from './config/constants';
export * from './config/grades';
