import type Phaser from 'phaser';
import { apiStoryClient } from './apiStoryClient';
import { getPlayerId } from '../state/player';
import type { StoryPlay } from './storyFlow';
import type { StoryDialogueData } from '../scenes/StoryDialogueScene';

// 서버가 알려 준 대화 범위(play)를 지금 화면 위에 재생하고, 끝나면 이 화면을 깨운다(맵 트리거·보풀이 전달·유물 장착 공용).
export function playStory(scene: Phaser.Scene, play: StoryPlay, stageCode: string) {
  const key = scene.scene.key;
  const data: StoryDialogueData = {
    client: apiStoryClient,
    seenKey: `turby_seen_segments:${getPlayerId()}`,
    stageCode,
    play,
    onDone: (s) => {
      s.scene.wake(key);
      s.scene.stop();
    },
  };
  scene.scene.launch('StoryDialogue', data);
  scene.scene.sleep();
}
