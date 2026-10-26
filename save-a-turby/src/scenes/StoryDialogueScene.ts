import { CHARACTER_IMAGES } from '../assets/registry';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../config/constants';
import { battleClient } from '../net/battleClient';
import { RoomApiError } from '../net/roomClient';
import type { BattleSnapshot } from '../net/battleTypes';
import { runDialogue, STORY_BATTLE_RETRY_MESSAGE, type DialogueFile, type RunnerPorts, type StoryBattleResult } from '../story/dialogueRunner';
import { battleEntryOf, battleResultOf, battleStartErrorResult, chapterOfSegment, type StoryPlay } from '../story/storyFlow';
import { OpeningScene, type OpeningSceneData } from './OpeningScene';
import { recoverUnackedResult } from '../state/unackedResult';
import { deferredRestore } from '../state/restoreAttempt';
import { resumeBattle } from './VillageScene';


// M4-C 장 대화 화면 — 오프닝과 같은 대사 표시를 쓰고, 재생 범위는 서버가 정한 구간(play)만, storyBattle은 서버 스토리 전투로 연결한다.
// 전투 동안 이 화면은 잠들어(sleep) 대화 위치를 그대로 들고 있다가, 전투 결과 화면이 깨우면(wake) 같은 항목에서 이어 간다.
export interface StoryDialogueData extends OpeningSceneData {
  stageCode: string;
  play?: StoryPlay; // 서버가 알려 준 재생 범위(맵 입장·트리거 응답)
  // 새로고침으로 스토리 전투부터 복원된 경우: 그 전투 항목부터 그 구간 끝까지만 잇는다(다음 구간은 맵 재입장 때 서버가 알려 줌)
  resumeBattle?: { encounterKey: string; chapterCode: string };
  storyBattleEnd?: { encounterKey: string; outcome: string };
}

// 장 코드 → 대화 배경(OpeningScene의 DIALOGUE_BACKDROPS 키). 없으면 숲 타일
const BACKDROP_OF_CHAPTER: Record<string, string> = { ch03: 'underfloor', ch04: 'fridge', ch05: 'desert', final: 'home_core' };
// 10-26 F-3b: 정체 공개 뒤 누비의 표시 명칭(정본 — 장면 안에서 처음 바뀐다). 다섯 실이 풀리기 시작하면(final.unravel) 다시 누비
export const ORIGIN_NAME = '태초의 실타래 누비';
const ENDING_BLACK_MS = 900; // 암전만 보이는 시간
const ENDING_FADE_MS = 1400; // 제목이 떠오르는 시간
const ORIGIN_SEGMENTS = new Set(['final.last_thread', 'final.knot', 'final.cost']);
// 10-26 F-3b: 현실 세계 장면 뒤 즉시 암전 → 제목 카드(정본 docs/scene/종장.md 302~303행 인용 블록)
export const ENDING_TITLE = '터비 구하기';
export const ENDING_LINE = '풀린 실은 사라지는 것이 아니라, 누군가의 기억 속에 다시 묶인다.';

export class StoryDialogueScene extends OpeningScene {
  private data2!: StoryDialogueData;
  private segmentNow: string | null = null;

  constructor() {
    super('StoryDialogue');
  }

  init(data: StoryDialogueData) {
    super.init(data);
    this.data2 = data;
  }

  preload() {
    super.preload();
    for (const code of ['bopuli']) if (!this.textures.exists(`turby-${code}`)) this.load.image(`turby-${code}`, CHARACTER_IMAGES[code]);
  }

  protected async runStory() {
    const d = this.data2;
    const chapterCode = d.play ? chapterOfSegment(d.play.segmentId) : d.resumeBattle!.chapterCode;
    const file = (await this.retrying(() => this.opts.client.fetchDialogue(chapterCode), '이야기를 불러오지 못했어요.')) as DialogueFile;
    this.state = await this.retrying(() => this.opts.client.fetchState(), '이야기 진행 정보를 불러오지 못했어요.');

    if (d.play) {
      await runDialogue(file, d.play.segmentId, this.ports(), { endAfter: d.play.endAfter, fromEntry: d.play.fromEntry, untilEntry: d.play.untilEntry, exact: true }); // 서버가 정한 범위 그대로
      if (this.state.checkpoint === 'ENDING_COMPLETE' && this.segmentNow === 'final.real_world') await this.playEndingCard();
      return;
    }
    const at = battleEntryOf(file, d.resumeBattle!.encounterKey);
    if (!at) return;
    // 진 전투에서 복원됐으면 재도전 안내부터(이긴 전투면 서버가 DONE을 돌려주고 다음 대사로 넘어간다)
    if (d.storyBattleEnd && d.storyBattleEnd.outcome !== 'win') await this.waitRetry(STORY_BATTLE_RETRY_MESSAGE);
    await runDialogue(file, at.segmentId, this.ports(), { fromEntry: at.dialogueId, endAfter: at.segmentId });
  }

  protected ports(): RunnerPorts {
    const base = super.ports();
    return {
      ...base,
      // 10-26 F-3b: 정체 공개 뒤 장면의 누비 이름표
      show: (line) => base.show(this.segmentNow && ORIGIN_SEGMENTS.has(this.segmentNow) && line.entry.kind === 'line' && line.entry.speaker === 'nubi' ? { ...line, label: ORIGIN_NAME } : line),
      onSegment: (id) => {
        this.segmentNow = id;
        this.setBackdrop(BACKDROP_OF_CHAPTER[chapterOfSegment(id)] ?? 'forest'); // 장 전용 대화 배경(3장 C3-6 R1-04, 4장 C4-3, 5장 C5-1)
      },
      startBattle: (key) => this.startBattle(key),
    };
  }

  // 10-26 F-3b: 즉시 암전(주인공의 반응·털실의 추가 움직임은 보여 주지 않는다) → 제목 카드. 누르면 이어 간다
  private async playEndingCard() {
    this.clearLayer();
    this.fxState.endingShown = true;
    const cover = this.add.rectangle(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 0x000000, 1).setOrigin(0, 0).setDepth(5000);
    const title = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40, ENDING_TITLE, { fontSize: '56px', color: '#f7e9d2' }).setOrigin(0.5).setDepth(5001).setAlpha(0);
    const line = this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 40, ENDING_LINE, { fontSize: '24px', color: '#d8cbe8', align: 'center', wordWrap: { width: CANVAS_WIDTH - 160 } }).setOrigin(0.5).setDepth(5001).setAlpha(0);
    await new Promise<void>((resolve) => this.time.delayedCall(ENDING_BLACK_MS, resolve));
    this.tweens.add({ targets: title, alpha: 1, duration: ENDING_FADE_MS });
    this.tweens.add({ targets: line, alpha: 1, duration: ENDING_FADE_MS, delay: ENDING_FADE_MS / 2 });
    await new Promise<void>((resolve) => this.time.delayedCall(ENDING_FADE_MS * 1.5, resolve));
    await new Promise<void>((resolve) => {
      const done = () => {
        this.input.off('pointerdown', done);
        this.input.keyboard?.off('keydown', done);
        resolve();
      };
      this.fxState.endingReady = true; // 제목이 다 떠오른 뒤부터 누를 수 있다
      this.input.once('pointerdown', done);
      this.input.keyboard?.once('keydown', done);
    });
    [cover, title, line].forEach((o) => o.destroy());
  }

  private async startBattle(encounterKey: string): Promise<StoryBattleResult> {
    let snapshot: BattleSnapshot;
    try {
      snapshot = await battleClient.startStory(encounterKey);
    } catch (err) {
      if (await recoverUnackedResult(err, { fetchSnapshot: (id) => battleClient.snapshot(id).then((r) => r.snapshot), showResult: (snap) => resumeBattle(this, snap), fallbackToVillage: () => { deferredRestore.mark(); this.scene.start('Village'); }, isStale: () => !this.sys.isActive() })) throw err;
      const r = battleStartErrorResult(err instanceof RoomApiError ? err.code : undefined);
      if (r) return r;
      throw err; // 통신·상태 오류 → 진행기가 다시 시도 안내
    }
    this.clearLayer();
    return new Promise<StoryBattleResult>((resolve) => {
      this.events.once('wake', (_sys: unknown, data?: { storyBattleEnd?: { outcome: string } }) => resolve(battleResultOf(data?.storyBattleEnd?.outcome)));
      // 전투 화면(파티 선택 단계면 파티 선택으로 넘어감) → 결과 → 이 화면을 깨운다
      this.scene.launch('Battle', { stageCode: this.data2.stageCode, capturedIndices: [], removedIndices: [], snapshot, returnTo: { scene: this.scene.key, mode: 'wake' } });
      this.scene.sleep();
    });
  }
}
