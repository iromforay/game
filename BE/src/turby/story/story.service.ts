import { HttpException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { SettingsService } from '../rooms/settings.service';
import { gameError } from '../turby-dto';
import { StoryContentService, type StageRect } from './story-content.service';
import { addToPlayerItem, usedBagSlots } from './bag';
import { StageAccessService } from './stage-access.service';
import type { StageStatusDto } from './stage-access';
import {
  DEFAULT_NICKNAME,
  ENCOUNTER_BY_KEY,
  EVENT_BY_ID,
  RELIC_EQUIP_EVENT,
  OBJECTIVE_BY_KEY,
  SEGMENT_AFTER_EVENT,
  SEGMENT_CHAIN_END,
  STAGE_CHAPTER,
  STORY_TRIGGERS,
  STORY_OBJECTIVES,
  FIRST_PATH_INTRO,
  TRIGGER_BY_ID,
  STORY_CATEGORIES,
  STORY_NUBI_CHARACTER,
  STORY_SLOT_PREFIX,
  type Checkpoint,
  type Evidence,
  type ItemGrant,
  type StoryEncounterDef,
  type StoryEventDef,
  type StoryPlayRange,
  type StoryTriggerDef,
} from './story-data';
import {
  bagRoomFor,
  chapterCodeOf,
  checkpointIndex,
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
  // slots: 이야기 누비에 장착된 유물(장착 전 슬롯은 클라이언트가 보유 유물의 story_slot으로 빈 칸 표시)
  storyNubi: { turbyId: string; growthStage: number; slots: { slotKey: string; itemCode: string; name: string }[] } | null;
  storyNubiMissing: boolean;
  stages: StageStatusDto[]; // 지역 입장·표시 상태(M2: story.stageAccessV2에 따라 신·구 판정)
  // 지금 전달을 기다리는 수집 목표(서버 인벤토리 수량 기준, Codex v2 §2.3). 없으면 null
  delivery: { triggerId: string; itemCode: string; have: number; need: number } | null;
}

// 서버가 재생하라고 알려 주는 대화 범위(segmentId부터 endAfter까지 파일 순서대로).
// fromEntry·untilEntry가 있으면 첫 구간은 그 항목부터, 마지막 구간은 그 항목까지만(숲 안의 지점이 한 구간을 나눠 재생)
export interface StoryPlayDto {
  segmentId: string;
  endAfter: string;
  fromEntry?: string;
  untilEntry?: string;
}

// 지역 스토리 화면 데이터 — 이 플레이어에게 지금 보이는 것만 담는다(10-02 v3 §3.4·§4)
export interface StageViewDto {
  stageCode: string;
  greybox: boolean; // 임시 회색상자 배치인가(최종 지도 아님)
  size: { width: number; height: number } | null;
  // 아직 수집하지 않은 오브젝트만. locked = 아직 모을 수 없음(보풀이 구조 전)
  objects: { id: string; objectiveKey: string; x: number; y: number; radius: number; assetKey: string; label: string; prompt: string; state: 'locked' | 'available' }[];
  // 지금 활성화된 이야기 지점만(비활성·완료 지점은 내려 주지 않는다)
  points: { id: string; kind: string; x: number; y: number; radius: number; assetKey: string; label: string; prompt: string }[];
  gates: { id: string; label: string; x: number; y: number; width: number; height: number; open: boolean }[];
  layout: { zones: StageRect[]; paths: number[][][]; blockers: StageRect[] } | null;
  objectives: { key: string; collected: number; required: number; active: boolean }[];
}

export interface StoryTriggerResultDto {
  triggerId: string;
  play: StoryPlayDto | null;
  shortage: { itemCode: string; have: number; need: number } | null;
  story: StoryStateDto;
}

export interface StoryEventResultDto {
  eventId: string;
  alreadyCompleted: boolean;
  grants: Grant[];
  consumed: ItemGrant[];
  story: StoryStateDto;
  play?: StoryPlayDto | null; // 새로 기록했을 때 이어서 재생할 구간(유물 장착 장면 등)
}

const playOf = (range: string | StoryPlayRange | null | undefined): StoryPlayDto | null => {
  if (!range) return null;
  const r = typeof range === 'string' ? { segmentId: range } : range;
  return { segmentId: r.segmentId, endAfter: r.endAfter ?? SEGMENT_CHAIN_END[r.segmentId] ?? r.segmentId, ...(r.fromEntry ? { fromEntry: r.fromEntry } : {}), ...(r.untilEntry ? { untilEntry: r.untilEntry } : {}) };
};

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
      storyNubi: progress?.story_nubi_turby_instance_id
        ? { turbyId: progress.story_nubi_turby_instance_id.toString(), growthStage: progress.nubi_growth_stage, slots: await this.storySlotsOf(progress.story_nubi_turby_instance_id) }
        : null,
      storyNubiMissing,
      stages: await this.stageAccess.statuses(playerId),
      delivery: await this.deliveryOf(playerId, snap),
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
  // evidenceChecked: 호출 쪽(지점 발동)이 요청 도착 시점에 이미 위치 증거를 확인했다 — 줄 서는 동안 움직였어도 다시 따지지 않는다
  async runEvent(playerId: bigint, def: StoryEventDef, name: string | null, evidenceChecked = false): Promise<StoryEventResultDto> {
    if (!evidenceChecked) this.checkPositionEvidence(playerId, def.evidence);
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
        if (def.equipRelic) await this.equipRelicTx(tx, playerId, progress.story_nubi_turby_instance_id, def.equipRelic.itemCode, def.equipRelic.slotKey);

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
    // 문 개방 같은 이동 판정에 바로 반영(탐험 세션 안에 있을 때)
    this.rooms.noteStoryEvents(playerId.toString(), [def.id, ...(def.alsoComplete ?? [])]);
    return { eventId: def.id, alreadyCompleted: already, grants: already ? [] : grants, consumed: already ? [] : consumed, story: await this.getState(playerId), play: already ? null : playOf(SEGMENT_AFTER_EVENT[def.id]) };
  }

  // ---------- 유물 장착(v3 §3) ----------

  // 인벤토리 "누비에게 장착": 클라이언트는 유물 코드만 보낸다. 이벤트·대상(이야기 누비)·체크포인트·보유는 서버가 정하고 검증한다.
  // 재요청은 중복 장착·중복 이벤트 없이 현재 상태(alreadyCompleted)를 돌려준다.
  async equipRelic(playerId: bigint, itemCodeRaw: unknown): Promise<StoryEventResultDto> {
    const eventId = typeof itemCodeRaw === 'string' ? RELIC_EQUIP_EVENT.get(itemCodeRaw) : undefined;
    if (!eventId) throw gameError(404, 'RELIC_UNKNOWN', '이야기 누비에게 장착할 수 있는 유물이 아닙니다.');
    return this.serialize(playerId, () => this.runEvent(playerId, EVENT_BY_ID.get(eventId)!, null));
  }

  // ---------- 트리거(M4-C) ----------

  // 지역 진입(map:enter 성공 뒤): 그 지역의 진입 트리거가 있으면 실행. 없으면 null
  async onStageEntered(playerId: bigint, stageCode: string): Promise<StoryTriggerResultDto | null> {
    const def = STORY_TRIGGERS.find((t) => t.auto && t.stageCode === stageCode);
    return def ? this.trigger(playerId, def.id) : null;
  }

  // 서버가 트리거 위치·진행 조건을 판정하고, 이벤트는 서버 경로로 멱등 기록한다. 재생 구간은 서버가 정한다.
  async trigger(playerId: bigint, triggerIdRaw: unknown): Promise<StoryTriggerResultDto> {
    const def = typeof triggerIdRaw === 'string' ? TRIGGER_BY_ID.get(triggerIdRaw) : undefined;
    if (!def) throw gameError(404, 'STORY_TRIGGER_UNKNOWN', '알 수 없는 이야기 지점입니다.');
    if (!(await this.stageAccess.openingComplete(playerId))) throw gameError(403, 'OPENING_REQUIRED', '먼저 누비와 이야기를 마쳐 주세요.');
    this.checkPositionEvidence(playerId, def.evidence);
    return this.serialize(playerId, () => this.runTrigger(playerId, def));
  }

  private async runTrigger(playerId: bigint, def: StoryTriggerDef): Promise<StoryTriggerResultDto> {
    const done = (play: StoryPlayDto | null, shortage: StoryTriggerResultDto['shortage'] = null) => this.getState(playerId).then((story) => ({ triggerId: def.id, play, shortage, story }));
    const snap = await this.readSnapshot(playerId);
    const rangeOf = (s: StorySnapshot) => (def.play === 'resume' ? this.resumePlay(s, def.stageCode) : playOf(typeof def.play === 'function' ? def.play(s.events) : def.play));

    // 지역 진입: 장 시작 이벤트를 기록할 수 있으면 기록하고, 지금 진행의 복귀 범위를 알려 준다
    if (def.auto) {
      const ev = def.event ? EVENT_BY_ID.get(def.event)! : null;
      if (ev && !snap.events.has(ev.id) && !checkEvent(ev, snap)) {
        const res = await this.runEvent(playerId, ev, null, true);
        return { triggerId: def.id, play: rangeOf(await this.readSnapshot(playerId)), shortage: null, story: res.story };
      }
      return done(rangeOf(snap));
    }

    const recorded = !!def.event && snap.events.has(def.event);
    if (!this.pointOpen(def, snap)) {
      // 완료한 일회성 지점의 재요청: 아무 효과 없이 현재 상태만 돌려준다(다시 재생하지 않음)
      if (recorded || this.pointClosed(def, snap)) return done(null);
      // 아직 활성화되지 않은 지점: 거부
      const failure = def.event ? checkEvent(EVENT_BY_ID.get(def.event)!, snap) : null;
      throw failure ? this.ruleError(failure, snap) : gameError(409, 'STORY_EVENT_NOT_ALLOWED', '지금은 진행할 수 없는 이야기입니다.');
    }

    if (def.event && !recorded) {
      if (def.need) {
        const have = await this.itemQuantity(playerId, def.need.itemCode);
        if (have < def.need.quantity) return done(null, { itemCode: def.need.itemCode, have, need: def.need.quantity });
      }
      const res = await this.runEvent(playerId, EVENT_BY_ID.get(def.event)!, null, true);
      // 동시에 온 같은 요청은 먼저 기록한 쪽만 장면을 재생한다
      return { triggerId: def.id, play: res.alreadyCompleted ? null : rangeOf(snap), shortage: null, story: res.story };
    }
    // 이벤트를 기록하지 않는 지점(전투·이어 보기): 조건만 확인하고 범위를 연다. 진행은 전투 확정·대화 완료 이벤트가 바꾼다
    return done(rangeOf(snap));
  }

  // 지점이 끝났는가(unless의 이벤트가 모두 완료)
  private pointClosed(def: StoryTriggerDef, snap: StorySnapshot): boolean {
    return !!def.unless?.length && def.unless.every((e) => snap.events.has(e));
  }

  // 지점이 지금 활성화돼 있는가 — 지도 표시와 발동 판정이 같은 함수를 쓴다
  private pointOpen(def: StoryTriggerDef, snap: StorySnapshot): boolean {
    if (this.pointClosed(def, snap)) return false;
    if (def.event) {
      const ev = EVENT_BY_ID.get(def.event)!;
      // 완료 기록은 끝났지만 장면을 이어 볼 수 있는 지점(unless가 끝나기 전까지)
      if (snap.events.has(ev.id)) return def.repeatable && !!def.unless?.length;
      return checkEvent(ev, snap) === null;
    }
    const chapter = STAGE_CHAPTER[def.stageCode] ?? 0;
    return canProgressChapter(chapter, snap.checkpoint) && (def.activeAt ?? []).includes(snap.checkpoint) && (def.requires ?? []).every((e) => snap.events.has(e));
  }

  // 지역 진입 때의 복귀 범위(그 지역 장의 구간만). 숲의 첫 길은 걷는 장면만 — 나머지는 숲 안의 지점이 이어 간다
  private resumePlay(snap: StorySnapshot, stageCode: string): StoryPlayDto | null {
    const seg = resumeOf(snap).segmentId;
    if (!seg || STAGE_CHAPTER[stageCode] === undefined || !seg.startsWith(`ch0${STAGE_CHAPTER[stageCode]}.`)) return null;
    if (seg === FIRST_PATH_INTRO.segmentId) return snap.events.has('forest_cut_thread_inspected') ? null : playOf(FIRST_PATH_INTRO);
    return playOf(seg);
  }

  // ---------- 수집 목표 ----------

  async collectObject(playerId: bigint, objectiveKey: string, objectIdRaw: unknown) {
    const def = OBJECTIVE_BY_KEY.get(objectiveKey);
    if (!def) throw gameError(404, 'OBJECTIVE_UNKNOWN', '알 수 없는 목표입니다.');
    if (typeof objectIdRaw !== 'string' || !def.objectIds.includes(objectIdRaw)) throw gameError(404, 'OBJECT_UNKNOWN', '알 수 없는 오브젝트입니다.');
    const objectId = objectIdRaw;
    // 지역 데이터에 놓여 있는(활성화된) 오브젝트만 — 정의에만 있고 지도에 없는 ID는 수집할 수 없다
    if (!this.content.stage(def.stageCode)?.objects?.some((o) => o.id === objectId && o.objectiveKey === objectiveKey)) throw gameError(404, 'OBJECT_UNKNOWN', '알 수 없는 오브젝트입니다.');
    // 위치 증거는 요청이 도착한 지금의 승인 위치로 판정한다(같은 플레이어의 앞선 요청을 기다리는 동안의 이동과 무관 — 순서 일관성)
    this.checkPositionEvidence(playerId, { kind: 'point', stageCode: def.stageCode, pointId: objectId });
    return this.serialize(playerId, async () => {
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
      // stage: 수집 뒤의 지역 화면 상태(남은 오브젝트·목표) — 클라이언트가 한 번의 응답으로 화면을 맞춘다
      return { objectiveKey, objectId, alreadyCollected: already, collected, required: def.objectIds.length, grants: grant && !already ? [grant] : [], stage: await this.stageView(playerId, def.stageCode) };
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

  async stageData(playerId: bigint, stageCode: string): Promise<StageViewDto> {
    const status = (await this.stageAccess.statuses(playerId)).find((s) => s.stageCode === stageCode);
    if (!status) throw gameError(404, 'INVALID_STAGE', '존재하지 않는 지역입니다.');
    if (!status.canEnter) throw gameError(403, 'STAGE_LOCKED', '아직 열리지 않은 지역입니다.');
    return this.stageView(playerId, stageCode);
  }

  // 이 플레이어에게 지금 보이는 지역 스토리 화면: 남은 오브젝트(잠김·수집 가능), 활성 지점, 문 상태, 목표 진행
  private async stageView(playerId: bigint, stageCode: string): Promise<StageViewDto> {
    const data = this.content.stage(stageCode);
    if (!data) return { stageCode, greybox: false, size: null, objects: [], points: [], gates: [], layout: null, objectives: [] };
    const snap = await this.readSnapshot(playerId);
    const at = new Map(data.points.map((p) => [p.id, p]));
    const defs = STORY_OBJECTIVES.filter((o) => o.stageCode === stageCode);
    // 목표가 끝난 뒤(마지막 활성 체크포인트를 지남)에는 남은 오브젝트를 보여 주지 않는다
    const past = (o: (typeof defs)[number]) => checkpointIndex(snap.checkpoint) > Math.max(...o.activeAt.map(checkpointIndex));

    const objects: StageViewDto['objects'] = [];
    for (const o of data.objects ?? []) {
      const def = defs.find((d) => d.key === o.objectiveKey);
      const p = at.get(o.id);
      if (!def || !p || !def.objectIds.includes(o.id) || snap.objectives.get(def.key)?.has(o.id) || past(def)) continue;
      objects.push({ id: o.id, objectiveKey: def.key, x: p.x, y: p.y, radius: p.radius, assetKey: o.assetKey, label: o.label, prompt: o.prompt, state: checkObjective(def, snap) ? 'locked' : 'available' });
    }

    const points: StageViewDto['points'] = [];
    for (const t of STORY_TRIGGERS) {
      if (t.stageCode !== stageCode || t.auto || !this.pointOpen(t, snap)) continue;
      const p = at.get(t.id);
      const look = data.storyPoints?.find((s) => s.id === t.id);
      if (!p || !look) continue;
      points.push({ id: t.id, kind: look.kind, x: p.x, y: p.y, radius: p.radius, assetKey: look.assetKey, label: look.label, prompt: look.prompt });
    }

    const layout = data.layout;
    const shown = (x: { visibleAfter?: string }) => !x.visibleAfter || snap.events.has(x.visibleAfter); // 숨은 구역의 내부 정보는 열린 뒤에만
    return {
      stageCode,
      greybox: data.greybox === true,
      size: data.size ?? null,
      objects,
      points,
      gates: (layout?.gates ?? []).filter(shown).map((g) => ({ id: g.id, label: g.label, x: g.x, y: g.y, width: g.width, height: g.height, open: snap.events.has(g.openEvent) })),
      layout: layout
        ? {
            zones: layout.zones.filter(shown).map((z) => ({ id: z.id, label: z.label, x: z.x, y: z.y, width: z.width, height: z.height })),
            paths: layout.paths.filter(shown).map((path) => path.points),
            blockers: layout.blockers.filter(shown).map((b) => ({ id: b.id, label: b.label, x: b.x, y: b.y, width: b.width, height: b.height })),
          }
        : null,
      objectives: defs.map((d) => ({ key: d.key, collected: snap.objectives.get(d.key)?.size ?? 0, required: d.objectIds.length, active: checkObjective(d, snap) === null })),
    };
  }

  // ---------- 내부: 상태 ----------

  private async storySlotsOf(nubiId: bigint) {
    const rows = await this.prisma.turby_equipment.findMany({ where: { turby_instance_id: nubiId, slot_key: { startsWith: STORY_SLOT_PREFIX } }, include: { item_definition: true } });
    return rows.map((r) => ({ slotKey: r.slot_key, itemCode: r.item_definition.code, name: r.item_definition.name })).sort((a, b) => a.slotKey.localeCompare(b.slotKey));
  }

  private async readSnapshot(playerId: bigint): Promise<StorySnapshot> {
    const [progress, events, objectives] = await Promise.all([
      this.prisma.player_story_progress.findUnique({ where: { player_id: playerId } }),
      this.prisma.player_story_event.findMany({ where: { player_id: playerId } }),
      this.prisma.player_story_objective_progress.findMany({ where: { player_id: playerId } }),
    ]);
    return this.snapshotOf(progress, events, objectives);
  }

  private async itemQuantity(playerId: bigint, itemCode: string): Promise<number> {
    const def = await this.prisma.item_definition.findUnique({ where: { code: itemCode } });
    if (!def) return 0;
    const owned = await this.prisma.player_item.findUnique({ where: { player_id_item_definition_id: { player_id: playerId, item_definition_id: def.id } } });
    return owned?.quantity ?? 0;
  }

  // 전달 트리거 중 지금 이벤트 조건(체크포인트·선행 이벤트)이 맞는 것 — 목표 0/10 표시용
  private async deliveryOf(playerId: bigint, snap: StorySnapshot): Promise<StoryStateDto['delivery']> {
    for (const t of STORY_TRIGGERS) {
      if (!t.need || !t.event || snap.events.has(t.event)) continue;
      if (checkEvent(EVENT_BY_ID.get(t.event)!, snap)) continue;
      return { triggerId: t.id, itemCode: t.need.itemCode, have: await this.itemQuantity(playerId, t.need.itemCode), need: t.need.quantity };
    }
    return null;
  }

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
    if (evidence.kind !== 'region' && evidence.kind !== 'point' && evidence.kind !== 'stage') return;
    const room = this.rooms.roomOf(playerId.toString());
    const pos = room ? this.rooms.memberPosition(room, playerId.toString()) : null;
    if (!room || !pos?.inMap || room.stageCode !== evidence.stageCode) throw gameError(422, 'STORY_EVIDENCE_INVALID', '해당 지역에 있지 않습니다.');
    if (evidence.kind === 'stage') return; // 좌표 확정 전 임시 증거: 그 지역 탐험 세션(맵 입장) 안이면 충분
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
      // 거리만 가깝고 벽·닫힌 문 너머에 있으면 닿지 않는다(10-02 v4 §2.3). pos는 서버가 마지막으로 승인한 위치다
      if (!this.rooms.canReach(room, playerId.toString(), { x: p.x, y: p.y })) throw gameError(422, 'STORY_EVIDENCE_INVALID', '막혀 있어 닿지 않습니다.');
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

    if (toBag > 0) await addToPlayerItem(tx, playerId, def.id, toBag, now, isStory);
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

  private async equipRelicTx(tx: Tx, playerId: bigint, nubiId: bigint | null, itemCode: string, slotKey: string) {
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
