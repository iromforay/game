// 10-01 v2 §1: 선반·가방 이동 동시 요청 — 한 칸에 둘 이상 들어가지 않고, 최종 상태는 하나다.
//
// 이 테스트가 검증하는 것과 검증하지 않는 것:
//  (A) 서비스 결과: 동시에 호출했을 때의 성공·거부 건수와 최종 행 상태. FakeDb는 "같은 행을 FOR UPDATE로 잠근 트랜잭션은
//      차례로 실행된다"는 순서만 메모리로 흉내 낸다 — 실제 InnoDB 행 잠금·격리 수준·교착 감지를 검증하지 않는다.
//  (B) 트랜잭션 경계와 잠금 쿼리: 서비스가 어떤 SQL을 어떤 순서로, 쓰기와 같은 트랜잭션 안에서 보내는지(FakeDb 추적).
// 실제 MariaDB에서의 동시 실행은 이 작업에서 돌리지 않았다(운영·원격 DB 접속 금지).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb } from './helpers/fake-prisma';
import { PlayerService } from '../src/turby/player.service';

function setup() {
  const db = new FakeDb();
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 1, base_defense: 1, base_action_power: 1, base_hp: 1 });
  const ch = db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 }) as { id: number };
  const me = db.seed('player', { device_uuid: 'me', nickname: '나' }) as { id: bigint };
  const other = db.seed('player', { device_uuid: 'other', nickname: '남' }) as { id: bigint };
  const turby = (owner: bigint, extra: Record<string, unknown> = {}) => (db.seed('turby_instance', { owner_player_id: owner, character_id: ch.id, acquired_via: 'shop', ...extra }) as { id: bigint }).id;
  const mine = Array.from({ length: 10 }, () => turby(me.id));
  const nubi = turby(me.id, { is_story_companion: true, acquired_via: 'starter' });
  const theirs = turby(other.id);
  const svc = new PlayerService(db.client(), {} as never);
  const P = String(me.id);
  const slotOf = (id: bigint) => (db.rows('turby_instance', { id })[0] as { base_slot_id: bigint | null }).base_slot_id;
  const inSlot = (index: number) => {
    const slot = db.rows('player_base_slot', { player_id: me.id, slot_index: index })[0] as { id: bigint } | undefined;
    return slot ? db.rows('turby_instance', { base_slot_id: slot.id }).length : 0;
  };
  return { db, svc, P, me, other, mine, nubi, theirs, slotOf, inSlot };
}
const codeOf = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? ((r.reason as { getResponse?: () => { code?: string } }).getResponse?.()?.code ?? (r.reason as Error).message) : 'ok');

test('(A) 같은 빈 칸으로 서로 다른 터비 10건 동시 이동: 성공 1건, 나머지 SHELF_SLOT_OCCUPIED, 칸에는 1마리', async () => {
  const s = setup();
  const results = await Promise.allSettled(s.mine.map((id) => s.svc.moveToShelf(s.P, String(id), 3)));
  const codes = results.map(codeOf);
  assert.equal(codes.filter((c) => c === 'ok').length, 1);
  assert.equal(codes.filter((c) => c === 'SHELF_SLOT_OCCUPIED').length, 9);
  assert.equal(s.inSlot(3), 1, '한 칸에 한 마리');
  assert.equal(s.mine.filter((id) => s.slotOf(id) !== null).length, 1, '거부된 터비는 가방에 그대로');
  assert.equal(s.db.rows('player_base_slot', { player_id: s.me.id }).length, 1, '슬롯 행은 하나');
});

test('(A) 같은 터비를 같은 칸으로 10건 재요청: 모두 성공(멱등), 최종 상태 하나, 갱신은 한 번', async () => {
  const s = setup();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => s.svc.moveToShelf(s.P, String(s.mine[0]), 5)));
  assert.deepEqual(results.map(codeOf), Array(10).fill('ok'));
  assert.equal(s.inSlot(5), 1);
  assert.equal(s.db.trace.filter((t) => t.op === 'update' && t.table === 'turby_instance').length, 1, '이미 그 칸이면 다시 쓰지 않는다');
  const dto = (results[9] as PromiseFulfilledResult<{ locationType: string; slotIndex: number }>).value;
  assert.deepEqual([dto.locationType, dto.slotIndex], ['shelf', 5]);
});

test('(A) 같은 터비를 서로 다른 칸으로 동시 이동: 한 칸에만 있다(둘로 보이지 않음)', async () => {
  const s = setup();
  const results = await Promise.allSettled([0, 1, 2, 3].map((i) => s.svc.moveToShelf(s.P, String(s.mine[0]), i)));
  assert.deepEqual(results.map(codeOf), Array(4).fill('ok'), '빈 칸끼리의 이동은 차례로 모두 성공');
  assert.equal([0, 1, 2, 3].reduce((n, i) => n + s.inSlot(i), 0), 1, '터비는 정확히 한 칸에');
  assert.notEqual(s.slotOf(s.mine[0]), null);
});

test('(A) 가방 이동과 선반 이동이 겹쳐도 최종 상태는 하나(가방이거나 그 칸)', async () => {
  const s = setup();
  await s.svc.moveToShelf(s.P, String(s.mine[0]), 2);
  const results = await Promise.allSettled([s.svc.moveToBag(s.P, String(s.mine[0])), s.svc.moveToShelf(s.P, String(s.mine[0]), 7), s.svc.moveToBag(s.P, String(s.mine[0])), s.svc.moveToShelf(s.P, String(s.mine[0]), 7)]);
  assert.deepEqual(results.map(codeOf), Array(4).fill('ok'));
  const where = s.slotOf(s.mine[0]);
  assert.equal(s.inSlot(2), 0, '원래 칸은 비었다');
  assert.equal(s.inSlot(7), where === null ? 0 : 1, '가방이면 0마리, 선반이면 그 칸에 1마리');
});

test('(A) 점유된 칸은 거부하고 원래 위치를 보존한다(가방에 있던 터비·다른 칸에 있던 터비 모두)', async () => {
  const s = setup();
  await s.svc.moveToShelf(s.P, String(s.mine[0]), 1);
  await s.svc.moveToShelf(s.P, String(s.mine[1]), 4);
  const fromBag = await Promise.allSettled([s.svc.moveToShelf(s.P, String(s.mine[2]), 1)]);
  assert.equal(codeOf(fromBag[0]), 'SHELF_SLOT_OCCUPIED');
  assert.equal(s.slotOf(s.mine[2]), null, '가방 그대로');
  const before = s.slotOf(s.mine[1]);
  const fromShelf = await Promise.allSettled([s.svc.moveToShelf(s.P, String(s.mine[1]), 1)]);
  assert.equal(codeOf(fromShelf[0]), 'SHELF_SLOT_OCCUPIED');
  assert.equal(String(s.slotOf(s.mine[1])), String(before), '원래 칸 그대로');
  assert.equal(s.inSlot(1), 1);
});

test('(A) 트랜잭션 중간 실패 → 전체 롤백: 새로 만든 슬롯 행도 남지 않고 터비는 원래 위치', async () => {
  const s = setup();
  s.db.failOn = (table, op) => table === 'turby_instance' && op === 'update';
  await assert.rejects(s.svc.moveToShelf(s.P, String(s.mine[0]), 9), /강제 실패/);
  s.db.failOn = null;
  assert.equal(s.slotOf(s.mine[0]), null);
  assert.equal(s.db.rows('player_base_slot', { player_id: s.me.id }).length, 0, '같은 트랜잭션에서 만든 슬롯 행도 롤백');
  assert.equal(s.db.trace.at(-1)?.op, 'rollback');
  // 실패 뒤에도 잠금이 남지 않아 다음 요청이 정상 처리된다
  const ok = await s.svc.moveToShelf(s.P, String(s.mine[0]), 9);
  assert.equal(ok.slotIndex, 9);
});

test('(A) 이야기 누비: 선반 이동 허용(확정 설계 — 선반에 있어도 스토리 전투에는 서버가 불러온다), 같은 경합 규칙 적용', async () => {
  const s = setup();
  const dto = await s.svc.moveToShelf(s.P, String(s.nubi), 0);
  assert.deepEqual([dto.locationType, dto.slotIndex], ['shelf', 0]);
  assert.equal((s.db.rows('turby_instance', { id: s.nubi })[0] as { is_story_companion: boolean }).is_story_companion, true, '이야기 누비 표식은 그대로');
  const r = await Promise.allSettled([s.svc.moveToShelf(s.P, String(s.mine[0]), 0)]);
  assert.equal(codeOf(r[0]), 'SHELF_SLOT_OCCUPIED', '누비가 있는 칸도 한 칸에 한 마리');
  assert.equal((await s.svc.moveToBag(s.P, String(s.nubi))).locationType, 'bag');
});

test('(A) 다른 플레이어의 터비·칸에는 닿지 않는다: 남의 터비 403, 내 칸 번호는 내 선반에만 적용', async () => {
  const s = setup();
  const r = await Promise.allSettled([s.svc.moveToShelf(s.P, String(s.theirs), 0), s.svc.moveToBag(s.P, String(s.theirs)), s.svc.moveToShelf(s.P, '999999', 0)]);
  assert.deepEqual(r.map(codeOf), ['NOT_YOUR_TURBY', 'NOT_YOUR_TURBY', 'turby not found']);
  assert.equal(s.db.rows('player_base_slot').length, 0, '거부된 요청은 슬롯 행을 만들지 않는다(롤백)');
  // 상대가 자기 0번 칸을 쓰고 있어도 내 0번 칸과는 별개
  const O = String(s.other.id);
  await s.svc.moveToShelf(O, String(s.theirs), 0);
  const mineDto = await s.svc.moveToShelf(s.P, String(s.mine[0]), 0);
  assert.equal(mineDto.slotIndex, 0);
  assert.equal(s.db.rows('player_base_slot').length, 2, '플레이어마다 따로');
  await assert.rejects(s.svc.moveToShelf(s.P, String(s.mine[1]), 40), /slotIndex/);
  await assert.rejects(s.svc.moveToShelf(s.P, 'abc', 0), (e: { getResponse?: () => { code?: string } }) => e.getResponse?.().code === 'INVALID_ID');
});

test('(B) 트랜잭션 경계·잠금 쿼리: 한 트랜잭션 안에서 플레이어 → 터비 → 슬롯 순서로 FOR UPDATE 뒤에 갱신, 값은 바인딩 변수', async () => {
  const s = setup();
  s.db.trace.length = 0;
  await s.svc.moveToShelf(s.P, String(s.mine[0]), 6);
  const ops = s.db.trace;
  const tx = ops[0].tx;
  assert.equal(ops[0].op, 'begin');
  assert.equal(ops.at(-1)?.op, 'commit');
  assert.ok(ops.every((o) => o.tx === tx), '읽기·잠금·쓰기가 모두 같은 트랜잭션');
  const raws = ops.filter((o) => o.op === 'raw').map((o) => o.sql);
  assert.deepEqual(raws, [
    'SELECT id FROM player WHERE id = ? FOR UPDATE',
    'SELECT id, owner_player_id, base_slot_id FROM turby_instance WHERE id = ? FOR UPDATE',
    'SELECT id FROM player_base_slot WHERE id = ? FOR UPDATE',
  ]);
  const order = ops.map((o) => (o.op === 'raw' ? `lock:${/FROM (\w+)/.exec(o.sql!)![1]}` : `${o.op}${o.table ? `:${o.table}` : ''}`));
  assert.deepEqual(order, ['begin', 'lock:player', 'lock:turby_instance', 'create:player_base_slot', 'lock:player_base_slot', 'update:turby_instance', 'commit']);
  // 가방 이동도 같은 순서(플레이어 → 터비)
  s.db.trace.length = 0;
  await s.svc.moveToBag(s.P, String(s.mine[0]));
  assert.deepEqual(s.db.trace.filter((o) => o.op === 'raw').map((o) => /FROM (\w+)/.exec(o.sql!)![1]), ['player', 'turby_instance']);
  assert.ok(s.db.trace.every((o) => o.tx === s.db.trace[0].tx));
});
