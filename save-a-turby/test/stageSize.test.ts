// 10-16: 모든 장의 지도 크기는 1장 구현 해상도 3200×2400으로 통일한다(사용자 결정).
// 프런트 설정(config/stages)·지역 목록(backgrounds.json)·서버 지역 데이터(story-data/stages/*.json의 size)가 같은 값이어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STAGE_FOREST } from '../src/config/stages/forest.ts';
import { STAGE_LAKE } from '../src/config/stages/lake.ts';
import { STAGE_UNDERGROUND } from '../src/config/stages/underground.ts';
import { STAGE_ICE } from '../src/config/stages/ice.ts';
import { STAGE_DESERT } from '../src/config/stages/desert.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SIZE = { width: 3200, height: 2400 };
const CODES = ['forest', 'lake', 'underground', 'ice', 'desert'];
const STAGES = [STAGE_FOREST, STAGE_LAKE, STAGE_UNDERGROUND, STAGE_ICE, STAGE_DESERT]; // config/stages/index.ts의 STAGES와 같은 순서

test('지도 크기 통일: 다섯 장 모두 3200×2400(프런트 설정·지역 목록·서버 지역 데이터)', () => {
  assert.deepEqual(STAGES.map((s) => s.code), CODES);
  for (const s of STAGES) assert.deepEqual({ width: s.width, height: s.height }, SIZE, `config/stages/${s.code}`);
  const bgs = JSON.parse(readFileSync(here('../src/data/backgrounds.json'), 'utf8')) as { code: string; mapWidth: number; mapHeight: number }[];
  for (const b of bgs) assert.deepEqual({ width: b.mapWidth, height: b.mapHeight }, SIZE, `backgrounds.json ${b.code}`);
  // 서버 지역 데이터가 있는 장은 size도 같다(없는 장은 서버가 지역 표 값을 쓴다 — 운영 SQL 2026-10-16_turby_story_map_size.sql)
  for (const code of CODES) {
    const file = here(`../../BE/story-data/save-a-turby/stages/${code}.json`);
    if (!existsSync(file)) continue;
    const size = (JSON.parse(readFileSync(file, 'utf8')) as { size?: { width: number; height: number } }).size;
    assert.deepEqual(size, SIZE, `story-data/stages/${code}.json size`);
  }
});
