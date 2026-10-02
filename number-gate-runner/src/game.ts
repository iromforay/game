import Phaser from 'phaser';
import { RunnerScene } from './scenes/RunnerScene';
import { RUNNER_STAGES } from './stages';
import type { RunnerStage } from './stages';

export interface RunnerResult {
  stageId: number;
  won: boolean;
  finalCount: number;
  maxCount: number;
}

export interface RunnerGameOptions {
  stage?: RunnerStage;
  onComplete?: (result: RunnerResult) => void;
  onLeave?: () => void;
}

export function mountGame(parent: HTMLElement | string, options: RunnerGameOptions = {}): Phaser.Game {
  const stage = options.stage ?? RUNNER_STAGES[0];
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 720,
    height: 1280,
    backgroundColor: '#102236',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new RunnerScene(stage, options.onComplete, options.onLeave)],
  });
}

export * from './model';
export * from './stages';
