// 통합 검증용 DB 도구(개발 전용 — 운영 API 아님). BE/.env의 DATABASE_URL을 쓰고, 접속 정보는 출력하지 않는다.
// 사용: npx ts-node --transpile-only test/integration/db-tool.ts <명령>
//   check                    읽기 전용: M1 스키마·아이템 정의·테스트 계정 상태
//   apply <sql 파일>          주석을 뺀 문장을 하나씩 실행하고 결과만 요약(여러 번 실행해도 안전한 SQL만)
//   fixture <device> <이름>   테스트 계정(dev-device-it-v4-*)에만: dust10 = 빛나는 실가루 10개, knot = 첫 매듭 각성 상태,
//                            bulk = 일반 아이템 여러 종·가방 터비 여러 마리(페이지 확인용)
//   legacy <device>          구 BE 시절 계정 재현: 진행 행 없음 + 스타터 누비(선반, 무기 장착) + 가방 터비 + 아이템·타레
//   inspect <device>         읽기 전용: 테스트 계정의 진행·터비·아이템 요약
//   cleanup                  dev-device-it-v4-* 계정과 그 계정의 모든 행 삭제
import 'dotenv/config';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const TEST_PREFIX = 'dev-device-it-v4-'; // 프런트 개발 서버 ?device=it-v4-N → dev-device-it-v4-N-account
const prisma = new PrismaClient();

function statements(sql: string): string[] {
  const noComments = sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function check() {
  const cols = (await prisma.$queryRawUnsafe(
    "SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME='player' AND COLUMN_NAME='session_token') OR (TABLE_NAME='turby_instance' AND COLUMN_NAME='is_story_companion') OR (TABLE_NAME='item_definition' AND COLUMN_NAME IN ('max_stack','story_slot')) OR (TABLE_NAME='player_item' AND COLUMN_NAME IN ('first_acquired_at','is_new','is_locked')))",
  )) as { t: string; c: string }[];
  const tables = (await prisma.$queryRawUnsafe(
    "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('player_story_progress','player_story_event','player_story_objective_progress','player_item_overflow')",
  )) as { t: string }[];
  const cat = (await prisma.$queryRawUnsafe("SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='item_definition' AND COLUMN_NAME='category'")) as { ct: string }[];
  const items = (await prisma.$queryRawUnsafe("SELECT code, category FROM item_definition WHERE code IN ('glowing_yarn_dust','yarn_tremor_compass','first_knot')")) as unknown[];
  const testPlayers = (await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM player WHERE device_uuid LIKE '${TEST_PREFIX}%'`)) as { n: bigint }[];
  console.log(JSON.stringify({ m1Columns: cols.map((r) => `${r.t}.${r.c}`), m1Tables: tables.map((r) => r.t), categoryEnum: cat[0]?.ct, storyItems: items, testPlayers: Number(testPlayers[0]?.n ?? 0) }, null, 2));
}

async function apply(file: string) {
  const list = statements(readFileSync(file, 'utf8'));
  let ok = 0;
  for (const [i, s] of list.entries()) {
    try {
      const r = await prisma.$executeRawUnsafe(s);
      ok++;
      console.log(`#${i + 1} ok (${r}) ${s.split('\n')[0].slice(0, 70)}`);
    } catch (e) {
      console.log(`#${i + 1} FAIL ${s.split('\n')[0].slice(0, 70)} :: ${(e as Error).message.split('\n').slice(-1)[0]}`);
      throw e;
    }
  }
  console.log(`${ok}/${list.length} statements applied`);
}

async function testPlayer(device: string) {
  if (!device.startsWith(TEST_PREFIX)) throw new Error(`테스트 계정만 허용(${TEST_PREFIX}*)`);
  const p = await prisma.player.findUnique({ where: { device_uuid: device } });
  if (!p) throw new Error('테스트 계정이 없습니다(먼저 게임에서 접속)');
  return p.id;
}

async function giveItem(playerId: bigint, code: string, quantity: number) {
  const def = await prisma.item_definition.findUniqueOrThrow({ where: { code } });
  const now = new Date();
  await prisma.player_item.upsert({
    where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } },
    create: { player_id: playerId, item_definition_id: def.id, quantity, first_acquired_at: now, last_acquired_at: now, is_new: true, is_locked: ['mission', 'relic', 'memento'].includes(def.category) },
    update: { quantity, last_acquired_at: now, is_new: true },
  });
}

async function fixture(device: string, name: string) {
  const id = await testPlayer(device);
  if (name === 'dust10') {
    await giveItem(id, 'glowing_yarn_dust', 10);
  } else if (name === 'knot') {
    // 첫 매듭 각성까지 끝난 상태(좌표가 필요한 숨은 길·보스전은 실제 플레이로 위조하지 않고, 픽스처로 상태만 만든다)
    const events = ['forest_giant_knot_defeated', 'forest_first_knot_awakened'];
    for (const e of events) await prisma.player_story_event.upsert({ where: { player_id_event_id: { player_id: id, event_id: e } }, create: { player_id: id, event_id: e, source: 'story' }, update: {} });
    await giveItem(id, 'first_knot', 1);
  } else if (name === 'bulk') {
    // 일반 아이템 여러 종(스토리 아이템 제외)과 가방 터비 여러 마리 — 인벤토리·PartySelect 페이지 이동 확인용
    const defs = await prisma.item_definition.findMany({ where: { category: { notIn: ['mission', 'relic', 'memento'] } }, orderBy: { id: 'asc' } });
    for (const [i, d] of defs.entries()) await giveItem(id, d.code, d.max_stack === 1 ? 8 + i : d.max_stack * 2 + 1); // 묶음 한도를 넘겨 칸이 여러 개가 되게
    const chars = await prisma.turby_character.findMany({ where: { code: { not: 'nubi' } }, orderBy: { id: 'asc' }, take: 12 });
    for (const c of chars) await prisma.turby_instance.create({ data: { owner_player_id: id, character_id: c.id, acquired_via: 'shop' } });
    console.log(JSON.stringify({ items: defs.length, turbys: chars.length }));
  } else throw new Error(`알 수 없는 픽스처: ${name}`);
  const progress = await prisma.player_story_progress.findUnique({ where: { player_id: id } });
  const ev = await prisma.player_story_event.findMany({ where: { player_id: id }, select: { event_id: true } });
  console.log(JSON.stringify({ fixture: name, checkpoint: progress?.checkpoint, events: ev.map((e) => e.event_id).sort() }));
}

// 구 BE가 만든 계정 상태(진행 행 없음, 스타터 누비가 선반에 있고 무기 장착, 가방 터비·아이템·타레 보유)
async function legacy(device: string) {
  if (!device.startsWith(TEST_PREFIX)) throw new Error(`테스트 계정만 허용(${TEST_PREFIX}*)`);
  if (await prisma.player.findUnique({ where: { device_uuid: device } })) throw new Error('이미 있는 계정입니다(cleanup 후 다시)');
  const player = await prisma.player.create({ data: { device_uuid: device, nickname: '기존계정', tare_balance: 500 } });
  const slot = await prisma.player_base_slot.create({ data: { player_id: player.id, slot_index: 0 } });
  const nubi = await prisma.turby_character.findUniqueOrThrow({ where: { code: 'nubi' } });
  const other = await prisma.turby_character.findFirstOrThrow({ where: { code: { not: 'nubi' } }, orderBy: { id: 'asc' } });
  const starter = await prisma.turby_instance.create({ data: { owner_player_id: player.id, character_id: nubi.id, acquired_via: 'starter', base_slot_id: slot.id, atk_bonus: 1 } });
  await prisma.turby_instance.create({ data: { owner_player_id: player.id, character_id: other.id, acquired_via: 'wild_capture' } });
  const needle = await prisma.item_definition.findUniqueOrThrow({ where: { code: 'knit_needle' } });
  await prisma.player_item.create({ data: { player_id: player.id, item_definition_id: needle.id, quantity: 1, is_new: false } });
  await prisma.turby_equipment.create({ data: { turby_instance_id: starter.id, slot_key: 'weapon', item_definition_id: needle.id } });
  await inspect(device);
}

async function inspect(device: string) {
  const id = await testPlayer(device);
  const p = await prisma.player.findUniqueOrThrow({ where: { id } });
  const progress = await prisma.player_story_progress.findUnique({ where: { player_id: id } });
  const turbys = await prisma.turby_instance.findMany({ where: { owner_player_id: id }, include: { turby_character: true, turby_equipment: true }, orderBy: { id: 'asc' } });
  const items = await prisma.player_item.findMany({ where: { player_id: id }, include: { item_definition: true } });
  console.log(
    JSON.stringify({
      nickname: p.nickname,
      tare: p.tare_balance,
      progress: progress && { checkpoint: progress.checkpoint, origin: progress.origin, storyNubiIsStarter: progress.story_nubi_turby_instance_id === turbys.find((t) => t.acquired_via === 'starter')?.id },
      turbys: turbys.map((t) => ({ n: t.id === turbys[0].id ? 'first' : 'other', code: t.turby_character.code, via: t.acquired_via, story: t.is_story_companion, shelf: t.base_slot_id !== null, atkBonus: t.atk_bonus, equip: t.turby_equipment.map((e) => e.slot_key) })),
      items: items.map((i) => [i.item_definition.code, i.quantity]),
    }),
  );
}

async function cleanup() {
  const players = await prisma.player.findMany({ where: { device_uuid: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const ids = players.map((p) => p.id);
  if (ids.length === 0) return console.log('정리할 테스트 계정 없음');
  const turbys = await prisma.turby_instance.findMany({ where: { owner_player_id: { in: ids } }, select: { id: true } });
  const tIds = turbys.map((t) => t.id);
  const r: Record<string, number> = {};
  // 테스트 계정이 남긴 전투 기록: 결과 행 → 그 결과만 가리키던 전투 행
  const results = await prisma.battle_result.findMany({ where: { OR: [{ player_id: { in: ids } }, { opponent_player_id: { in: ids } }] }, select: { battle_id: true } });
  const battleIds = [...new Set(results.map((x) => x.battle_id).filter((x): x is bigint => x !== null))];
  r.battle_result = (await prisma.battle_result.deleteMany({ where: { OR: [{ player_id: { in: ids } }, { opponent_player_id: { in: ids } }] } })).count;
  const stillUsed = new Set((await prisma.battle_result.findMany({ where: { battle_id: { in: battleIds } }, select: { battle_id: true } })).map((x) => String(x.battle_id)));
  r.coop_battle = (await prisma.coop_battle.deleteMany({ where: { id: { in: battleIds.filter((b) => !stillUsed.has(String(b))) } } })).count;
  r.shop_purchase = (await prisma.shop_purchase.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.market_listing = (await prisma.market_listing.deleteMany({ where: { OR: [{ seller_player_id: { in: ids } }, { buyer_player_id: { in: ids } }] } })).count;
  r.account_game_player = (await prisma.account_game_player.deleteMany({ where: { game: 'turby', player_id: { in: ids } } })).count;
  r.turby_equipment = (await prisma.turby_equipment.deleteMany({ where: { turby_instance_id: { in: tIds } } })).count;
  r.player_story_event = (await prisma.player_story_event.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.player_story_objective_progress = (await prisma.player_story_objective_progress.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.player_story_progress = (await prisma.player_story_progress.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.player_item_overflow = (await prisma.player_item_overflow.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.player_item = (await prisma.player_item.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.turby_instance = (await prisma.turby_instance.deleteMany({ where: { id: { in: tIds } } })).count;
  r.player_base_slot = (await prisma.player_base_slot.deleteMany({ where: { player_id: { in: ids } } })).count;
  r.player = (await prisma.player.deleteMany({ where: { id: { in: ids } } })).count;
  console.log(JSON.stringify({ cleaned: r }));
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'check') await check();
  else if (cmd === 'apply') await apply(a);
  else if (cmd === 'fixture') await fixture(a, b);
  else if (cmd === 'legacy') await legacy(a);
  else if (cmd === 'inspect') await inspect(a);
  else if (cmd === 'cleanup') await cleanup();
  else throw new Error('명령: check | apply <file> | fixture <device> <dust10|knot|bulk> | legacy <device> | inspect <device> | cleanup');
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
