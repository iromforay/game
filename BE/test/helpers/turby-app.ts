// 테스트용 실제 터비 Nest 앱: 컨트롤러·소켓 게이트웨이·서비스는 운영 코드 그대로, DB만 FakeDb.
// integration-live(HTTP·소켓 직접)와 e2e(실제 브라우저·실제 게임 클라이언트)가 같이 쓴다. 운영 DB에는 닿지 않는다.
import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FakeDb } from './fake-prisma';
import { PrismaService } from '../../src/turby/prisma.service';
import { PlayerService } from '../../src/turby/player.service';
import { PlayerController } from '../../src/turby/player.controller';
import { ShopService } from '../../src/turby/shop.service';
import { EquipmentService } from '../../src/turby/equipment.service';
import { ShopController } from '../../src/turby/shop.controller';
import { RoomsService } from '../../src/turby/rooms/rooms.service';
import { RoomsGateway } from '../../src/turby/rooms/rooms.gateway';
import { SettingsService } from '../../src/turby/rooms/settings.service';
import { BattleService } from '../../src/turby/battle/battle.service';
import { BattleGateway } from '../../src/turby/battle/battle.gateway';
import { SessionService } from '../../src/turby/session.service';
import { InventoryService } from '../../src/turby/inventory.service';
import { MeController } from '../../src/turby/me.controller';
import { StoryController } from '../../src/turby/story/story.controller';
import { StoryService } from '../../src/turby/story/story.service';
import { StoryContentService } from '../../src/turby/story/story-content.service';
import { StageAccessService } from '../../src/turby/story/stage-access.service';

// 보존·유예 시간은 짧게(테스트가 끝난 뒤 남은 서버 타이머가 프로세스를 붙잡지 않게)
export const TEST_SETTINGS: Record<string, unknown> = {
  'battle.gridCols': 12, 'battle.gridRows': 8, 'battle.maxAlliedUnits': 5, 'battle.partyStartCol': 1, 'battle.wildStartCol': 10, 'battle.wildStartRow': 4,
  'battle.minDamage': 1, 'battle.defenseDivisor': 2, 'battle.wildHpMult.1': 1, 'battle.wildHpMult.2': 1.5, 'battle.wildHpMult.3': 2, 'battle.wildHpMult.4': 2.5, 'battle.wildHpMult.5': 3,
  'battle.inviteSeconds': 30, 'battle.partySelectSeconds': 30, 'battle.subturnSeconds': 30, 'battle.resolvedRetentionSeconds': 1, 'battle.encounterRadiusPx': 200,
  'room.reconnectGraceMs': 1000, 'move.maxSpeedPxPerSec': 400, 'move.minIntervalMs': 50, 'move.slackPx': 64,
};

// 기본 시드: 장 정의, 등급·캐릭터, M1 아이템 정의(2026-09-29_turby_story_m1_items.sql)와 일반 장비(2026-09-21_shop_equipment.sql) 값
export function seedBase(db: FakeDb, settings: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries({ ...TEST_SETTINGS, ...settings })) db.seed('game_setting', { setting_key: k, value_json: JSON.stringify(v) });
  db.seed('story_chapter', { chapter_order: 1, stage_code: 'forest', clear_character_code: 'nubi', title: '1장 — 숲', map_width: 3200, map_height: 2400 });
  db.seed('story_chapter', { chapter_order: 2, stage_code: 'lake', clear_character_code: 'muldeuli', title: '2장 — 호수', map_width: 2000, map_height: 2000 });
  db.seed('turby_grade', { id: 1, name: '일반', base_attack: 30, base_defense: 6, base_action_power: 4, base_hp: 200 });
  db.seed('turby_grade', { id: 2, name: '약함', base_attack: 1, base_defense: 0, base_action_power: 1, base_hp: 1 });
  db.seed('turby_character', { code: 'nubi', name: '누비', grade_id: 1, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('turby_character', { code: 'bopuli', name: '보풀이', grade_id: 2, atk_mod: 0, def_mod: 0, ap_mod: 0, hp_mod: 0 });
  db.seed('stage_wild_spawn', { stage_code: 'forest', spawn_index: 0, character_code: 'bopuli', x: 1650, y: 2080 });
  db.seed('item_definition', { code: 'glowing_yarn_dust', name: '빛나는 실가루', category: 'mission', max_stack: 99 });
  db.seed('item_definition', { code: 'yarn_tremor_compass', name: '실의 떨림을 찾는 나침판', category: 'mission' });
  db.seed('item_definition', { code: 'first_knot', name: '첫 매듭', category: 'relic', story_slot: 'story_1' });
  db.seed('item_definition', { code: 'water_dye_yarn', name: '물빛 염색실', category: 'relic', story_slot: 'story_2', max_stack: 1 });
  db.seed('item_definition', { code: 'old_cotton_core', name: '오래된 솜심', category: 'relic', story_slot: 'story_3', max_stack: 1 });
  db.seed('item_definition', { code: 'ice_microfiber', name: '얼음 극세사', category: 'relic', story_slot: 'story_4', max_stack: 1 }); // 10-23 C4-3
  db.seed('item_definition', { code: 'knit_needle', name: '뜨개바늘', category: 'equipment', equip_slot: 'weapon', atk_bonus: 2 });
}

export async function startTurbyApp(db: FakeDb, port = 0): Promise<{ app: INestApplication; base: string; port: number }> {
  @Module({
    controllers: [MeController, StoryController, PlayerController, ShopController],
    providers: [
      { provide: PrismaService, useValue: db.client() },
      SettingsService, SessionService, PlayerService, ShopService, EquipmentService, InventoryService,
      RoomsService, RoomsGateway, BattleService, BattleGateway, StoryContentService, StageAccessService, StoryService,
    ],
  })
  class TurbyTestModule {}
  const app = await NestFactory.create(TurbyTestModule, { logger: false });
  app.enableCors();
  await app.listen(port, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  return { app, base: `http://127.0.0.1:${addr.port}`, port: addr.port };
}
