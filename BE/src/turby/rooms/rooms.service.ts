import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PrismaService } from '../prisma.service';
import { SettingsService } from './settings.service';
import { FACINGS, MAX_PLAYERS, ROOM_CODE_LENGTH, RoomError } from './types';
import type { Facing, MapPlayerDto, Room, RoomMember, RoomStateDto, WildDto, WildRuntime, WildState } from './types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I 제외

export type MoveResult = { kind: 'ok'; x: number; y: number; dir: Facing } | { kind: 'dropped' } | { kind: 'corrected'; x: number; y: number };

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
  ) {}

  // ---------- 신원 ----------

  // 클라이언트가 보낸 playerId는 믿지 않고, 서버가 device_uuid로 찾은 플레이어에 소켓을 묶는다
  async identify(socketId: string, deviceUuid: unknown) {
    if (typeof deviceUuid !== 'string' || deviceUuid.length < 8 || deviceUuid.length > 64) throw new RoomError('INVALID_PAYLOAD', '기기 식별자가 올바르지 않습니다.');
    const player = await this.prisma.player.findUnique({ where: { device_uuid: deviceUuid } });
    if (!player) throw new RoomError('PLAYER_NOT_FOUND', '등록되지 않은 플레이어입니다.');
    const playerId = player.id.toString();

    const previousSocketId = this.socketOfPlayer.get(playerId) ?? null;
    if (previousSocketId && previousSocketId !== socketId) this.playerOfSocket.delete(previousSocketId);
    this.playerOfSocket.set(socketId, playerId);
    this.socketOfPlayer.set(playerId, socketId);

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
    return { playerId, nickname: player.nickname, previousSocketId: previousSocketId === socketId ? null : previousSocketId, room: room ?? null };
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
    await this.requireUnlocked(playerId, stage.chapter_order);

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
    };
    room.members.push(this.newMember(playerId, player.nickname));
    this.rooms.set(room.code, room);
    this.roomOfPlayer.set(playerId, room.code);
    return room;
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

  enterMap(playerId: string, xRaw: unknown, yRaw: unknown, dirRaw: unknown) {
    const room = this.requireRoom(playerId);
    if (room.phase !== 'playing') throw new RoomError('ROOM_NOT_STARTED', '방이 아직 시작되지 않았습니다.');
    const { x, y } = this.validatePosition(room, xRaw, yRaw);
    const dir = this.validateDir(dirRaw);
    const member = this.memberOf(room, playerId);
    member.inMap = true;
    member.x = x;
    member.y = y;
    member.dir = dir;
    member.lastMoveAt = Date.now();
    this.events.emit('room:state', room);
    return { room, self: this.toMapPlayer(member), others: this.snapshotOf(room, playerId), wilds: this.wildsOf(room) };
  }

  // 이동 보고 — 검증만 하고 브로드캐스트는 게이트웨이가 한다
  move(playerId: string, xRaw: unknown, yRaw: unknown, dirRaw: unknown, now = Date.now()): { room: Room; result: MoveResult } {
    const room = this.requireRoom(playerId);
    const member = this.memberOf(room, playerId);
    if (!member.inMap) throw new RoomError('NOT_IN_MAP', '맵에 입장하지 않았습니다.');
    const { x, y } = this.validatePosition(room, xRaw, yRaw);
    const dir = this.validateDir(dirRaw);

    const dt = now - member.lastMoveAt;
    if (dt < this.settings.number('move.minIntervalMs')) return { room, result: { kind: 'dropped' } }; // 전송 빈도 제한

    // 경과 시간 × 최대 속도 + 여유 안에서만 이동을 인정(순간이동으로 야생 터비를 가로채는 것 방지)
    const allowed = (this.settings.number('move.maxSpeedPxPerSec') * dt) / 1000 + this.settings.number('move.slackPx');
    const dist = Math.hypot(x - member.x, y - member.y);
    member.lastMoveAt = now;
    if (dist > allowed) return { room, result: { kind: 'corrected', x: member.x, y: member.y } };

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
    return { playerId, nickname, socketId: this.socketOfPlayer.get(playerId) ?? null, connected: true, inMap: false, x: 0, y: 0, dir: 'down', lastMoveAt: 0, graceTimer: null };
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

  // 이전 장의 대표 터비를 직접 포획(acquired_via='wild_capture')했어야 열림 — docs/Turby_story.md 3.2, FE와 같은 규칙을 서버가 다시 검증
  private async requireUnlocked(playerId: string, chapterOrder: number) {
    if (chapterOrder <= 1) return;
    const previous = await this.prisma.story_chapter.findUnique({ where: { chapter_order: chapterOrder - 1 } });
    if (!previous) return;
    const captured = await this.prisma.turby_instance.count({
      where: { owner_player_id: BigInt(playerId), acquired_via: 'wild_capture', turby_character: { code: previous.clear_character_code } },
    });
    if (captured === 0) throw new RoomError('STAGE_LOCKED', '아직 열리지 않은 지역입니다.');
  }

  private validatePosition(room: Room, x: unknown, y: unknown) {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new RoomError('INVALID_PAYLOAD', '좌표가 올바르지 않습니다.');
    if (x < 0 || y < 0 || x > room.mapWidth || y > room.mapHeight) throw new RoomError('OUT_OF_BOUNDS', '맵 범위를 벗어난 좌표입니다.');
    return { x, y };
  }

  private validateDir(dir: unknown): Facing {
    if (!FACINGS.includes(dir as Facing)) throw new RoomError('INVALID_PAYLOAD', '방향이 올바르지 않습니다.');
    return dir as Facing;
  }

  private toMapPlayer(m: RoomMember): MapPlayerDto {
    return { playerId: m.playerId, nickname: m.nickname, x: m.x, y: m.y, dir: m.dir };
  }
}
