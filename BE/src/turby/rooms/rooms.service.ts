import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '../prisma.service';
import { SettingsService } from './settings.service';
import { SessionService } from '../session.service';
import { StageAccessService } from '../story/stage-access.service';
import { OPENING_REQUIRED_HINT } from '../story/stage-access';
import { FACINGS, MAX_PLAYERS, ROOM_CODE_LENGTH, RoomError } from './types';
import type { Facing, MapPlayerDto, Room, RoomMember, RoomStateDto, WildDto, WildRuntime, WildState } from './types';
import { StoryContentService } from '../story/story-content.service';
import { checkMove, collisionOf, lockedZonesFor, reachable, safePosition, solidsFor, type MoveVerdict, type Point } from './stage-collision';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I 제외

// corrected: 이동을 승인하지 않았다 — x·y는 마지막으로 승인한 서버 위치. reason = 속도 초과 또는 충돌 판정
export type MoveResult = { kind: 'ok'; x: number; y: number; dir: Facing } | { kind: 'dropped' } | { kind: 'corrected'; x: number; y: number; reason: 'speed' | Exclude<MoveVerdict, 'ok'> };

// 4-A: 방 생성·입장·퇴장·호스트 승계·재접속 유예·맵 위치 동기화(docs/save_a_turby_coop_spec.md 2, 3절).
// 방과 위치는 영구 저장이 필요 없어 메모리로만 관리하고, 변경은 events로 알려 게이트웨이가 브로드캐스트한다.
// events: 'room:state'(room), 'member:removed'(room, playerId, wasInMap, reason), 'room:closed'(code), 'wild:changed'(room, wild)
@Injectable()
export class RoomsService {
  readonly events = new EventEmitter();
  private rooms = new Map<string, Room>();
  private roomOfPlayer = new Map<string, string>();
  private playerOfSocket = new Map<string, string>();
  private socketOfPlayer = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly session: SessionService,
    private readonly stageAccess: StageAccessService,
    private readonly content: StoryContentService,
  ) {}

  // ---------- 신원 ----------

  // 클라이언트가 보낸 playerId는 믿지 않고, 서버가 device_uuid로 찾은 플레이어에 소켓을 묶는다
  async identify(socketId: string, deviceUuid: unknown, sessionToken?: unknown) {
    if (typeof deviceUuid !== 'string' || deviceUuid.length < 8 || deviceUuid.length > 64) throw new RoomError('INVALID_PAYLOAD', '기기 식별자가 올바르지 않습니다.');
    const player = await this.prisma.player.findUnique({ where: { device_uuid: deviceUuid } });
    if (!player) throw new RoomError('PLAYER_NOT_FOUND', '등록되지 않은 플레이어입니다.');
    // 스토리 M1: 토큰이 오면 반드시 일치해야 하고, 없으면 auth.requireSession 설정에 따른다(전환 기간)
    if (!this.session.socketTokenOk(player.session_token, sessionToken)) throw new RoomError('SESSION_INVALID', '접속 정보가 올바르지 않습니다. 다시 시작해 주세요.');
    const playerId = player.id.toString();

    const previousSocketId = this.socketOfPlayer.get(playerId) ?? null;
    if (previousSocketId && previousSocketId !== socketId) this.playerOfSocket.delete(previousSocketId);
    this.playerOfSocket.set(socketId, playerId);
    this.socketOfPlayer.set(playerId, socketId);

    // v15: 오프닝 미완료 계정은 남아 있던 탐험 세션을 이어받지 않고 마을로 돌려보낸다(진행 데이터는 지우지 않음)
    let returnToVillage = false;
    const stale = this.roomOf(playerId);
    if (stale && !(await this.stageAccess.openingComplete(player.id))) {
      this.removeMember(stale, playerId, 'left');
      returnToVillage = true;
    }

    // 유예 중이거나 다른 탭에서 열려 있던 방 세션을 새 소켓으로 이어받는다
    const room = this.roomOf(playerId);
    const member = room?.members.find((m) => m.playerId === playerId);
    if (room && member) {
      member.socketId = socketId;
      member.connected = true;
      member.nickname = player.nickname;
      if (member.graceTimer) clearTimeout(member.graceTimer);
      member.graceTimer = null;
      this.events.emit('room:state', room);
    }
    // 같은 소켓이 hello를 다시 보낸 경우는 '이전 소켓'이 아니다(자기 자신을 끊지 않도록)
    return { playerId, nickname: player.nickname, previousSocketId: previousSocketId === socketId ? null : previousSocketId, room: room ?? null, returnToVillage, returnReason: returnToVillage ? ('OPENING_REQUIRED' as const) : null };
  }

  socketIdOf(playerId: string): string | null {
    return this.socketOfPlayer.get(playerId) ?? null;
  }

  playerOf(socketId: string): string {
    const playerId = this.playerOfSocket.get(socketId);
    if (!playerId) throw new RoomError('NOT_IDENTIFIED', '먼저 접속 인증이 필요합니다.');
    return playerId;
  }

  // 소켓이 닫힘 — 현재 소켓일 때만 유예 시작(같은 플레이어의 다른 소켓이 이미 이어받았다면 무시)
  disconnect(socketId: string) {
    const playerId = this.playerOfSocket.get(socketId);
    if (!playerId) return;
    this.playerOfSocket.delete(socketId);
    if (this.socketOfPlayer.get(playerId) !== socketId) return;
    this.socketOfPlayer.delete(playerId);

    const room = this.roomOf(playerId);
    const member = room?.members.find((m) => m.playerId === playerId);
    if (!room || !member) return;
    member.socketId = null;
    member.connected = false;
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = setTimeout(() => this.removeMember(room, playerId, 'timeout'), this.settings.number('room.reconnectGraceMs'));
    this.events.emit('room:state', room);
  }

  // ---------- 방 ----------

  // 멀티 제거: 방은 언제나 플레이어 1인 전용 세션이다(join·공개 목록 없음). stageCode별 진행 상태와
  // 야생 터비 상태를 담는 컨테이너로만 쓴다.
  async createRoom(playerId: string, stageCodeRaw: unknown) {
    if (this.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM', '이미 방에 참여 중입니다.');
    const stage = await this.requireStage(stageCodeRaw);
    // M2: 지역 입장 판정은 StageAccessService 한 곳(story.stageAccessV2로 신·구 전환)
    const denial = await this.stageAccess.entryDenial(BigInt(playerId), stage.stage_code, stage.chapter_order);
    if (denial === 'OPENING_REQUIRED') throw new RoomError('OPENING_REQUIRED', OPENING_REQUIRED_HINT);
    if (denial) throw new RoomError('STAGE_LOCKED', '아직 열리지 않은 지역입니다.');

    const player = await this.prisma.player.findUnique({ where: { id: BigInt(playerId) } });
    if (!player) throw new RoomError('PLAYER_NOT_FOUND', '등록되지 않은 플레이어입니다.');
    if (this.roomOf(playerId)) throw new RoomError('ALREADY_IN_ROOM', '이미 방에 참여 중입니다.'); // await 사이에 같은 플레이어의 다른 요청이 방을 만든 경우

    const room: Room = {
      code: this.newCode(),
      name: '혼자 탐험',
      stageCode: stage.stage_code,
      mapWidth: stage.map_width,
      mapHeight: stage.map_height,
      maxPlayers: MAX_PLAYERS,
      visibility: 'private',
      phase: 'lobby',
      members: [],
      wilds: await this.loadWilds(stage.stage_code),
      collision: collisionOf(this.content.stage(stage.stage_code), stage.map_width, stage.map_height),
    };
    room.members.push(this.newMember(playerId, player.nickname));
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(playerId, room.code);
    return room;
  }

  // v15: 방 시작·맵 입장 직전에도 다시 확인(오래된 화면 상태나 직접 호출로 우회하지 못하게)
  async requireOpening(playerId: string) {
    if (!(await this.stageAccess.openingComplete(BigInt(playerId)))) throw new RoomError('OPENING_REQUIRED', OPENING_REQUIRED_HINT);
  }

  leaveRoom(playerId: string) {
    const room = this.roomOf(playerId);
    if (!room) throw new RoomError('NOT_IN_ROOM', '참여 중인 방이 없습니다.');
    this.removeMember(room, playerId, 'left');
  }

  startRoom(playerId: string) {
    const room = this.requireRoom(playerId);
    if (room.members[0].playerId !== playerId) throw new RoomError('NOT_HOST', '방장만 시작할 수 있습니다.');
    if (room.phase === 'lobby') {
      room.phase = 'playing';
      this.events.emit('room:state', room);
    }
    return room;
  }

  // ---------- 맵 위치 ----------

  // 10-02 v4 §1: 입장 위치는 서버가 정한다. 요청에 좌표가 들어 있어도 읽지 않는다.
  // - 이 탐험 세션의 첫 입장: 지역 데이터의 시작 지점(spawnPoint)
  // - 같은 세션의 재입장(전투 뒤 복귀·새로고침·유예 안 재접속): 마지막으로 승인한 위치. 지도 밖·벽 안·닫힌 문 너머면 시작 지점으로 보정
  // - 세션이 끝난 뒤 새로 들어오면 다시 시작 지점(방이 새로 만들어진다)
  async enterMap(playerId: string, dirRaw?: unknown) {
    const room = this.requireRoom(playerId);
    if (room.phase !== 'playing') throw new RoomError('ROOM_NOT_STARTED', '방이 아직 시작되지 않았습니다.');
    const events = await this.loadStoryEvents(playerId);
    const member = this.memberOf(room, playerId); // 기다리는 사이 방을 나갔으면 여기서 거부
    member.storyEvents = events;
    const c = room.collision;
    let corrected = false;
    if (!member.placed) {
      member.x = c.spawn.x;
      member.y = c.spawn.y;
      member.placed = true;
    } else {
      const safe = safePosition(c, solidsFor(c, events), lockedZonesFor(c, events), { x: member.x, y: member.y });
      member.x = safe.x;
      member.y = safe.y;
      corrected = safe.corrected;
    }
    member.inMap = true;
    member.dir = FACINGS.includes(dirRaw as Facing) ? (dirRaw as Facing) : member.dir;
    member.lastMoveAt = Date.now();
    this.events.emit('room:state', room);
    return { room, self: this.toMapPlayer(member), corrected, others: this.snapshotOf(room, playerId), wilds: this.wildsOf(room) };
  }

  private async loadStoryEvents(playerId: string): Promise<Set<string>> {
    const rows = await this.prisma.player_story_event.findMany({ where: { player_id: BigInt(playerId) } });
    return new Set(rows.map((r) => r.event_id));
  }

  // 스토리 이벤트가 기록되면(문 개방 등) 그 플레이어의 통과 판정에 바로 반영한다
  noteStoryEvents(playerId: string, eventIds: string[]) {
    const room = this.roomOf(playerId);
    const member = room?.members.find((m) => m.playerId === playerId);
    if (member) for (const id of eventIds) member.storyEvents.add(id);
  }

  // 위치 증거용: 마지막으로 승인한 위치에서 대상 지점까지 벽·닫힌 문이 가로막지 않는가
  canReach(room: Room, playerId: string, target: Point): boolean {
    const m = room.members.find((x) => x.playerId === playerId);
    if (!m) return false;
    return reachable(solidsFor(room.collision, m.storyEvents), { x: m.x, y: m.y }, target);
  }

  // 이동 보고 — 검증만 하고 브로드캐스트는 게이트웨이가 한다
  move(playerId: string, xRaw: unknown, yRaw: unknown, dirRaw: unknown, now = Date.now()): { room: Room; result: MoveResult } {
    const room = this.requireRoom(playerId);
    const member = this.memberOf(room, playerId);
    if (!member.inMap) throw new RoomError('NOT_IN_MAP', '맵에 입장하지 않았습니다.');
    if (typeof xRaw !== 'number' || typeof yRaw !== 'number' || !Number.isFinite(xRaw) || !Number.isFinite(yRaw)) throw new RoomError('INVALID_PAYLOAD', '좌표가 올바르지 않습니다.');
    const x = xRaw;
    const y = yRaw;
    const dir = this.validateDir(dirRaw);

    const dt = now - member.lastMoveAt;
    if (dt < this.settings.number('move.minIntervalMs')) return { room, result: { kind: 'dropped' } }; // 전송 빈도 제한

    // 경과 시간 × 최대 속도 + 여유 안에서만 이동을 인정(순간이동으로 야생 터비를 가로채는 것 방지)
    const allowed = (this.settings.number('move.maxSpeedPxPerSec') * dt) / 1000 + this.settings.number('move.slackPx');
    const dist = Math.hypot(x - member.x, y - member.y);
    member.lastMoveAt = now;
    if (dist > allowed) return { room, result: { kind: 'corrected', x: member.x, y: member.y, reason: 'speed' } };

    // 10-02 v4 §2: 지도 경계·막힌 곳·닫힌 문·잠긴 구역. 끝점만이 아니라 마지막 승인 위치에서의 선분도 검사한다(터널링 방지).
    // 승인하지 않은 좌표는 저장하지 않는다 — 수집·지점의 위치 증거는 언제나 마지막 승인 위치다
    const c = room.collision;
    const verdict = checkMove(c, solidsFor(c, member.storyEvents), lockedZonesFor(c, member.storyEvents), { x: member.x, y: member.y }, { x, y });
    if (verdict !== 'ok') return { room, result: { kind: 'corrected', x: member.x, y: member.y, reason: verdict } };

    member.x = x;
    member.y = y;
    member.dir = dir;
    return { room, result: { kind: 'ok', x, y, dir } };
  }

  // ---------- 야생 터비 공유 상태(4-C) ----------

  private async loadWilds(stageCode: string): Promise<WildRuntime[]> {
    const rows = await this.prisma.stage_wild_spawn.findMany({ where: { stage_code: stageCode }, orderBy: { spawn_index: 'asc' } });
    return rows.map((r) => ({ index: r.spawn_index, characterCode: r.character_code, x: r.x, y: r.y, state: 'free' as WildState, battleId: null }));
  }

  wildsOf(room: Room): WildDto[] {
    return room.wilds.map((w) => ({ index: w.index, state: w.state }));
  }

  // 상태 전이는 서버만 한다. 바뀌면 같은 맵의 모두에게 알린다.
  setWildState(room: Room, index: number, state: WildState, battleId: string | null) {
    const wild = room.wilds.find((w) => w.index === index);
    if (!wild || (wild.state === state && wild.battleId === battleId)) return;
    wild.state = state;
    wild.battleId = battleId;
    this.events.emit('wild:changed', room, wild);
  }

  memberPosition(room: Room, playerId: string) {
    const m = room.members.find((x) => x.playerId === playerId);
    return m ? { x: m.x, y: m.y, inMap: m.inMap, connected: m.connected } : null;
  }

  // ---------- 조회·채널 ----------

  mapChannel(room: Room) {
    return `turby-map:${room.code}:${room.stageCode}`; // docs 3.5.4: 방코드:맵코드 합성 키
  }

  roomChannel(code: string) {
    return `turby-room:${code}`;
  }

  roomByCode(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.roomOfPlayer.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  isInMap(room: Room, playerId: string) {
    return !!room.members.find((m) => m.playerId === playerId)?.inMap;
  }

  toState(room: Room): RoomStateDto {
    return {
      code: room.code,
      name: room.name,
      stageCode: room.stageCode,
      maxPlayers: room.maxPlayers,
      visibility: room.visibility,
      phase: room.phase,
      hostPlayerId: room.members[0].playerId,
      members: room.members.map((m) => ({ playerId: m.playerId, nickname: m.nickname, connected: m.connected, inMap: m.inMap })),
    };
  }

  snapshotOf(room: Room, exceptPlayerId?: string): MapPlayerDto[] {
    return room.members.filter((m) => m.inMap && m.playerId !== exceptPlayerId).map((m) => this.toMapPlayer(m));
  }

  // ---------- 내부 ----------

  private requireRoom(playerId: string): Room {
    const room = this.roomOf(playerId);
    if (!room) throw new RoomError('NOT_IN_ROOM', '참여 중인 방이 없습니다.');
    return room;
  }

  private memberOf(room: Room, playerId: string): RoomMember {
    const m = room.members.find((x) => x.playerId === playerId);
    if (!m) throw new RoomError('NOT_IN_ROOM', '참여 중인 방이 없습니다.');
    return m;
  }

  private removeMember(room: Room, playerId: string, reason: 'left' | 'timeout') {
    const idx = room.members.findIndex((m) => m.playerId === playerId);
    if (idx < 0) return;
    const [member] = room.members.splice(idx, 1);
    if (member.graceTimer) clearTimeout(member.graceTimer);
    this.roomOfPlayer.delete(playerId);
    this.events.emit('member:removed', room, playerId, member.inMap, reason);

    if (room.members.length === 0) {
      this.rooms.delete(room.code); // 마지막 1명이 나가면 방 종료(3.6)
      this.events.emit('room:closed', room.code);
      return;
    }
    // 호스트(members[0])가 나가면 입장 순서상 다음 사람이 자동으로 승계된다
    this.events.emit('room:state', room);
  }

  private newMember(playerId: string, nickname: string): RoomMember {
    return { playerId, nickname, socketId: this.socketOfPlayer.get(playerId) ?? null, connected: true, inMap: false, x: 0, y: 0, dir: 'down', lastMoveAt: 0, graceTimer: null, placed: false, storyEvents: new Set() };
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('SERVER_BUSY', '방 코드를 만들 수 없습니다. 잠시 후 다시 시도하세요.');
  }

  private async requireStage(stageCode: unknown) {
    if (typeof stageCode !== 'string') throw new RoomError('INVALID_STAGE', '지역 코드가 올바르지 않습니다.');
    const stage = await this.prisma.story_chapter.findUnique({ where: { stage_code: stageCode } });
    if (!stage) throw new RoomError('INVALID_STAGE', '존재하지 않는 지역입니다.');
    return stage;
  }

  private validateDir(dir: unknown): Facing {
    if (!FACINGS.includes(dir as Facing)) throw new RoomError('INVALID_PAYLOAD', '방향이 올바르지 않습니다.');
    return dir as Facing;
  }

  private toMapPlayer(m: RoomMember): MapPlayerDto {
    return { playerId: m.playerId, nickname: m.nickname, x: m.x, y: m.y, dir: m.dir };
  }
}
