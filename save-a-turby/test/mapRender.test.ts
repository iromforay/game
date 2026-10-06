// 10-06 v2: 탐험 맵 렌더링 계획 — 대형 배경·상태별 오버레이·문 닫힘/열림 텍스처·누락 에셋 폴백·카메라 경계·깊이 순서.
// 순수 계획(src/story/mapRender.ts)과 그것을 쓰는 화면(MapScene)의 연결을 검증한다. 최종 PNG 없이도 돌아간다(텍스처 유무는 주입).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_DEPTH, planStageRender } from '../src/story/mapRender.ts';
import { solidRects, type StageView } from '../src/story/storyStage.ts';

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
const SIZE = { width: 3200, height: 2400 };
const WIND = { x: 2320, y: 1250, width: 320, height: 360 };
const ROOT = { x: 2880, y: 1250, width: 480, height: 520 };

// 서버가 내려 주는 모양(StageViewDto)의 화면 데이터. 문 open과 오버레이는 서버가 같은 이벤트로 한 번에 정한다
function view(over: { greybox?: boolean; hiddenOpen?: boolean; rootOpen?: boolean; background?: boolean } = {}): StageView {
  const hiddenOpen = over.hiddenOpen ?? false;
  const rootOpen = over.rootOpen ?? false;
  return {
    stageCode: 'forest',
    greybox: over.greybox ?? false,
    size: SIZE,
    objects: [{ id: 'forest_dust_01', objectiveKey: 'k', x: 1100, y: 880, radius: 56, assetKey: 'glowing-yarn-dust', label: '실가루(임시)', prompt: '줍기', state: 'available' }],
    points: [{ id: 'forest_cut_thread', kind: 'inspect', x: 1600, y: 1000, radius: 64, assetKey: 'cut-yarn-strand', label: '잘린 실오라기(임시)', prompt: '살펴보기' }],
    gates: [
      { id: 'gate_hidden_path', label: '먼지바람', x: 2300, y: 1170, width: 40, height: 160, open: hiddenOpen, closedAssetKey: 'dust-wind-closed', openAssetKey: null, art: WIND },
      ...(hiddenOpen ? [{ id: 'gate_root', label: '닫힌 실뿌리', x: 2860, y: 1170, width: 40, height: 160, open: rootOpen, closedAssetKey: 'root-gate-closed', openAssetKey: 'root-gate-open', art: ROOT }] : []),
    ],
    render: {
      background: over.background === false ? null : { assetKey: 'forest-base' },
      overlays: hiddenOpen ? [{ id: 'overlay_hidden_path_reveal', assetKey: 'hidden-path-reveal', x: 2600, y: 1250, width: 960, height: 560 }, { id: 'overlay_hidden_yarn_path', assetKey: 'hidden-yarn-path', x: 2580, y: 1250, width: 768, height: 256 }] : [],
    },
    layout: { zones: [], paths: [], blockers: [{ id: 'bush_04', label: '먼지풀', x: 1680, y: 810, width: 200, height: 44 }] },
    objectives: [],
  };
}
const all = () => true;
const none = () => false;

test('최종 배경 키(텍스처)가 있고 회색상자 단계가 끝났으면 대형 배경 한 장 — tileSprite를 쓰지 않는다', () => {
  const plan = planStageRender(view({ greybox: false }), (k) => k === 'forest-base', { width: 1, height: 1 });
  assert.deepEqual(plan.background, { mode: 'final', assetKey: 'forest-base', width: 3200, height: 2400 });
  // 화면 코드: 최종 분기는 add.image 한 장, tileSprite는 지역 배치가 없는 분기(tile)에만 한 곳
  const map = src('scenes/MapScene.ts');
  assert.equal([...map.matchAll(/tileSprite\(/g)].length, 1);
  assert.match(map, /plan\.background\.mode === 'final'\) this\.add\.image\(0, 0, plan\.background\.assetKey\)\.setOrigin\(0, 0\)\.setDisplaySize\(plan\.background\.width, plan\.background\.height\)\.setDepth\(MAP_DEPTH\.background\);\s*else if \(plan\.background\.mode === 'greybox' && view\?\.layout\) this\.drawGreybox\(view, width, height\);\s*else this\.add\.tileSprite\(/);
});

test('배경 텍스처가 없으면(미납품·로드 실패) 임시 회색상자가 유지되고, 회색상자 단계(greybox:true)에서는 배경이 있어도 바꾸지 않는다', () => {
  assert.equal(planStageRender(view({ greybox: false }), none, SIZE).background.mode, 'greybox', '키만 있고 텍스처가 없다');
  assert.equal(planStageRender(view({ greybox: false, background: false }), all, SIZE).background.mode, 'greybox', '데이터에 배경 키가 없다');
  assert.equal(planStageRender(view({ greybox: true }), all, SIZE).background.mode, 'greybox', 'greybox:true는 Codex가 에셋을 DELIVERED로 표시한 뒤에만 바뀐다');
  const noLayout = { ...view(), layout: null, render: undefined } as StageView;
  assert.equal(planStageRender(noLayout, all, SIZE).background.mode, 'tile', '지역 배치가 없는 다른 지역은 기존 반복 배경');
  assert.equal(planStageRender(null, all, SIZE).background.mode, 'tile', '서버 화면을 받지 못해도 화면이 죽지 않는다');
  assert.deepEqual(planStageRender(null, all, { width: 2000, height: 1000 }).bounds, { x: 0, y: 0, width: 2000, height: 1000 });
});

test('숨은 길과 문 상태가 서버 이벤트에 따라 그림·오버레이·충돌이 한 번에 바뀐다', () => {
  const closed = view({ hiddenOpen: false });
  const opened = view({ hiddenOpen: true });
  const planClosed = planStageRender(closed, all, SIZE);
  const planOpened = planStageRender(opened, all, SIZE);
  // 개방 전: 길 오버레이 없음(길 자체가 보이지 않는다), 먼지바람 닫힘 그림, 문은 충돌 대상
  assert.deepEqual(planClosed.overlays, []);
  assert.deepEqual(planClosed.gates.map((g) => [g.id, g.open, g.art?.assetKey ?? null]), [['gate_hidden_path', false, 'dust-wind-closed']]);
  assert.ok(solidRects(closed).some((r) => r.id === 'gate_hidden_path'));
  // 개방 뒤: 오버레이 공개 + 먼지바람 사라짐(열림 그림 없음, 임시 사각형도 없음) + 문이 충돌에서 빠짐 + 실뿌리 문은 닫힘 그림
  assert.deepEqual(planOpened.overlays.map((o) => [o.assetKey, o.depth]), [['hidden-path-reveal', MAP_DEPTH.overlay], ['hidden-yarn-path', MAP_DEPTH.overlay]]);
  const wind = planOpened.gates.find((g) => g.id === 'gate_hidden_path')!;
  assert.deepEqual([wind.open, wind.art, wind.placeholder], [true, null, false]);
  assert.ok(!solidRects(opened).some((r) => r.id === 'gate_hidden_path'), '열린 문은 통과 가능');
  assert.equal(planOpened.gates.find((g) => g.id === 'gate_root')!.art?.assetKey, 'root-gate-closed');
  // 실뿌리 문: 닫힘 → 열림 텍스처 전환과 충돌 해제가 같은 값
  const rootOpen = view({ hiddenOpen: true, rootOpen: true });
  const root = planStageRender(rootOpen, all, SIZE).gates.find((g) => g.id === 'gate_root')!;
  assert.deepEqual([root.open, root.art?.assetKey, root.placeholder], [true, 'root-gate-open', false]);
  assert.ok(!solidRects(rootOpen).some((r) => r.id === 'gate_root'));
  // 모든 문에서: 그림이 "열림"이면 충돌이 없고 "닫힘"이면 충돌이 있다(어긋나지 않음)
  for (const v of [closed, opened, rootOpen]) {
    const solids = new Set(solidRects(v).map((r) => r.id));
    for (const g of planStageRender(v, all, SIZE).gates) assert.equal(solids.has(g.id), !g.open, `${g.id}: 그림 상태와 충돌이 같다`);
  }
  // 화면은 같은 view로 그림·오버레이·충돌을 한 번에 갱신한다
  const map = src('scenes/MapScene.ts');
  const apply = map.slice(map.indexOf('private applyStageView('), map.indexOf('private refreshMiniMap()'));
  assert.match(apply, /this\.solids = solidRects\(view\);/);
  assert.match(apply, /planStageRender\(view, /);
  assert.match(apply, /for \(const o of plan\.overlays\)/);
});

test('실제 에셋이 없어도 상호작용 대상(지점·수집물·닫힌 문)은 임시 도형으로 보이고, 있으면 그림으로 바뀐다. 누락 오버레이는 건너뛴다', () => {
  const v = view({ hiddenOpen: true });
  const bare = planStageRender(v, none, SIZE);
  assert.deepEqual(bare.objects, [{ id: 'forest_dust_01', assetKey: null }]);
  assert.deepEqual(bare.points, [{ id: 'forest_cut_thread', assetKey: null }]);
  assert.deepEqual(bare.gates.map((g) => [g.id, g.open, g.placeholder]), [['gate_hidden_path', true, false], ['gate_root', false, true]], '닫힌 문은 그림이 없으면 임시 사각형');
  assert.deepEqual(bare.overlays, [], '누락된 오버레이는 만들지 않는다(씬 전체가 실패하지 않는다)');
  const only = planStageRender(v, (k) => k === 'hidden-path-reveal' || k === 'glowing-yarn-dust', SIZE);
  assert.deepEqual(only.overlays.map((o) => o.assetKey), ['hidden-path-reveal'], '있는 것만');
  assert.deepEqual(only.objects, [{ id: 'forest_dust_01', assetKey: 'glowing-yarn-dust' }]);
  // 임시 도형을 쓰는 코드가 화면에 남아 있다(최종 에셋 전에 대상이 사라지지 않는다)
  const map = src('scenes/MapScene.ts');
  assert.match(map, /fillPoints\(\[\{ x: 0, y: -16 \}/, '수집물 임시 도형');
  assert.match(map, /if \(!g\.placeholder\) continue;/, '문 임시 사각형');
  // 수집 반경 원은 임시 도형일 때만(그림이 있는 일반 화면에는 숨긴다)
  const objects = map.slice(map.indexOf('for (const o of view?.objects ?? [])'), map.indexOf('for (const pt of view?.points ?? [])'));
  assert.ok(objects.indexOf('continue;') < objects.indexOf('setStrokeStyle(1, locked'), '그림이 있으면 반경 원을 만들기 전에 끝난다');
});

test('카메라 경계는 지도 크기, 깊이 순서는 배경 < 오버레이 < 이야기 대상 < 배우 < HUD', () => {
  assert.deepEqual(planStageRender(view(), all, { width: 1, height: 1 }).bounds, { x: 0, y: 0, width: 3200, height: 2400 });
  const d = MAP_DEPTH;
  assert.ok(d.background < d.greybox && d.greybox < d.overlay && d.overlay < d.story && d.story < d.actors && d.actors < d.hud);
  const map = src('scenes/MapScene.ts');
  assert.match(map, /setBounds\(plan\.bounds\.x, plan\.bounds\.y, plan\.bounds\.width, plan\.bounds\.height\)/);
  assert.match(map, /const DEPTH_GROUND = MAP_DEPTH\.greybox;/);
  assert.match(map, /const DEPTH_STORY = MAP_DEPTH\.story;/);
});
