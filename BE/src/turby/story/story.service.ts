import { HttpException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { SettingsService } from '../rooms/settings.service';
import { gameError } from '../turby-dto';
import { StoryContentService } from './story-content.service';
import { addToPlayerItem, usedBagSlots } from './bag';
import { StageAccessService } from './stage-access.service';
import type { StageStatusDto } from './stage-access';
import {
  DEFAULT_NICKNAME,
  ENCOUNTER_BY_KEY,
  EVENT_BY_ID,
  OBJECTIVE_BY_KEY,
  STAGE_CHAPTER,
  STORY_CATEGORIES,
  STORY_NUBI_CHARACTER,
  type Checkpoint,
  type Evidence,
  type ItemGrant,
  type StoryEncounterDef,
  type StoryEventDef,
} from './story-data';
import {
  bagRoomFor,
  chapterCodeOf,
  checkEvent,
  checkObjective,
  nextCheckpoint,
  canProgressChapter,
  resumeOf,
  openingFlags,
  originWithoutRow,
  toCheckpoint,
  validatePlayerName,
  type RuleFailure,
  type StorySnapshot,
} from './story-rules';

type Tx = Prisma.TransactionClient;
type Grant = { itemCode: string; quantity: number; destination: 'bag' | 'story' | 'overflow' };

// 멱등 재요청을 트랜잭션 밖에서 "이미 완료"로 돌려주기 위한 신호
class AlreadyCompleted extends Error {}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export interface StoryStateDto {
  checkpoint: Checkpoint;
  chapterCode: string;
  resume: { segmentId: string | null; tutorial: 'relic_equip' | null };
  needsName: boolean;
  // M3 호환(Codex v13): 서버가 판정한 오프닝 필수/선택. 클라이언트는 추측하지 않고 이 값만 따른다
  openingRequired: boolean;
  openingAvailable: boolean;
  openingStarted: boolean;
  origin: 'new' | 'legacy_backfill';
  playerName: string;
  completedEvents: string[];
  objectives: Record<string, string[]>;
  storyNubi: { turbyId: string; growthStage: number } | null;
  storyNubiMissing: boolean;
  stages: StageStatusDto[]; // 지역 입장·표시 상태(M2: story.stageAccessV2에 따라 신·구 판정)
}

export interface StoryEventResultDto {
  eventId: string;
  alreadyCompleted: boolean;
  grants: Grant[];
  consumed: ItemGrant[];
  story: StoryStateDto;
}

// 스토리 진행·보상·장 개방의 서버 권위 구현(docs/dev/save-a-turby/m0/m0_design.md 3절).
// 멱등성: (player_id, event_id)·(player_id, objective_key, object_id) unique + 체크포인트 조건부 갱신.
// 같은 플레이어의 요청은 프로세스 안에서 한 줄로 세워 불필요한 충돌을 줄인다(최종 방어선은 DB unique).
@Injectable()
export class StoryService {
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly settings: SettingsService,
    private readonly content: StoryContentService,
    private readonly stageAccess: StageAccessService,
  ) {}

  // ---------- 조회 ----------

  async getState(playerId: bigint): Promise<StoryStateDto> {
    const [player, progress, events, objectives] = await Promise.all([
      this.prisma.player.findUnique({ where: { id: playerId } }),
      this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } }),
      this.prisma.player_story_event.findMany({ where: { player_id: playerId } }),
      this.prisma.player_story_objective_progress.findMany({ where: { player_id: playerId } }),
    ]);
    if (!player) throw gameError(404, 'PLAYER_NOT_FOUND', '등록되지 않은 플레이어입니다.');
    const snap = this.snapshotOf(progress, events, objectives);
    // 행이 있으면 저장된 출신(백필 = 기존 계정), 없으면 서버 데이터(보유 터비)로 판정
    const origin = progress ? progress.origin : originWithoutRow(await this.prisma.turby_instance.count({ where: { owner_player_id: playerId } }));
    let storyNubiMissing = false;
    if (progress?.story_nubi_turby_instance_id) {
      const nubi = await this.prisma.turby_instance.findUnique({ where: { id: progress.story_nubi_turby_instance_id } });
      storyNubiMissing = !nubi || nubi.owner_player_id !== playerId;
    } else if (snap.events.has('story_nubi_granted')) {
      storyNubiMissing = true; // SetNull로 연결이 끊긴 경우. 자동 재지급하지 않는다(m0_design 2.3)
    }
    return {
      checkpoint: snap.checkpoint,
      chapterCode: chapterCodeOf(snap.checkpoint),
      resume: resumeOf(snap),
      needsName: !snap.events.has('opening_name_saved') && player.nickname === DEFAULT_NICKNAME,
      ...openingFlags(origin, snap.checkpoint),
      origin,
      playerName: player.nickname,
      completedEvents: [...snap.events].sort(),
      objectives: Object.fromEntries([...snap.objectives].map(([k, v]) => [k, [...v].sort()])),
      storyNubi: progress?.story_nubi_turby_instance_id ? { turbyId: progress.story_nubi_turby_instance_id.toString(), growthStage: progress.nubi_growth_stage } : null,
      storyNubiMissing,
      stages: await this.stageAccess.statuses(playerId),
    };
  }

  // ---------- 이벤트 ----------

  // via='rest': 클라이언트 요청(서버 전용 이벤트 거부). via='server': 전투 확정 등 서버 코드.
  async completeEvent(playerId: bigint, eventId: string, via: 'rest' | 'server' = 'rest'): Promise<StoryEventResultDto> {
    const def = EVENT_BY_ID.get(eventId);
    if (!def) throw gameError(404, 'STORY_EVENT_UNKNOWN', '알 수 없는 스토리 이벤트입니다.');
    if (via === 'rest' && def.serverOnly) throw gameError(403, 'STORY_EVENT_SERVER_ONLY', '이 이벤트는 직접 완료할 수 없습니다.');
    return this.serialize(playerId, () => this.runEvent(playerId, def, null));
  }

  // 오프닝 이름 입력 — 이름 저장과 opening_name_saved 기록을 한 트랜잭션에서
  async saveName(playerId: bigint, rawName: unknown): Promise<StoryEventResultDto> {
    const checked = validatePlayerName(rawName, this.content.bannedNameWords());
    if (!checked.ok) throw new HttpException({ code: 'NAME_INVALID', message: '사용할 수 없는 이름입니다.', reason: checked.reason }, 400);
    return this.serialize(playerId, () => this.runEvent(playerId, EVENT_BY_ID.get('opening_name_saved')!, checked.name));
  }

  // 테스트가 프로세스 내 직렬화를 건너뛰고 DB 방어선만 확인할 수 있게 분리
  async runEvent(playerId: bigint, def: StoryEventDef, name: string | null): Promise<StoryEventResultDto> {
    this.checkPositionEvidence(playerId, def.evidence);
    const grants: Grant[] = [];
    const consumed: ItemGrant[] = [];
    let already = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const { progress, snap } = await this.loadForUpdate(tx, playerId);
        if (snap.events.has(def.id)) {
          if (name !== null) await this.requireSameName(tx, playerId, name);
          throw new AlreadyCompleted();
        }
        this.throwRule(checkEvent(def, snap), snap);

        if (def.evidence.kind === 'name') await this.applyName(tx, playerId, name);

        await tx.player_story_event.create({ data: { player_id: playerId, event_id: def.id } });
        for (const extra of def.alsoComplete ?? []) await tx.player_story_event.create({ data: { player_id: playerId, event_id: extra } });

        for (const c of def.consume ?? []) {
          await this.consumeItem(tx, playerId, c);
          consumed.push(c);
        }
        for (const g of def.grant ?? []) grants.push(await this.grantItem(tx, playerId, g, `story:${def.id}:${g.itemCode}`));
        for (const code of def.markUsed ?? []) await this.markUsed(tx, playerId, code);
        if (def.grantStoryNubi) await this.grantStoryNubi(tx, playerId, progress.story_nubi_turby_instance_id);
        if (def.equipRelic) await this.equipRelic(tx, playerId, progress.story_nubi_turby_instance_id, def.equipRelic.itemCode, def.equipRelic.slotKey);

        const growth = def.equipRelic ? Math.max(snap.growthStage, def.equipRelic.growthStage) : snap.growthStage;
        const to = nextCheckpoint(snap.checkpoint, def.to);
        if (to || growth !== snap.growthStage) {
          // 조건부 갱신: 읽은 뒤 다른 요청이 체크포인트를 바꿨다면 0건 → 전체 롤백
          const updated = await tx.player_story_progress.updateMany({
            where: { player_id: playerId, checkpoint: snap.checkpoint },
            data: { checkpoint: to ?? snap.checkpoint, nubi_growth_stage: growth },
          });
          if (updated.count !== 1) throw gameError(409, 'STORY_STATE_CHANGED', '진행 상태가 바뀌었습니다. 다시 시도하세요.');
        }
      });
    } catch (err) {
      if (err instanceof AlreadyCompleted) already = true;
      // unique 충돌은 "같은 이벤트가 먼저 커밋됨"일 때만 성공으로 본다. 롤백 뒤 실제 이벤트 행을 확인하고,
      // 다른 unique 충돌(보상·장비·보관함 등)은 원래 오류로 전달한다.
      else if (isUniqueViolation(err) && (await this.eventExists(playerId, def.id))) already = true;
      else throw err;
    }
    return { eventId: def.id, alreadyCompleted: already, grants: already ? [] : grants, consumed: already ? [] : consumed, story: await this.getState(playerId) };
  }

  // ---------- 수집 목표 ----------

  async collectObject(playerId: bigint, objectiveKey: string, objectIdRaw: unknown) {
    const def = OBJECTIVE_BY_KEY.get(objectiveKey);
    if (!def) throw gameError(404, 'OBJECTIVE_UNKNOWN', '알 수 없는 목표입니다.');
    if (typeof objectIdRaw !== 'string' || !def.objectIds.includes(objectIdRaw)) throw gameError(404, 'OBJECT_UNKNOWN', '알 수 없는 오브젝트입니다.');
    const objectId = objectIdRaw;
    return this.serialize(playerId, async () => {
      this.checkPositionEvidence(playerId, { kind: 'point', stageCode: def.stageCode, pointId: objectId });
      let already = false;
      let grant: Grant | null = null;
      try {
        await this.prisma.$transaction(async (tx) => {
          const { snap } = await this.loadForUpdate(tx, playerId);
          if (snap.objectives.get(objectiveKey)?.has(objectId)) throw new AlreadyCompleted();
          const failure = checkObjective(def, snap);
          if (failure) throw this.ruleError(failure, snap, 'OBJECTIVE_NOT_ACTIVE');
          await tx.player_story_objective_progress.create({ data: { player_id: playerId, objective_key: objectiveKey, object_id: objectId } });
          if (def.grantPerObject) grant = await this.grantItem(tx, playerId, def.grantPerObject, `objective:${objectiveKey}:${objectId}`);
        });
      } catch (err) {
        if (err instanceof AlreadyCompleted) already = true;
        else if (isUniqueViolation(err) && (await this.objectCollected(playerId, objectiveKey, objectId))) already = true;
        else throw err;
      }
      const collected = await this.prisma.player_story_objective_progress.count({ where: { player_id: playerId, objective_key: objectiveKey } });
      return { objectiveKey, objectId, alreadyCollected: already, collected, required: def.objectIds.length, grants: grant && !already ? [grant] : [] };
    });
  }

  // ---------- 스토리 전투 조우(M4-B) ----------

  // 조우 시작 가능 여부. 전투 서비스가 자기 오류 형식으로 바꾸도록 예외 대신 결과를 돌려준다.
  async encounterAvailability(playerId: bigint, key: string): Promise<{ ok: true; def: StoryEncounterDef; storyNubiId: bigint } | { ok: false; code: string; message: string }> {
    const def = ENCOUNTER_BY_KEY.get(key);
    if (!def) return { ok: false, code: 'STORY_ENCOUNTER_UNKNOWN', message: '알 수 없는 스토리 전투입니다.' };
    const [progress, events] = await Promise.all([
      this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } }),
      this.prisma.player_story_event.findMany({ where: { player_id: playerId } }),
    ]);
    const snap = this.snapshotOf(progress, events, []);
    if (def.onWinEvents.every((e) => snap.events.has(e))) return { ok: false, code: 'STORY_ENCOUNTER_DONE', message: '이미 끝난 전투입니다.' };
    if (!canProgressChapter(def.chapter, snap.checkpoint) || !def.allowedAt.includes(snap.checkpoint) || def.requires.some((r) => !snap.events.has(r))) {
      return { ok: false, code: 'STORY_ENCOUNTER_NOT_AVAILABLE', message: '지금은 시작할 수 없는 전투입니다.' };
    }
    const nubiId = progress?.story_nubi_turby_instance_id ?? null;
    const nubi = nubiId ? await this.prisma.turby_instance.findUnique({ where: { id: nubiId } }) : null;
    if (!nubiId || !nubi || nubi.owner_player_id !== playerId || !nubi.is_story_companion) return { ok: false, code: 'STORY_NUBI_MISSING', message: '이야기 누비를 찾을 수 없습니다.' };
    return { ok: true, def, storyNubiId: nubiId };
  }

  // ---------- 대화·지역 데이터 ----------

  async dialogue(playerId: bigint, chapterCode: string) {
    const chapter = chapterCode === 'opening' ? 0 : /^ch0[1-5]$/.test(chapterCode) ? Number(chapterCode.slice(2)) : -1;
    if (chapter < 0) throw gameError(404, 'DIALOGUE_NOT_FOUND', '대화 데이터가 없습니다.');
    const state = await this.getState(playerId);
    // 스포일러 방지: 진행할 수 있는 장의 대화만 내려준다
    const allowed = chapter === 0 || state.stages.some((s) => STAGE_CHAPTER[s.stageCode] === chapter && s.canProgress);
    if (!allowed) throw gameError(403, 'CHAPTER_LOCKED', '아직 열리지 않은 이야기입니다.');
    const data = this.content.dialogue(chapterCode);
    if (!data) throw gameError(404, 'DIALOGUE_NOT_FOUND', '대화 데이터가 없습니다.');
    return data;
  }

  async stageData(playerId: bigint, stageCode: string) {
    const state = await this.getState(playerId);
    const status = state.stages.find((s) => s.stageCode === stageCode);
    if (!status) throw gameError(404, 'INVALID_STAGE', '존재하지 않는 지역입니다.');
    if (!status.canEnter) throw gameError(403, 'STAGE_LOCKED', '아직 열리지 않은 지역입니다.');
    return this.content.stage(stageCode) ?? { stageCode, regions: [], points: [] };
  }

  // ---------- 내부: 상태 ----------

  private async eventExists(playerId: bigint, eventId: string) {
    return (await this.prisma.player_story_event.count({ where: { player_id: playerId, event_id: eventId } })) > 0;
  }

  private async objectCollected(playerId: bigint, objectiveKey: string, objectId: string) {
    return (await this.prisma.player_story_objective_progress.count({ where: { player_id: playerId, objective_key: objectiveKey, object_id: objectId } })) > 0;
  }

  private snapshotOf(
    progress: { checkpoint: string; nubi_growth_stage: number } | null,
    events: { event_id: string }[],
    objectives: { objective_key: string; object_id: string }[],
  ): StorySnapshot {
    const obj = new Map<string, Set<string>>();
    for (const o of objectives) {
      if (!obj.has(o.objective_key)) obj.set(o.objective_key, new Set());
      obj.get(o.objective_key)!.add(o.object_id);
    }
    return {
      checkpoint: toCheckpoint(progress?.checkpoint ?? 'OPENING_NOT_STARTED'),
      events: new Set(events.map((e) => e.event_id)),
      objectives: obj,
      growthStage: progress?.nubi_growth_stage ?? 0,
    };
  }

  private async loadForUpdate(tx: Tx, playerId: bigint) {
    let progress = await tx.player_story_progress.findUnique({ where: { player_id: playerId } });
    if (!progress) {
      const player = await tx.player.findUnique({ where: { id: playerId } });
      if (!player) throw gameError(404, 'PLAYER_NOT_FOUND', '등록되지 않은 플레이어입니다.');
      const owned = await tx.turby_instance.count({ where: { owner_player_id: playerId } });
      progress = await tx.player_story_progress.create({ data: { player_id: playerId, origin: originWithoutRow(owned) } });
    }
    const [events, objectives] = await Promise.all([
      tx.player_story_event.findMany({ where: { player_id: playerId } }),
      tx.player_story_objective_progress.findMany({ where: { player_id: playerId } }),
    ]);
    return { progress, snap: this.snapshotOf(progress, events, objectives) };
  }

  private throwRule(failure: RuleFailure | null, snap: StorySnapshot) {
    if (failure) throw this.ruleError(failure, snap);
  }

  private ruleError(failure: RuleFailure, snap: StorySnapshot, codeOverride?: string) {
    const status = failure.code === 'CHAPTER_LOCKED' ? 403 : 409;
    const code = failure.code === 'CHAPTER_LOCKED' ? failure.code : (codeOverride ?? failure.code);
    return new HttpException({ code, message: '지금은 진행할 수 없는 이야기입니다.', detail: failure.detail, checkpoint: snap.checkpoint }, status);
  }

  // ---------- 내부: 증거 ----------

  private checkPositionEvidence(playerId: bigint, evidence: Evidence) {
    if (evidence.kind !== 'region' && evidence.kind !== 'point') return;
    const room = this.rooms.roomOf(playerId.toString());
    const pos = room ? this.rooms.memberPosition(room, playerId.toString()) : null;
    if (!room || !pos?.inMap || room.stageCode !== evidence.stageCode) throw gameError(422, 'STORY_EVIDENCE_INVALID', '해당 지역에 있지 않습니다.');
    const stage = this.content.stage(evidence.stageCode);
    const slack = this.settings.numberOr('story.evidenceSlackPx', 48);
    if (evidence.kind === 'region') {
      const r = stage?.regions.find((x) => x.id === evidence.regionId);
      if (!r) throw gameError(500, 'STORY_DATA_MISSING', '지역 스토리 데이터가 없습니다.');
      const inside = pos.x >= r.x - slack && pos.x <= r.x + r.width + slack && pos.y >= r.y - slack && pos.y <= r.y + r.height + slack;
      if (!inside) throw gameError(422, 'STORY_EVIDENCE_INVALID', '아직 그 장소에 도착하지 않았습니다.');
    } else {
      const p = stage?.points.find((x) => x.id === evidence.pointId);
      if (!p) throw gameError(500, 'STORY_DATA_MISSING', '지역 스토리 데이터가 없습니다.');
      if (Math.hypot(pos.x - p.x, pos.y - p.y) > p.radius + slack) throw gameError(422, 'STORY_EVIDENCE_INVALID', '너무 멀리 떨어져 있습니다.');
    }
  }

  // ---------- 내부: 이름 ----------

  private async applyName(tx: Tx, playerId: bigint, name: string | null) {
    const player = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
    if (name !== null) {
      await tx.player.update({ where: { id: playerId }, data: { nickname: name } });
      return;
    }
    // 이름 API가 아닌 이벤트 요청: 기존 계정이 이미 이름을 가진 경우에만 입력을 건너뛴다
    if (player.nickname === DEFAULT_NICKNAME) throw gameError(409, 'STORY_PREREQUISITE_MISSING', '먼저 이름을 입력하세요.');
  }

  private async requireSameName(tx: Tx, playerId: bigint, name: string) {
    const player = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
    if (player.nickname !== name) throw gameError(409, 'NAME_ALREADY_SET', '이미 이름을 정했습니다.');
  }

  // ---------- 내부: 아이템 ----------

  private async itemDef(tx: Tx, code: string) {
    const def = await tx.item_definition.findUnique({ where: { code } });
    if (!def) throw gameError(500, 'STORY_DATA_MISSING', `아이템 정의가 없습니다: ${code}`);
    return def;
  }

  // 이야기 아이템은 칸 검사 없이 항상 지급. 일반 아이템은 40칸을 넘는 수량만 임시 보관함으로 보낸다.
  async grantItem(tx: Tx, playerId: bigint, g: ItemGrant, sourceKey: string): Promise<Grant> {
    const def = await this.itemDef(tx, g.itemCode);
    const isStory = STORY_CATEGORIES.has(def.category);
    const now = new Date();
    const key = { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } };
    const owned = await tx.player_item.findUnique({ where: key });

    let toBag = g.quantity;
    if (def.category === 'relic' && (owned?.quantity ?? 0) >= 1) toBag = 0; // 유물은 한 번만
    if (!isStory && toBag > 0) {
      const used = await usedBagSlots(tx, playerId);
      const room = bagRoomFor(owned?.quantity ?? 0, def.max_stack, used, this.settings.numberOr('inventory.bagCapacity', 40));
      toBag = Math.min(toBag, room);
    }
    const overflow = isStory ? 0 : g.quantity - toBag;

    if (toBag > 0) await addToPlayerItem(tx, playerId, def.id, toBag, now);
    if (overflow > 0) {
      await tx.player_item_overflow.create({ data: { player_id: playerId, item_definition_id: def.id, quantity: overflow, source_key: sourceKey } });
      return { itemCode: g.itemCode, quantity: overflow, destination: 'overflow' };
    }
    return { itemCode: g.itemCode, quantity: toBag, destination: isStory ? 'story' : 'bag' };
  }

  private async consumeItem(tx: Tx, playerId: bigint, c: ItemGrant) {
    const def = await this.itemDef(tx, c.itemCode);
    const res = await tx.player_item.updateMany({
      where: { player_id: playerId, item_definition_id: def.id, quantity: { gte: c.quantity } },
      data: { quantity: { decrement: c.quantity } },
    });
    if (res.count !== 1) throw gameError(409, 'STORY_PREREQUISITE_MISSING', `${def.name}이(가) 부족합니다.`);
  }

  private async markUsed(tx: Tx, playerId: bigint, code: string) {
    const def = await this.itemDef(tx, code);
    await tx.player_item.updateMany({ where: { player_id: playerId, item_definition_id: def.id, used_at: null }, data: { used_at: new Date() } });
  }

  // ---------- 내부: 이야기 누비·유물 ----------

  // 이미 연결된 누비 → 가장 오래된 스타터 누비(기존 계정) → 새로 생성. 선반에 있으면 가방으로 옮긴다(C8: 파티 저장소 없음).
  private async grantStoryNubi(tx: Tx, playerId: bigint, linkedId: bigint | null) {
    let instanceId = linkedId;
    if (instanceId) {
      const linked = await tx.turby_instance.findUnique({ where: { id: instanceId } });
      if (!linked || linked.owner_player_id !== playerId) throw gameError(409, 'STORY_NUBI_MISSING', '이야기 누비를 찾을 수 없습니다.');
    } else {
      const character = await tx.turby_character.findUnique({ where: { code: STORY_NUBI_CHARACTER } });
      if (!character) throw gameError(500, 'STORY_DATA_MISSING', '누비 캐릭터 정의가 없습니다.');
      const starter = await tx.turby_instance.findFirst({
        where: { owner_player_id: playerId, character_id: character.id, acquired_via: 'starter' },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      });
      instanceId = starter
        ? starter.id
        : (await tx.turby_instance.create({ data: { owner_player_id: playerId, character_id: character.id, acquired_via: 'starter' } })).id;
    }
    await tx.turby_instance.update({ where: { id: instanceId }, data: { is_story_companion: true, base_slot_id: null } });
    await tx.player_story_progress.update({ where: { player_id: playerId }, data: { story_nubi_turby_instance_id: instanceId } });
  }

  private async equipRelic(tx: Tx, playerId: bigint, nubiId: bigint | null, itemCode: string, slotKey: string) {
    if (!nubiId) throw gameError(409, 'STORY_NUBI_MISSING', '이야기 누비를 찾을 수 없습니다.');
    const nubi = await tx.turby_instance.findUnique({ where: { id: nubiId } });
    if (!nubi || nubi.owner_player_id !== playerId || !nubi.is_story_companion) throw gameError(409, 'STORY_NUBI_MISSING', '이야기 누비를 찾을 수 없습니다.');
    const def = await this.itemDef(tx, itemCode);
    if (def.category !== 'relic' || def.story_slot !== slotKey) throw gameError(500, 'STORY_DATA_MISSING', '유물 정의가 올바르지 않습니다.');
    const owned = await tx.player_item.findUnique({ where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } } });
    if (!owned || owned.quantity < 1) throw gameError(409, 'STORY_PREREQUISITE_MISSING', '유물을 가지고 있지 않습니다.');
    const current = await tx.turby_equipment.findUnique({ where: { turby_instance_id_slot_key: { turby_instance_id: nubiId, slot_key: slotKey } } });
    if (current) throw gameError(409, 'STORY_SLOT_OCCUPIED', '이미 다른 유물이 장착되어 있습니다.');
    await tx.turby_equipment.create({ data: { turby_instance_id: nubiId, item_definition_id: def.id, slot_key: slotKey } });
    await tx.player_item.update({ where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } }, data: { is_new: false } });
  }

  // ---------- 내부: 직렬화 ----------

  private serialize<T>(playerId: bigint, fn: () => Promise<T>): Promise<T> {
    const key = playerId.toString();
    const prev = this.queues.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }
}
