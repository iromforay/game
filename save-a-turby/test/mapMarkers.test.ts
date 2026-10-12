// 10-12 v3: 지도 기호(marker-*)는 코드로 생성하는 정식 UI다 — 월드 placeholder 체계(placeholders.ts)와 분리된 계약
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_MARKER_KEYS, MAP_MARKER_SPECS, markerTextureKey } from '../src/assets/mapMarkerSpecs.ts';
import { LEGEND_LABEL, type MarkerType } from '../src/ui/screenStates.ts';

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');

// 분리 전(placeholders.ts) 계약: 키·크기·도형 종류
const PREVIOUS: Record<string, { size: [number, number]; shape: string }> = {
  'marker-player': { size: [40, 40], shape: 'arrow' },
  'marker-home': { size: [40, 40], shape: 'house' },
  'marker-market': { size: [40, 40], shape: 'stall' },
  'marker-exit': { size: [40, 40], shape: 'door' },
  'marker-locked': { size: [40, 40], shape: 'lock' },
  'marker-story': { size: [40, 40], shape: 'ring' },
  'marker-dust': { size: [40, 40], shape: 'diamond' },
  'marker-wild': { size: [40, 40], shape: 'triangle' },
  'marker-current': { size: [48, 48], shape: 'star' },
};

test('정식 마커 정의 목록: 키·크기·도형 종류는 분리 전 계약과 같고 키가 중복되지 않는다', () => {
  assert.deepEqual([...MAP_MARKER_KEYS].sort(), Object.keys(PREVIOUS).sort());
  assert.equal(new Set(MAP_MARKER_KEYS).size, MAP_MARKER_KEYS.length, '키 중복 없음');
  for (const s of MAP_MARKER_SPECS) {
    assert.deepEqual([[s.width, s.height], s.shape], [PREVIOUS[s.key].size, PREVIOUS[s.key].shape], s.key);
    assert.ok(s.role.length > 0, `${s.key}: 역할 설명`);
  }
});

test('새 모듈(mapMarkers.ts)이 모든 도형을 그리고 정의 목록의 키를 전부 생성한다', () => {
  const m = src('assets/mapMarkers.ts');
  for (const shape of new Set(MAP_MARKER_SPECS.map((s) => s.shape))) assert.match(m, new RegExp(`\\b${shape}: \\(g\\)`), `${shape} 그리기`);
  assert.match(m, /export function ensureMapMarkerTextures\(scene: Phaser\.Scene\)/);
  assert.match(m, /for \(const spec of MAP_MARKER_SPECS\)/, '정의 목록 전체를 순회');
  assert.match(m, /if \(scene\.textures\.exists\(spec\.key\)\) continue;/, '같은 키의 실제 PNG가 있으면 만들지 않는다');
  assert.match(m, /generateTexture\(spec\.key, spec\.width, spec\.height\)/);
});

test('placeholders.ts는 정식 마커 키를 생성하지 않는다(중복 생성 없음)', () => {
  const p = src('assets/placeholders.ts');
  assert.equal(/marker-/.test(p), false, '지도 기호 키가 placeholders.ts에 없다');
  assert.equal(/function star\(/.test(p), false, '지도 별 그리기도 옮겨졌다');
});

test('월드·HUD 폴백 텍스처 동작은 placeholders.ts에 그대로 남아 있다(에셋 실패 대비)', () => {
  const p = src('assets/placeholders.ts');
  for (const key of ['home-field', 'market-field', 'village-fountain', 'village-gate', 'lamp-post', 'fence-horizontal', 'fence-vertical', 'village-path-overlay', 'hud-coin-panel', 'hud-area-panel', 'prompt-interact', 'minimap-frame', 'map-open', 'map-close']) {
    assert.ok(p.includes(`'${key}'`), `${key} 폴백 유지`);
  }
  assert.match(p, /if \(scene\.textures\.exists\(key\)\) return;/, '실제 PNG가 있으면 건드리지 않음');
});

test('VillageScene·MapScene이 새 API로 정식 마커를 명시적으로 준비한다(placeholders 경유 아님)', () => {
  for (const f of ['scenes/VillageScene.ts', 'scenes/MapScene.ts']) {
    const s = src(f);
    assert.match(s, /import \{ ensureMapMarkerTextures \} from '\.\.\/assets\/mapMarkers';/, `${f}: import`);
    assert.match(s, /ensureMapMarkerTextures\(this\);/, `${f}: 호출`);
  }
  // 마을 placeholder 함수가 마커를 몰래 만들던 연결(ensureUiPlaceholders)이 마커를 만들지 않으므로 호출만 남아도 키가 겹치지 않는다
  assert.equal(/marker-/.test(src('assets/placeholders.ts')), false);
});

test('범례 MarkerType과 텍스처 키가 일치하고 사용자 노출 범례에 (임시)가 없다', () => {
  const types: MarkerType[] = ['home', 'market', 'exit', 'target', 'story', 'dust', 'wild'];
  for (const t of types) {
    const key = markerTextureKey(t);
    assert.ok(MAP_MARKER_KEYS.includes(key), `${t} → ${key}`);
    assert.ok(typeof LEGEND_LABEL[t] === 'string' && LEGEND_LABEL[t].length > 0, `${t} 범례 문구`);
  }
  assert.equal(markerTextureKey('target'), 'marker-current');
  assert.ok(MAP_MARKER_KEYS.includes('marker-player'), '내 위치 범례는 marker-player');
  for (const [k, v] of Object.entries(LEGEND_LABEL)) assert.equal(/임시/.test(v), false, `범례 ${k}: ${v}`);
  assert.equal(LEGEND_LABEL.story, '이야기 지점 — 겹동그라미');
  assert.equal(LEGEND_LABEL.dust, '빛나는 실가루 — 마름모');
  assert.equal(LEGEND_LABEL.wild, '야생 터비 ▲');
  assert.equal(LEGEND_LABEL.path, '길 — 굵은 선');
});

test('MiniMap은 마커 키를 정의 모듈의 함수로만 얻는다', () => {
  const m = src('ui/MiniMap.ts');
  assert.match(m, /import \{ markerTextureKey \} from '\.\.\/assets\/mapMarkerSpecs';/);
  assert.equal(/`marker-\$\{type\}`/.test(m), false, 'MiniMap에 키 조합 문자열이 남아 있지 않다');
});
