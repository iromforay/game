import Phaser from 'phaser';
import { WORLD_IMAGES, SPRITESHEET_KEYS } from './registry';

// world·sprites·ui 폴더에 들어온 실제 이미지를 로드 — 없는 키는 placeholders.ts의 임시 도형이 대신한다
export function loadWorldImages(scene: Phaser.Scene) {
  for (const [key, url] of Object.entries(WORLD_IMAGES)) {
    if (scene.textures.exists(key)) continue;
    if (SPRITESHEET_KEYS.includes(key)) scene.load.spritesheet(key, url, { frameWidth: 96, frameHeight: 96 });
    else scene.load.image(key, url);
  }
}
