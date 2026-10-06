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
import { canLeaveToVillage, canRetry, deferredRestore, OnceGuard, RESTORE_RETRY_LABEL, RESTORE_SLOW_MS, RESTORE_TEXT, RESTORE_TO_VILLAGE_TEXT, RESTORE_VILLAGE_LABEL, RestoreAttempts, type RestorePhase } from '../state/restoreAttempt';
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
  private villageButton?: Phaser.GameObjects.Container;
  private slowTimer?: Phaser.Time.TimerEvent;
  private escape = new OnceGuard(); // 마을 복귀는 버튼을 여러 번 눌러도 한 번만

  constructor() {
    super('Boot');
  }

  init() {
    this.attempts = new RestoreAttempts();
    this.restorePhase = null;
    this.restoreStatus = undefined;
    this.retryButton = undefined;
    this.villageButton = undefined;
    this.slowTimer = undefined;
    this.escape = new OnceGuard();
  }

  // 진단용 요약(화면 상태만)
  get debugRestore() {
    return { phase: this.restorePhase, attempts: this.attempts.count, retry: !!this.retryButton, village: !!this.villageButton, leaving: this.escape.used };
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
    this.slowTimer?.remove(false);
    const slow = (this.slowTimer = this.time.delayedCall(RESTORE_SLOW_MS, () => {
      if (this.attempts.isCurrent(id) && this.restorePhase === 'loading') this.showRestore('slow');
    }));
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
    this.villageButton?.destroy();
    this.retryButton = undefined;
    this.villageButton = undefined;
    // 10-06 v1 §6: 지연·실패 화면의 탈출 경로 두 가지 — 다시 시도 / 마을 화면으로 돌아가기
    if (canRetry(phase)) this.retryButton = pillButton(this, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 100, 300, 80, RESTORE_RETRY_LABEL, 'primary', () => this.restore());
    if (canLeaveToVillage(phase)) this.villageButton = pillButton(this, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 196, 420, 80, RESTORE_VILLAGE_LABEL, 'secondary', () => void this.leaveToVillage());
  }

  // 10-06 v1 §6: 마을로 돌아간다. 한 번만 실행하고, 진행 중이던 복원 시도의 응답은 낡은 것으로 만들어 선택한 마을 화면을 덮지 못하게 한다.
  // 서버가 연결돼 있으면 기존 탐험 세션 이탈 계약(room:leave)을 먼저 쓰고, 닿지 않으면 요청 없이 로컬 화면만 전환한다 — 새 탐험 방은 만들지 않는다.
  // 서버를 확인하지 못했거나 활성 전투가 남아 있으면 마을이 서버 연결 회복 뒤에 다시 확인해 복원 안내를 낸다(deferredRestore)
  private async leaveToVillage() {
    if (!this.escape.take()) return;
    this.attempts.begin();
    this.slowTimer?.remove(false);
    this.retryButton?.destroy();
    this.villageButton?.destroy();
    this.retryButton = undefined;
    this.villageButton = undefined;
    this.restorePhase = null;
    this.restoreStatus?.setText(RESTORE_TO_VILLAGE_TEXT).setColor(TEXT.body);
    const how = await roomClient.leaveRoomIfOnline();
    if (!this.sys.isActive()) return;
    if (how === 'offline' || roomClient.activeBattle) deferredRestore.mark();
    this.scene.start('Village');
  }
}
