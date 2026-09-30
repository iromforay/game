import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { loadWorldImages } from '../assets/loader';
import { TEXT, pillButton } from '../ui/kit';
import { apiStoryClient } from '../story/apiStoryClient';
import { bootRoute, type OpeningStoryState } from '../story/storyClient';
import { inventory } from '../state/inventory';
import { getPlayerId } from '../state/player';
import type { OpeningSceneData } from './OpeningScene';

// 오프닝 시작(Boot의 필수 진입과 마을의 선택 진입이 같은 흐름을 쓴다). 완료되면 이야기 누비를 다시 받아 마을로.
export function startOpening(scene: Phaser.Scene, state: OpeningStoryState) {
  const data: OpeningSceneData = {
    client: apiStoryClient,
    state,
    seenKey: `turby_seen_segments:${getPlayerId()}`,
    onDone: async (s) => {
      await inventory.init(); // 오프닝 완료로 지급·연결된 이야기 누비를 다시 받아 온다
      s.scene.start('Village');
    },
  };
  scene.scene.start('Opening', data);
}

// 게임 첫 씬(M3): 서버가 오프닝 필수(openingRequired)라고 할 때만 오프닝, 아니면 마을(기존 계정 포함).
// 상태를 받지 못하면 신규/기존을 추측하지 않고 다시 시도를 기다린다.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    loadWorldImages(this);
  }

  async create() {
    this.cameras.main.setBackgroundColor('#F7E9D2');
    const status = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20, '이야기를 불러오는 중…', { fontSize: '24px', color: TEXT.body }).setOrigin(0.5);
    let state: OpeningStoryState;
    try {
      state = await apiStoryClient.fetchState();
    } catch (err) {
      console.warn('[boot] 스토리 상태를 불러오지 못했습니다:', err);
      status.setText('이야기 정보를 불러오지 못했어요.').setColor(TEXT.error);
      pillButton(this, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70, 260, 88, '다시 시도', 'primary', () => this.scene.restart());
      return;
    }
    if (bootRoute(state) === 'opening') startOpening(this, state);
    else this.scene.start('Village');
  }
}
