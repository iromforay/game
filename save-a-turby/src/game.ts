import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './config/constants';
import { VillageScene } from './scenes/VillageScene';
import { HomeScene } from './scenes/HomeScene';
import { MarketScene } from './scenes/MarketScene';
import { StageSelectScene } from './scenes/StageSelectScene';
import { MapScene } from './scenes/MapScene';
import { PartySelectScene } from './scenes/PartySelectScene';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { OpeningScene } from './scenes/OpeningScene';
import { StoryDialogueScene } from './scenes/StoryDialogueScene';
import { inventory } from './state/inventory';
import { session } from './api/client';
import { installImmediateInput } from './ui/inputReady';

export async function mountGame(parent: HTMLElement | string): Promise<Phaser.Game> {
  // VillageScene이 동기적으로 인벤토리(타레 등)를 읽으므로, 씬 생성 전에 서버 조회를 먼저 끝내둠(오펜스타워의 loadHero 패턴과 동일)
  await inventory.init();
  watchSession(parent);

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
    // 첫 씬 Boot가 서버 스토리 상태로 오프닝/마을을 고른다(M3)
    scene: [BootScene, VillageScene, HomeScene, MarketScene, StageSelectScene, MapScene, PartySelectScene, BattleScene, OpeningScene, StoryDialogueScene],
  };

  const game = new Phaser.Game(config);
  installImmediateInput(game); // 다시 그린 직후의 탭도 새 버튼에 닿게(ui/inputReady.ts)
  return game;
}

// 스토리 M1-B: 세션 토큰 재식별까지 실패하면(state/session.ts) 요청을 반복하지 않고 재접속 안내를 띄운다.
function watchSession(parent: HTMLElement | string) {
  const host = typeof parent === 'string' ? document.getElementById(parent) : parent;
  session.onChange((state) => {
    if (state !== 'reconnect_required' || !host || host.querySelector('.turby-session-lost')) return;
    const box = document.createElement('div');
    box.className = 'turby-session-lost';
    box.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(16,8,32,.86);color:#fff;font:16px sans-serif;z-index:10;text-align:center;padding:16px';
    const msg = document.createElement('p');
    msg.textContent = '접속 정보를 확인할 수 없습니다. 다시 접속해 주세요.';
    const btn = document.createElement('button');
    btn.textContent = '다시 접속';
    btn.style.cssText = 'min-width:120px;min-height:44px;font-size:16px';
    btn.onclick = () => location.reload();
    box.append(msg, btn);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(box);
  });
}

export * from './config/constants';
export * from './config/grades';
