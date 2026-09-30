import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BattleDefinition } from '../battle/battle-types';

// 스토리 런타임 데이터(대화 JSON, 지역 트리거 좌표, 이름 금칙어)는 프런트 번들에 넣지 않고 BE에만 둔다(개발 계획 3.4).
// ts-node(src/turby/story)와 빌드(dist/turby/story) 모두 BE/story-data/save-a-turby를 가리킨다.
export const STORY_DATA_DIR = resolve(__dirname, '../../../story-data/save-a-turby');

export interface StageRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StagePoint {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface StageStoryData {
  stageCode: string;
  regions: StageRegion[];
  points: StagePoint[];
}

@Injectable()
export class StoryContentService {
  private cache = new Map<string, unknown>();
  dir = STORY_DATA_DIR; // 테스트가 다른 폴더를 가리킬 수 있게 공개

  // 없으면 null — 파일이 준비되지 않은 장·지역은 호출 쪽이 오류로 바꾼다
  dialogue(chapterCode: string): unknown | null {
    if (!/^(opening|ch0[1-5]|finale)$/.test(chapterCode)) return null;
    return this.load(join('dialogue', `${chapterCode}.json`));
  }

  stage(stageCode: string): StageStoryData | null {
    if (!/^[a-z_]{1,30}$/.test(stageCode)) return null;
    return this.load(join('stages', `${stageCode}.json`)) as StageStoryData | null;
  }

  // 스토리 전투 정의(M4-B). battles/<key>.json
  battle(key: string): BattleDefinition | null {
    if (!/^[a-z0-9_]{1,64}$/.test(key)) return null;
    return this.load(join('battles', `${key}.json`)) as BattleDefinition | null;
  }

  bannedNameWords(): string[] {
    const list = this.load('name-banned-words.json');
    return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string') : [];
  }

  private load(rel: string): unknown | null {
    if (this.cache.has(rel)) return this.cache.get(rel) ?? null;
    const file = join(this.dir, rel);
    const value = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null;
    this.cache.set(rel, value);
    return value;
  }
}
