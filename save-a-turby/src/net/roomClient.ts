import { io } from 'socket.io-client';
import type { StoryDelivery, StoryPlay } from '../story/storyFlow';
import type { Socket } from 'socket.io-client';
import { BASE_URL, session } from '../api/client';
import { getPlayerId } from '../state/player';
import { helloPayload } from '../state/session';
import type { BattleInvite, BattleSnapshot, BattleUpdate, WildInfo } from './battleTypes';

// 4-A: 방·맵 위치 동기화 클라이언트(docs/save_a_turby_coop_spec.md 5절 계약). 화면과 분리된 연결 계층이라
// 최종 방 UI가 나와도 이 클래스는 그대로 쓴다. 서버가 device_uuid와 세션 토큰으로 플레이어를 확정하므로 playerId를 보내지 않는다.

export type Facing = 'down' | 'left' | 'right' | 'up';

export const HELLO_TIMEOUT_MS = 5000; // 접속 인증 응답을 기다리는 한도

export interface MemberInfo {
  playerId: string;
  nickname: string;
  connected: boolean;
  inMap: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  stageCode: string;
  maxPlayers: number;
  visibility: 'private';
  phase: 'lobby' | 'playing';
  hostPlayerId: string;
  members: MemberInfo[];
}

export interface MapPlayer {
  playerId: string;
  nickname: string;
  x: number;
  y: number;
  dir: Facing;
}

export class RoomApiError extends Error {
  readonly code: string;
  readonly snapshot: BattleSnapshot | null; // STATE_MISMATCH일 때 서버가 함께 내려주는 최신 전투 상태
  readonly reason: string | null; // 서버가 덧붙인 거부 사유(예: WILD_UNREACHABLE의 blocked·locked_zone) — 좌표 같은 정보는 없다

  constructor(code: string, message: string, snapshot: BattleSnapshot | null = null, reason: string | null = null) {
    super(message);
    this.code = code;
    this.snapshot = snapshot;
    this.reason = reason;
  }
}

type Ack<T> = ({ ok: true } & T) | { ok: false; code: string; message: string; reason?: string; snapshot?: BattleSnapshot };

interface Events {
  state: (room: RoomState | null) => void;
  joined: (player: MapPlayer) => void;
  moved: (player: Omit<MapPlayer, 'nickname'>) => void;
  left: (info: { playerId: string; reason: string }) => void;
  correct: (pos: { x: number; y: number }) => void;
  replaced: () => void;
  battleUpdate: (update: BattleUpdate) => void;
  battleInvite: (invite: BattleInvite) => void;
  wildChanged: (wild: WildInfo) => void;
  reconnected: () => void; // 끊겼다가 다시 붙어 hello까지 끝난 뒤(진행 중 전투 등을 다시 맞출 시점)
  returnToVillage: () => void; // v15: 서버가 오프닝 미완료로 남은 탐험 세션을 닫았다 — 마을로
}

class RoomClient {
  private socket: Socket | null = null;
  private listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();
  private helloPromise: Promise<void> | null = null;
  private helloSeq = 0; // 접속 인증 시도 번호 — 새 시도가 시작되면 앞선 시도의 응답은 버린다
  private abortHello: (() => void) | null = null;
  playerId: string | null = null;
  room: RoomState | null = null;
  resumeInMap = false; // hello 응답: 이어받은 탐험 세션에서 맵 안에 있었는가(새로고침 뒤 Map 복원의 근거 — 서버 응답만 쓴다)
  activeBattle: BattleSnapshot | null = null; // hello 응답으로 받은 진행 중 전투(새로고침·재접속 복구)
  readonly others = new Map<string, MapPlayer>();
  private clockOffset = 0; // 서버 시각 - 브라우저 시각(ms). 카운트다운 표시 보정용이고 만료 판정은 언제나 서버가 한다

  // 서버가 snapshot에 실어 보낸 serverNow로 시계 오차를 갱신한다(가장 최근 값 기준)
  observeServerTime(serverNow: unknown) {
    if (typeof serverNow === 'number' && Number.isFinite(serverNow)) this.clockOffset = serverNow - Date.now();
  }

  // 서버 기준 현재 시각(ms) — expiresAt과 비교해 남은 시간을 표시할 때 쓴다
  now() {
    return Date.now() + this.clockOffset;
  }

  // 서버가 소유한 야생 터비 마커(위치·종류·상태). 화면·미니맵·전체 지도는 이 값만 쓴다(클라이언트 설정에 좌표가 없다)
  readonly wilds = new Map<number, WildInfo>();

  // 방 입장 순서 = 참가자 슬롯(색). 방에 없으면 0
  slotOf(playerId: string): number {
    const i = this.room?.members.findIndex((m) => m.playerId === playerId) ?? -1;
    return i + 1;
  }

  private setWilds(list: WildInfo[] | undefined) {
    this.wilds.clear();
    (list ?? []).forEach((w) => this.wilds.set(w.index, w));
  }

  on<K extends keyof Events>(event: K, fn: Events[K]) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn as (...args: never[]) => void);
    this.listeners.set(event, set);
    return () => {
      set.delete(fn as (...args: never[]) => void);
    };
  }

  private emitLocal<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
    this.listeners.get(event)?.forEach((fn) => (fn as (...a: Parameters<Events[K]>) => void)(...args));
  }

  // 연결하고 접속 인증(presence:hello)까지 끝낸다. 끊겼다가 다시 붙으면 자동으로 hello를 다시 보내 방 세션을 이어받는다.
  // fresh: 진행 중인 시도를 버리고 새로 시도한다(복원 화면의 "다시 시도"). 버린 시도의 응답이 늦게 와도 상태를 덮지 않는다.
  // hello는 방을 만들지 않고 있던 세션을 이어받기만 하므로 여러 번 보내도 방이 늘지 않는다
  async connect(opts: { fresh?: boolean } = {}): Promise<void> {
    if (!opts.fresh) {
      if (this.socket?.connected && this.playerId) return;
      if (this.helloPromise) return this.helloPromise;
    }
    const seq = ++this.helloSeq;
    this.abortHello?.();

    const attempt: Promise<void> = new Promise<void>((resolve, reject) => {
      const socket = this.socket ?? io(BASE_URL, { transports: ['websocket'] });
      if (!this.socket) {
        this.socket = socket;
        this.bind(socket);
      }
      const superseded = () => new RoomApiError('SUPERSEDED', '새로 시도한 접속으로 바뀌었습니다.');
      const hello = async () => {
        if (seq !== this.helloSeq) return;
        try {
          // HTTP /player/me/* 와 같은 세션 토큰을 보낸다. 토큰이 거부되면 session.run이 재식별을 한 번만 하고 다시 보낸다.
          const res = await session.run(async (token) => {
            const ack = (await socket.timeout(HELLO_TIMEOUT_MS).emitWithAck('presence:hello', helloPayload(getPlayerId(), token))) as Ack<{ playerId: string; room: RoomState | null; players: MapPlayer[]; battle: BattleSnapshot | null; inMap?: boolean; wilds?: WildInfo[]; returnToVillage?: boolean }>;
            if (!ack.ok) throw new RoomApiError(ack.code, ack.message);
            return ack;
          });
          if (seq !== this.helloSeq) return reject(superseded()); // 오래된 응답 — 새 시도의 결과를 덮지 않는다
          this.playerId = res.playerId;
          this.room = res.room;
          this.activeBattle = res.battle ?? null;
          this.resumeInMap = res.inMap === true;
          this.observeServerTime(res.battle?.serverNow);
          this.setWilds(res.wilds);
          this.others.clear();
          res.players.forEach((p) => this.others.set(p.playerId, p));
          this.emitLocal('state', this.room);
          if (res.returnToVillage) this.emitLocal('returnToVillage');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      const onConnect = () => void hello();
      const onError = (err: Error) => reject(err);
      this.abortHello = () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        reject(superseded());
      };
      if (socket.connected) void hello();
      else {
        socket.once('connect', onConnect);
        socket.once('connect_error', onError);
      }
    }).finally(() => {
      if (this.helloPromise === attempt) {
        this.helloPromise = null;
        this.abortHello = null;
      }
    });
    this.helloPromise = attempt;
    return attempt;
  }

  private bind(socket: Socket) {
    // 재연결(네트워크 끊김 후)에는 hello를 다시 보내 유예 시간 안이면 방 세션을 이어받는다
    socket.io.on('reconnect', () => void this.connect().then(() => this.emitLocal('reconnected')).catch(() => undefined));
    socket.on('room:state', (room: RoomState) => {
      this.room = room;
      this.emitLocal('state', room);
    });
    socket.on('map:joined', ({ player }: { player: MapPlayer }) => {
      this.others.set(player.playerId, player);
      this.emitLocal('joined', player);
    });
    socket.on('map:moved', (p: Omit<MapPlayer, 'nickname'>) => {
      const known = this.others.get(p.playerId);
      if (known) Object.assign(known, { x: p.x, y: p.y, dir: p.dir });
      this.emitLocal('moved', p);
    });
    socket.on('map:left', (info: { playerId: string; reason: string }) => {
      this.others.delete(info.playerId);
      this.emitLocal('left', info);
    });
    socket.on('battle:update', (u: BattleUpdate) => {
      this.observeServerTime(u.snapshot?.serverNow);
      this.emitLocal('battleUpdate', u);
    });
    socket.on('battle:invite', (i: BattleInvite) => {
      this.observeServerTime(i.snapshot?.serverNow);
      this.emitLocal('battleInvite', i);
    });
    socket.on('wild:changed', (w: WildInfo) => {
      this.wilds.set(w.index, w);
      this.emitLocal('wildChanged', w);
    });
    socket.on('map:correct', (pos: { x: number; y: number; reason?: string }) => this.emitLocal('correct', pos));
    socket.on('presence:replaced', () => {
      // 다른 탭이 같은 계정으로 접속해 이 탭은 밀려남 — 자동 재연결하지 않는다
      if (this.socket) this.socket.io.opts.reconnection = false;
      this.room = null;
      this.activeBattle = null;
      this.others.clear();
      this.emitLocal('replaced');
    });
  }

  async request<T>(event: string, body?: unknown): Promise<T> {
    await this.connect();
    const res = (await this.socket!.timeout(5000).emitWithAck(event, body)) as Ack<T>;
    if (!res.ok) {
      this.observeServerTime(res.snapshot?.serverNow);
      throw new RoomApiError(res.code, res.message, res.snapshot ?? null, res.reason ?? null);
    }
    this.observeServerTime((res as { snapshot?: BattleSnapshot }).snapshot?.serverNow);
    return res as unknown as T;
  }

  get hasRoom() {
    return this.room !== null;
  }

  async createRoom(stageCode: string): Promise<RoomState> {
    this.room = (await this.request<{ room: RoomState }>('room:create', { stageCode })).room;
    this.others.clear();
    this.wilds.clear(); // 새 탐험 세션 — 야생 마커는 맵 입장 응답으로 다시 받는다
    this.emitLocal('state', this.room);
    return this.room;
  }

  async startRoom(): Promise<RoomState> {
    this.room = (await this.request<{ room: RoomState }>('room:start')).room;
    this.emitLocal('state', this.room);
    return this.room;
  }

  async leaveRoom(): Promise<void> {
    if (!this.room) return;
    try {
      await this.request('room:leave');
    } catch (err) {
      if (!(err instanceof RoomApiError && err.code === 'NOT_IN_ROOM')) throw err;
    } finally {
      this.room = null;
      this.others.clear();
      this.wilds.clear();
      this.emitLocal('state', null);
    }
  }

  // 1인 방 자동 생성+시작 — 이미 방에 있으면 먼저 나간다
  async startSolo(stageCode: string): Promise<RoomState> {
    await this.connect();
    await this.leaveRoom();
    await this.createRoom(stageCode);
    return this.startRoom();
  }

  // M4-C: 마지막 맵 입장 때 서버가 알려 준 이야기(재생할 구간·전달 목표). 없으면 null
  storyOnEnter: { play: StoryPlay | null; delivery: StoryDelivery | null } | null = null;

  // 10-02 v4: 입장 위치는 서버가 정한다(좌표를 보내지 않는다). 응답의 self가 서버가 확정한 내 위치, corrected = 저장돼 있던 위치를 시작 지점으로 보정했는가
  selfOnEnter: { x: number; y: number; corrected: boolean } | null = null;

  async enterMap(dir: Facing): Promise<MapPlayer[]> {
    const res = await this.request<{ self: { x: number; y: number }; corrected?: boolean; players: MapPlayer[]; wilds: WildInfo[]; story?: { play: StoryPlay | null; delivery: StoryDelivery | null } | null }>('map:enter', { dir });
    this.selfOnEnter = res.self ? { x: res.self.x, y: res.self.y, corrected: res.corrected === true } : null;
    this.storyOnEnter = res.story ?? null;
    this.setWilds(res.wilds);
    this.others.clear();
    res.players.forEach((p) => this.others.set(p.playerId, p));
    return res.players;
  }

  // 이동 보고 — 성공 시 서버 응답이 없다(오류만 ack). 호출 빈도는 호출자가 120ms로 맞춘다
  sendMove(x: number, y: number, dir: Facing) {
    if (!this.socket?.connected) return;
    this.socket.emit('map:move', { x, y, dir });
  }
}

export const roomClient = new RoomClient();

if (import.meta.env.DEV) (window as unknown as { __rooms?: RoomClient }).__rooms = roomClient; // 두 탭 수동 테스트용
