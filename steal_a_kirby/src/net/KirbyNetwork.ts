import { io, type Socket } from 'socket.io-client';
import { api, getOrCreateDeviceUuid, type PlayerStateDto, type KirbyInstanceDto } from '../api/client';

// 사용자 지적(2026-09-18): api/client.ts와 동일한 이유로 .env(VITE_KIRBY_SERVER_URL)에서 읽어옴.
const URL = import.meta.env.VITE_KIRBY_SERVER_URL ?? 'http://localhost:3003';

export interface InvasionStartedEvent {
  instanceId: string;
  viewerPlayerId: string;
  characterName: string;
}
export interface InvasionHitEvent {
  instanceId: string;
  hitCount: number;
}
export interface InvasionResolvedEvent {
  instanceId: string;
  result: 'success' | 'failed';
  reason?: string;
  newOwnerId?: string;
}
export interface InvasionPositionEvent {
  instanceId: string;
  playerId: string;
  x: number;
  y: number;
}
export interface LobbyPositionEvent {
  playerId: string;
  x: number;
  y: number;
}
export interface LobbyLeftEvent {
  playerId: string;
}
export interface LobbyEmoteEvent {
  playerId: string;
  emote: 'happy';
}

type Handlers = {
  stateChanged: (state: PlayerStateDto) => void;
  invasionStarted: (e: InvasionStartedEvent) => void;
  invasionHit: (e: InvasionHitEvent) => void;
  invasionResolved: (e: InvasionResolvedEvent) => void;
  invasionPosition: (e: InvasionPositionEvent) => void;
  lobbyPosition: (e: LobbyPositionEvent) => void;
  lobbyLeft: (e: LobbyLeftEvent) => void;
  lobbyEmote: (e: LobbyEmoteEvent) => void;
  connectionChanged: (connected: boolean) => void;
};

/**
 * 화면 구성(9번 작업순서, 재설계 예정)과 완전히 분리된 실시간 통신 계층.
 * 어떤 씬 구조로 화면을 다시 잡든, 씬들은 이 클래스의 메서드/이벤트만 쓰면 되고
 * 소켓 연결·재연결·room 관리 같은 배관은 여기 안에서 전부 처리한다(7번 확정: Socket.io 기반).
 *
 * 사용법: 앱 부팅 시 한 번 connect()를 호출해두면, 이후 어느 씬에서든
 * kirbyNetwork.on(...)/off(...)로 이벤트를 구독하고 kirbyNetwork.state로 최신 상태를 읽으면 됨.
 */
class KirbyNetwork {
  private socket: Socket | null = null;
  private listeners: { [K in keyof Handlers]: Set<Handlers[K]> } = {
    stateChanged: new Set(),
    invasionStarted: new Set(),
    invasionHit: new Set(),
    invasionResolved: new Set(),
    invasionPosition: new Set(),
    lobbyPosition: new Set(),
    lobbyLeft: new Set(),
    lobbyEmote: new Set(),
    connectionChanged: new Set(),
  };

  playerId = '';
  state: PlayerStateDto | null = null;
  connected = false;
  private connectPromise: Promise<void> | null = null;
  private sessionToken = ''; // Codex QA 지적(2026-09-18) 반영 — presence:hello 등록에 필요

  // BE가 아직 안 떠 있어도 실패로 끝나지 않고, 다음 connect() 호출(예: 재시도 버튼)에서 다시 시도할 수 있도록
  // 실패 시 connectPromise를 비워둠 — 계속 캐시된 실패 Promise를 재사용하면 영원히 재연결 불가능해짐.
  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect().catch((err) => {
      this.connectPromise = null;
      throw err;
    });
    return this.connectPromise;
  }

  private async doConnect() {
    const deviceUuid = getOrCreateDeviceUuid();
    const identified = await api.identify(deviceUuid);
    this.state = identified;
    this.playerId = identified.playerId;
    this.sessionToken = identified.sessionToken;
    this.emit('stateChanged', this.state);

    this.socket = io(URL, { transports: ['websocket'] });

    // 'connect'는 재연결마다 다시 발생하는 상시 리스너 하나만 둠 — 최초 연결과 재연결을 같은 경로로 처리
    // (끊겼다 살아나도 presence/room 상태가 자동으로 복구됨).
    this.socket.on('connect', () => {
      this.connected = true;
      this.emit('connectionChanged', true);
      void this.afterSocketConnected();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emit('connectionChanged', false);
    });

    this.socket.on('invasion:started', (p: InvasionStartedEvent) => {
      this.emit('invasionStarted', p);
      // 5.1-② 확정: 내 기지에서 벌어지는 침입은 실시간으로 나에게도 보여야 함
      const mine = this.state?.kirbies.find((k) => k.instanceId === p.instanceId);
      if (mine) {
        mine.status = 'stolen_in_transit';
        this.emit('stateChanged', this.state!);
      }
    });
    this.socket.on('invasion:hit', (p: InvasionHitEvent) => this.emit('invasionHit', p));
    this.socket.on('invasion:resolved', (p: InvasionResolvedEvent) => {
      this.emit('invasionResolved', p);
      // 성공 시 새 주인이 된 침입자 쪽은 로컬 캐시에 그 커비가 아예 없었으므로(원래 남의 기지 소유물)
      // 목록에 추가해줄 수 없음 — 서버가 진실의 원천이므로 그냥 다시 조회해서 동기화.
      if (p.result === 'success' && p.newOwnerId === this.playerId) {
        void this.refreshState();
        return;
      }
      if (!this.state) return;
      const mine = this.state.kirbies.find((k) => k.instanceId === p.instanceId);
      if (!mine) return;
      if (p.result === 'success') {
        this.state.kirbies = this.state.kirbies.filter((k) => k.instanceId !== p.instanceId);
      } else {
        mine.status = 'idle';
      }
      this.emit('stateChanged', this.state);
    });
    this.socket.on('invasion:position', (p: InvasionPositionEvent) => this.emit('invasionPosition', p));
    this.socket.on('lobby:position', (p: LobbyPositionEvent) => this.emit('lobbyPosition', p));
    this.socket.on('lobby:left', (p: LobbyLeftEvent) => this.emit('lobbyLeft', p));
    this.socket.on('lobby:emote', (p: LobbyEmoteEvent) => this.emit('lobbyEmote', p));

    // 최초 연결이 실제로 될 때까지만 기다림(이후 재연결은 위 상시 'connect' 핸들러가 알아서 처리) —
    // socket.io 기본 옵션은 자동 재연결을 시도하므로, 여기서 타임아웃/실패해도 백그라운드에서 계속 재시도함.
    await new Promise<void>((resolve, reject) => {
      this.socket!.once('connect', () => resolve());
      this.socket!.once('connect_error', (err) => {
        // 최초 연결 실패 시엔 백그라운드 재시도 루프를 남겨두지 않고 정리 — 나중에 connect()를
        // 다시 부르면(예: 재시도 버튼) 깨끗한 새 소켓으로 다시 시작함.
        this.socket?.disconnect();
        this.socket = null;
        reject(err);
      });
    });
  }

  private async afterSocketConnected() {
    await this.emitAsync('presence:hello', { playerId: this.playerId, sessionToken: this.sessionToken });
    await this.emitAsync('base:enter', { viewerPlayerId: this.playerId, targetPlayerId: this.playerId });
  }

  on<K extends keyof Handlers>(event: K, handler: Handlers[K]) {
    this.listeners[event].add(handler as never);
  }

  off<K extends keyof Handlers>(event: K, handler: Handlers[K]) {
    this.listeners[event].delete(handler as never);
  }

  private emit<K extends keyof Handlers>(event: K, payload: Parameters<Handlers[K]>[0]) {
    for (const handler of this.listeners[event]) (handler as (p: typeof payload) => void)(payload);
  }

  private emitAsync<T = unknown>(event: string, payload: unknown): Promise<T> {
    if (!this.socket?.connected) {
      return Promise.reject(new Error(`소켓이 연결되지 않았습니다(${event}) — 서버가 켜져 있는지 확인하세요`));
    }
    return new Promise((resolve) => this.socket!.emit(event, payload, resolve));
  }

  private async refreshState() {
    this.state = await api.getState(this.playerId);
    this.emit('stateChanged', this.state);
  }

  // ----- 경제(2.2/2.3/2.4) -----
  async buy() {
    const res = await api.buy(this.playerId);
    this.state = res.player;
    this.emit('stateChanged', this.state);
    return res.bought;
  }

  async sell(instanceId: string) {
    this.state = await api.sell(this.playerId, instanceId);
    this.emit('stateChanged', this.state);
  }

  // 초당 발생 재화(2026-09-18 요청) — 캐릭터 터치 시 정산된 골드를 수금
  async collect(instanceId: string) {
    const res = await api.collect(this.playerId, instanceId);
    this.state = res.player;
    this.emit('stateChanged', this.state);
    return res.collected;
  }

  // ----- 기지 잠금/오프라인 운영(4.4/4.5) -----
  async updateSettings(body: Parameters<typeof api.updateSettings>[1]) {
    this.state = await api.updateSettings(this.playerId, body);
    this.emit('stateChanged', this.state);
  }

  // 화면 재설계 후 "다른 기지 목록" UI에서 바로 쓸 수 있도록 준비해둔 조회(현재는 접속 중인 playerId만)
  listOnlinePlayers() {
    return this.emitAsync<{ ok: boolean; playerIds: string[] }>('base:listOnline', { excludingPlayerId: this.playerId });
  }

  // ----- 마을(로비) 앰비언트 프레즌스 — 사용자 지적(2026-09-18): 로비에서 다른 접속자 캐릭터가 안 보이던 문제 -----
  enterLobby() {
    return this.emitAsync<{ ok: boolean; players?: { playerId: string; x: number; y: number }[] }>('lobby:enter', {});
  }

  leaveLobby() {
    return this.emitAsync<{ ok: boolean }>('lobby:leave', {});
  }

  // 로비 이모트(코덱스 to_claude_v3_C) — 종류만 보내고 발신자는 서버가 소켓 신원으로 확정
  sendLobbyEmote(emote: 'happy') {
    return this.emitAsync<{ ok: boolean; reason?: string }>('lobby:emote', { emote });
  }

  reportLobbyMove(x: number, y: number) {
    return this.emitAsync('lobby:move', { x, y });
  }

  // ----- 침입(5/6번) -----
  enterBase(targetPlayerId: string) {
    return this.emitAsync<{ ok: boolean; reason?: string; access?: unknown; ownerOnline?: boolean; kirbies?: KirbyInstanceDto[] }>(
      'base:enter',
      { viewerPlayerId: this.playerId, targetPlayerId },
    );
  }

  selectTarget(targetPlayerId: string, instanceId: string) {
    return this.emitAsync<{ ok: boolean; reason?: string }>('invasion:select', {
      viewerPlayerId: this.playerId,
      targetPlayerId,
      instanceId,
    });
  }

  reportMove(targetPlayerId: string, instanceId: string, x: number, y: number) {
    return this.emitAsync('invasion:move', { instanceId, targetPlayerId, playerId: this.playerId, x, y });
  }

  attack(targetPlayerId: string, instanceId: string) {
    return this.emitAsync<{ ok: boolean; hit?: boolean; hitCount?: number }>('invasion:attack', { instanceId, targetPlayerId });
  }

  exit(targetPlayerId: string, instanceId: string) {
    return this.emitAsync<{ ok: boolean; result?: 'success' | 'failed' }>('invasion:exit', {
      viewerPlayerId: this.playerId,
      targetPlayerId,
      instanceId,
    });
  }
}

export const kirbyNetwork = new KirbyNetwork();
