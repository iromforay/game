import { Injectable } from '@nestjs/common';
import {
  COLOR_BLASTERS_ZONES,
  type BattleMatch,
  type BattlePlayerState,
  type BattlePosition,
  type BattleVector3,
  type ColorBlastersZone,
} from './color-blasters.types';

const REQUIRED_ZONES = 4;
const FIRE_INTERVAL_MS = 140;
const ARENA_X = 10.5;
const ARENA_Z = 13.5;
const PLAYER_RADIUS = 0.55;
// FE threeAssets arenaBarrier의 기초·지지대를 포함한 월드 경계와 동일하게 유지한다.
const COVER_BOUNDS = [
  { minX: -5.36, maxX: -3.44, minY: 0, maxY: 3.05, minZ: -3.25, maxZ: 0.25 },
  { minX: 3.44, maxX: 5.36, minY: 0, maxY: 3.05, minZ: -0.25, maxZ: 3.25 },
  { minX: -2.55, maxX: 2.55, minY: 0, maxY: 3.05, minZ: -7.16, maxZ: -5.24 },
  { minX: -2.55, maxX: 2.55, minY: 0, maxY: 3.05, minZ: 5.24, maxZ: 7.16 },
] as const;

@Injectable()
export class ColorBlastersService {
  private waiting: BattlePlayerState | null = null;
  private readonly matches = new Map<string, BattleMatch>();
  private readonly matchOfSocket = new Map<string, string>();

  joinQueue(playerId: string, socketId: string) {
    this.leave(socketId);
    const player = this.makePlayer(playerId, socketId, 9.5);
    if (!this.waiting || this.waiting.socketId === socketId) {
      this.waiting = player;
      return { status: 'waiting' as const };
    }
    const opponent = this.waiting;
    this.waiting = null;
    opponent.position.z = 9.5;
    player.position.z = -10.5;
    const match: BattleMatch = {
      matchId: `CB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      players: [opponent, player],
      startedAt: Date.now(),
      finished: false,
    };
    this.matches.set(match.matchId, match);
    for (const member of match.players) this.matchOfSocket.set(member.socketId, match.matchId);
    return { status: 'matched' as const, match: this.snapshot(match) };
  }

  move(socketId: string, position: BattlePosition) {
    const match = this.requireMatch(socketId);
    const player = this.requirePlayer(match, socketId);
    const requestedX = this.clampFinite(position.x, -ARENA_X, ARENA_X);
    const requestedZ = this.clampFinite(position.z, -ARENA_Z, ARENA_Z);
    if (!this.insideCover(requestedX, player.position.z)) player.position.x = requestedX;
    if (!this.insideCover(player.position.x, requestedZ)) player.position.z = requestedZ;
    player.position.facing = this.clampFinite(position.facing, -Math.PI, Math.PI);
    return this.snapshot(match);
  }

  fire(socketId: string, origin: BattleVector3, direction: BattleVector3, now = Date.now()) {
    const match = this.requireMatch(socketId);
    if (match.finished) throw new Error('MATCH_FINISHED');
    const shooter = this.requirePlayer(match, socketId);
    if (now - shooter.lastShotAt < FIRE_INTERVAL_MS) throw new Error('FIRE_RATE_LIMIT');
    const shotOrigin = this.validVector(origin);
    const shotDirection = this.normalize(this.validVector(direction));
    if (Math.hypot(shotOrigin.x - shooter.position.x, shotOrigin.z - shooter.position.z) > 2) throw new Error('INVALID_ORIGIN');
    shooter.lastShotAt = now;
    const target = match.players.find((player) => player.socketId !== socketId)!;
    const hit = this.hitZone(shotOrigin, shotDirection, target.position);
    const coverDistance = this.firstCoverDistance(shotOrigin, shotDirection);
    const zone = hit && (coverDistance === null || hit.distance < coverDistance) ? hit.zone : null;
    if (zone) target.paintedZones.add(zone);
    if (target.paintedZones.size >= REQUIRED_ZONES) match.finished = true;
    return {
      state: this.snapshot(match),
      hitZone: zone,
      result: match.finished ? { winnerId: shooter.playerId, loserId: target.playerId } : null,
    };
  }

  leave(socketId: string) {
    if (this.waiting?.socketId === socketId) this.waiting = null;
    const matchId = this.matchOfSocket.get(socketId);
    if (!matchId) return null;
    const match = this.matches.get(matchId);
    this.matches.delete(matchId);
    if (!match) return null;
    for (const player of match.players) this.matchOfSocket.delete(player.socketId);
    const survivor = match.players.find((player) => player.socketId !== socketId);
    return survivor ? { matchId, survivorSocketId: survivor.socketId, winnerId: survivor.playerId } : null;
  }

  private makePlayer(playerId: string, socketId: string, z: number): BattlePlayerState {
    return { playerId, socketId, position: { x: 7, z, facing: 0 }, paintedZones: new Set(), lastShotAt: 0 };
  }

  private requireMatch(socketId: string) {
    const matchId = this.matchOfSocket.get(socketId);
    const match = matchId ? this.matches.get(matchId) : null;
    if (!match) throw new Error('MATCH_NOT_FOUND');
    return match;
  }

  private requirePlayer(match: BattleMatch, socketId: string) {
    const player = match.players.find((member) => member.socketId === socketId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    return player;
  }

  private clampFinite(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(min, Math.min(max, value));
  }

  private validVector(value: BattleVector3) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) throw new Error('INVALID_VECTOR');
    return value;
  }

  private normalize(vector: BattleVector3) {
    const length = Math.hypot(vector.x, vector.y, vector.z);
    if (length < 0.001) throw new Error('INVALID_DIRECTION');
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  private insideCover(x: number, z: number) {
    return COVER_BOUNDS.some((cover) => (
      x >= cover.minX - PLAYER_RADIUS && x <= cover.maxX + PLAYER_RADIUS
      && z >= cover.minZ - PLAYER_RADIUS && z <= cover.maxZ + PLAYER_RADIUS
    ));
  }

  private firstCoverDistance(origin: BattleVector3, direction: BattleVector3) {
    let nearest: number | null = null;
    for (const cover of COVER_BOUNDS) {
      let minimum = 0;
      let maximum = 45;
      for (const axis of ['x', 'y', 'z'] as const) {
        const axisDirection = direction[axis];
        const low = cover[`min${axis.toUpperCase() as 'X' | 'Y' | 'Z'}`];
        const high = cover[`max${axis.toUpperCase() as 'X' | 'Y' | 'Z'}`];
        if (Math.abs(axisDirection) < 0.0001) {
          if (origin[axis] < low || origin[axis] > high) { minimum = 46; break; }
          continue;
        }
        const first = (low - origin[axis]) / axisDirection;
        const second = (high - origin[axis]) / axisDirection;
        minimum = Math.max(minimum, Math.min(first, second));
        maximum = Math.min(maximum, Math.max(first, second));
        if (maximum < minimum) break;
      }
      if (minimum <= maximum && minimum >= 0 && (nearest === null || minimum < nearest)) nearest = minimum;
    }
    return nearest;
  }

  private hitZone(origin: BattleVector3, direction: BattleVector3, target: BattlePosition): { zone: ColorBlastersZone; distance: number } | null {
    const offsets: Record<ColorBlastersZone, [number, number, number, number]> = {
      head: [0, 4.02, 0, 0.68], torso: [0, 2.72, 0, 0.92],
      leftArm: [-1.02, 2.72, 0, 0.52], rightArm: [1.02, 2.72, 0, 0.52],
      leftLeg: [-0.43, 1.02, 0, 0.52], rightLeg: [0.43, 1.02, 0, 0.52],
    };
    let nearest: { zone: ColorBlastersZone; distance: number } | null = null;
    for (const zone of COLOR_BLASTERS_ZONES) {
      const [offsetX, offsetY, offsetZ, radius] = offsets[zone];
      const center = { x: target.x + offsetX, y: offsetY, z: target.z + offsetZ };
      const toCenter = { x: center.x - origin.x, y: center.y - origin.y, z: center.z - origin.z };
      const projection = toCenter.x * direction.x + toCenter.y * direction.y + toCenter.z * direction.z;
      if (projection < 0 || projection > 45) continue;
      const closest = {
        x: origin.x + direction.x * projection,
        y: origin.y + direction.y * projection,
        z: origin.z + direction.z * projection,
      };
      const distance = Math.hypot(closest.x - center.x, closest.y - center.y, closest.z - center.z);
      if (distance <= radius && (!nearest || projection < nearest.distance)) nearest = { zone, distance: projection };
    }
    return nearest;
  }

  private snapshot(match: BattleMatch) {
    return {
      matchId: match.matchId,
      startedAt: match.startedAt,
      finished: match.finished,
      players: match.players.map(({ playerId, socketId, position, paintedZones }) => ({
        playerId,
        socketId,
        position: { ...position },
        paintedZones: [...paintedZones],
      })),
    };
  }
}
