import { CHARACTER_IMAGES } from '../assets/registry';
import { battleClient } from '../net/battleClient';
import { RoomApiError } from '../net/roomClient';
import type { BattleSnapshot } from '../net/battleTypes';
import { runDialogue, STORY_BATTLE_RETRY_MESSAGE, type DialogueFile, type RunnerPorts, type StoryBattleResult } from '../story/dialogueRunner';
import { battleEntryOf, battleResultOf, battleStartErrorResult, chapterOfSegment, type StoryPlay } from '../story/storyFlow';
import { OpeningScene, type OpeningSceneData } from './OpeningScene';

// M4-C 장 대화 화면 — 오프닝과 같은 대사 표시를 쓰고, 재생 범위는 서버가 정한 구간(play)만, storyBattle은 서버 스토리 전투로 연결한다.
// 전투 동안 이 화면은 잠들어(sleep) 대화 위치를 그대로 들고 있다가, 전투 결과 화면이 깨우면(wake) 같은 항목에서 이어 간다.
export interface StoryDialogueData extends OpeningSceneData {
  stageCode: string;
  play?: StoryPlay; // 서버가 알려 준 재생 범위(맵 입장·트리거 응답)
  // 새로고침으로 스토리 전투부터 복원된 경우: 그 전투 항목부터 그 구간 끝까지만 잇는다(다음 구간은 맵 재입장 때 서버가 알려 줌)
  resumeBattle?: { encounterKey: string; chapterCode: string };
  storyBattleEnd?: { encounterKey: string; outcome: string };
}

export class StoryDialogueScene extends OpeningScene {
  private data2!: StoryDialogueData;

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
      return;
    }
    const at = battleEntryOf(file, d.resumeBattle!.encounterKey);
    if (!at) return;
    // 진 전투에서 복원됐으면 재도전 안내부터(이긴 전투면 서버가 DONE을 돌려주고 다음 대사로 넘어간다)
    if (d.storyBattleEnd && d.storyBattleEnd.outcome !== 'win') await this.waitRetry(STORY_BATTLE_RETRY_MESSAGE);
    await runDialogue(file, at.segmentId, this.ports(), { fromEntry: at.dialogueId, endAfter: at.segmentId });
  }

  protected ports(): RunnerPorts {
    return {
      ...super.ports(),
      onSegment: () => this.setBackdrop('forest'),
      startBattle: (key) => this.startBattle(key),
    };
  }

  private async startBattle(encounterKey: string): Promise<StoryBattleResult> {
    let snapshot: BattleSnapshot;
    try {
      snapshot = await battleClient.startStory(encounterKey);
    } catch (err) {
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
