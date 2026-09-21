import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/constants';
import { VillageScene } from './scenes/VillageScene';
import { HomeScene } from './scenes/HomeScene';
import { MarketScene } from './scenes/MarketScene';
import { StageSelectScene } from './scenes/StageSelectScene';
import { MapScene } from './scenes/MapScene';
import { PartySelectScene } from './scenes/PartySelectScene';
import { BattleScene } from './scenes/BattleScene';
import { CoopScene } from './scenes/CoopScene';
import { inventory } from './state/inventory';

export async function mountGame(parent: HTMLElement | string): Promise<Phaser.Game> {
  // VillageScene이 동기적으로 인벤토리(타레 등)를 읽으므로, 씬 생성 전에 서버 조회를 먼저 끝내둠(오펜스타워의 loadHero 패턴과 동일)
  await inventory.init();

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#1a1030',
    dom: { createContainer: true }, // 방 이름·방 코드 입력(화면 2)에 쓰는 DOM 입력칸
    scale: {
      mode: Phaser.Scale.FIT,
      // 허브(hub)의 .game-canvas-container가 이미 flex로 중앙정렬하는데, Phaser의 자체
      // 중앙정렬(margin 기반)이 그 위에 또 겹쳐 적용되면서 좁은/세로로 긴 뷰포트에서 캔버스가
      // 엉뚱한 위치(아래쪽에 쏠림)로 밀리는 버그를 겪음 — 실제로 재현·확인함. 부모가 이미
      // 중앙정렬하므로 Phaser 쪽 중앙정렬은 끄고 부모에게 맡김(단독 실행 시 index.html의
      // body도 동일하게 flex 중앙정렬이라 문제없음).
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    scene: [VillageScene, HomeScene, MarketScene, StageSelectScene, CoopScene, MapScene, PartySelectScene, BattleScene],
  };

  return new Phaser.Game(config);
}

export * from './config/constants';
export * from './config/grades';
