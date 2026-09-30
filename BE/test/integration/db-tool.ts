// 통합 검증용 DB 도구 — 개발 전용(운영 API·앱 번들 아님). BE/.env의 DATABASE_URL에 붙으므로 운영 DB에도 닿을 수 있다.
//
// 목적: 실제 BE + 실제 클라이언트 통합 검증 때 테스트 계정(dev-device-it-*)의 상태를 준비·확인·정리한다.
// 허용 환경: 개발자 PC에서 사람이 직접 실행할 때만. NODE_ENV=production이면 거부한다.
// 사용자 승인: 원격·운영 DB가 대상이면 실행 전에 반드시 사용자 승인을 받는다(대상 호스트/DB는 실행 때 표시된다).
// 앱(src)·npm test·build는 이 파일을 import하지 않는다(test/dev-tools-isolation.test.ts가 검사).
//
// 안전장치(기본은 항상 거부):
//   모든 명령        TURBY_DB_TOOL=enable
//   읽기(check, inspect)       추가 조건 없음
//   픽스처·정리(fixture, legacy, cleanup)  TURBY_DB_TOOL_FIXTURE=allow  + --confirm <명령>:<호스트>/<DB>
//   SQL 적용(apply)           TURBY_DB_TOOL_SQL=allow      + --confirm apply:<호스트>/<DB>
//   대상 계정은 device_uuid가 dev-device-it- 로 시작하는 것만.
//
// 명령:
//   check                    읽기 전용: M1 스키마·아이템 정의·테스트 계정 수
//   inspect <device>         읽기 전용: 테스트 계정의 진행·터비·아이템 요약
//   apply <sql 파일>          주석을 뺀 문장을 하나씩 실행하고 결과만 요약(여러 번 실행해도 안전한 SQL만)
//   fixture <device> <이름>   dust10 = 빛나는 실가루 10개, knot = 첫 매듭 각성 상태, bulk = 일반 아이템 여러 종·가방 터비 여러 마리
//   legacy <device>          구 BE 시절 계정 재현: 진행 행 없음 + 스타터 누비(선반, 무기 장착) + 가방 터비 + 아이템·타레
//   cleanup                  dev-device-it-* 계정과 그 계정의 모든 행 삭제
//
// 예(PowerShell):
//   $env:TURBY_DB_TOOL='enable'; npx ts-node --transpile-only test/integration/db-tool.ts check
//   $env:TURBY_DB_TOOL='enable'; $env:TURBY_DB_TOOL_FIXTURE='allow'; npx ts-node --transpile-only test/integration/db-tool.ts cleanup --confirm cleanup:<호스트>/<DB>
import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const TEST_PREFIX = 'dev-device-it-'; // 프런트 개발 서버 ?device=it-<이름> → dev-device-it-<이름>-account
let prisma: PrismaClient; // 안전장치를 통과한 뒤에만 만든다

type Tier = 'read' | 'fixture' | 'sql';
const TIER: Record<string, Tier> = { check: 'read', inspect: 'read', fixture: 'fixture', legacy: 'fixture', cleanup: 'fixture', apply: 'sql' };

// 연결 대상(호스트/DB)만 뽑는다 — 비밀번호·사용자명·전체 연결 문자열은 다루지 않는다
export function targetOf(url: string | undefined): string {
  if (!url) return '(DATABASE_URL 없음)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '(해석할 수 없는 DATABASE_URL)';
  }
}

// 실행 허가 판정(순수 함수 — 테스트 대상). 통과하면 null, 아니면 거부 사유
export function refusal(cmd: string | undefined, env: Record<string, string | undefined>, argv: string[], target: string): string | null {
  if (env.NODE_ENV === 'production') return 'NODE_ENV=production에서는 실행하지 않습니다';
  if (env.TURBY_DB_TOOL !== 'enable') return 'TURBY_DB_TOOL=enable이 없어 거부합니다(기본은 항상 거부)';
  const tier = cmd ? TIER[cmd] : undefined;
  if (!tier) return '알 수 없는 명령입니다';
  if (tier === 'read') return null;
  if (tier === 'fixture' && env.TURBY_DB_TOOL_FIXTURE !== 'allow') return '픽스처·정리 명령에는 TURBY_DB_TOOL_FIXTURE=allow가 필요합니다';
  if (tier === 'sql' && env.TURBY_DB_TOOL_SQL !== 'allow') return 'SQL 적용 명령에는 TURBY_DB_TOOL_SQL=allow가 필요합니다';
  const i = argv.indexOf('--confirm');
  const confirm = i >= 0 ? argv[i + 1] : undefined;
  if (confirm !== `${cmd}:${target}`) return `확인 값이 필요합니다: --confirm ${cmd}:${target}`;
  return null;
}

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
  const argv = process.argv.slice(2);
  const [cmd, a, b] = argv.filter((x, i) => x !== '--confirm' && argv[i - 1] !== '--confirm');
  loadEnv(); // .env는 직접 실행할 때만 읽는다(판정 함수만 불러가는 테스트는 환경을 건드리지 않음)
  const target = targetOf(process.env.DATABASE_URL);
  console.log(`대상 DB: ${target}`);
  const denied = refusal(cmd, process.env, argv, target);
  if (denied) throw new Error(denied);
  prisma = new PrismaClient();
  if (cmd === 'check') await check();
  else if (cmd === 'apply') await apply(a);
  else if (cmd === 'fixture') await fixture(a, b);
  else if (cmd === 'legacy') await legacy(a);
  else if (cmd === 'inspect') await inspect(a);
  else if (cmd === 'cleanup') await cleanup();
  else throw new Error('명령: check | apply <file> | fixture <device> <dust10|knot|bulk> | legacy <device> | inspect <device> | cleanup');
}

// 직접 실행할 때만 동작(테스트가 판정 함수만 불러갈 때는 아무것도 하지 않는다)
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exitCode = 1;
    })
    .finally(() => void prisma?.$disconnect());
}
