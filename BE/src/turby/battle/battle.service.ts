import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { StageAccessService } from '../story/stage-access.service';
import { OPENING_REQUIRED_HINT } from '../story/stage-access';
import { StoryService } from '../story/story.service';
import { StoryContentService } from '../story/story-content.service';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { SettingsService } from '../rooms/settings.service';
import { INSTANCE_INCLUDE, baseStatsOf, toTurbyDto } from '../turby-dto';
import type { Room } from '../rooms/types';
import { applyAction, closeInvites, closePartySelect, createBattle, expireSubturn, removeParticipant, respondInvite, setConnected, submitParty, toSnapshot } from './battle-engine';
import { BattleError } from './battle-types';
import type { ActionRequest, BattleEvent, BattleRules, BattleSnapshotDto, BattleState } from './battle-types';

export interface RewardDto {
  playerId: string;
  rewardStatus: 'granted' | 'none';
  reason: string | null;
  capturedTurbyInstanceId: string | null;
  capturedTurby: ReturnType<typeof toTurbyDto> | null;
}

export interface EndedDto {
  outcome: string;
  rewards: RewardDto[];
  settled: boolean; // false = 보상 기록에 실패해 재시도 대기 중(스냅샷 재요청 시 다시 시도)
}

export interface BattleResponse {
  version: number;
  events: BattleEvent[];
  snapshot: BattleSnapshotDto;
  ended: EndedDto | null;
}

interface BattleRecord {
  state: BattleState;
  responses: Map<string, BattleResponse>; // actionId → 최초 응답(중복 전송은 그대로 재사용)
  ended: EndedDto | null;
  settled: boolean;
  queue: Promise<unknown>;
  cleanup: NodeJS.Timeout | null;
  timer: NodeJS.Timeout | null; // 초대·파티 선택·서브턴 마감(파티 선택·서브턴은 참전자 2명 이상일 때만)
  timerKey: string | null;
  // M4-B 스토리 전투: 포획·야생 보상 없음, 승리 시 onWinEvents를 서버 경로로 기록, 이야기 누비 필수 편성
  story: { encounterKey: string; onWinEvents: string[]; storyNubiId: string } | null;
}

const ACTION_ID_MAX = 64;

// 4-B: 서버 권위 전투 관리. 엔진(battle-engine)은 순수 규칙만 다루고, 이 서비스가 소유권·파티 검증(DB), 멱등 처리(actionId),
// 버전 검사, 보상 지급 트랜잭션(중복 방지), 이탈 연동을 맡는다. 전투는 메모리에만 있고 서버가 재시작되면 사라진다(BATTLE_EXPIRED).
// events: 'battle:update'(state, payload, actorPlayerId | null), 'battle:invite'(state, inviteePlayerIds)
@Injectable()
export class BattleService implements OnModuleInit {
  readonly events = new EventEmitter();
  private readonly log = new Logger(BattleService.name);
  private battles = new Map<string, BattleRecord>();
  private battleOfPlayer = new Map<string, string>();
  private injectedSettleFailures = Number(process.env.BATTLE_SETTLE_FAIL_COUNT ?? 0) || 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rooms: RoomsService,
    private readonly stageAccess: StageAccessService,
    private readonly story: StoryService,
    private readonly content: StoryContentService,
  ) {}

  onModuleInit() {
    // 방에서 나가거나 재접속 유예가 끝난 참전자는 전투에서도 이탈 처리, 연결 끊김/복귀는 away 표시에 반영
    this.rooms.events.on('member:removed', (_room: Room, playerId: string, _wasInMap: boolean, reason: string) => {
      const record = this.recordOfPlayer(playerId);
      if (record) void this.enqueue(record, async () => this.publish(record, removeParticipant(record.state, playerId, reason), null));
    });
    this.rooms.events.on('room:state', (room: Room) => {
      for (const m of room.members) {
        const record = this.recordOfPlayer(m.playerId);
        if (record && record.state.roomCode === room.code) void this.enqueue(record, async () => this.publish(record, setConnected(record.state, m.playerId, m.connected), null));
      }
    });
  }

  // ---------- 시작·파티 ----------

  // 맵에서 야생 터비와 조우 — 서버가 방의 야생 상태(마커 번호)를 확인해 소유권을 선점하고 전투를 만든다.
  // 같은 방에서 맵에 있는 다른 사람들에게는 참전 초대가 나간다(혼자면 바로 파티 선택).
  async start(playerId: string, spawnIndexRaw: unknown): Promise<BattleSnapshotDto> {
    // v15: 오프닝 완료 전에는 야생 조우·전투를 시작할 수 없다(탐험 세션이 남아 있어도)
    if (!(await this.stageAccess.openingComplete(BigInt(playerId)))) throw new BattleError('OPENING_REQUIRED', OPENING_REQUIRED_HINT);
    const existing = this.recordOfPlayer(playerId);
    if (existing) return toSnapshot(existing.state); // 이미 진행 중인 전투(초대 받은 상태 포함)가 있으면 그대로 이어서(중복 요청 안전)

    const room = this.rooms.roomOf(playerId);
    if (!room) throw new BattleError('NOT_IN_ROOM', '참여 중인 방이 없습니다.');
    if (room.phase !== 'playing') throw new BattleError('ROOM_NOT_STARTED', '방이 아직 시작되지 않았습니다.');
    const pos = this.rooms.memberPosition(room, playerId);
    if (!pos?.inMap) throw new BattleError('NOT_IN_MAP', '맵에 입장하지 않았습니다.');
    if (!Number.isInteger(spawnIndexRaw)) throw new BattleError('INVALID_PAYLOAD', '조우 대상이 올바르지 않습니다.');
    const wildRow = room.wilds.find((w) => w.index === spawnIndexRaw);
    if (!wildRow) throw new BattleError('INVALID_SPAWN', '이 지역에 없는 야생 터비입니다.');
    if (wildRow.state === 'engaged') throw new BattleError('WILD_ENGAGED', '다른 사람이 이미 교전 중인 야생 터비입니다.');
    if (wildRow.state !== 'free') throw new BattleError('WILD_GONE', '이미 사라진 야생 터비입니다.');
    if (Math.hypot(pos.x - wildRow.x, pos.y - wildRow.y) > this.settings.number('battle.encounterRadiusPx')) throw new BattleError('TOO_FAR', '야생 터비와 너무 멀리 떨어져 있습니다.');

    const wild = await this.prisma.turby_character.findUnique({ where: { code: wildRow.characterCode }, include: { turby_grade: true } });
    if (!wild) throw new BattleError('INVALID_SPAWN', '야생 터비 정보를 찾을 수 없습니다.');
    // await 사이에 다른 요청이 이 야생이나 이 플레이어를 선점했는지 다시 확인한다. 이 아래는 await가 없어 선점이 한 번에 일어난다.
    const raced = this.recordOfPlayer(playerId);
    if (raced) return toSnapshot(raced.state);
    if (wildRow.state !== 'free') throw new BattleError(wildRow.state === 'engaged' ? 'WILD_ENGAGED' : 'WILD_GONE', '다른 사람이 먼저 조우했습니다.');

    // 초대 대상: 같은 방에서 맵에 있고 연결 중이며 다른 전투에 묶이지 않은 사람. 슬롯은 방 입장 순서로 고정.
    const participants = room.members
      .map((m, i) => ({ m, slot: i + 1 }))
      .filter(({ m }) => m.playerId === playerId || (m.inMap && m.connected && !this.recordOfPlayer(m.playerId)))
      .map(({ m, slot }) => ({ playerId: m.playerId, nickname: m.nickname, slot, connected: m.connected, invited: m.playerId !== playerId }));

    const state = createBattle({
      battleId: randomUUID().replace(/-/g, ''),
      roomCode: room.code,
      stageCode: room.stageCode,
      spawnIndex: wildRow.index,
      encounterPlayerId: playerId,
      wild: { code: wild.code, name: wild.name, stats: baseStatsOf(wild) },
      rules: this.rules(),
      participants,
    });
    const record: BattleRecord = { state, responses: new Map(), ended: null, settled: false, queue: Promise.resolve(), cleanup: null, timer: null, timerKey: null, story: null };
    this.battles.set(state.battleId, record);
    for (const p of participants) this.battleOfPlayer.set(p.playerId, state.battleId);
    this.rooms.setWildState(room, wildRow.index, 'engaged', state.battleId);
    this.armTimer(record);
    const invitees = participants.filter((p) => p.invited).map((p) => p.playerId);
    if (invitees.length > 0) this.events.emit('battle:invite', state, invitees);
    return toSnapshot(state);
  }

  // ---------- 스토리 전투(M4-B) ----------

  // 탐험 세션 안에서만 시작한다. 시작 가능 여부(체크포인트·선행 이벤트·이미 이긴 전투)와 이야기 누비는 서버가 확인한다.
  // 같은 전투가 진행 중이면 그대로 이어서 돌려준다(재요청·재접속 안전). 야생 마커·포획과 무관하다.
  async startStory(playerId: string, encounterKeyRaw: unknown): Promise<BattleSnapshotDto> {
    if (!(await this.stageAccess.openingComplete(BigInt(playerId)))) throw new BattleError('OPENING_REQUIRED', OPENING_REQUIRED_HINT);
    if (typeof encounterKeyRaw !== 'string' || !/^[a-z0-9_]{1,64}$/.test(encounterKeyRaw)) throw new BattleError('INVALID_PAYLOAD', '전투 정보가 올바르지 않습니다.');
    const key = encounterKeyRaw;
    const existing = this.recordOfPlayer(playerId);
    if (existing) {
      if (existing.story?.encounterKey === key) return toSnapshot(existing.state);
      throw new BattleError('ALREADY_IN_BATTLE', '진행 중인 전투가 있습니다.');
    }

    const room = this.rooms.roomOf(playerId);
    if (!room) throw new BattleError('NOT_IN_ROOM', '참여 중인 방이 없습니다.');
    if (room.phase !== 'playing') throw new BattleError('ROOM_NOT_STARTED', '방이 아직 시작되지 않았습니다.');
    if (!this.rooms.memberPosition(room, playerId)?.inMap) throw new BattleError('NOT_IN_MAP', '맵에 입장하지 않았습니다.');

    const available = await this.story.encounterAvailability(BigInt(playerId), key);
    if (!available.ok) throw new BattleError(available.code, available.message);
    if (room.stageCode !== available.def.stageCode) throw new BattleError('STORY_ENCOUNTER_NOT_AVAILABLE', '이 지역에서 시작할 수 없는 전투입니다.');
    const definition = this.content.battle(key);
    if (!definition) throw new BattleError('STORY_DATA_MISSING', '전투 정의 데이터가 없습니다.');

    const raced = this.recordOfPlayer(playerId); // await 사이에 다른 요청이 전투를 만든 경우
    if (raced) return toSnapshot(raced.state);
    const member = room.members.find((m) => m.playerId === playerId)!;
    const state = createBattle({
      battleId: randomUUID().replace(/-/g, ''),
      roomCode: room.code,
      stageCode: room.stageCode,
      spawnIndex: -1, // 야생 마커 없음
      encounterPlayerId: playerId,
      wild: { code: key, name: key, stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 1 } },
      rules: this.rules(),
      participants: [{ playerId, nickname: member.nickname, slot: 1, connected: member.connected }],
      definition,
    });
    const record: BattleRecord = { state, responses: new Map(), ended: null, settled: false, queue: Promise.resolve(), cleanup: null, timer: null, timerKey: null, story: { encounterKey: key, onWinEvents: available.def.onWinEvents, storyNubiId: available.storyNubiId.toString() } };
    this.battles.set(state.battleId, record);
    this.battleOfPlayer.set(playerId, state.battleId);
    this.armTimer(record);
    return toSnapshot(state);
  }

  // 초대 응답(참전/불참). 응답이 모두 모이면 파티 선택으로 넘어간다.
  async respond(playerId: string, battleId: unknown, join: unknown): Promise<BattleResponse> {
    const record = this.requireRecord(battleId);
    return this.enqueue(record, async () => this.publish(record, respondInvite(record.state, playerId, join), playerId));
  }

  async party(playerId: string, battleId: unknown, turbyIdsRaw: unknown): Promise<BattleResponse> {
    const record = this.requireRecord(battleId);
    return this.enqueue(record, async () => {
      this.requireParticipant(record, playerId);
      if (!Array.isArray(turbyIdsRaw) || turbyIdsRaw.some((id) => typeof id !== 'string' || !/^\d{1,20}$/.test(id))) throw new BattleError('INVALID_PAYLOAD', '파티 목록이 올바르지 않습니다.');
      const ids = turbyIdsRaw as string[];
      if (new Set(ids).size !== ids.length) throw new BattleError('PARTY_NOT_OWNED', '같은 터비를 두 번 고를 수 없습니다.');

      // 스토리 전투: 이야기 누비는 보관(선반) 중이어도 자동으로 맨 앞에 편성되고 파티 한 칸을 쓴다(D6)
      const nubiId = record.story?.storyNubiId ?? null;
      if (nubiId && !ids.includes(nubiId)) ids.unshift(nubiId);
      const others = ids.filter((i) => i !== nubiId);
      const owned = [
        ...(nubiId ? await this.prisma.turby_instance.findMany({ where: { id: BigInt(nubiId), owner_player_id: BigInt(playerId), is_story_companion: true }, include: INSTANCE_INCLUDE }) : []),
        ...(others.length > 0
          ? await this.prisma.turby_instance.findMany({
              where: { id: { in: others.map((i) => BigInt(i)) }, owner_player_id: BigInt(playerId), base_slot_id: null }, // 소지(가방) 중인 내 터비만
              include: INSTANCE_INCLUDE,
            })
          : []),
      ];
      if (nubiId && !owned.some((o) => o.id.toString() === nubiId)) throw new BattleError('STORY_NUBI_MISSING', '이야기 누비를 찾을 수 없습니다.');
      if (owned.length !== ids.length) throw new BattleError('PARTY_NOT_OWNED', '가방에 없는 터비가 포함되어 있습니다.');
      const dtoById = new Map(owned.map((o) => [o.id.toString(), toTurbyDto(o)]));
      const party = ids.map((id) => {
        const dto = dtoById.get(id)!;
        return { turbyId: id, characterCode: dto.characterCode, name: dto.characterName, ...dto.stats };
      });
      const events = submitParty(record.state, playerId, party);
      return this.publish(record, events, playerId);
    });
  }

  // ---------- 행동 ----------

  async action(playerId: string, body: { battleId?: unknown; actionId?: unknown; expectedVersion?: unknown; type?: unknown; unitId?: unknown; targetCol?: unknown; targetRow?: unknown; targetUnitId?: unknown }): Promise<BattleResponse> {
    const record = this.requireRecord(body?.battleId);
    return this.enqueue(record, async () => {
      this.requireParticipant(record, playerId);
      const actionId = body.actionId;
      if (typeof actionId !== 'string' || actionId.length < 1 || actionId.length > ACTION_ID_MAX) throw new BattleError('INVALID_PAYLOAD', 'actionId가 올바르지 않습니다.');

      // 같은 actionId 재전송은 최초 응답을 그대로 돌려준다(상태를 다시 바꾸지 않음). 종료된 뒤 재시도도 여기서 걸러진다.
      const previous = record.responses.get(`${playerId}:${actionId}`);
      if (previous) return previous;

      if (record.state.phase === 'resolved') throw new BattleError('BATTLE_RESOLVED', '이미 끝난 전투입니다.');
      if (typeof body.expectedVersion !== 'number' || body.expectedVersion !== record.state.version) {
        throw new BattleError('STATE_MISMATCH', '전투 상태가 달라졌습니다. 최신 상태를 다시 받아 주세요.', toSnapshot(record.state));
      }
      const events = applyAction(record.state, playerId, body as unknown as ActionRequest);
      const response = await this.publish(record, events, playerId);
      record.responses.set(`${playerId}:${actionId}`, response);
      return response;
    });
  }

  // 파티 선택을 포기하거나 전투에서 스스로 빠진다(보상 자격 없음). 남은 참전자가 없으면 전투가 취소된다.
  async leave(playerId: string, battleId: unknown): Promise<BattleResponse> {
    const record = this.requireRecord(battleId);
    return this.enqueue(record, async () => {
      this.requireParticipant(record, playerId);
      return this.publish(record, removeParticipant(record.state, playerId, 'left'), playerId);
    });
  }

  // ---------- 조회 ----------

  async snapshot(playerId: string, battleId: unknown): Promise<BattleResponse> {
    const record = this.requireRecord(battleId);
    return this.enqueue(record, async () => {
      this.requireParticipant(record, playerId);
      if (record.state.phase === 'resolved' && !record.settled) await (record.story ? this.settleStory(record) : this.settle(record)); // 보상 기록 재시도
      return { version: record.state.version, events: [], snapshot: toSnapshot(record.state), ended: record.ended };
    });
  }

  // 접속 인증 응답에 실을 진행 중 전투(새로고침·재접속 복구용)
  // 방 이벤트(재접속으로 인한 connected 복구 등)가 대기열에서 먼저 처리된 뒤의 상태를 돌려준다
  async activeSnapshotOf(playerId: string): Promise<BattleSnapshotDto | null> {
    const record = this.recordOfPlayer(playerId);
    if (!record) return null;
    await record.queue;
    return toSnapshot(record.state);
  }

  // ---------- 내부 ----------

  private rules(): BattleRules {
    const n = (k: string) => this.settings.number(k);
    return {
      gridCols: n('battle.gridCols'),
      gridRows: n('battle.gridRows'),
      maxAlliedUnits: n('battle.maxAlliedUnits'),
      partyStartCol: n('battle.partyStartCol'),
      wildStartCol: n('battle.wildStartCol'),
      wildStartRow: n('battle.wildStartRow'),
      minDamage: n('battle.minDamage'),
      defenseDivisor: n('battle.defenseDivisor'),
      wildHpMult: [0, n('battle.wildHpMult.1'), n('battle.wildHpMult.2'), n('battle.wildHpMult.3'), n('battle.wildHpMult.4'), n('battle.wildHpMult.5')],
    };
  }

  private requireRecord(battleId: unknown): BattleRecord {
    if (typeof battleId !== 'string' || battleId.length < 1) throw new BattleError('BATTLE_NOT_FOUND', '전투 식별자가 없습니다.');
    const record = this.battles.get(battleId);
    if (!record) throw new BattleError('BATTLE_EXPIRED', '전투가 사라졌습니다. 서버가 다시 시작되었거나 시간이 지났습니다.');
    return record;
  }

  private requireParticipant(record: BattleRecord, playerId: string) {
    if (!record.state.participants.some((p) => p.playerId === playerId)) throw new BattleError('NOT_PARTICIPANT', '이 전투의 참전자가 아닙니다.');
  }

  private recordOfPlayer(playerId: string): BattleRecord | undefined {
    const id = this.battleOfPlayer.get(playerId);
    const record = id ? this.battles.get(id) : undefined;
    if (!record || record.state.phase === 'resolved') return undefined;
    return record;
  }

  // 같은 전투의 요청을 한 줄로 세워 await(DB 조회) 사이에 상태가 뒤섞이지 않게 한다
  private enqueue<T>(record: BattleRecord, run: () => Promise<T>): Promise<T> {
    const next = record.queue.then(run, run);
    record.queue = next.catch(() => undefined);
    return next;
  }

  private async publish(record: BattleRecord, events: BattleEvent[], actorPlayerId: string | null): Promise<BattleResponse> {
    const { state } = record;
    // 초대를 거절·시간 초과했거나 빠진 사람은 다른 전투에 참여할 수 있도록 묶음을 푼다
    for (const p of state.participants) if (!p.active && this.battleOfPlayer.get(p.playerId) === state.battleId) this.battleOfPlayer.delete(p.playerId);
    if (state.phase === 'resolved') {
      for (const p of state.participants) if (this.battleOfPlayer.get(p.playerId) === state.battleId) this.battleOfPlayer.delete(p.playerId);
      this.clearTimer(record);
      if (record.story) {
        await this.settleStory(record);
      } else {
        this.releaseWild(state);
        await this.settle(record);
      }
      this.scheduleCleanup(record);
    } else {
      this.armTimer(record);
    }
    const response: BattleResponse = { version: state.version, events, snapshot: toSnapshot(state), ended: record.ended };
    if (events.length > 0) this.events.emit('battle:update', state, response, actorPlayerId);
    return response;
  }

  // 전투 결과에 따라 야생 마커 상태를 정리한다: 승리=포획됨, 패배=도망(사라짐), 무승부·취소=다시 만날 수 있음
  private releaseWild(state: BattleState) {
    const room = this.rooms.roomByCode(state.roomCode);
    if (!room) return;
    const next = state.outcome === 'win' ? 'captured' : state.outcome === 'lose' ? 'removed' : 'free';
    this.rooms.setWildState(room, state.spawnIndex, next, null);
  }

  private clearTimer(record: BattleRecord) {
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    record.timerKey = null;
    record.state.expiresAt = null;
  }

  // 마감 시각: 초대는 항상, 파티 선택·서브턴은 참전자가 2명 이상일 때만(혼자 하는 전투는 시간 제한이 없다).
  // 같은 단계가 이어지는 동안(예: 같은 서브턴의 여러 행동)은 마감 시각을 유지한다.
  private armTimer(record: BattleRecord) {
    const s = record.state;
    const active = s.participants.filter((p) => p.active).length;
    let seconds: number | null = null;
    if (s.phase === 'inviting') seconds = this.settings.number('battle.inviteSeconds');
    else if (s.phase === 'party_select' && active >= 2) seconds = this.settings.number('battle.partySelectSeconds');
    else if (s.phase === 'player_subturn' && active >= 2) seconds = this.settings.number('battle.subturnSeconds');
    if (seconds === null) {
      this.clearTimer(record);
      return;
    }
    const key = `${s.phase}|${s.round}|${s.subturnIndex}|${s.turnOrder[s.subturnIndex] ?? ''}`;
    if (record.timer && record.timerKey === key) return;
    this.clearTimer(record);
    s.expiresAt = Date.now() + seconds * 1000;
    record.timerKey = key;
    record.timer = setTimeout(() => this.onTimeout(record, key), seconds * 1000);
    record.timer.unref();
  }

  private onTimeout(record: BattleRecord, key: string) {
    void this.enqueue(record, async () => {
      if (record.timerKey !== key) return; // 그 사이 단계가 바뀌었다
      record.timer = null;
      record.timerKey = null;
      const s = record.state;
      const events = s.phase === 'inviting' ? closeInvites(s) : s.phase === 'party_select' ? closePartySelect(s) : s.phase === 'player_subturn' ? expireSubturn(s) : [];
      await this.publish(record, events, null);
    });
  }

  private scheduleCleanup(record: BattleRecord) {
    if (record.cleanup) return;
    record.cleanup = setTimeout(() => this.battles.delete(record.state.battleId), this.settings.number('battle.resolvedRetentionSeconds') * 1000);
    record.cleanup.unref();
  }

  // 스토리 전투 결과 확정: 포획·야생 보상 없음. 승리면 onWinEvents를 서버 경로로 기록한다.
  // 이벤트 기록은 (player, event) unique로 멱등이라 재시도·재요청해도 한 번만 반영된다. 실패하면 settled=false로 두고 스냅샷 재요청 때 다시 시도.
  private async settleStory(record: BattleRecord): Promise<void> {
    if (record.settled || !record.story) return;
    const { state } = record;
    try {
      if (state.outcome === 'win') {
        for (const p of state.participants.filter((x) => x.partySubmitted && x.eligibleForReward)) {
          for (const eventId of record.story.onWinEvents) await this.story.completeEvent(BigInt(p.playerId), eventId, 'server');
        }
      }
      record.ended = { outcome: state.outcome!, rewards: [], settled: true };
      record.settled = true;
    } catch (err) {
      this.log.error(`스토리 전투 결과 기록 실패(재시도 대기) battle=${state.battleId}`, err as Error);
      record.ended = { outcome: state.outcome!, rewards: [], settled: false };
    }
  }

  // 결과 확정: coop_battle + 참가자별 battle_result + 포획 지급을 한 트랜잭션에서. (battle_id, player_id) 유니크라
  // 재시도해도 같은 결과를 돌려주고 터비를 다시 만들지 않는다.
  private async settle(record: BattleRecord): Promise<void> {
    if (record.settled) return;
    const { state } = record;
    try {
      // 개발·검증용: 환경변수 BATTLE_SETTLE_FAIL_COUNT 만큼 정산을 일부러 실패시켜 settled:false 재시도 경로를 확인한다(운영 기본값 0)
      if (this.injectedSettleFailures > 0) {
        this.injectedSettleFailures--;
        throw new Error('injected settle failure');
      }
      const rewards = await this.prisma.$transaction(async (tx) => {
        const battle = await tx.coop_battle.upsert({
          where: { battle_key: state.battleId },
          update: {},
          create: {
            battle_key: state.battleId,
            room_code: state.roomCode,
            stage_code: state.stageCode,
            spawn_index: state.spawnIndex,
            wild_character_code: state.wildCharacterCode,
            participant_count: state.participants.filter((p) => p.partySubmitted).length,
            result: state.outcome!,
          },
        });
        const wild = await tx.turby_character.findUnique({ where: { code: state.wildCharacterCode } });
        const out: RewardDto[] = [];
        for (const p of state.participants.filter((x) => x.partySubmitted)) {
          const key = { battle_id_player_id: { battle_id: battle.id, player_id: BigInt(p.playerId) } };
          const existing = await tx.battle_result.findUnique({ where: key });
          let capturedId = existing?.captured_turby_instance_id ?? null;
          if (!existing) {
            if (state.outcome === 'win' && p.eligibleForReward && wild) {
              const created = await tx.turby_instance.create({ data: { owner_player_id: BigInt(p.playerId), character_id: wild.id, acquired_via: 'wild_capture' } });
              capturedId = created.id;
            }
            await tx.battle_result.create({ data: { player_id: BigInt(p.playerId), encounter_type: 'wild', result: state.outcome!, captured_turby_instance_id: capturedId, battle_id: battle.id } });
          }
          let dto: ReturnType<typeof toTurbyDto> | null = null;
          if (capturedId) {
            const inst = await tx.turby_instance.findUnique({ where: { id: capturedId }, include: INSTANCE_INCLUDE });
            if (inst) dto = toTurbyDto(inst);
          }
          out.push({ playerId: p.playerId, rewardStatus: capturedId ? 'granted' : 'none', reason: capturedId ? null : p.leftReason ?? (state.outcome === 'win' ? null : state.outcome), capturedTurbyInstanceId: capturedId?.toString() ?? null, capturedTurby: dto });
        }
        return out;
      });
      record.ended = { outcome: state.outcome!, rewards, settled: true };
      record.settled = true;
    } catch (err) {
      this.log.error(`전투 결과 기록 실패(재시도 대기) battle=${state.battleId}`, err as Error);
      record.ended = { outcome: state.outcome!, rewards: [], settled: false };
    }
  }
}
