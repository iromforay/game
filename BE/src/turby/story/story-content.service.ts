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

export interface StageRect {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface StagePath {
  points: number[][];
  visibleAfter?: string;
}
export interface StageZone extends StageRect {
  visibleAfter?: string; // 이 이벤트가 끝난 뒤에만 지도에 보인다(숨은 길)
}

// 지역 스토리 데이터(story-data/stages/<stage>.json). 판정 규칙(언제·무엇을)은 story-data.ts, 여기는 위치와 겉모습만 둔다.
// regions·points: 서버 위치 증거용 좌표. objects·storyPoints: ID별 표시 정보(에셋 키·문구). layout: 회색상자 배치(구역·길·막힌 곳·문)
export interface StageStoryData {
  stageCode: string;
  greybox?: boolean;
  size?: { width: number; height: number };
  spawnPoint?: { x: number; y: number }; // 서버 권위 시작 지점(입장 요청의 좌표는 쓰지 않는다)
  regions: StageRegion[];
  points: StagePoint[];
  objects?: { id: string; objectiveKey: string; group: string; assetKey: string; label: string; prompt: string }[];
  storyPoints?: { id: string; kind: string; assetKey: string; label: string; prompt: string }[];
  // visibleAfter: 그 이벤트 전에는 지도·화면에 내려 주지 않는다(숨은 구역의 내부 정보). 통과 불가 판정은 표시 여부와 무관하게 서버가 한다
  layout?: { zones: StageZone[]; paths: StagePath[]; blockers: (StageRect & { visibleAfter?: string })[]; gates: (StageRect & { openEvent: string; visibleAfter?: string })[] };
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
