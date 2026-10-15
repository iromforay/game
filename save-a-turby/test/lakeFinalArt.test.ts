// 10-14 C2-7A: 최종 호수 배경 연결 — 파일·키·크기·해시, 호수만 최종 배경, 깊이, 운영 렌더의 개발 표시 0, 디버그 오버레이는 개발 모드 전용, 기능 좌표 불변
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_DEPTH, planStageRender } from '../src/story/mapRender.ts';
import type { StageView } from '../src/story/storyStage.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const LAKE_JSON = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/lake.json'), 'utf8')) as Record<string, unknown> & { greybox: boolean; render: { background: { assetKey: string } | null }; size: { width: number; height: number } };
const FOREST_JSON = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/forest.json'), 'utf8')) as typeof LAKE_JSON;
const asView = (j: typeof LAKE_JSON, code: string) => ({ stageCode: code, greybox: j.greybox, size: j.size, objects: [], points: [], gates: [], render: { markerMode: 'fallback', background: j.render.background, overlays: [] }, layout: { zones: [], paths: [], blockers: [] }, objectives: [], goal: null }) as unknown as StageView;

test('lake-base: 파일·3200×2400 불투명 PNG·원본 해시·용량, 키는 items가 아닌 world/** glob의 파일명', () => {
  const file = here('../src/assets/world/lake/lake-base.png');
  assert.ok(existsSync(file));
  const bytes = readFileSync(file);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [3200, 2400]);
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), '357342612CE77CE7E0E90FCF9EF96035221B3AFF34F754CC8F8FA4E8C215FE12');
  assert.equal(statSync(file).size, 3_179_368);
  // 불투명: 색 유형이 알파 없음(2 RGB 또는 3 팔레트이고 tRNS 청크 없음)
  assert.ok([2, 3].includes(bytes[25]), `colorType ${bytes[25]}`);
  assert.equal(bytes.includes(Buffer.from('tRNS')), false, '투명도 청크 없음');
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  assert.match(reg, /import\.meta\.glob\('\.\/world\/\*\*\/\*\.png'/);
});

test('렌더 계획: 호수만 최종 배경(lake-base, 3200×2400, 월드 원점), 숲은 기존 배경 유지, 텍스처가 없으면 임시 배치로 폴백', () => {
  const lake = asView(LAKE_JSON, 'lake');
  const plan = planStageRender(lake, (k) => k === 'lake-base', { width: 3200, height: 2400 });
  assert.deepEqual(plan.background, { mode: 'final', assetKey: 'lake-base', width: 3200, height: 2400 });
  assert.deepEqual(plan.bounds, { x: 0, y: 0, width: 3200, height: 2400 });
  assert.equal(planStageRender(lake, () => false, { width: 3200, height: 2400 }).background.mode, 'greybox', '미납품·로드 실패는 임시 배치 폴백');
  const forest = planStageRender(asView(FOREST_JSON, 'forest'), (k) => k === 'forest-base', { width: 3200, height: 2400 });
  assert.equal(forest.background.mode === 'final' ? forest.background.assetKey : null, 'forest-base');
  assert.equal(LAKE_JSON.render.background?.assetKey, 'lake-base');
  assert.equal(LAKE_JSON.greybox, false);
});

test('깊이: 배경(−30)은 회색상자·오버레이·이야기 대상·야생·플레이어·HUD보다 낮다', () => {
  assert.ok(MAP_DEPTH.background < MAP_DEPTH.greybox && MAP_DEPTH.greybox < MAP_DEPTH.overlay && MAP_DEPTH.overlay < MAP_DEPTH.story && MAP_DEPTH.story < MAP_DEPTH.actors && MAP_DEPTH.actors < MAP_DEPTH.hud);
  const scene = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  assert.match(scene, /this\.add\.image\(0, 0, plan\.background\.assetKey\)\.setOrigin\(0, 0\)\.setDisplaySize\(plan\.background\.width, plan\.background\.height\)\.setDepth\(MAP_DEPTH\.background\)/, '원점·표시 크기·깊이, 반복·회전 없음');
});

test('운영 렌더: 최종 모드에서는 회색 격자·벽 글자·깊은 물 글자·물 색면을 그리는 drawGreybox를 부르지 않는다', () => {
  const scene = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  // 임시 도형·글자는 drawGreybox 한 곳에서만 만들고, 호출은 greybox 모드 분기 하나뿐이다
  const calls = scene.match(/this\.drawGreybox\(/g) ?? [];
  assert.equal(calls.length, 1);
  assert.match(scene, /else if \(plan\.background\.mode === 'greybox' && view\?\.layout\) this\.drawGreybox\(view, width, height\)/);
  const fn = scene.slice(scene.indexOf('private drawGreybox('), scene.indexOf('// 서버가 내려 준 화면 상태로 맞춘다'));
  for (const marker of ["'깊은 물'", '회색상자(임시 배치)', 'b.label', 'z.label']) assert.ok(fn.includes(marker), `drawGreybox 안에서만: ${marker}`);
  const outside = scene.replace(fn, '');
  for (const marker of ["'깊은 물'", '회색상자(임시 배치)']) assert.equal(outside.includes(marker), false, `drawGreybox 밖에 없음: ${marker}`);
});

test('충돌 디버그 오버레이: 개발 모드(import.meta.env.DEV)에서만 켜지고 기본은 꺼짐, 운영 빌드 번들에는 들어가지 않는다', () => {
  const scene = readFileSync(here('../src/scenes/MapScene.ts'), 'utf8');
  assert.match(scene, /private collisionDebugOn = false;/);
  const set = scene.slice(scene.indexOf('setCollisionDebug(on: boolean)'), scene.indexOf('private drawCollisionDebug()'));
  assert.match(set, /if \(!import\.meta\.env\.DEV\) return;/);
  const draw = scene.slice(scene.indexOf('private drawCollisionDebug()'), scene.indexOf('// 개발 전용: 카메라를 월드 좌표에 맞춘다'));
  assert.match(draw, /if \(!import\.meta\.env\.DEV\) return;/);
  assert.match(draw, /if \(!this\.collisionDebugOn \|\| !view\) return;/);
  // 호출 경로(__dev)는 개발 도구(dev/captureHelper.ts)에만 있다
  const helper = readFileSync(here('../dev/captureHelper.ts'), 'utf8');
  assert.match(helper, /collisionDebug, lookAt \}/);
  assert.equal(/collisionDebug|setCollisionDebug/.test(readFileSync(here('../src/main.ts'), 'utf8')), false);
});

test('기능 좌표 고정(C2-7B): 최종 배경에 맞춘 spawn·story point·구조·문·물·물살·앵커·덫·blocker 값이 의도치 않게 바뀌지 않는다(C2-7A 값은 51370ab 기준이었다)', () => {
  const keys = ['size', 'spawnPoint', 'points', 'regions', 'objects', 'storyPoints', 'layout', 'waterAreas', 'currentFields', 'safeAnchors', 'blackThreadTraps'];
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  const sub = Object.fromEntries(keys.map((k) => [k, (LAKE_JSON as Record<string, unknown>)[k] ?? null]));
  const digest = createHash('sha256').update(JSON.stringify(canon(sub))).digest('hex');
  assert.equal(digest, '259b43d4bd82c3b38e720fa91cbf9967ec0075ad9c372b27f05beed8cd660f83');
});
