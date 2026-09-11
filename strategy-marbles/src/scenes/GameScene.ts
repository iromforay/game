import Phaser from 'phaser';
import {
  BOARD_CENTER_X,
  BOARD_CENTER_Y,
  BOARD_RADIUS,
  DEFAULT_PLAYER_COUNT,
  EGGS_PER_PLAYER,
  MAX_LAUNCH_SPEED,
  MAX_PULL_DISTANCE,
  MAX_TURNS,
  SCORE_HIT,
  SCORE_OUT,
  TURN_TIME_LIMIT_MS,
} from '../config/constants';
import { createStartingPositions } from '../config/board';
import { randomWeightTier } from '../config/weights';
import { mapUrl } from '../config/maps';
import type { RoundMapDef } from '../config/maps';
import { bounceToRestitution, floorFrictionToAir } from '../config/physics';
import { PIECES_URL, PIECE_ICON_FILES, pieceColorNumber, pieceTextureKey } from '../config/pieces';
import type { PieceDef } from '../config/pieces';
import { seededRandom } from '../config/rng';
import { Egg } from '../objects/Egg';
import { gameEvents, Events } from '../events';
import type { ScoreEntry } from '../events';
import type { EggOutcome, NetworkOptions, TurnActionPayload, TurnOutcomePayload } from '../network';

interface PlayerState {
  index: number;
  score: number;
  eggs: Egg[];
}

type Phase = 'aiming' | 'waiting' | 'resolving' | 'ended';

const SETTLE_SPEED_THRESHOLD = 0.05;
const RESOLUTION_TIMEOUT_MS = 6000;
const MIN_DRAG_DISTANCE = 8;

export class GameScene extends Phaser.Scene {
  playerCount = DEFAULT_PLAYER_COUNT;
  players: PlayerState[] = [];
  eggsById = new Map<number, Egg>();
  roundId = 1;
  map!: RoundMapDef;
  pieces: PieceDef[] = [];
  zoneFrictionAirBase: number[] = [];

  turnNumber = 1;
  phase: Phase = 'aiming';
  turnOrder: number[] = [];
  turnPointer = 0;
  activePlayerIndex: number | null = null;

  selectedEgg: Egg | null = null;
  dragging = false;
  pullGraphics!: Phaser.GameObjects.Graphics;

  timerEvent: Phaser.Time.TimerEvent | null = null;
  timerRemainingMs = TURN_TIME_LIMIT_MS;

  hitThisTurn = new Set<Egg>();
  lastHitBy = new Map<Egg, number>();
  resolutionStartedAt = 0;
  resolutionFinishing = false;

  network: NetworkOptions | null = null;
  selfPlayerIndex = 0;
  submittedThisTurn = false;

  constructor() {
    super('Game');
  }

  init(data: { roundId?: number; network?: NetworkOptions }) {
    this.roundId = data.roundId ?? 1;
    this.network = data.network ?? null;
    if (this.network) {
      this.playerCount = this.network.playerIds.length;
      this.selfPlayerIndex = Math.max(0, this.network.playerIds.indexOf(this.network.selfId));
    }
  }

  preload() {
    this.load.json(`map-${this.roundId}`, mapUrl(this.roundId));
    this.load.json('pieces', PIECES_URL);
    for (const file of PIECE_ICON_FILES) {
      this.load.svg(pieceTextureKey(`${file}.svg`), `/data/strategy-marbles/icons/${file}.svg`, { width: 64, height: 64 });
    }
  }

  create() {
    this.map = this.cache.json.get(`map-${this.roundId}`) as RoundMapDef;
    this.pieces = this.cache.json.get('pieces') as PieceDef[];

    // No world-bounds walls: eggs fly freely past the board circle and are
    // culled by our own distance-from-center check in finishResolution().
    this.matter.world.setGravity(0, 0);

    this.players = [];
    this.eggsById.clear();
    this.turnNumber = 1;
    this.phase = 'aiming';

    this.drawBoard();
    this.spawnEggs();

    this.pullGraphics = this.add.graphics().setDepth(20);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.matter.world.on('collisionstart', this.onCollisionStart, this);
    this.matter.world.on('collisionend', this.onCollisionEnd, this);

    gameEvents.on(Events.RequestRestart, () => this.scene.restart());
    this.events.on('shutdown', () => {
      gameEvents.removeAllListeners(Events.RequestRestart);
    });

    if (this.network) {
      const network = this.network;
      const onTurnResolved = (...args: unknown[]) => this.onTurnResolved(args[0] as { turn: number; actions: Record<string, TurnActionPayload> });
      network.socket.on('turnResolved', onTurnResolved);
      this.events.on('shutdown', () => network.socket.off('turnResolved', onTurnResolved));

      const onTurnOutcome = (...args: unknown[]) => this.onTurnOutcome(args[0] as TurnOutcomePayload);
      network.socket.on('turnOutcome', onTurnOutcome);
      this.events.on('shutdown', () => network.socket.off('turnOutcome', onTurnOutcome));
    }

    // UIScene subscribes to gameEvents in its own create(), which runs after
    // this one finishes - defer the first emits so it doesn't miss them.
    this.time.delayedCall(0, () => {
      gameEvents.emit(Events.MapChanged, { name: this.map.name, floorFriction: this.map.floorFriction });
      this.emitScore();
      if (this.network) {
        this.startNetworkTurn();
      } else {
        this.startTurnCycle();
      }
    });
  }

  private drawBoard() {
    this.add.circle(BOARD_CENTER_X, BOARD_CENTER_Y, BOARD_RADIUS, 0x2a3a2a).setStrokeStyle(4, 0x4a6a4a, 1);
    for (const placement of this.map.terrain) {
      const piece = this.getPiece(placement.pieceId);
      const x = BOARD_CENTER_X + placement.dx;
      const y = BOARD_CENTER_Y + placement.dy;
      const obstacle = piece.image
        ? this.add.image(x, y, pieceTextureKey(piece.image)).setDisplaySize(piece.radius * 2, piece.radius * 2)
        : this.add.circle(x, y, piece.radius, pieceColorNumber(piece)).setStrokeStyle(2, 0x000000, 0.4);
      this.matter.add.gameObject(obstacle, {
        shape: { type: 'circle', radius: piece.radius },
        isStatic: true,
        friction: 0.05,
        restitution: bounceToRestitution(placement.bounce),
      });
    }

    // Special-friction zones: shown as a plain patch on the board so players
    // can see and route around/into them, but the friction value itself is
    // never displayed - only discoverable by feel.
    this.zoneFrictionAirBase = this.map.zones.map((zone) => floorFrictionToAir(zone.friction));
    this.map.zones.forEach((zone, index) => {
      const x = BOARD_CENTER_X + zone.dx;
      const y = BOARD_CENTER_Y + zone.dy;
      const patch = this.add.circle(x, y, zone.radius, 0x3a6a8a, 0.28).setStrokeStyle(2, 0x8ad1ff, 0.5);
      this.matter.add.gameObject(patch, {
        shape: { type: 'circle', radius: zone.radius },
        isStatic: true,
        isSensor: true,
        label: `zone:${index}`,
      });
    });
  }

  private spawnEggs() {
    // Multiplayer: every client must assign identical weights to identical
    // eggs, so seed off the room code instead of using real randomness.
    const rng = this.network ? seededRandom(this.network.roomCode) : Math.random;
    const positions = createStartingPositions(this.playerCount, EGGS_PER_PLAYER);
    for (let p = 0; p < this.playerCount; p++) {
      const eggs: Egg[] = [];
      for (const pos of positions[p]) {
        const egg = new Egg(this, p, randomWeightTier(rng), pos.x, pos.y, this.map.floorFriction);
        this.eggsById.set(egg.id, egg);
        eggs.push(egg);
      }
      this.players.push({ index: p, score: 0, eggs });
    }
  }

  private getPiece(id: number): PieceDef {
    const found = this.pieces.find((p) => p.id === id);
    if (!found) throw new Error(`Unknown piece id: ${id}`);
    return found;
  }

  private aliveEggs(player: PlayerState): Egg[] {
    return player.eggs.filter((e) => e.alive);
  }

  private playersWithEggs(): PlayerState[] {
    return this.players.filter((p) => this.aliveEggs(p).length > 0);
  }

  // --- Turn flow -----------------------------------------------------

  private startTurnCycle() {
    if (this.turnNumber > MAX_TURNS || this.playersWithEggs().length <= 1) {
      this.endGame();
      return;
    }
    this.turnOrder = this.playersWithEggs().map((p) => p.index);
    this.turnPointer = 0;
    this.phase = 'aiming';
    this.beginPlayerTurn();
  }

  private beginPlayerTurn() {
    if (this.turnPointer >= this.turnOrder.length) {
      this.resolveTurnCycle();
      return;
    }
    this.activePlayerIndex = this.turnOrder[this.turnPointer];
    this.selectedEgg = null;
    this.pullGraphics.clear();
    this.refreshWeightVisibility();

    this.timerRemainingMs = TURN_TIME_LIMIT_MS;
    this.timerEvent?.remove();
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      repeat: Math.ceil(TURN_TIME_LIMIT_MS / 1000) - 1,
      callback: () => {
        this.timerRemainingMs -= 1000;
        gameEvents.emit(Events.TimerTick, Math.max(0, Math.round(this.timerRemainingMs / 1000)));
        if (this.timerRemainingMs <= 0) {
          this.advanceTurn();
        }
      },
    });

    gameEvents.emit(Events.TurnChanged, {
      turn: this.turnNumber,
      maxTurns: MAX_TURNS,
      activePlayerIndex: this.activePlayerIndex,
      phase: this.phase,
    });
    gameEvents.emit(Events.TimerTick, Math.round(this.timerRemainingMs / 1000));
  }

  // Network mode: no sequential turn order - every player may act at once,
  // matching the design doc's "전원 행동 완료 시점에 동시 처리" rule directly
  // instead of simulating it through a single shared local screen.
  private startNetworkTurn() {
    if (this.turnNumber > MAX_TURNS || this.playersWithEggs().length <= 1) {
      this.endGame();
      return;
    }
    this.phase = 'aiming';
    this.activePlayerIndex = this.selfPlayerIndex;
    this.submittedThisTurn = false;
    this.selectedEgg = null;
    this.pullGraphics.clear();
    this.refreshWeightVisibility();

    gameEvents.emit(Events.TurnChanged, {
      turn: this.turnNumber,
      maxTurns: MAX_TURNS,
      activePlayerIndex: this.activePlayerIndex,
      phase: this.phase,
    });
  }

  private submitNetworkAction(egg: Egg, velocity: { x: number; y: number }) {
    if (!this.network || this.submittedThisTurn) return;
    const player = this.players[this.selfPlayerIndex];
    const eggIndex = this.aliveEggs(player).indexOf(egg);
    if (eggIndex === -1) return;

    this.submittedThisTurn = true;
    egg.usedThisTurn = true;
    this.phase = 'waiting';
    this.activePlayerIndex = null;
    this.refreshWeightVisibility();

    gameEvents.emit(Events.TurnChanged, {
      turn: this.turnNumber,
      maxTurns: MAX_TURNS,
      activePlayerIndex: null,
      phase: 'waiting',
    });

    this.network.socket.emit('submitAction', { eggIndex, velocityX: velocity.x, velocityY: velocity.y });
  }

  private onTurnResolved(payload: { turn: number; actions: Record<string, TurnActionPayload> }) {
    if (!this.network) return;
    this.phase = 'resolving';
    this.activePlayerIndex = null;
    this.refreshWeightVisibility();
    this.hitThisTurn.clear();
    this.lastHitBy.clear();
    this.resolutionFinishing = false;

    gameEvents.emit(Events.TurnChanged, {
      turn: this.turnNumber,
      maxTurns: MAX_TURNS,
      activePlayerIndex: null,
      phase: this.phase,
    });

    let anyShooter = false;
    for (const [playerId, action] of Object.entries(payload.actions)) {
      const playerIndex = this.network.playerIds.indexOf(playerId);
      const player = this.players[playerIndex];
      if (!player) continue;
      const egg = this.aliveEggs(player)[action.eggIndex];
      if (!egg) continue;

      this.matter.body.setVelocity(egg.circle.body, { x: action.velocityX, y: action.velocityY });
      egg.isShooterThisTurn = true;
      anyShooter = true;
    }

    this.resolutionStartedAt = this.time.now;
    if (!anyShooter) {
      this.finishResolution();
    }
  }

  private refreshWeightVisibility() {
    for (const player of this.players) {
      for (const egg of this.aliveEggs(player)) {
        egg.setWeightVisible(player.index === this.activePlayerIndex);
      }
    }
  }

  private advanceTurn() {
    this.timerEvent?.remove();
    this.timerEvent = null;
    this.selectedEgg = null;
    this.pullGraphics.clear();
    this.turnPointer++;
    this.beginPlayerTurn();
  }

  // --- Input (drag-to-flick, no trajectory preview) -------------------

  private eggAt(pointerX: number, pointerY: number): Egg | null {
    let closest: Egg | null = null;
    let closestDist = Infinity;
    for (const player of this.players) {
      if (player.index !== this.activePlayerIndex) continue;
      for (const egg of this.aliveEggs(player)) {
        if (egg.usedThisTurn) continue;
        const d = Phaser.Math.Distance.Between(pointerX, pointerY, egg.x, egg.y);
        if (d <= egg.radius + 6 && d < closestDist) {
          closest = egg;
          closestDist = d;
        }
      }
    }
    return closest;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.phase !== 'aiming' || this.activePlayerIndex === null) return;
    const egg = this.eggAt(pointer.worldX, pointer.worldY);
    if (!egg) return;
    this.selectedEgg?.setSelected(false);
    this.selectedEgg = egg;
    egg.setSelected(true);
    this.dragging = true;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.dragging || !this.selectedEgg) return;
    this.pullGraphics.clear();

    const egg = this.selectedEgg;
    const dx = pointer.worldX - egg.x;
    const dy = pointer.worldY - egg.y;
    const dist = Math.min(Math.hypot(dx, dy), MAX_PULL_DISTANCE);
    const angle = Math.atan2(dy, dx);
    const px = egg.x + Math.cos(angle) * dist;
    const py = egg.y + Math.sin(angle) * dist;

    // Launch direction is the opposite of the pull (slingshot-style); only the
    // pull vector itself is drawn, never a predicted path into the arena.
    const power = dist / MAX_PULL_DISTANCE;
    const color = Phaser.Display.Color.GetColor(255, Math.round(255 * (1 - power)), 80);
    this.pullGraphics.lineStyle(3, color, 0.9);
    this.pullGraphics.lineBetween(egg.x, egg.y, px, py);
    this.pullGraphics.fillStyle(color, 0.9);
    this.pullGraphics.fillCircle(px, py, 6);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.dragging || !this.selectedEgg) return;
    this.dragging = false;
    this.pullGraphics.clear();

    const egg = this.selectedEgg;
    egg.setSelected(false);
    const dx = pointer.worldX - egg.x;
    const dy = pointer.worldY - egg.y;
    const dist = Math.hypot(dx, dy);

    if (dist < MIN_DRAG_DISTANCE) {
      this.selectedEgg = null;
      return; // treat as cancel, player may pick again
    }

    const clamped = Math.min(dist, MAX_PULL_DISTANCE);
    const angle = Math.atan2(dy, dx);
    const power = clamped / MAX_PULL_DISTANCE;
    // Velocity points opposite the pull, like releasing a slingshot.
    const velocity = {
      x: -Math.cos(angle) * power * MAX_LAUNCH_SPEED,
      y: -Math.sin(angle) * power * MAX_LAUNCH_SPEED,
    };
    this.selectedEgg = null;

    if (this.network) {
      this.submitNetworkAction(egg, velocity);
      return;
    }

    egg.pendingVelocity = velocity;
    egg.usedThisTurn = true;
    this.advanceTurn();
  }

  // --- Resolution ------------------------------------------------------

  private resolveTurnCycle() {
    this.phase = 'resolving';
    this.activePlayerIndex = null;
    this.refreshWeightVisibility();
    this.timerEvent?.remove();
    this.timerEvent = null;
    this.hitThisTurn.clear();
    this.lastHitBy.clear();
    this.resolutionFinishing = false;

    gameEvents.emit(Events.TurnChanged, {
      turn: this.turnNumber,
      maxTurns: MAX_TURNS,
      activePlayerIndex: null,
      phase: this.phase,
    });

    let anyShooter = false;
    for (const player of this.players) {
      for (const egg of this.aliveEggs(player)) {
        if (egg.pendingVelocity) {
          this.matter.body.setVelocity(egg.circle.body, egg.pendingVelocity);
          egg.isShooterThisTurn = true;
          egg.pendingVelocity = null;
          anyShooter = true;
        }
      }
    }

    this.resolutionStartedAt = this.time.now;
    if (!anyShooter) {
      this.finishResolution();
    }
  }

  private onCollisionStart(event: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    if (this.phase !== 'resolving') return;
    for (const pair of event.pairs) {
      const eggA = this.eggFromBody(pair.bodyA);
      const eggB = this.eggFromBody(pair.bodyB);

      if (eggA && eggB) {
        const aShooter = eggA.isShooterThisTurn;
        const bShooter = eggB.isShooterThisTurn;
        if (aShooter === bShooter) continue; // both or neither moving under their own shot: no clean attacker

        const attacker = aShooter ? eggA : eggB;
        const defender = aShooter ? eggB : eggA;
        this.hitThisTurn.add(defender);
        this.lastHitBy.set(defender, attacker.ownerId);
        continue;
      }

      const egg = eggA ?? eggB;
      const zoneIndex = this.zoneIndexFromBody(eggA ? pair.bodyB : pair.bodyA);
      if (egg && zoneIndex !== null) {
        egg.activeZones.add(zoneIndex);
        this.refreshEggFriction(egg);
      }
    }
  }

  private onCollisionEnd(event: Phaser.Physics.Matter.Events.CollisionEndEvent) {
    for (const pair of event.pairs) {
      const eggA = this.eggFromBody(pair.bodyA);
      const eggB = this.eggFromBody(pair.bodyB);
      const egg = eggA ?? eggB;
      const zoneIndex = this.zoneIndexFromBody(eggA ? pair.bodyB : pair.bodyA);
      if (egg && zoneIndex !== null) {
        egg.activeZones.delete(zoneIndex);
        this.refreshEggFriction(egg);
      }
    }
  }

  private refreshEggFriction(egg: Egg) {
    if (egg.activeZones.size === 0) {
      egg.setFrictionAir(egg.baseFrictionAir);
      return;
    }
    const zoneIndex = egg.activeZones.values().next().value as number;
    egg.setFrictionAir(this.zoneFrictionAirBase[zoneIndex] * egg.frictionMultiplier);
  }

  private eggFromBody(body: MatterJS.BodyType): Egg | null {
    const label = body.label ?? '';
    const match = /^egg:(\d+)$/.exec(label);
    if (!match) return null;
    return this.eggsById.get(Number(match[1])) ?? null;
  }

  private zoneIndexFromBody(body: MatterJS.BodyType): number | null {
    const label = body.label ?? '';
    const match = /^zone:(\d+)$/.exec(label);
    return match ? Number(match[1]) : null;
  }

  update() {
    if (this.phase !== 'resolving' || this.resolutionFinishing) return;

    const elapsed = this.time.now - this.resolutionStartedAt;
    const allSettled = this.players.every((p) =>
      this.aliveEggs(p).every((egg) => egg.speed < SETTLE_SPEED_THRESHOLD),
    );

    for (const player of this.players) {
      for (const egg of this.aliveEggs(player)) {
        egg.syncLabel();
      }
    }

    if (allSettled || elapsed > RESOLUTION_TIMEOUT_MS) {
      this.resolutionFinishing = true;
      if (this.network && !this.network.isHost) {
        // Guests don't score/eliminate off their own physics - just stop
        // ticking and wait for the host's authoritative turnOutcome.
        return;
      }
      this.finishResolution();
    }
  }

  private finishResolution() {
    const eliminated: Egg[] = [];
    for (const player of this.players) {
      for (const egg of this.aliveEggs(player)) {
        const dist = Phaser.Math.Distance.Between(egg.x, egg.y, BOARD_CENTER_X, BOARD_CENTER_Y);
        if (dist > BOARD_RADIUS + egg.radius) {
          eliminated.push(egg);
        }
      }
    }

    for (const egg of eliminated) {
      const attackerId = this.lastHitBy.get(egg);
      if (attackerId !== undefined) {
        this.awardScore(attackerId, SCORE_OUT);
      }
    }

    for (const egg of this.hitThisTurn) {
      if (eliminated.includes(egg)) continue;
      const attackerId = this.lastHitBy.get(egg);
      if (attackerId !== undefined) {
        this.awardScore(attackerId, SCORE_HIT);
      }
    }

    if (this.network?.isHost) {
      this.reportTurnOutcome(eliminated);
    }

    for (const egg of eliminated) {
      egg.destroy();
    }
    for (const player of this.players) {
      player.eggs = player.eggs.filter((e) => e.alive);
      for (const egg of player.eggs) {
        egg.resetForNewTurn();
      }
    }

    this.emitScore();
    this.turnNumber++;
    if (this.network) {
      this.startNetworkTurn();
    } else {
      this.startTurnCycle();
    }
  }

  // Host-only: package this turn's authoritative result (positions,
  // eliminations, scores) and relay it through the server so guests adopt it
  // instead of trusting their own possibly-divergent local physics.
  private reportTurnOutcome(eliminated: Egg[]) {
    if (!this.network) return;
    const eliminatedSet = new Set(eliminated);
    const eggs: EggOutcome[] = [];
    for (const player of this.players) {
      player.eggs.forEach((egg, eggIndex) => {
        eggs.push({
          playerIndex: player.index,
          eggIndex,
          x: egg.x,
          y: egg.y,
          eliminated: eliminatedSet.has(egg),
        });
      });
    }

    const scores: Record<string, number> = {};
    for (const player of this.players) {
      const playerId = this.network.playerIds[player.index];
      if (playerId) scores[playerId] = player.score;
    }

    this.network.socket.emit('reportTurnOutcome', { turn: this.turnNumber, scores, eggs });
  }

  // Guest-only: adopt the host's resolution wholesale instead of running our
  // own scoring/elimination off local physics.
  private onTurnOutcome(payload: TurnOutcomePayload) {
    if (!this.network || this.network.isHost) return;

    for (const outcome of payload.eggs) {
      const player = this.players[outcome.playerIndex];
      const egg = player?.eggs[outcome.eggIndex];
      if (!egg) continue;
      if (outcome.eliminated) {
        egg.destroy();
      } else {
        egg.circle.setPosition(outcome.x, outcome.y);
        this.matter.body.setVelocity(egg.circle.body, { x: 0, y: 0 });
      }
    }

    for (const player of this.players) {
      player.eggs = player.eggs.filter((e) => e.alive);
      for (const egg of player.eggs) {
        egg.resetForNewTurn();
      }
      const playerId = this.network.playerIds[player.index];
      if (playerId && payload.scores[playerId] !== undefined) {
        player.score = payload.scores[playerId];
      }
    }

    this.emitScore();
    this.turnNumber++;
    this.resolutionFinishing = false;
    this.startNetworkTurn();
  }

  private awardScore(playerIndex: number, amount: number) {
    const player = this.players.find((p) => p.index === playerIndex);
    if (player) player.score += amount;
  }

  private emitScore() {
    const entries: ScoreEntry[] = this.players.map((p) => ({
      playerIndex: p.index,
      score: p.score,
      eggsAlive: this.aliveEggs(p).length,
    }));
    gameEvents.emit(Events.ScoreChanged, entries);
  }

  private endGame() {
    this.phase = 'ended';
    this.timerEvent?.remove();
    this.timerEvent = null;
    const maxScore = Math.max(...this.players.map((p) => p.score));
    const winnerIndexes = this.players.filter((p) => p.score === maxScore).map((p) => p.index);
    gameEvents.emit(Events.GameOver, {
      scores: this.players.map((p) => ({ playerIndex: p.index, score: p.score, eggsAlive: this.aliveEggs(p).length })),
      winnerIndexes,
    });
  }
}
