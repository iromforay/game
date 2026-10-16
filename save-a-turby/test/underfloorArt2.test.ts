// 10-16 3장 2차 에셋 연결(C3-5) — 파일·키·크기·알파·해시(Codex delivery-v2 manifest), 시트 프레임 계약, 전투 표시 연결, 지도 소품·오버레이 계약
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

// [키, 런타임 경로, 너비, 높이, SHA-256(Codex delivery-v2 manifest)] — 모두 투명 PNG
const ASSETS: [string, string, number, number, string][] = [
  ['pressed-sewn-doll-idle', 'sprites/enemies/pressed-sewn-doll-idle.png', 640, 160, 'D091A246607FF78E19C2EC0D89848DA53FA6D9EB1A7B745C39E3A7614BA515BE'],
  ['pressed-sewn-doll-exposed', 'sprites/enemies/pressed-sewn-doll-exposed.png', 640, 160, '906B98A74F21F42E6858BF38012FB925155A2D6C77B659B88C4BF1934F2FF93E'],
  ['small-spool-idle', 'sprites/enemies/small-spool-idle.png', 512, 128, '0396B7C1123C29743A56764409B8B2FD58BA8393F89B2168DE5347A3DB5D2265'],
  ['carrier-thread', 'sprites/enemies/carrier-thread.png', 128, 128, '5DB5116F2B0FA20CDB610282526B12021C8E8E90F4657F1FA30FD0FFAAB4A295'],
  ['memory-spool-idle', 'sprites/bosses/memory-spool-idle.png', 1024, 256, '638694F6E4EF4AC1CDAABEA846AB9FC42440D1CB89EEC47C67B3CDB0AE3AF027'],
  ['memory-spool-exposed', 'sprites/bosses/memory-spool-exposed.png', 1024, 256, '693562AA9C0C9D39B590CA291478676A3C3FB941A0C62EC15082343609F95642'],
  ['memory-thread', 'sprites/enemies/memory-thread.png', 640, 128, '5758F5B872D8F0BF698B144FA67BFE7DE09221E45E5039E96F420B1DD42F2255'],
  ['memory-thread-hint', 'sprites/enemies/memory-thread-hint.png', 128, 128, 'AA75217E2B2E65F2C60E047DBBD9DF1C30BA11D3B93D5507D90E2A20813B2E30'],
  ['old-cotton-core', 'items/relics/old-cotton-core.png', 160, 160, 'A81810F36CDC94DC37EBB7C78FE8FC74B250270A27113F8D17867E07F8BFFBFB'],
  ['ambush-pile', 'world/underfloor/props/ambush-pile.png', 512, 512, '60985A1555A7D7E902E2C8FFD309A70266E8886B9CC98B1C78837014557EEEB6'],
  ['boss-entrance-mark', 'world/underfloor/props/boss-entrance-mark.png', 512, 512, '3B5A4CFBCD938F639EAC9353A873A70AB5680CDB867872B7ABF282DB0A680E3D'],
  ['boss-arena-overlay', 'world/underfloor/overlays/boss-arena-overlay.png', 1400, 1200, '42D2AF04830B4D792D990F10F24134C2AEC96E6E621CEAEEDAFCFDBF2E9EBE05'],
  ['memory-fragment', 'fx/story/memory-fragment.png', 768, 768, '89D1B4E1AF96D5D3D998C458E955A175A822CE1894DBDF9431BF8ADDA5885EDF'],
  ['silver-thread', 'fx/story/silver-thread.png', 768, 768, '416BC908A79C2BDAF86CCD5F5A01C8D74E3E91C5AC79F5FFCA8D389B360956E3'],
];

test('2차 에셋 14종: 파일·키(파일명)·크기·투명·해시가 Codex delivery-v2 manifest와 같다', () => {
  const keys = new Set<string>();
  for (const [key, rel, w, h, hash] of ASSETS) {
    const file = here(`../src/assets/${rel}`);
    assert.ok(existsSync(file), `${key} 파일`);
    assert.equal(rel.split('/').pop(), `${key}.png`, `${key}: 키 = 파일명`);
    assert.equal(keys.has(key), false, `${key} 중복`);
    keys.add(key);
    const bytes = readFileSync(file);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [w, h], `${key} 크기`);
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, `${key} 해시`);
    assert.ok(bytes[25] === 6 || bytes[25] === 4 || bytes.includes(Buffer.from('tRNS')), `${key} 투명`);
  }
  assert.equal(keys.size, 14);
});

test('시트 프레임 계약: 등록된 프레임 크기 × 프레임 수 = 시트 폭, 두 상태 시트는 같은 프레임 크기·수', () => {
  // registry.ts는 vite 전용 import.meta.glob을 쓰므로 node에서는 소스 문자열로 확인한다
  const reg = readFileSync(here('../src/assets/registry.ts'), 'utf8');
  const frame = (key: string) => {
    const m = reg.match(new RegExp(`'${key}': \\{ size: (\\d+), frames: (\\d+), fps: (\\d+) \\}`));
    assert.ok(m, `${key} 시트 등록`);
    return { size: Number(m![1]), frames: Number(m![2]), fps: Number(m![3]) };
  };
  const width = Object.fromEntries(ASSETS.map(([k, , w, h]) => [k, { w, h }]));
  for (const key of ['pressed-sewn-doll-idle', 'pressed-sewn-doll-exposed', 'small-spool-idle', 'memory-spool-idle', 'memory-spool-exposed', 'memory-thread']) {
    const f = frame(key);
    assert.equal(f.size * f.frames, width[key].w, `${key} 폭`);
    assert.equal(f.size, width[key].h, `${key} 높이 = 프레임 크기`);
  }
  assert.deepEqual(frame('pressed-sewn-doll-idle'), frame('pressed-sewn-doll-exposed'));
  assert.deepEqual(frame('memory-spool-idle'), frame('memory-spool-exposed'));
  assert.deepEqual([frame('memory-thread').frames, frame('memory-thread').fps], [5, 0], '기억실 5가닥은 재생하지 않는 프레임');
  // 전투 정의의 characterCode → 시트
  for (const [code, key] of [['pressed_sewn_doll', 'pressed-sewn-doll-idle'], ['small_spool', 'small-spool-idle'], ['memory_spool', 'memory-spool-idle']]) assert.match(reg, new RegExp(`${code}: '${key}'`), `${code} → ${key}`);
});

test('전투 표시 연결: 보스 결박/노출, 눌린 박음이 납작/노출 교체, 기억실 프레임 = 가닥 번호, 다음 실 빛무리는 기억실 아래에 중첩', () => {
  const scene = readFileSync(here('../src/scenes/BattleScene.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(scene, /memory_spool: \{ idle: 'memory-spool-idle', exposed: 'memory-spool-exposed' \}/);
  assert.match(scene, /pressed_sewn_doll: \{ flat: 'pressed-sewn-doll-idle', exposed: 'pressed-sewn-doll-exposed' \}/);
  assert.match(scene, /u\.flat === false \? sheets\.exposed : sheets\.flat/, '서버 flat 값으로만 교체');
  assert.match(scene, /this\.add\.sprite\(0, 0, THREAD_SHEET, Math\.max\(0, Math\.min\(4, Number\(threadNumber\(u\)\) - 1\)\)\)/, '기억실 프레임 = 가닥 번호 - 1');
  assert.match(scene, /const show = !!u\.hinted && !isHiddenUnit\(u\)/, '빛무리는 서버 hinted 값 그대로, 끊긴 실에는 없음');
  assert.match(scene, /view\.container\.addAt\(mark, 0\)/, '빛무리는 실 그림 아래');
  // 전투 정의의 기억실 unitId는 thread_1~5(가닥 번호 = 마지막 글자)
  const boss = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/battles/underfloor_boss_memory_spool.json'), 'utf8')) as { units: { unitId: string; characterCode: string }[] };
  assert.deepEqual(boss.units.filter((u) => u.characterCode === 'memory_thread').map((u) => u.unitId), ['thread_1', 'thread_2', 'thread_3', 'thread_4', 'thread_5']);
});

test('지도 소품·오버레이 계약: 매복 더미·보스 입구 표식 120×120 피벗 (0.5,0.7), 보스 공간 오버레이 (2450,140) 700×600 알파 0.8(지도 안)', () => {
  const UG = JSON.parse(readFileSync(here('../../BE/story-data/save-a-turby/stages/underground.json'), 'utf8')) as {
    size: { width: number; height: number };
    storyPoints: { id: string; assetKey: string; art: { width: number; height: number; pivot: [number, number] } }[];
    render: { overlays: Record<string, unknown>[] };
  };
  const art = (id: string) => UG.storyPoints.find((p) => p.id === id)!;
  for (const [id, key] of [['underfloor_ambush', 'ambush-pile'], ['underfloor_boss_entrance', 'boss-entrance-mark']]) {
    const p = art(id);
    assert.deepEqual([p.assetKey, p.art.width, p.art.height, p.art.pivot], [key, 120, 120, [0.5, 0.7]], id);
  }
  const arena = UG.render.overlays.find((o) => o.assetKey === 'boss-arena-overlay')!;
  assert.deepEqual([arena.x, arena.y, arena.width, arena.height, arena.pivot, arena.alpha], [2450, 140, 700, 600, [0, 0], 0.8]);
  assert.ok((arena.x as number) + (arena.width as number) <= UG.size.width && (arena.y as number) + (arena.height as number) <= UG.size.height, '지도 안');
});
