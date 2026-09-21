import { Injectable } from '@nestjs/common';
import type { ActiveInvasion } from './invasion.types';

// 6번 확정: 방망이(1차 출시 유일 무기) — 근접 콜리전 판정 + 누적 3회 명중 = 붙잡힘
const BAT_HITS_REQUIRED = 3;
const BAT_HIT_RADIUS_PX = 48;

// Codex QA 지적(2026-09-18) 반영: 좌표 위조/순간이동 방지용 검증 상수.
// AVATAR_SPEED(FE config/constants.ts, 200px/s)에 네트워크 지연 여유를 곱한 값 — 이보다 빠른 이동은 거부.
const MAX_SPEED_PX_PER_MS = (200 * 3) / 1000;
const EMOTE_MIN_INTERVAL_MS = 4500;
const WORLD_BOUNDS = { minX: 0, minY: 0, maxX: 1280, maxY: 720 };

// Codex QA 지적(2026-09-17, noti_v1_C.md) 반영: exit()이 좌표를 전혀 검증하지 않아 조작된
// 클라이언트가 문까지 이동하지 않고도 invasion:exit만 호출해서 탈출할 수 있던 문제 수정.
// 1280x720 월드 좌표 기준 — FE(steal_a_kirby/src/scenes/BaseScene.ts)의 EXIT_ZONE과 반드시 동일해야 함.
const EXIT_ZONE = { x: 605, y: 635, radius: 90 };

// Codex QA 지적(2026-09-18, to_claude_v2_C.md §3-1/2) 반영: 침입 시작 시 최초 위치를 클라이언트
// 자기신고에 맡기지 않고 서버가 직접 스폰 좌표로 고정한다 — 그래야 "첫 이동 보고를 곧장 출입문
// 좌표로 보내는" 우회를 속도검증(updatePosition)이 처음부터 막을 수 있다.
// FE(BaseScene.ts createChaseUi)의 시작 좌표 계산과 동일해야 한다(MOVE_BOUNDS 변경 시 함께 갱신 — 2026-09-21 재정렬).
const OWNER_SPAWN = { x: 190, y: 450 }; // FE createChaseUi: (MOVE_BOUNDS.minX+100, 세로 중앙)
const VIEWER_SPAWN = { x: 640, y: 280 }; // FE createChaseUi: (캔버스 중앙, MOVE_BOUNDS.minY+60)

@Injectable()
export class InvasionService {
  // 온라인 판정(4.4/4.5의 "ownerIsOnline") — 소켓 연결 수 기준
  private onlineSockets = new Map<string, Set<string>>(); // playerId -> socketIds
  private socketToPlayer = new Map<string, string>(); // socketId -> playerId

  // instanceId -> 진행 중인 침입 정보
  private activeInvasions = new Map<string, ActiveInvasion>();

  // 마을(로비) 앰비언트 위치 — 사용자 지적(2026-09-18): "마을에서 상대가 안 보인다"는 애초에
  // 구현이 없던 기능. playerId -> 로비 안에서의 마지막 좌표(로비를 나가면 삭제).
  private lobbyPositions = new Map<string, { x: number; y: number }>();

  setLobbyPosition(playerId: string, x: number, y: number) {
    this.lobbyPositions.set(playerId, { x, y });
  }

  removeLobbyPosition(playerId: string) {
    this.lobbyPositions.delete(playerId);
  }

  // 로비를 나갔다 들어와도 빈도 제한을 우회하지 못하도록 완전 오프라인일 때만 정리
  clearEmoteState(playerId: string) {
    this.lastEmoteAt.delete(playerId);
  }

  // 로비 이모트(코덱스 to_claude_v3_C, 2026-09-21) — 표시 2초+쿨다운 3초=5초 주기, 네트워크 지연 여유 0.5초를 둔 서버측 빈도 제한
  private lastEmoteAt = new Map<string, number>();

  tryEmote(playerId: string): boolean {
    const now = Date.now();
    const last = this.lastEmoteAt.get(playerId) ?? 0;
    if (now - last < EMOTE_MIN_INTERVAL_MS) return false;
    this.lastEmoteAt.set(playerId, now);
    return true;
  }

  listLobbyPositions(excludingPlayerId?: string): { playerId: string; x: number; y: number }[] {
    return [...this.lobbyPositions.entries()]
      .filter(([playerId]) => playerId !== excludingPlayerId)
      .map(([playerId, pos]) => ({ playerId, ...pos }));
  }

  registerSocket(playerId: string, socketId: string) {
    this.socketToPlayer.set(socketId, playerId);
    if (!this.onlineSockets.has(playerId)) this.onlineSockets.set(playerId, new Set());
    this.onlineSockets.get(playerId)!.add(socketId);
  }

  unregisterSocket(socketId: string): { playerId: string; wentOffline: boolean } | null {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;
    this.socketToPlayer.delete(socketId);
    const set = this.onlineSockets.get(playerId);
    set?.delete(socketId);
    const wentOffline = !set || set.size === 0;
    if (wentOffline) this.onlineSockets.delete(playerId);
    return { playerId, wentOffline };
  }

  isOnline(playerId: string): boolean {
    return (this.onlineSockets.get(playerId)?.size ?? 0) > 0;
  }

  // Codex QA 지적(2026-09-18) 반영: 소켓이 실제로 어떤 playerId로 등록됐는지 서버가 직접 조회 —
  // 이후 move/attack/exit는 요청 본문의 자기신고 대신 이 값을 신원의 기준으로 삼는다.
  getPlayerIdBySocket(socketId: string): string | undefined {
    return this.socketToPlayer.get(socketId);
  }

  // 화면 재설계 시 "다른 기지 목록"류 UI에서 바로 쓸 수 있도록 미리 준비해둔 조회 — playerId를
  // 직접 입력받는 임시 UI(window.prompt)를 대체할 때 사용
  listOnlinePlayerIds(excludingPlayerId?: string): string[] {
    return [...this.onlineSockets.keys()].filter((id) => id !== excludingPlayerId);
  }

  startInvasion(instanceId: string, ownerPlayerId: string, viewerPlayerId: string) {
    const now = Date.now();
    const positions = new Map([
      [ownerPlayerId, { ...OWNER_SPAWN, t: now }],
      [viewerPlayerId, { ...VIEWER_SPAWN, t: now }],
    ]);
    const invasion: ActiveInvasion = { instanceId, ownerPlayerId, viewerPlayerId, hitCount: 0, positions };
    this.activeInvasions.set(instanceId, invasion);
    return invasion;
  }

  getInvasion(instanceId: string) {
    return this.activeInvasions.get(instanceId);
  }

  // Codex QA 지적(2026-09-18) 반영: 좌표값 자체가 유효 범위인지, 그리고 마지막 좌표로부터
  // 물리적으로 가능한 속도 내에서 이동했는지 검증 — 출입문 좌표로 순간이동 보고하는 걸 막는다.
  updatePosition(instanceId: string, playerId: string, x: number, y: number): boolean {
    const invasion = this.activeInvasions.get(instanceId);
    if (!invasion) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || y < WORLD_BOUNDS.minY || y > WORLD_BOUNDS.maxY) return false;

    const now = Date.now();
    const prev = invasion.positions.get(playerId);
    if (prev) {
      const elapsedMs = Math.max(now - prev.t, 1);
      const dist = Math.hypot(x - prev.x, y - prev.y);
      if (dist > MAX_SPEED_PX_PER_MS * elapsedMs) return false;
    }

    invasion.positions.set(playerId, { x, y, t: now });
    return true;
  }

  // 서버 권위 명중 판정 — 소유자가 마지막으로 보고한 좌표와 침입자의 마지막 좌표 간 거리로 콜리전 체크(직접 타격)
  tryAttack(instanceId: string): { hit: boolean; hitCount: number; captured: boolean } | null {
    const invasion = this.activeInvasions.get(instanceId);
    if (!invasion) return null;
    const ownerPos = invasion.positions.get(invasion.ownerPlayerId);
    const viewerPos = invasion.positions.get(invasion.viewerPlayerId);
    if (!ownerPos || !viewerPos) return { hit: false, hitCount: invasion.hitCount, captured: false };

    const dx = ownerPos.x - viewerPos.x;
    const dy = ownerPos.y - viewerPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > BAT_HIT_RADIUS_PX) {
      return { hit: false, hitCount: invasion.hitCount, captured: false };
    }

    invasion.hitCount += 1;
    const captured = invasion.hitCount >= BAT_HITS_REQUIRED;
    return { hit: true, hitCount: invasion.hitCount, captured };
  }

  // 서버 권위 탈출 판정 — 침입자의 마지막 보고 좌표가 출입문 Zone 반경 안에 있는지 검증
  isNearExit(instanceId: string, playerId: string): boolean {
    const pos = this.activeInvasions.get(instanceId)?.positions.get(playerId);
    if (!pos) return false;
    const dx = pos.x - EXIT_ZONE.x;
    const dy = pos.y - EXIT_ZONE.y;
    return Math.sqrt(dx * dx + dy * dy) <= EXIT_ZONE.radius;
  }

  endInvasion(instanceId: string) {
    this.activeInvasions.delete(instanceId);
  }

  // 특정 플레이어가 관여 중인 활성 침입 목록(연결 종료 시 정리용)
  findInvasionsInvolving(playerId: string): ActiveInvasion[] {
    return [...this.activeInvasions.values()].filter(
      (inv) => inv.viewerPlayerId === playerId || inv.ownerPlayerId === playerId,
    );
  }
}
