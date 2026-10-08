// 10-02 v6 §2 · 10-06 v1 §5: 지역 geometry 계약 — 서버와 클라이언트가 같은 공용 패키지(shared/turby-stage-geometry)의 타입·검증·판정을 쓴다.
// 경계점·모서리·문 개방·구역 잠금의 결과가 양쪽에서 같고, 몸 반지름 차이는 의도한 범위 안이며, 잘못된 지역 JSON은 로드 단계에서 거부된다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { pathToFileURL } from 'url';
import * as shared from 'turby-stage-geometry';
import { collisionOf, pointBlocked, reachable, SERVER_BODY_HALF } from '../src/turby/rooms/stage-collision';
import { STORY_DATA_DIR, StoryContentService } from '../src/turby/story/story-content.service';
import { HIDDEN_INSIDE, SPAWN, WIND_FRONT, WIND_GATE } from './helpers/forest-geo';

const { BODY_HALF_TOLERANCE, bodyBlocked, checkMove, CLIENT_BODY_HALF, gateOpen, insideRect, lockedZonesFor, parseStageGeometry, reachVerdict, safePosition, segmentCrosses, solidsFor, solidsOfView, StageGeometryError, stepWithSolids, zoneLocked } = shared;
const FOREST_RAW = JSON.parse(readFileSync(join(STORY_DATA_DIR, 'stages', 'forest.json'), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SIZE = { width: 3200, height: 2400 };
const none = new Set<string>();
const nativeImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test('계약: 실제 숲 데이터가 계약을 통과하고, 서버 입구(stage-collision)와 공용 모듈이 같은 함수·같은 결과를 쓴다', () => {
  const g = parseStageGeometry(FOREST_RAW, SIZE, 'forest');
  assert.deepEqual([g.width, g.height, g.spawn], [3200, 2400, SPAWN]);
  assert.equal(g.blockers.length, FOREST_RAW.layout.blockers.length);
  assert.deepEqual(g.gates.map((x) => [x.id, x.openEvent]), [['gate_hidden_path', 'forest_hidden_path_opened'], ['gate_root', 'forest_first_knot_equipped']]);
  assert.deepEqual(g.zones.map((z) => [z.id, z.accessAfter]), [['zone_hidden', 'forest_hidden_path_opened'], ['zone_root_gate', 'forest_first_knot_equipped']], '접근 조건이 있는 구역만 잠금 구역');
  assert.deepEqual(collisionOf(FOREST_RAW, 1, 1, 'forest'), g, '서버의 방 geometry는 같은 파서의 결과');
  // 서버 입구가 다시 내보내는 것은 공용 모듈의 그 함수다(복사본이 아니다)
  assert.equal(SERVER_BODY_HALF, shared.SERVER_BODY_HALF);
  const bush = g.blockers.find((b) => b.id === 'bush_04')!; // 먼지풀 — 길 밖
  const p = { x: bush.x + bush.width / 2, y: bush.y + bush.height / 2 };
  assert.equal(pointBlocked(g.blockers, p), true);
  assert.equal(pointBlocked(g.blockers, p), bodyBlocked(g.blockers, p, shared.SERVER_BODY_HALF));
  const above = { x: p.x, y: bush.y - 40 };
  const below = { x: p.x, y: bush.y + bush.height + 40 };
  assert.equal(reachable(g.blockers, above, below), reachVerdict(g.blockers, [], above, below) === 'ok');
  assert.equal(reachable(g.blockers, above, below), false, '먼지풀 위아래는 닿지 않는다');
  // 지역 데이터가 없는 지역: 지도 한가운데에서 시작, 막힌 곳 없음
  assert.deepEqual(collisionOf(null, 2000, 1000), { width: 2000, height: 1000, spawn: { x: 1000, y: 500 }, blockers: [], gates: [], zones: [] });
});

test('계약: 클라이언트(save-a-turby)가 쓰는 판정은 서버와 같은 모듈이다 — 경계점·모서리·문 개방에서 결과가 같다', async () => {
  const client = await nativeImport(pathToFileURL(join(__dirname, '../../save-a-turby/src/story/storyStage.ts')).href);
  const viaClient = await nativeImport(pathToFileURL(join(__dirname, '../../shared/turby-stage-geometry/dist/esm/index.js')).href); // 프런트(ESM)가 불러오는 산출물
  assert.equal(client.stepWithSolids, viaClient.stepWithSolids, '클라이언트의 한 걸음 판정 = 공용 모듈의 함수');
  assert.deepEqual([client.CLIENT_BODY_HALF, client.SERVER_BODY_HALF], [CLIENT_BODY_HALF, SERVER_BODY_HALF], '몸 반지름 상수도 한 정의');
  // 클라이언트 소스에 충돌 규칙의 복사본이 남아 있지 않다(부등호·반지름 숫자를 직접 쓰지 않는다)
  const src = readFileSync(join(__dirname, '../../save-a-turby/src/story/storyStage.ts'), 'utf8');
  assert.match(src, /from 'turby-stage-geometry'/);
  assert.doesNotMatch(src, /BE\/src/, '프런트는 BE 소스를 참조하지 않는다');
  assert.doesNotMatch(src, /[<>]=? r\.x|r\.width \+|x \+ half|x - half/, '사각형 비교식을 따로 두지 않는다');
  const map = readFileSync(join(__dirname, '../../save-a-turby/src/scenes/MapScene.ts'), 'utf8');
  assert.match(map, /const AVATAR_HALF = CLIENT_BODY_HALF;/, '아바타 몸 반지름은 계약의 값');

  // 같은 화면 데이터로 서버 판정과 클라이언트 판정을 나란히 돌린다: 사각형 (100,100)~(200,150), 닫힌 문 (300,100)~(340,200), 열린 문
  const view = { layout: { zones: [], paths: [], blockers: [{ id: 'b', label: '', x: 100, y: 100, width: 100, height: 50 }] }, gates: [{ id: 'g1', label: '', x: 300, y: 100, width: 40, height: 100, open: false }, { id: 'g2', label: '', x: 500, y: 100, width: 40, height: 100, open: true }] };
  const geometry = parseStageGeometry({ size: { width: 1000, height: 1000 }, spawnPoint: { x: 50, y: 500 }, layout: { blockers: view.layout.blockers, gates: [{ ...view.gates[0], openEvent: 'e1' }, { ...view.gates[1], openEvent: 'e2' }] } }, { width: 1, height: 1 });
  const serverSolids = solidsFor(geometry, new Set(['e2'])); // 서버: 이벤트로 문 상태를 푼다
  const clientSolids = client.solidRects(view); // 클라이언트: 서버가 풀어 준 open 값
  assert.deepEqual(clientSolids.map((r: { id: string }) => r.id), ['b', 'g1']);
  assert.deepEqual(serverSolids.map((r) => (r as { id: string }).id), ['b', 'g1'], '문 개방 해석이 같다(열린 문은 통과, 닫힌 문은 막힘)');
  for (const half of [SERVER_BODY_HALF, CLIENT_BODY_HALF]) {
    for (let x = 60; x <= 360; x += 4) {
      for (let y = 60; y <= 220; y += 4) {
        assert.equal(client.blockedAt(clientSolids, x, y, half), bodyBlocked(serverSolids, { x, y }, half), `(${x},${y}) half=${half}`);
      }
    }
  }
});

test('계약: 경계 포함 규칙 — 경계선 위는 바깥, 지도 경계는 포함, 가장자리를 스치는 선분은 지나는 것이 아니다', () => {
  const r = { x: 100, y: 100, width: 100, height: 50 };
  // 점: 경계선 위는 바깥(벽에 딱 붙어 서는 것은 겹침이 아니다)
  assert.deepEqual([insideRect(r, { x: 100, y: 120 }, 0), insideRect(r, { x: 100.01, y: 120 }, 0), insideRect(r, { x: 200, y: 150 }, 0), insideRect(r, { x: 150, y: 125 }, 0)], [false, true, false, true]);
  // 몸: 반지름만큼 부풀린 경계 위는 바깥, 그 안쪽은 겹침. 모서리도 같다(부풀린 사각형 기준)
  for (const half of [SERVER_BODY_HALF, CLIENT_BODY_HALF]) {
    assert.equal(bodyBlocked([r], { x: 100 - half, y: 120 }, half), false, `왼쪽 변에 붙음 half=${half}`);
    assert.equal(bodyBlocked([r], { x: 100 - half + 0.5, y: 120 }, half), true);
    assert.equal(bodyBlocked([r], { x: 100 - half, y: 100 - half }, half), false, '모서리에 딱 붙음');
    assert.equal(bodyBlocked([r], { x: 100 - half + 0.5, y: 100 - half + 0.5 }, half), true, '모서리 안쪽');
    assert.equal(bodyBlocked([r], { x: 200 + half, y: 150 + half }, half), false);
  }
  // 선분: 내부를 지나면 가로막힘, 변을 따라가거나 모서리를 스치면 아님
  assert.equal(segmentCrosses(r, { x: 50, y: 125 }, { x: 250, y: 125 }), true);
  assert.equal(segmentCrosses(r, { x: 50, y: 100 }, { x: 250, y: 100 }), false, '윗변을 따라간다');
  assert.equal(segmentCrosses(r, { x: 50, y: 50 }, { x: 100, y: 100 }), false, '모서리까지만');
  assert.equal(segmentCrosses(r, { x: 150, y: 125 }, { x: 150, y: 125 }), true, '안에 서 있는 점');
  // 지도 경계는 포함
  const g = parseStageGeometry({ size: { width: 400, height: 300 }, spawnPoint: { x: 10, y: 10 } }, SIZE);
  assert.deepEqual([checkMove(g, [], [], { x: 10, y: 10 }, { x: 0, y: 0 }), checkMove(g, [], [], { x: 10, y: 10 }, { x: 400, y: 300 }), checkMove(g, [], [], { x: 10, y: 10 }, { x: 400.5, y: 300 })], ['ok', 'ok', 'out_of_bounds']);
});

test('계약: 문 개방과 구역 잠금은 이벤트 하나로 정해지고, 서버 판정과 화면 데이터가 같은 해석을 쓴다', () => {
  const g = parseStageGeometry(FOREST_RAW, SIZE, 'forest');
  const gate = g.gates[0];
  const zone = g.zones[0];
  const opened = new Set(['forest_hidden_path_opened']);
  assert.deepEqual([gateOpen(gate, none), gateOpen(gate, opened), zoneLocked(zone, none), zoneLocked(zone, opened)], [false, true, true, false]);
  assert.equal(solidsFor(g, none).length, g.blockers.length + 2);
  assert.equal(solidsFor(g, opened).length, g.blockers.length + 1, '열린 문은 통과 불가 목록에서 빠진다');
  assert.deepEqual([lockedZonesFor(g, none).length, lockedZonesFor(g, opened).length], [2, 1]);
  // 화면 데이터(서버가 open을 풀어 준 것)로 만든 목록 = 서버가 이벤트로 만든 목록(공개된 것에 한해)
  const ids = (list: object[]) => list.map((x) => (x as { id: string }).id);
  const view = (ev: Set<string>) => solidsOfView(g.blockers, g.gates.map((x) => ({ ...x, open: gateOpen(x, ev) })));
  assert.deepEqual(ids(view(none)), ids(solidsFor(g, none)));
  assert.deepEqual(ids(view(opened)), ids(solidsFor(g, opened)));
  // 문 앞에서: 닫혀 있으면 문 너머 지점에 닿지 않고(잠긴 구역), 열리면 닿는다
  const front = WIND_FRONT;
  const inside = HIDDEN_INSIDE;
  assert.equal(reachVerdict(solidsFor(g, none), lockedZonesFor(g, none), front, inside), 'locked_zone');
  assert.equal(reachVerdict(solidsFor(g, opened), lockedZonesFor(g, opened), front, inside), 'ok');
  assert.equal(checkMove(g, solidsFor(g, none), lockedZonesFor(g, none), front, { x: WIND_GATE.x + 10, y: front.y }), 'blocked');
  assert.equal(safePosition(g, solidsFor(g, none), lockedZonesFor(g, none), inside).corrected, true, '닫힌 문 너머에 저장된 위치는 시작 지점으로');
  assert.deepEqual(safePosition(g, solidsFor(g, opened), lockedZonesFor(g, opened), inside), { ...inside, corrected: false });
});

test('계약: 몸 반지름 — 서버(8)는 클라이언트(16)보다 작다. 클라이언트가 갈 수 있는 자리는 서버가 언제나 승인하고, 차이는 벽 쪽 8px 띠뿐이다', () => {
  assert.deepEqual([CLIENT_BODY_HALF, SERVER_BODY_HALF, BODY_HALF_TOLERANCE], [16, 8, 8]);
  assert.ok(SERVER_BODY_HALF <= CLIENT_BODY_HALF);
  const g = parseStageGeometry(FOREST_RAW, SIZE, 'forest');
  const solids = solidsFor(g, none);
  let band = 0;
  for (const r of [...g.gates, ...g.blockers.slice(0, 10)]) { // 이름 붙은 벽·문만(바깥 둘레 사각형은 수백 개라 반복 비용이 크다)
    for (let x = r.x - 40; x <= r.x + r.width + 40; x += 3) {
      for (let y = r.y - 40; y <= r.y + r.height + 40; y += 3) {
        const p = { x, y };
        const client = bodyBlocked(solids, p, CLIENT_BODY_HALF);
        const server = bodyBlocked(solids, p, SERVER_BODY_HALF);
        if (!client) assert.equal(server, false, `클라이언트가 설 수 있는 (${x},${y})를 서버가 막는다`);
        if (client && !server) {
          band++;
          // 서버만 허용하는 자리는 어떤 사각형에서 8px 이상 16px 미만 떨어진 띠 안이다(벽 안이 아니다)
          const gap = Math.min(...solids.map((s) => Math.max(s.x - x, x - (s.x + s.width), s.y - y, y - (s.y + s.height))));
          assert.ok(gap >= SERVER_BODY_HALF && gap < CLIENT_BODY_HALF, `(${x},${y}) 벽과의 거리 ${gap}`);
        }
      }
    }
  }
  assert.ok(band > 0, '허용 차이 띠가 실제로 있다');
  // 클라이언트의 한 걸음(벽을 따라 미끄러짐)의 결과는 서버가 승인한다: 길 한가운데에서 위쪽 벽을 향해 비스듬히 민다
  let at = { x: WIND_FRONT.x - 120, y: WIND_FRONT.y };
  for (let i = 0; i < 60; i++) {
    const next = stepWithSolids(solids, at, { x: at.x + 2, y: at.y - 6 });
    assert.equal(checkMove(g, solids, lockedZonesFor(g, none), at, next), 'ok');
    at = next;
  }
  assert.equal(bodyBlocked(solids, at, CLIENT_BODY_HALF), false, '벽 안으로 들어가지 않는다');
  assert.ok(at.y < WIND_FRONT.y - 20 && at.x > WIND_FRONT.x - 120, '위로 올라가다 벽에 막히고 옆으로 미끄러진다');
  assert.ok(Math.abs(at.y - WIND_FRONT.y) < 150, '길 밖으로 나가지 않는다');
});

test('검증: 잘못된 지역 JSON은 계약 오류로 거부한다(모양·숫자·id·경계·문 이벤트·시작 지점)', () => {
  const base = () => JSON.parse(JSON.stringify({ size: { width: 1000, height: 800 }, spawnPoint: { x: 500, y: 400 }, layout: { zones: [], blockers: [{ id: 'b1', label: '', x: 100, y: 100, width: 50, height: 50 }], gates: [{ id: 'g1', label: '', x: 300, y: 100, width: 20, height: 80, openEvent: 'e' }] } })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fails = (mutate: (d: Record<string, any>) => void, pattern: RegExp) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = base();
    mutate(d);
    assert.throws(() => parseStageGeometry(d, SIZE, 'bad'), (e: unknown) => e instanceof StageGeometryError && pattern.test(e.message), String(pattern));
  };
  assert.doesNotThrow(() => parseStageGeometry(base(), SIZE));
  fails((d) => (d.layout.blockers[0].shape = 'polygon'), /지원하지 않는 shape 'polygon'/);
  fails((d) => (d.layout.blockers[0].width = 0), /0보다 커야/);
  fails((d) => (d.layout.blockers[0].x = 'left'), /숫자/);
  fails((d) => (d.layout.blockers[0].height = Number.NaN), /숫자/);
  fails((d) => delete d.layout.blockers[0].id, /id가 없다/);
  fails((d) => (d.layout.gates[0].id = 'b1'), /id가 겹친다/);
  fails((d) => delete d.layout.gates[0].openEvent, /openEvent가 없다/);
  fails((d) => (d.layout.blockers[0].x = 980), /지도 밖/);
  fails((d) => (d.layout.blockers = {}), /배열이 아니다/);
  fails((d) => (d.size = { width: -1, height: 800 }), /size/);
  fails((d) => (d.spawnPoint = { x: 120, y: 120 }), /spawnPoint: 막힌 곳/);
  fails((d) => (d.spawnPoint = { x: 2000, y: 120 }), /spawnPoint: 지도 밖/);
  fails((d) => (d.spawnPoint = { x: 310, y: 140 }), /spawnPoint: 막힌 곳·닫힌 문/);
  fails((d) => {
    d.layout.zones = [{ id: 'z1', label: '', x: 400, y: 300, width: 200, height: 200, visibleAfter: 'later' }];
  }, /spawnPoint: 잠긴 구역 안/);
  assert.throws(() => parseStageGeometry([], SIZE, 'bad'), StageGeometryError);
  // shape: 'rect'는 명시해도 된다(다각형을 더할 자리)
  const ok = base();
  ok.layout.blockers[0].shape = 'rect';
  assert.equal(parseStageGeometry(ok, SIZE).blockers.length, 1);
});

test('검증: 서버는 시작 단계(모듈 초기화)와 지역 로드에서 잘못된 지역 JSON을 거부한다 — 실제 데이터 폴더는 통과한다', () => {
  const real = new StoryContentService();
  assert.deepEqual(real.validateStages(), ['forest'], '실제 지역 데이터 전부 통과');
  assert.doesNotThrow(() => real.onModuleInit());

  const dir = mkdtempSync(join(tmpdir(), 'turby-stage-'));
  mkdirSync(join(dir, 'stages'));
  const bad = { ...FOREST_RAW, layout: { ...FOREST_RAW.layout, blockers: [...FOREST_RAW.layout.blockers, { id: 'broken', label: '', x: 10, y: 10, width: -5, height: 10 }] } };
  writeFileSync(join(dir, 'stages', 'forest.json'), JSON.stringify(bad));
  const content = new StoryContentService();
  content.dir = dir;
  assert.throws(() => content.onModuleInit(), (e: unknown) => e instanceof StageGeometryError && /forest/.test(e.message) && /broken/.test(e.message), '서버 시작이 멈춘다');
  assert.throws(() => content.stage('forest'), StageGeometryError, '다시 불러도 조용히 쓰이지 않는다');
  // 방을 만들 때도 같은 파서가 지도 크기(지역 표)까지 넣어 다시 본다: 지도 밖 사각형
  assert.throws(() => collisionOf({ layout: { blockers: [{ id: 'far', label: '', x: 3000, y: 100, width: 400, height: 40 }] } }, 3200, 2400, 'forest'), /지도 밖/);
});

// ---------- 10-06 v1 §5: 공용 패키지 구조 ----------
const REPO = join(__dirname, '..', '..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'docs', 'build'].includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(full);
  }
  return out;
};

test('구조: geometry 구현은 공용 패키지 한 곳에만 있고, BE는 프런트 소스를·프런트는 BE 소스를 참조하지 않는다', () => {
  const files = walk(REPO).filter((f) => f !== __filename); // 이 시험 파일은 검색 문자열을 담고 있다
  const defines = files.filter((f) => /export function parseStageGeometry\b|export function stepWithSolids\b|export function segmentCrosses\b/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(defines.map((f) => f.slice(REPO.length + 1).split(sep).join('/')), ['shared/turby-stage-geometry/src/index.ts'], '구현 파일은 한 벌');
  // 코드의 import·require 경로만 본다(주석의 언급은 제외)
  const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const crossBe = files.filter((f) => f.startsWith(join(REPO, 'BE', 'src')) && importsOf(f).some((p) => /save-a-turby/.test(p)));
  const crossFe = files.filter((f) => f.startsWith(join(REPO, 'save-a-turby', 'src')) && importsOf(f).some((p) => /BE\/|\/BE\b/.test(p)));
  assert.deepEqual([crossBe, crossFe], [[], []]);
  // 기존 경로 호환용 복사본·재노출 파일이 없다
  assert.equal(existsSync(join(REPO, 'BE', 'src', 'turby', 'shared')), false);
});

test('구조: 공용 패키지는 자체 package.json·exports·타입 선언을 가지고 의존성이 없으며, 양쪽 소비자가 의존성으로 선언한다', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'shared', 'turby-stage-geometry', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'turby-stage-geometry');
  assert.equal(pkg.dependencies, undefined, '런타임 의존성 없음(브라우저·Node 공용)');
  assert.deepEqual(Object.keys(pkg.exports['.']).sort(), ['default', 'import', 'require', 'types']);
  for (const rel of [pkg.exports['.'].import, pkg.exports['.'].require, pkg.exports['.'].types]) assert.ok(existsSync(join(REPO, 'shared', 'turby-stage-geometry', rel)), `산출물 ${rel}`);
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.ok(root.workspaces.includes('shared/turby-stage-geometry'), '루트 workspace');
  for (const consumer of ['BE', 'save-a-turby']) assert.equal(JSON.parse(readFileSync(join(REPO, consumer, 'package.json'), 'utf8')).dependencies['turby-stage-geometry'], '*', consumer);
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/turby-stage-geometry']?.resolved, 'shared/turby-stage-geometry', 'lockfile 동기화');
  // 소스 한 벌에서 CJS(서버)와 ESM(프런트)이 같은 계약을 낸다
  const esm = nativeImport(pathToFileURL(join(REPO, 'shared', 'turby-stage-geometry', pkg.exports['.'].import)).href);
  return esm.then((m: Record<string, unknown>) => assert.deepEqual(Object.keys(m).sort(), Object.keys(shared).sort()));
});
