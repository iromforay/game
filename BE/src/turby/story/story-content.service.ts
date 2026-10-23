import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { BattleDefinition } from '../battle/battle-types';
import { parseStageGeometry } from 'turby-stage-geometry';
import { parseStageWater, type StageWater } from '../rooms/stage-water';

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
  storyPoints?: { id: string; kind: string; assetKey: string; label: string; prompt: string; art?: StagePointArt }[]; // art: 그림 표시 크기·피벗(서버 데이터가 단일 출처 — 원본 PNG 크기를 쓰지 않는다)
  // 10-13 C2-1: 이야기 진행에 따른 목표 문구(상단 목표 패널). 위에서부터 첫 번째로 맞는 것 — requires(모두 완료)·unless(모두 완료면 닫힘). 수집 목표(전달 delivery)가 없을 때만 쓴다
  goals?: { id: string; text: string; requires?: string[]; unless?: string[]; count?: { of: string[]; is: number } }[]; // count: of 중 완료된 사건이 정확히 is개일 때만(구조 0/3~2/3 같은 진행도 문구)
  blackThreadTraps?: unknown[]; // 검은 실 덫(rooms/stage-water.ts가 해석·검증)
  // visibleAfter: 그 이벤트 전에는 지도·화면에 내려 주지 않는다(숨은 구역의 내부 정보). 통과 불가 판정은 표시 여부와 무관하게 서버가 한다
  // 10-13 C2-2: 물 규칙(rooms/stage-water.ts가 해석·검증한다). 구역은 축에 나란한 사각형
  waterAreas?: unknown[];
  currentFields?: unknown[];
  safeAnchors?: unknown[];
  // 10-23 C4-1: 서리 구역(속도 배율)·바늘 칸(서버 시각 주기, 내려찍으면 안전 앵커로 복귀). 같은 모듈이 해석·검증한다
  frostZones?: unknown[];
  needleFields?: unknown[];
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
  openPieces?: StageGatePiece[]; // 열린 문을 열림 그림의 일부(frame) 여러 조각으로 그린다(10-15 C2-7C — 세로 문의 위·아래 끝에 기둥을 두어 가운데 틈을 보인다). 없으면 art를 쓴다
}
// 문 그림 조각: 열림 텍스처 안의 사각형(frame = [x, y, 너비, 높이], 원본 px)을 x·y(피벗 위치)에 width×height로 그린다. 판정에는 쓰이지 않는다
export interface StageGatePiece {
  x: number;
  y: number;
  width: number;
  height: number;
  pivot?: [number, number];
  frame: [number, number, number, number];
}
export interface StagePointArt {
  width: number;
  height: number;
  pivot?: [number, number]; // 이미지 안의 기준점(0~1), 지점 좌표에 놓인다. 생략 시 (0.5, 0.7)
  glow?: boolean; // 임무 대상 외곽광(크림색) — 배경 소품과 구별해야 하는 대상만(10-16 C3-6)
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
  rotation?: number; // 도(°), 시계 방향(화면 좌표). 안내 파문처럼 방향이 있는 그림(10-13 v1c)
  alpha?: number; // 0 초과 1 이하(기본 1)
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
      if (o.rotation !== undefined && !(num(o.rotation) && Math.abs(o.rotation) <= 360)) bad.push(`${at}.rotation: -360~360 숫자(도)`);
      if (o.alpha !== undefined && !(num(o.alpha) && o.alpha > 0 && o.alpha <= 1)) bad.push(`${at}.alpha: 0 초과 1 이하`);
      for (const f of ['visibleAfter', 'hiddenAfter'] as const) if (o[f] !== undefined && typeof o[f] !== 'string') bad.push(`${at}.${f}: 이벤트 이름이 아니다`);
    });
  }
  for (const p of data.storyPoints ?? []) {
    key(p.assetKey, `storyPoints(${p.id}).assetKey`);
    if (p.art !== undefined) {
      const w = p.art.width, h = p.art.height;
      if (!num(w) || !num(h) || w <= 0 || h <= 0) bad.push(`storyPoints(${p.id}).art: width·height는 0보다 큰 숫자`);
      pivot(p.art.pivot, `storyPoints(${p.id}).art.pivot`);
      if (p.art.glow !== undefined && typeof p.art.glow !== 'boolean') bad.push(`storyPoints(${p.id}).art.glow: true/false`);
    }
  }
  for (const g of data.layout?.gates ?? []) {
    const at = `layout.gates(${g.id})`;
    if (g.closedAssetKey !== undefined) key(g.closedAssetKey, `${at}.closedAssetKey`, true);
    if (g.openAssetKey !== undefined) key(g.openAssetKey, `${at}.openAssetKey`, true);
    if (g.closedAssetKey || g.openAssetKey) size(g.art as unknown as Record<string, unknown> | undefined, `${at}.art`);
    pivot(g.art?.pivot, `${at}.art.pivot`);
    if (g.openPieces !== undefined) {
      if (!Array.isArray(g.openPieces) || g.openPieces.length === 0 || !g.openAssetKey) bad.push(`${at}.openPieces: 열림 그림(openAssetKey)이 있을 때 조각 1개 이상`);
      else
        g.openPieces.forEach((q, i) => {
          size(q as unknown as Record<string, unknown>, `${at}.openPieces[${i}]`);
          pivot(q.pivot, `${at}.openPieces[${i}].pivot`);
          if (!(Array.isArray(q.frame) && q.frame.length === 4 && q.frame.every((n) => num(n) && n >= 0) && q.frame[2] > 0 && q.frame[3] > 0)) bad.push(`${at}.openPieces[${i}].frame: [x, y, 너비, 높이] 원본 px`);
        });
    }
  }
  if (bad.length > 0) throw new Error(`지역 데이터(${stageCode}) render 검증 실패: ${bad.join(' / ')}`);
}

@Injectable()
export class StoryContentService implements OnModuleInit {
  private cache = new Map<string, unknown>();
  private waterCache = new Map<string, StageWater | null>(); // 검증을 마친 물 규칙(지역 데이터가 처음 읽힐 때 한 번)
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
        const geo = parseStageGeometry(data, { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }, stageCode);
        validateRender(data, stageCode);
        this.waterCache.set(stageCode, parseStageWater(data, geo, stageCode));
      } catch (err) {
        this.cache.delete(rel);
        this.waterCache.delete(stageCode); // 다음 호출도 같은 오류를 낸다(잘못된 데이터를 조용히 쓰지 않는다)
        throw err;
      }
    }
    return data;
  }

  // 10-13 C2-2: 지역의 물 규칙(없으면 null). 읽을 때 검증된 값
  water(stageCode: string): StageWater | null {
    this.stage(stageCode);
    return this.waterCache.get(stageCode) ?? null;
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
