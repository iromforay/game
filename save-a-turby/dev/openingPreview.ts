// 개발용 오프닝 미리보기 — 서버·DB 없이 메모리 가짜 StoryClient로 실제 런타임 opening.json을 재생한다.
// 게임 빌드(index.html)에는 포함되지 않는다. 캡처·UI 확인용(M1 SQL 적용 전이라 실제 서버로 띄울 수 없음).
// 주소 예: /dev/opening-preview.html?from=OPENING_FALL_COMPLETE&failOnce=opening_fall_completed&existingName=하늘
import Phaser from 'phaser';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/config/constants';
import { OpeningScene, type OpeningSceneData } from '../src/scenes/OpeningScene';
import { precheckName } from '../src/story/nameRules';
import type { DialogueFile } from '../src/story/dialogueRunner';
import type { OpeningStoryState, StoryClient } from '../src/story/storyClient';
import opening from '../../BE/story-data/save-a-turby/dialogue/opening.json';

const params = new URLSearchParams(location.search);
const RESUME: Record<string, string | null> = {
  OPENING_NOT_STARTED: 'opening.fall',
  OPENING_FALL_COMPLETE: 'opening.meeting',
  OPENING_NAME_SAVED: 'opening.promise',
  OPENING_COMPLETE: null,
};
const NEXT: Record<string, string> = {
  opening_fall_completed: 'OPENING_FALL_COMPLETE',
  opening_name_saved: 'OPENING_NAME_SAVED',
  story_nubi_granted: 'OPENING_COMPLETE',
};

let checkpoint = params.get('from') ?? 'OPENING_NOT_STARTED';
const existingName = params.get('existingName');
let playerName = existingName ?? '터비 탐험가';
let failOnce = params.get('failOnce');
const delay = () => new Promise((r) => setTimeout(r, 250));
const state = (): OpeningStoryState => ({ checkpoint, needsName: checkpoint !== 'OPENING_NAME_SAVED' && checkpoint !== 'OPENING_COMPLETE' && !existingName, playerName, resume: { segmentId: RESUME[checkpoint] ?? null }, openingRequired: checkpoint !== 'OPENING_COMPLETE' && !existingName, openingAvailable: checkpoint !== 'OPENING_COMPLETE', openingStarted: checkpoint !== 'OPENING_NOT_STARTED' });

const fake: StoryClient = {
  fetchState: async () => state(),
  fetchDialogue: async () => opening as DialogueFile,
  completeEvent: async (eventId) => {
    await delay();
    if (failOnce === eventId) {
      failOnce = null;
      throw new Error('미리보기: 한 번 실패');
    }
    if (NEXT[eventId]) checkpoint = NEXT[eventId];
    return state();
  },
  saveName: async (name) => {
    await delay();
    const checked = precheckName(name);
    if (!checked.ok) throw Object.assign(new Error('사용할 수 없는 이름입니다.'), { code: 'NAME_INVALID', reason: checked.reason });
    if (checked.name.includes('금칙')) throw Object.assign(new Error('사용할 수 없는 단어가 들어 있어요.'), { code: 'NAME_INVALID', reason: 'banned_word' });
    playerName = checked.name;
    checkpoint = 'OPENING_NAME_SAVED';
    return state();
  },
};

const data: OpeningSceneData = {
  client: fake,
  seenKey: 'turby_seen_segments:preview',
  onDone: (scene) => {
    scene.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, `오프닝 완료(${checkpoint}) — 실제 게임은 마을로 이동`, { fontSize: '28px', color: '#695B67', backgroundColor: '#fff4df', padding: { x: 20, y: 12 } }).setOrigin(0.5).setDepth(100);
  },
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColor: '#1a1030',
  dom: { createContainer: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [],
});
game.scene.add('Opening', OpeningScene, true, data);
(window as unknown as { __game?: Phaser.Game }).__game = game;
