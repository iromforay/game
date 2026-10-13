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
  // 10-13 C2-1: 이야기 진행에 따른 목표 문구(상단 목표 패널). 위에서부터 첫 번째로 맞는 것 — requires(모두 완료)·unless(모두 완료면 닫힘). 수집 목표(전달 delivery)가 없을 때만 쓴다
  goals?: { id: string; text: string; requires?: string[]; unless?: string[] }[];
  // visibleAfter: 그 이벤트 전에는 지도·화면에 내려 주지 않는다(숨은 구역의 내부 정보). 통과 불가 판정은 표시 여부와 무관하게 서버가 한다
  layout?: { zones: StageZone[]; paths: StagePath[]; blockers: (StageRect & { visibleAfter?: string })[]; gates: StageGateData[] };
  // 10-06 v2(최종 에셋 연결 계약): 대형 배경과 진행 상태별 오버레이의 런타임 에셋 키. 에셋이 없으면 화면이 회색상자·임시 도형을 그대로 쓴다
  render?: { markerMode?: 'fallback' | 'final'; background?: { assetKey: string }; backgroundLocked?: string; unlockedBy?: string; overlays?: StageOverlayData[] }; // backgroundLocked+unlockedBy: 이벤트 전에 쓰는 잠금 배경(둘 다 있어야 한다)
}

// 문: 충돌 사각형(x·y·width·height)과 그림(art, 중심 좌표)은 따로다 — 그림이 충돌 영역보다 커도 판정은 사각형으로만 한다.
// closedAssetKey/openAssetKey: 닫힘·열림 텍스처 키(열림 그림이 없으면 null). 열림 여부(open)는 서버가 openEvent로 한 번만 정하고 그림과 충돌이 같은 값을 쓴다
export interface StageGateData extends StageRect {
  openEvent: string;
  visibleAfter?: string;
  closedAssetKey?: string | null;
  openAssetKey?: string | null;
  art?: { x: number; y: number; width: number; height: number; pivot?: [number, number] }; // x·y = 피벗이 놓이는 월드 좌표(피벗 생략 시 중심)
}
export interface StageOverlayData {
  id: string;
  assetKey: string;
  x: number; // 피벗이 놓이는 월드 좌표(피벗 생략 시 중심)
  y: number;
  width: number;
  height: number;
  pivot?: [number, number]; // 이미지 안의 기준점(0~1). 예: 하단 중앙 (0.5, 0.9)
  layer?: 'overlay' | 'story'; // overlay = 바닥(길·그림자), story = 이야기 대상·NPC와 같은 층(기본 overlay)
  forPoints?: string[]; // 이 그림이 대신 보여 주는 이야기 지점 ID — 최종 표식 모드에서 그 지점의 임시 고리를 없앨 근거
  visibleAfter?: string; // 이 이벤트 뒤에만
  hiddenAfter?: string; // 이 이벤트 뒤에는 사라진다
}

// 지역 데이터의 render·문 그림 블록 검증 — 잘못되면 서버가 뜨지 않는다(geometry 계약과 같은 원칙)
export function validateRender(data: StageStoryData, stageCode: string): void {
  const bad: string[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const size = (r: Record<string, unknown> | undefined, at: string) => {
    if (!r || !num(r.x) || !num(r.y) || !num(r.width) || !num(r.height) || (r.width as number) <= 0 || (r.height as number) <= 0) bad.push(`${at}: x·y·width·height는 숫자(너비·높이는 0보다 큼)`);
  };
  const pivot = (v: unknown, at: string) => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 2 && v.every((n) => num(n) && n >= 0 && n <= 1))) bad.push(`${at}: [0~1, 0~1]`);
  };
  const key = (v: unknown, at: string, nullable = false) => {
    if (!(typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) && !(nullable && v === null)) bad.push(`${at}: 에셋 키 형식이 아니다`);
  };
  const render = data.render;
  if (render !== undefined) {
    if (render.markerMode !== undefined && render.markerMode !== 'fallback' && render.markerMode !== 'final') bad.push("render.markerMode: 'fallback' 또는 'final'");
    if (render.background !== undefined) key(render.background.assetKey, 'render.background.assetKey');
    if (render.backgroundLocked !== undefined) key(render.backgroundLocked, 'render.backgroundLocked');
    if (render.unlockedBy !== undefined && typeof render.unlockedBy !== 'string') bad.push('render.unlockedBy: 이벤트 이름이 아니다');
    const ids = new Set<string>();
    (render.overlays ?? []).forEach((o, i) => {
      const at = `render.overlays[${i}]`;
      if (typeof o.id !== 'string' || ids.has(o.id)) bad.push(`${at}: id가 없거나 겹친다`);
      else ids.add(o.id);
      key(o.assetKey, `${at}.assetKey`);
      size(o as unknown as Record<string, unknown>, at);
      pivot(o.pivot, `${at}.pivot`);
      if (o.layer !== undefined && o.layer !== 'overlay' && o.layer !== 'story') bad.push(`${at}.layer: overlay 또는 story`);
      if (o.forPoints !== undefined && !(Array.isArray(o.forPoints) && o.forPoints.every((x) => typeof x === 'string'))) bad.push(`${at}.forPoints: 지점 ID 배열`);
      for (const f of ['visibleAfter', 'hiddenAfter'] as const) if (o[f] !== undefined && typeof o[f] !== 'string') bad.push(`${at}.${f}: 이벤트 이름이 아니다`);
    });
  }
  for (const g of data.layout?.gates ?? []) {
    const at = `layout.gates(${g.id})`;
    if (g.closedAssetKey !== undefined) key(g.closedAssetKey, `${at}.closedAssetKey`, true);
    if (g.openAssetKey !== undefined) key(g.openAssetKey, `${at}.openAssetKey`, true);
    if (g.closedAssetKey || g.openAssetKey) size(g.art as unknown as Record<string, unknown> | undefined, `${at}.art`);
    pivot(g.art?.pivot, `${at}.art.pivot`);
  }
  if (bad.length > 0) throw new Error(`지역 데이터(${stageCode}) render 검증 실패: ${bad.join(' / ')}`);
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
        validateRender(data, stageCode);
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
