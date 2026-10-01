// E2E 테스트 계정 준비(테스트 격리 FakeDb에 직접). 좌표가 필요한 숨은 길·보스전은 플레이로 위조하지 않고 상태만 만든다.
import type { FakeDb } from '../helpers/fake-prisma';

// 첫 매듭 각성까지 끝난 계정(테스트 격리 DB에 직접 준비 — 좌표가 필요한 숨은 길·보스전은 플레이로 위조하지 않음)
const KNOT_READY_EVENTS = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted', 'forest_first_path_started', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted', 'forest_giant_knot_defeated', 'forest_first_knot_awakened'];
export function seedKnotReady(device: string) {
  return (db: FakeDb) => {
    const player = db.seed('player', { device_uuid: `dev-device-${device}-account`, nickname: '하늘', tare_balance: 100 }) as { id: bigint };
    const nubiChar = db.rows('turby_character', { code: 'nubi' })[0] as { id: number };
    const nubi = db.seed('turby_instance', { owner_player_id: player.id, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true }) as { id: bigint };
    db.seed('player_story_progress', { player_id: player.id, checkpoint: 'CH01_COMPASS_ACQUIRED', story_nubi_turby_instance_id: nubi.id, origin: 'new' });
    for (const e of KNOT_READY_EVENTS) db.seed('player_story_event', { player_id: player.id, event_id: e });
    const def = (code: string) => (db.rows('item_definition', { code })[0] as { id: number }).id;
    const now = new Date();
    db.seed('player_item', { player_id: player.id, item_definition_id: def('yarn_tremor_compass'), quantity: 1, is_new: true, is_locked: true, used_at: now, first_acquired_at: now, last_acquired_at: new Date(now.getTime() - 60_000) });
    db.seed('player_item', { player_id: player.id, item_definition_id: def('first_knot'), quantity: 1, is_new: true, is_locked: true, first_acquired_at: now, last_acquired_at: now });
    db.seed('player_item', { player_id: player.id, item_definition_id: def('knit_needle'), quantity: 1, is_new: true, is_locked: false, first_acquired_at: now, last_acquired_at: new Date(now.getTime() - 120_000) });
  };
}
// 첫 매듭까지 장착한 계정 + 가방 터비 여러 마리 + 가까운 야생 두 곳(약한 보풀이·강한 금빛이)
export function seedExplorer(device: string) {
  return (db: FakeDb) => {
    seedKnotReady(device)(db);
    const player = db.rows('player', { device_uuid: `dev-device-${device}-account` })[0] as { id: bigint };
    const progress = db.rows('player_story_progress', { player_id: player.id })[0] as { checkpoint: string; story_nubi_turby_instance_id: bigint };
    progress.checkpoint = 'CH01_FIRST_KNOT_EQUIPPED';
    db.seed('player_story_event', { player_id: player.id, event_id: 'forest_first_knot_equipped' });
    const knot = (db.rows('item_definition', { code: 'first_knot' })[0] as { id: number }).id;
    db.seed('turby_equipment', { turby_instance_id: progress.story_nubi_turby_instance_id, slot_key: 'story_1', item_definition_id: knot });
    db.seed('turby_grade', { id: 3, name: '강함', base_attack: 500, base_defense: 50, base_action_power: 2, base_hp: 5000 });
    db.seed('turby_character', { code: 'geumbiti', name: '금빛이', grade_id: 3, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
    const bopuli = (db.rows('turby_character', { code: 'bopuli' })[0] as { id: number }).id;
    for (let i = 0; i < 12; i++) db.seed('turby_instance', { owner_player_id: player.id, character_id: bopuli, acquired_via: 'shop' });
    // 좌표는 클라이언트 숲 배치(config/stages/forest.ts)의 5번·3번 자리 — 서버는 (지역, 번호)로 야생 종류와 거리를 판정
    db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 5, character_code: 'bopuli', x: 1400, y: 1800 });
    db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 3, character_code: 'geumbiti', x: 2100, y: 900 });
  };
}


// 상점: 터비 2종 + 장비 5종(총 7개 — 보통 화면 2쪽, 640×360도 2쪽). 가격은 잔액(100) 안쪽·바깥쪽을 섞는다
export function seedShop(db: FakeDb) {
  const extra = [
    { code: 'wool_glove', name: '털장갑', equip_slot: 'armor', def_bonus: 2, description: '방어력이 오르는 포근한 장갑' },
    { code: 'yarn_scarf', name: '실뭉치 목도리', equip_slot: 'armor', hp_bonus: 10, description: '생명력이 오르는 두툼한 목도리' },
    { code: 'lucky_button', name: '행운의 단추', equip_slot: 'accessory', ap_bonus: 1, description: '행동력이 오르는 반짝이는 단추' },
    { code: 'thimble', name: '골무', equip_slot: 'accessory', def_bonus: 1, description: '방어력이 조금 오르는 작은 골무' },
  ];
  for (const e of extra) if (db.rows('item_definition', { code: e.code }).length === 0) db.seed('item_definition', { category: 'equipment', ...e });
  const needle = db.rows('item_definition', { code: 'knit_needle' })[0] as { description: string | null };
  needle.description = '공격력이 오르는 작은 바늘';
  const products: [string, string, number][] = [['turby', 'bopuli', 30], ['item', 'knit_needle', 30], ['item', 'wool_glove', 40], ['item', 'yarn_scarf', 150], ['item', 'lucky_button', 60], ['turby', 'nubi', 500], ['item', 'thimble', 20]];
  products.forEach(([product_type, ref_code, price_tare], i) => db.seed('shop_product', { product_type, ref_code, price_tare, sort_order: i }));
}

// 지역 5곳(클라이언트 data/story.json과 같은 순서·코드) — 지역 선택 화면의 잠금 사유·페이지 확인용
export function seedChapters(db: FakeDb) {
  const more: [number, string, string, string][] = [[3, 'underground', 'pokshini', '3장 — 지하'], [4, 'ice', 'ganeuri', '4장 — 얼음'], [5, 'desert', 'geumbiti', '5장 — 사막']];
  for (const [chapter_order, stage_code, clear_character_code, title] of more) {
    if (db.rows('story_chapter', { stage_code }).length === 0) db.seed('story_chapter', { chapter_order, stage_code, clear_character_code, title, map_width: 2000, map_height: 2000 });
  }
  for (const [code, name] of [['muldeuli', '물들이'], ['pokshini', '폭신이'], ['ganeuri', '가느리'], ['geumbiti', '금빛이']]) {
    if (db.rows('turby_character', { code }).length === 0) db.seed('turby_character', { code, name, grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  }
}

// 보풀이를 구한 직후(실가루 전달 목표가 진행 중)인 계정 — 탐험 맵의 스토리 목표 추적 확인용
export function seedDelivery(device: string) {
  return (db: FakeDb) => {
    const player = db.seed('player', { device_uuid: `dev-device-${device}-account`, nickname: '하늘', tare_balance: 100 }) as { id: bigint };
    const nubiChar = db.rows('turby_character', { code: 'nubi' })[0] as { id: number };
    const nubi = db.seed('turby_instance', { owner_player_id: player.id, character_id: nubiChar.id, acquired_via: 'starter', is_story_companion: true }) as { id: bigint };
    db.seed('player_story_progress', { player_id: player.id, checkpoint: 'CH01_BOPUL_RESCUED', story_nubi_turby_instance_id: nubi.id, origin: 'new' });
    for (const e of KNOT_READY_EVENTS.slice(0, 7)) db.seed('player_story_event', { player_id: player.id, event_id: e });
    const dust = (db.rows('item_definition', { code: 'glowing_yarn_dust' })[0] as { id: number }).id;
    const now = new Date();
    db.seed('player_item', { player_id: player.id, item_definition_id: dust, quantity: 3, is_new: false, is_locked: true, first_acquired_at: now, last_acquired_at: now });
  };
}
