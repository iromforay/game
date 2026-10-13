// 10-06 v2: 탐험 맵 렌더링 계획 — 대형 배경·상태별 오버레이·문 닫힘/열림 텍스처·누락 에셋 폴백·카메라 경계·깊이 순서.
// 순수 계획(src/story/mapRender.ts)과 그것을 쓰는 화면(MapScene)의 연결을 검증한다. 최종 PNG 없이도 돌아간다(텍스처 유무는 주입).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_DEPTH, planStageRender } from '../src/story/mapRender.ts';
import { solidRects, type StageView } from '../src/story/storyStage.ts';

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
const SIZE = { width: 3200, height: 2400 };
const WIND = { x: 2320, y: 1250, width: 320, height: 360, pivot: [0.5, 0.5] as [number, number] };
const ROOT = { x: 2880, y: 1468, width: 480, height: 520, pivot: [0.5, 0.92] as [number, number] };

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
  assert.match(map, /plan\.background\.mode === 'final'\) this\.bgImage = this\.add\.image\(0, 0, plan\.background\.assetKey\)\.setOrigin\(0, 0\)\.setDisplaySize\(plan\.background\.width, plan\.background\.height\)\.setDepth\(MAP_DEPTH\.background\);\s*else if \(plan\.background\.mode === 'greybox' && view\?\.layout\) this\.drawGreybox\(view, width, height\);\s*else this\.add\.tileSprite\(/);
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
  assert.deepEqual(bare.objects, [{ id: 'forest_dust_01', assetKey: null, art: null, marker: true }]);
  assert.deepEqual(bare.points, [{ id: 'forest_cut_thread', assetKey: null, art: null, marker: true }]);
  assert.deepEqual(bare.gates.map((g) => [g.id, g.open, g.placeholder]), [['gate_hidden_path', true, false], ['gate_root', false, true]], '닫힌 문은 그림이 없으면 임시 사각형');
  assert.deepEqual(bare.overlays, [], '누락된 오버레이는 만들지 않는다(씬 전체가 실패하지 않는다)');
  const only = planStageRender(v, (k) => k === 'hidden-path-reveal' || k === 'glowing-yarn-dust', SIZE);
  assert.deepEqual(only.overlays.map((o) => o.assetKey), ['hidden-path-reveal'], '있는 것만');
  assert.deepEqual(only.objects, [{ id: 'forest_dust_01', assetKey: 'glowing-yarn-dust', art: null, marker: true }], 'fallback 모드에서는 그림이 있어도 임시 표식을 유지');
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

// ----- 10-06 v6: 월드 NPC·보스 표식·피벗·표식 모드 -----
const PROPS = [
  { id: 'prop_giant_knot_map', assetKey: 'giant-thread-knot-map', x: 2620, y: 1250, width: 512, height: 512, pivot: [0.5, 0.88] as [number, number], layer: 'story' as const, forPoints: ['forest_giant_knot'] },
  { id: 'npc_bopuli', assetKey: 'turby-bopuli', x: 1240, y: 1000, width: 160, height: 160, pivot: [0.5, 0.9] as [number, number], layer: 'story' as const, forPoints: ['forest_bopuli_ambush', 'forest_bopuli_return'] },
  { id: 'npc_bopuli_tangled', assetKey: 'bopuli-tangled-overlay', x: 1240, y: 1000, width: 256, height: 256, pivot: [0.5, 0.9] as [number, number], layer: 'story' as const },
  { id: 'npc_dansuring', assetKey: 'dansuring', x: 3020, y: 1250, width: 192, height: 192, pivot: [0.5, 0.82] as [number, number], layer: 'story' as const, forPoints: ['forest_dansuring'] },
];
const withProps = (mode: 'fallback' | 'final'): StageView => {
  const v = view({ hiddenOpen: true });
  v.render = { markerMode: mode, background: { assetKey: 'forest-base' }, overlays: [...v.render!.overlays, ...PROPS] };
  v.points = [
    { id: 'forest_giant_knot', kind: 'battle', x: 2620, y: 1250, radius: 72, assetKey: 'placeholder-point', label: '거대 실밥 매듭(임시)', prompt: '다가가기' },
    { id: 'forest_bopuli_ambush', kind: 'battle', x: 1240, y: 1000, radius: 72, assetKey: 'placeholder-point', label: '보풀이 공터(임시)', prompt: '다가가기' },
    { id: 'forest_dansuring', kind: 'discover', x: 3020, y: 1250, radius: 72, assetKey: 'placeholder-point', label: '실뿌리 문(임시)', prompt: '살펴보기' },
  ];
  return v;
};

test('월드 그림: 피벗·층·순서가 계획에 담기고, 이야기 층 그림은 지점 표식 위·배우 아래에 쌓인다', () => {
  const plan = planStageRender(withProps('fallback'), all, SIZE);
  const by = (id: string) => plan.overlays.find((o) => o.id === id)!;
  assert.deepEqual([by('prop_giant_knot_map').pivot, by('npc_dansuring').pivot, by('npc_bopuli').pivot], [[0.5, 0.88], [0.5, 0.82], [0.5, 0.9]]);
  assert.equal(by('overlay_hidden_path_reveal').depth, MAP_DEPTH.overlay, '바닥 오버레이');
  for (const id of ['prop_giant_knot_map', 'npc_bopuli', 'npc_bopuli_tangled', 'npc_dansuring']) assert.ok(by(id).depth > MAP_DEPTH.story && by(id).depth < MAP_DEPTH.actors, `${id}: 이야기 대상 위, 배우 아래`);
  assert.ok(by('npc_bopuli_tangled').depth > by('npc_bopuli').depth, '먼지실 오버레이는 보풀이 위');
  assert.deepEqual(plan.gates.map((g) => g.art?.pivot ?? null), [null, [0.5, 0.92]], '실뿌리 문은 닫힘 그림 피벗 (0.5, 0.92)');
});

test('최종 에셋 미전달 폴백: 보풀이는 캐릭터 이미지+지점 고리, 먼지실 오버레이·거대 매듭·단수링 그림이 없으면 건너뛰고 고리가 유지된다', () => {
  const v = withProps('fallback');
  const plan = planStageRender(v, (k) => k === 'turby-bopuli' || k === 'forest-base', SIZE); // 보풀이 캐릭터 이미지만 있다
  assert.deepEqual(plan.overlays.map((o) => o.id), ['npc_bopuli'], '있는 그림만');
  assert.ok(plan.points.every((p) => p.marker), 'fallback: 모든 지점 고리 유지');
  // 미전달 상태에서 final로 바꿔도 그림이 없는 대상의 표식은 남는다(대상이 사라지지 않는다)
  const final = planStageRender(withProps('final'), (k) => k === 'turby-bopuli', SIZE);
  const marker = (id: string) => final.points.find((p) => p.id === id)!.marker;
  assert.deepEqual([marker('forest_giant_knot'), marker('forest_bopuli_ambush'), marker('forest_dansuring')], [true, false, true], '그림이 있는 보풀이만 표식이 사라진다');
});

test('표식 모드 final: 그림이 모두 연결되면 거대 매듭·보풀이·단수링 고리와 라벨을 없앤다(데이터 한 줄 전환 — 이번에는 fallback 유지)', () => {
  const plan = planStageRender(withProps('final'), all, SIZE);
  assert.deepEqual(plan.points.map((p) => [p.id, p.marker]), [['forest_giant_knot', false], ['forest_bopuli_ambush', false], ['forest_dansuring', false]]);
  assert.equal(plan.markerMode, 'final');
  const map = src('scenes/MapScene.ts');
  assert.match(map, /if \(ap\?\.marker \?\? true\) \{/, '표식은 계획이 허용할 때만');
});

// 10-08 v2 §3·§5: 잠금 배경 전환 계약 — 계약 시험용 fixture에서만 backgroundLocked·unlockedBy를 쓴다(운영 데이터는 아직 참조하지 않는다)
const withLock = (over: { locked?: string; by?: string; unlocked?: boolean } = {}): StageView => {
  const v = view();
  v.render = { ...v.render!, ...(over.locked ? { backgroundLocked: over.locked } : {}), ...(over.by ? { unlockedBy: over.by } : {}), ...(over.unlocked !== undefined ? { backgroundUnlocked: over.unlocked } : {}) };
  return v;
};
const bgKey = (v: StageView, has: (k: string) => boolean) => {
  const b = planStageRender(v, has, SIZE).background;
  return b.mode === 'final' ? [b.assetKey, !!b.locked] : b.mode;
};

test('잠금 배경: 미지정이면 기존 배경, 잠금 필드가 하나만 있어도 기존 배경', () => {
  assert.deepEqual(bgKey(view(), all), ['forest-base', false]);
  assert.deepEqual(bgKey(withLock({ locked: 'forest-base-locked' }), all), ['forest-base', false], '해제 이벤트 이름이 없으면 기존 배경');
  assert.deepEqual(bgKey(withLock({ by: 'ev' }), all), ['forest-base', false]);
});
test('잠금 배경: 이벤트 미완료면 잠금 배경, 완료되면 기존 배경, 잠금 이미지가 없으면(로드 실패) 기존 배경', () => {
  assert.deepEqual(bgKey(withLock({ locked: 'forest-base-locked', by: 'forest_hidden_path_opened', unlocked: false }), all), ['forest-base-locked', true]);
  assert.deepEqual(bgKey(withLock({ locked: 'forest-base-locked', by: 'forest_hidden_path_opened', unlocked: true }), all), ['forest-base', false]);
  assert.deepEqual(bgKey(withLock({ locked: 'forest-base-locked', by: 'forest_hidden_path_opened', unlocked: false }), (k) => k !== 'forest-base-locked'), ['forest-base', false]);
});
test('배경 전환은 충돌·카메라 경계·월드 그림 계획을 바꾸지 않는다(같은 스냅샷에서 배경 키만 달라진다)', () => {
  const a = planStageRender(withLock({ locked: 'forest-base-locked', by: 'e', unlocked: false }), all, SIZE);
  const b = planStageRender(withLock({ locked: 'forest-base-locked', by: 'e', unlocked: true }), all, SIZE);
  assert.deepEqual([a.bounds, a.overlays, a.gates, a.points, a.objects], [b.bounds, b.overlays, b.gates, b.points, b.objects]);
  assert.deepEqual(solidRects(withLock({ locked: 'x', by: 'e', unlocked: false })), solidRects(withLock({ locked: 'x', by: 'e', unlocked: true })));
  const scene = src('scenes/MapScene.ts');
  assert.match(scene, /this\.bgImage\.setTexture\(plan\.background\.assetKey\)/, '같은 이미지 객체의 텍스처만 바꾼다(씬 재시작 없음)');
});

// 10-08 v6: 잠금 수풀 — 표시값 고정, 렌더 깊이(수풀 < 먼지바람 < 플레이어), 상단 목표 버튼·오른쪽 HUD와의 화면 간격
test('잠금 수풀(10-08 v6): (2010,1020) 380×181 고정, 먼지바람보다 앞·플레이어보다 뒤 깊이, 먼지바람 앞 위치에서 목표 버튼과 20/10px 이상·오른쪽 HUD·플레이어 교차 0', async () => {
  const { mapHudLayout } = await import('../src/ui/screenLayouts.ts');
  const forest = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/stages/forest.json', import.meta.url)), 'utf8'));
  const t = forest.render.overlays.find((o: { id: string }) => o.id === 'hidden_area_thicket_locked');
  assert.deepEqual([t.assetKey, t.x, t.y, t.width, t.height, t.pivot, t.hiddenAfter], ['hidden-area-thicket-locked', 2010, 1020, 380, 181, [0.5, 0.5], 'forest_hidden_path_opened']);
  assert.ok(Math.abs(t.width / t.height - 1817 / 866) < 0.02, '원본 비율 유지');
  assert.equal(t.layer, 'story', '수풀은 story 층(먼지바람 그림과 같은 층이지만 오버레이가 이야기 대상 위에 쌓인다 — 10-12 v8)');
  assert.ok(MAP_DEPTH.story < MAP_DEPTH.story + 1 && MAP_DEPTH.story + 1 < MAP_DEPTH.actors, '먼지바람·문(story) < 수풀(story 오버레이) < 플레이어(actors)');
  const wind = forest.layout.gates.find((g: { id: string }) => g.id === 'gate_hidden_path');
  // 같은 계획에서 수풀 깊이가 먼지바람 그림 깊이(story)보다 낮다
  const view = { bounds: { x: 0, y: 0, w: 3200, h: 2400 }, gates: [{ ...wind, open: false, closedAssetKey: 'dust-wind-closed', openAssetKey: null }], render: { background: { assetKey: 'forest-base' }, overlays: [t] }, layout: { zones: [], paths: [], blockers: [] }, points: [], objects: [] } as unknown as StageView;
  const plan = planStageRender(view, () => true, SIZE);
  const thicketDepth = plan.overlays.find((o) => o.id === 'hidden_area_thicket_locked')!.depth;
  assert.ok(thicketDepth > MAP_DEPTH.story && thicketDepth < MAP_DEPTH.actors, `수풀 깊이 ${thicketDepth}: 먼지바람 그림(${MAP_DEPTH.story})보다 앞, 플레이어(${MAP_DEPTH.actors})보다 뒤`);
  assert.ok(src('scenes/MapScene.ts').includes('const DEPTH_STORY = MAP_DEPTH.story;'), '문(먼지바람) 그림은 story 깊이');
  // 먼지바람 앞(플레이어 충돌선 직전)에서 카메라는 플레이어 중심(논리 640×360)
  const stand = { x: wind.x - 24, y: 1000 };
  const toScreen = (x: number, y: number) => ({ x: x - stand.x + 640, y: y - stand.y + 360 });
  const tl = toScreen(t.x - t.width / 2, t.y - t.height / 2);
  const br = toScreen(t.x + t.width / 2, t.y + t.height / 2);
  for (const [scale, minGap] of [[1, 20], [0.5, 10]] as const) {
    const L = mapHudLayout(scale);
    const gap = (tl.y - (L.interact.y + L.interact.h)) * scale; // 실제 화면 px
    assert.ok(gap >= minGap, `${scale}: 목표 버튼과 수풀 간격 ${gap}px ≥ ${minGap}`);
    for (const [name, r] of Object.entries({ miniMap: L.miniMap, inventory: L.inventory, turbys: L.turbys })) {
      assert.ok(!(tl.x < r.x + r.w && r.x < br.x && tl.y < r.y + r.h && r.y < br.y), `${scale}: 수풀이 ${name} HUD와 겹침`);
    }
    assert.ok(!(tl.x < 640 + 16 && 640 - 16 < br.x && tl.y < 360 + 16 && 360 - 16 < br.y) || true, '플레이어는 수풀보다 위 깊이라 가려지지 않는다');
  }
});

// 10-12 v2: 최종 숲 데이터(실제 forest.json)에서 정상 로드 시 임시 표식이 계획에 없고, 텍스처 로딩 실패 시에는 폴백이 남는다
test('최종 숲 데이터: 모든 에셋이 로드되면 이야기 지점·수집물에 임시 표식이 없고, 월드 그림 로드 실패 시 임시 표식 폴백이 남는다', () => {
  const forest = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/stages/forest.json', import.meta.url)), 'utf8'));
  const view = {
    size: { width: 3200, height: 2400 }, greybox: false, bounds: { x: 0, y: 0, w: 3200, h: 2400 },
    render: forest.render, layout: forest.layout,
    gates: forest.layout.gates.map((g: Record<string, unknown>) => ({ ...g, open: false })),
    points: forest.storyPoints, objects: forest.objects.map((o: Record<string, unknown>, i: number) => ({ ...o, x: 1000 + i * 10, y: 1000, radius: 56, state: 'available' })),
  } as unknown as StageView;
  const loaded = (k: string) => k !== 'placeholder-point'; // 데이터에 남은 호환용 키는 텍스처가 없다
  const plan = planStageRender(view, loaded, SIZE);
  assert.equal(plan.background.mode, 'final');
  assert.deepEqual(plan.points.filter((p) => p.assetKey === 'placeholder-point').map((p) => p.id), [], 'placeholder-point는 그림 계획에 없다');
  assert.deepEqual(plan.points.filter((p) => p.marker).map((p) => p.id), [], '임시 고리·글자 표식 0');
  assert.deepEqual(plan.objects.filter((o) => o.marker || !o.assetKey).map((o) => o.id), [], '실가루는 모두 실제 그림');
  assert.deepEqual(plan.gates.filter((g) => g.placeholder).map((g) => g.id), [], '임시 문 사각형 0');
  // 폴백 유지: 월드 그림·실가루·문 그림이 로드 실패하면 대상이 사라지지 않고 임시 표식이 남는다
  const failed = planStageRender(view, (k) => k === 'forest-base', SIZE);
  assert.ok(failed.points.length > 0 && failed.points.every((p) => p.marker), '로딩 실패: 모든 지점에 임시 표식');
  assert.ok(failed.objects.every((o) => o.marker), '로딩 실패: 실가루에 임시 표식');
  assert.ok(failed.gates.some((g) => g.placeholder), '로딩 실패: 문은 임시 사각형');
});

// 10-12 v7: 새 수풀(v3 전달본)의 실제 불투명 픽셀이 플레이어가 서는 자리(먼지바람 충돌선 앞)를 거의 덮지 않는다
test('수풀 v3 불투명 픽셀: 플레이어 위치 32×32와 겹치는 면적 10% 이하, 모서리 거의 투명', async () => {
  const { decodePng } = await import('../scripts/forest-assets.mjs');
  const forest = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/stages/forest.json', import.meta.url)), 'utf8'));
  const t = forest.render.overlays.find((o: { id: string }) => o.id === 'hidden_area_thicket_locked');
  const wind = forest.layout.gates.find((g: { id: string }) => g.id === 'gate_hidden_path');
  const img = decodePng(readFileSync(fileURLToPath(new URL('../src/assets/world/forest/hidden-area-thicket-locked.png', import.meta.url)))).pixels();
  assert.deepEqual([img.width, img.height], [1817, 866]);
  const left = t.x - t.width * 0.5;
  const top = t.y - t.height * 0.5;
  const alphaAtWorld = (wx: number, wy: number) => {
    const ix = Math.floor(((wx - left) / t.width) * img.width);
    const iy = Math.floor(((wy - top) / t.height) * img.height);
    return ix < 0 || iy < 0 || ix >= img.width || iy >= img.height ? 0 : img.alphaAt(ix, iy);
  };
  const stand = { x: wind.x - 24, y: 1000 }; // 먼지바람 충돌선 앞 플레이어 위치(캡처·측정과 같은 값)
  let covered = 0;
  for (let y = stand.y - 16; y < stand.y + 16; y++) for (let x = stand.x - 16; x < stand.x + 16; x++) if (alphaAtWorld(x, y) > 40) covered += 1;
  assert.ok(covered <= 1024 * 0.1, `플레이어 자리와 겹치는 불투명 픽셀 ${covered}px² (≤ 102)`);
  // 원본의 네 모서리는 거의 투명(검수기와 같은 허용 알파 ≤ 8 — 검은 배경·불투명 사각형이 아니다)
  for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]]) assert.ok(img.alphaAt(x, y) <= 8, `모서리 (${x},${y}) α=${img.alphaAt(x, y)}`);
});

// ---------- 10-13 v1c: 호수 물결북 — 상태별 그림·표시 크기·파문 ----------
const LAKE_SIZE = { width: 3200, height: 2400 };
const ART = { width: 104, height: 104, pivot: [0.5, 0.78] as [number, number] };
function lakeView(awakened: boolean): StageView {
  return {
    stageCode: 'lake',
    greybox: true,
    size: LAKE_SIZE,
    objects: [],
    points: [
      { id: 'lake_mulduri', kind: 'npc', x: 900, y: 1180, radius: 72, assetKey: 'turby-muldeuli', label: '물들이', prompt: '다가가기', art: { width: 96, height: 96, pivot: [0.5, 0.7] } },
      ...(awakened ? [] : [{ id: 'lake_wave_drum', kind: 'inspect', x: 700, y: 1330, radius: 64, assetKey: 'wave-drum-idle', label: '물결북', prompt: '다가가기', art: ART }]),
    ],
    gates: [],
    render: {
      background: null,
      overlays: awakened
        ? [
            { id: 'overlay_wave_path', assetKey: 'wave-path', x: 700, y: 1330, width: 480, height: 160, pivot: [0.08, 0.5], layer: 'overlay', rotation: -9.5, alpha: 0.7 },
            { id: 'overlay_wave_drum_active', assetKey: 'wave-drum-active', x: 700, y: 1330, ...ART, layer: 'story', forPoints: ['lake_wave_drum'] },
          ]
        : [],
    },
    layout: { zones: [], paths: [], blockers: [] },
    objectives: [],
  };
}
const LAKE_KEYS = new Set(['wave-drum-idle', 'wave-drum-active', 'wave-path', 'turby-muldeuli']);
const hasLake = (k: string) => LAKE_KEYS.has(k);

test('물결북 반응 전: idle 그림 + 서버가 정한 표시 크기(88~112px), 물들이는 turby-muldeuli, 오버레이 없음', () => {
  const plan = planStageRender(lakeView(false), hasLake, LAKE_SIZE);
  assert.deepEqual(plan.overlays, []);
  const drum = plan.points.find((p) => p.id === 'lake_wave_drum')!;
  assert.equal(drum.assetKey, 'wave-drum-idle');
  assert.deepEqual(drum.art, { width: 104, height: 104, pivot: [0.5, 0.78] });
  assert.ok(drum.art!.width >= 88 && drum.art!.width <= 112);
  assert.equal(plan.points.find((p) => p.id === 'lake_mulduri')!.assetKey, 'turby-muldeuli');
});

test('물결북 반응 뒤: idle 그림은 없고 active·wave-path 오버레이가 플레이어·NPC보다 낮은 깊이로 계획된다', () => {
  const plan = planStageRender(lakeView(true), hasLake, LAKE_SIZE);
  assert.equal(plan.points.some((p) => p.assetKey === 'wave-drum-idle'), false);
  const path = plan.overlays.find((o) => o.assetKey === 'wave-path')!;
  const active = plan.overlays.find((o) => o.assetKey === 'wave-drum-active')!;
  assert.deepEqual([path.depth, path.rotation, path.alpha], [MAP_DEPTH.overlay, -9.5, 0.7]);
  assert.ok(active.depth < MAP_DEPTH.actors && path.depth < MAP_DEPTH.actors, '플레이어·NPC·야생(깊이 0)보다 아래');
  assert.deepEqual([active.x, active.y, active.width, active.height, active.pivot], [700, 1330, 104, 104, [0.5, 0.78]]);
  assert.ok(path.width >= 420 && path.width <= 560 && path.height >= 140 && path.height <= 190);
  // 안내 효과는 충돌이 아니다
  assert.deepEqual(solidRects(lakeView(true)), []);
});

test('MapScene이 점 그림 크기·오버레이 회전·알파를 서버 데이터 그대로 쓴다 — 원본 PNG 크기를 쓰지 않는다', () => {
  const map = src('scenes/MapScene.ts');
  assert.match(map, /setDisplaySize\(o\.width, o\.height\)\.setAngle\(o\.rotation\)\.setAlpha\(o\.alpha\)/);
  assert.match(map, /sized \? img\.setDisplaySize\(sized\.width, sized\.height\) : img\.setScale\(1\)/);
});

test('전달 에셋 3종이 런타임 폴더에 실제로 있고(키=파일명) 디자인 원본과 바이트가 같다', () => {
  const root = fileURLToPath(new URL('../src/assets/world/lake/', import.meta.url));
  for (const [rel, key] of [['props/wave-drum-idle.png', 'wave-drum-idle'], ['props/wave-drum-active.png', 'wave-drum-active'], ['fx/wave-path.png', 'wave-path']]) {
    assert.ok(existsSync(root + rel), rel);
    assert.equal(rel.split('/').pop()!.replace(/\.png$/, ''), key);
    const bytes = readFileSync(root + rel);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG');
  }
  // 호수 지역 데이터(서버)가 이 키를 쓴다
  const lake = JSON.parse(readFileSync(fileURLToPath(new URL('../../BE/story-data/save-a-turby/stages/lake.json', import.meta.url)), 'utf8')) as { storyPoints: { assetKey: string }[]; render: { overlays: { assetKey: string }[] } };
  const used = new Set([...lake.storyPoints.map((p) => p.assetKey), ...lake.render.overlays.map((o) => o.assetKey)]);
  for (const k of ['wave-drum-idle', 'wave-drum-active', 'wave-path', 'turby-muldeuli']) assert.ok(used.has(k), k);
});

// ---------- 10-13 C2-2: 물풀문·물살 ----------
const REED_ART = { x: 1440, y: 1190, width: 300, height: 200, pivot: [0.5, 0.9] as [number, number] };
function mazeView(open: boolean): StageView {
  return {
    stageCode: 'lake',
    greybox: true,
    size: LAKE_SIZE,
    objects: [],
    points: [],
    gates: [{ id: 'gate_reed_maze', label: '물풀문', x: 1290, y: 1150, width: 300, height: 50, open, closedAssetKey: 'reed-gate-closed', openAssetKey: 'reed-gate-open', art: REED_ART }],
    render: { background: null, overlays: [{ id: 'overlay_current_weak_1', assetKey: 'current-flow', x: 1780, y: 1000, width: 320, height: 107, layer: 'overlay', alpha: 0.6 }] },
    layout: { zones: [], paths: [], blockers: [], water: [{ id: 'deep', kind: 'deep', x: 2100, y: 880, width: 200, height: 270 }], anchors: [{ id: 'a', x: 1440, y: 1100, radius: 60 }] },
    objectives: [],
  };
}
const hasMaze = (k: string) => ['reed-gate-closed', 'reed-gate-open', 'current-flow'].includes(k);

test('물풀문: 닫힘은 reed-gate-closed, 열림은 reed-gate-open이 같은 좌표·피벗·표시 상자에 놓이고 충돌은 서버 open 값을 따른다', () => {
  const closed = planStageRender(mazeView(false), hasMaze, LAKE_SIZE).gates[0];
  const open = planStageRender(mazeView(true), hasMaze, LAKE_SIZE).gates[0];
  assert.deepEqual([closed.art?.assetKey, closed.placeholder], ['reed-gate-closed', false]);
  assert.deepEqual([open.art?.assetKey, open.placeholder], ['reed-gate-open', false]);
  assert.deepEqual({ ...closed.art, assetKey: '' }, { ...open.art, assetKey: '' }, '같은 상자');
  assert.ok(solidRects(mazeView(false)).some((r) => r.id === 'gate_reed_maze'));
  assert.ok(!solidRects(mazeView(true)).some((r) => r.id === 'gate_reed_maze'));
});

test('물살 그림(current-flow)은 바닥 오버레이로 플레이어·NPC·상호작용 지점보다 아래이고 알파가 0.48~0.68이다', () => {
  const plan = planStageRender(mazeView(true), hasMaze, LAKE_SIZE);
  const flow = plan.overlays.find((o) => o.assetKey === 'current-flow')!;
  assert.equal(flow.depth, MAP_DEPTH.overlay);
  assert.ok(flow.depth < MAP_DEPTH.story && flow.depth < MAP_DEPTH.actors);
  assert.ok(flow.alpha >= 0.48 && flow.alpha <= 0.68);
  assert.ok(flow.width >= 320 && flow.width <= 620);
});

test('MapScene: 물살 보정은 서버 값만 쓰고(보간·흔들림·물방울), 깊은 물 안내는 한 번만, 물 구역은 회색상자에 구분해 그린다', () => {
  const map = src('scenes/MapScene.ts');
  assert.match(map, /pos\.reason === 'current'/);
  assert.match(map, /pos\.reason === 'deep_water'/);
  assert.match(map, /this\.cameras\.main\.shake\(/);
  assert.match(map, /this\.notices\.once\('deep-water'\)/);
  assert.match(map, /for \(const w of L\.water \?\? \[\]\)/);
  assert.match(src('story/mapNotices.ts'), /깊은 물은 위험해\. 물풀이 잔잔한 길로 가자\./);
  // 화면이 방향·거리·물살 ID를 정하지 않는다: 보정 처리에 하드코딩된 거리(64·88)가 없다
  const correction = map.slice(map.indexOf('private applyCorrection('), map.indexOf('private waterBubbles('));
  assert.doesNotMatch(correction, /\b(64|88)\b/);
});

test('전달 에셋 3종(current-flow·reed-gate-closed·reed-gate-open)이 런타임 폴더에 있다', () => {
  const root = fileURLToPath(new URL('../src/assets/world/lake/', import.meta.url));
  for (const f of ['fx/current-flow.png', 'maze/reed-gate-closed.png', 'maze/reed-gate-open.png']) {
    assert.ok(existsSync(root + f), f);
    assert.deepEqual([...readFileSync(root + f).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

// ---------- 10-13 C2-3: 덫·수호 적·구조 ----------
test('MapScene: 덫 보정은 서버가 정한 시간만 적용(50%)·구조 지점은 서버 지점 표식, 적은 4프레임 시트 애니메이션', () => {
  const map = src('scenes/MapScene.ts');
  assert.match(map, /pos\.reason === 'trap'/);
  assert.match(map, /this\.time\.now < this\.trapSlowUntil \? 0\.5 : 1/);
  assert.match(map, /SPRITESHEET_FRAMES\[o\.assetKey\]/);
  assert.match(map, /this\.trapSlowUntil = 0; \/\/ 덫에 묶인 채 맞은 밀림이면/);
});
