import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../config/constants';
import { loadWorldImages } from '../assets/loader';
import { TEXT, pillButton } from '../ui/kit';
import { apiStoryClient } from '../story/apiStoryClient';
import { bootRoute, type OpeningStoryState } from '../story/storyClient';
import { inventory } from '../state/inventory';
import { getPlayerId } from '../state/player';
import type { OpeningSceneData } from './OpeningScene';
import { roomClient } from '../net/roomClient';
import { restoreRoute } from '../state/restore';
import { canRetry, RESTORE_RETRY_LABEL, RESTORE_SLOW_MS, RESTORE_TEXT, RestoreAttempts, type RestorePhase } from '../state/restoreAttempt';
import { displayScaleOf, fontPx, MIN_BODY_PX } from '../ui/responsive';
import { resumeBattle } from './VillageScene';

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
  private attempts = new RestoreAttempts();
  private restorePhase: RestorePhase | null = null; // 복원 화면의 지금 상태(복원 단계가 아니면 null)
  private restoreStatus?: Phaser.GameObjects.Text;
  private retryButton?: Phaser.GameObjects.Container;

  constructor() {
    super('Boot');
  }

  init() {
    this.attempts = new RestoreAttempts();
    this.restorePhase = null;
    this.restoreStatus = undefined;
    this.retryButton = undefined;
  }

  // 진단용 요약(화면 상태만)
  get debugRestore() {
    return { phase: this.restorePhase, attempts: this.attempts.count, retry: !!this.retryButton };
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
    if (bootRoute(state) === 'opening') {
      startOpening(this, state);
      return;
    }
    // 10-02 v5 §3: 새로고침·재접속 복원 — 서버의 접속 인증 응답만 근거로 삼는다. 전투 → 탐험 중이던 Map → 마을.
    this.restoreStatus = status.setAlign('center').setFontSize(fontPx(displayScaleOf(this.scale.displaySize.width), 24, MIN_BODY_PX + 2));
    this.restore();
  }

  // 10-02 v6 §4.2: 복원 시도 한 번. 오래 걸리면 연결 상태를 설명하고 다시 시도할 수 있게 한다.
  // 다시 시도하면 앞선 시도의 응답은 버린다(attempts) — 늦게 온 응답이 새 결과를 덮지 않는다.
  // 접속 인증은 있던 탐험 세션을 이어받기만 하므로 여러 번 시도해도 방이 새로 생기지 않는다.
  // 서버가 "이어 갈 세션이 없다"고 답하면 마을로 간다. 서버에 닿지 못했으면 추측하지 않고 이 화면에서 다시 시도를 기다린다
  private restore() {
    const id = this.attempts.begin();
    this.showRestore('loading');
    const slow = this.time.delayedCall(RESTORE_SLOW_MS, () => {
      if (this.attempts.isCurrent(id) && this.restorePhase === 'loading') this.showRestore('slow');
    });
    void roomClient
      .connect({ fresh: id > 1 })
      .then(() => true, () => false)
      .then((connected) => {
        if (!this.attempts.isCurrent(id) || !this.sys.isActive()) return; // 낡은 시도의 응답이거나 화면이 이미 바뀜
        slow.remove(false);
        if (!connected) return this.showRestore('failed');
        this.restorePhase = null;
        const route = restoreRoute({ battle: roomClient.activeBattle, room: roomClient.room, inMap: roomClient.resumeInMap });
        if (route.to === 'battle' && roomClient.activeBattle) resumeBattle(this, roomClient.activeBattle);
        else if (route.to === 'map') this.scene.start('Map', { stageCode: route.stageCode });
        else this.scene.start('Village');
      });
  }

  private showRestore(phase: RestorePhase) {
    this.restorePhase = phase;
    this.restoreStatus?.setText(RESTORE_TEXT[phase]).setColor(phase === 'failed' ? TEXT.error : TEXT.body);
    this.retryButton?.destroy();
    this.retryButton = undefined;
    if (canRetry(phase)) this.retryButton = pillButton(this, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 110, 260, 88, RESTORE_RETRY_LABEL, 'primary', () => this.restore());
  }
}
