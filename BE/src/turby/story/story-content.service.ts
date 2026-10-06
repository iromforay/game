import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BattleDefinition } from '../battle/battle-types';
import { parseStageGeometry } from 'turby-stage-geometry';

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
export class StoryContentService implements OnModuleInit {
  private cache = new Map<string, unknown>();
  dir = STORY_DATA_DIR; // 테스트가 다른 폴더를 가리킬 수 있게 공개

  // 없으면 null — 파일이 준비되지 않은 장·지역은 호출 쪽이 오류로 바꾼다
  dialogue(chapterCode: string): unknown | null {
    if (!/^(opening|ch0[1-5]|finale)$/.test(chapterCode)) return null;
    return this.load(join('dialogue', `${chapterCode}.json`));
  }

  // 10-02 v6 §2: 잘못된 지역 JSON으로는 서버가 뜨지 않는다(geometry 계약 위반은 StageGeometryError)
  onModuleInit() {
    this.validateStages();
  }

  validateStages(): string[] {
    const dir = join(this.dir, 'stages');
    const codes = existsSync(dir) ? readdirSync(dir).filter((f) => /^[a-z_]{1,30}\.json$/.test(f)).map((f) => f.slice(0, -5)) : [];
    for (const code of codes) this.stage(code);
    return codes;
  }

  // 처음 읽을 때 geometry 계약(shared/turby-stage-geometry 패키지)으로 검증한다 — 맞지 않으면 StageGeometryError(그 지역은 쓰이지 않는다).
  // 지도 크기가 JSON에 없는 지역의 경계 검사는 방을 만들 때(collisionOf, 지역 표의 크기) 한다
  stage(stageCode: string): StageStoryData | null {
    if (!/^[a-z_]{1,30}$/.test(stageCode)) return null;
    const rel = join('stages', `${stageCode}.json`);
    const fresh = !this.cache.has(rel);
    const data = this.load(rel) as StageStoryData | null;
    if (fresh && data) {
      try {
        parseStageGeometry(data, { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }, stageCode);
      } catch (err) {
        this.cache.delete(rel); // 다음 호출도 같은 오류를 낸다(잘못된 데이터를 조용히 쓰지 않는다)
        throw err;
      }
    }
    return data;
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
