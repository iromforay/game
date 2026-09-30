// 개발용 1장 흐름 미리보기(M4-C 캡처용) — 배포 번들에 들어가지 않는다(dev/).
// M1 SQL 적용 전이라 새 BE를 원격 DB에 붙일 수 없어서, 서버 대신 브라우저 메모리에서 돌린다. 판정은 흉내가 아니라
// BE의 순수 규칙(story-data·story-rules의 이벤트/트리거/복귀 구간)과 실제 전투 엔진(battle-engine)을 그대로 불러 쓴다.
// 개발 픽스처(운영 API에는 없음): ?start=forest|clue|compass  &dust=0..99(빛나는 실가루 보유)  &nubiHp=1..(패배 재현)
import { applyAction, createBattle, submitParty, toSnapshot } from '../../BE/src/turby/battle/battle-engine';
import { BattleError, type BattleDefinition, type BattleRules, type BattleState } from '../../BE/src/turby/battle/battle-types';
import { ENCOUNTER_BY_KEY, EVENT_BY_ID, SEGMENT_AFTER_EVENT, SEGMENT_CHAIN_END, STORY_TRIGGERS, TRIGGER_BY_ID, type Checkpoint } from '../../BE/src/turby/story/story-data';
import { checkEvent, nextCheckpoint, resumeOf, type StorySnapshot } from '../../BE/src/turby/story/story-rules';
import opening from '../../BE/story-data/save-a-turby/dialogue/opening.json';
import ch01 from '../../BE/story-data/save-a-turby/dialogue/ch01.json';
import ambush from '../../BE/story-data/save-a-turby/battles/forest_stitchling_ambush.json';
import knot from '../../BE/story-data/save-a-turby/battles/forest_giant_knot.json';
import { roomClient, RoomApiError, type RoomState } from '../src/net/roomClient';
import type { BattleSnapshot } from '../src/net/battleTypes';

const params = new URLSearchParams(location.search);
const BASE = import.meta.env.VITE_TURBY_SERVER_URL ?? 'http://localhost:3002';
const ME = '1';
const OPENING_DONE = ['opening_fall_completed', 'opening_name_saved', 'story_nubi_granted'];
const PRESETS: Record<string, { checkpoint: Checkpoint; events: string[] }> = {
  forest: { checkpoint: 'OPENING_COMPLETE', events: OPENING_DONE },
  clue: { checkpoint: 'CH01_BOPUL_RESCUED', events: [...OPENING_DONE, 'forest_first_path_started', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned'] },
  compass: { checkpoint: 'CH01_COMPASS_ACQUIRED', events: [...OPENING_DONE, 'forest_first_path_started', 'forest_stitchling_battle_won', 'forest_bopul_rescued', 'forest_dansuring_clue_learned', 'forest_compass_granted'] },
};
const preset = PRESETS[params.get('start') ?? 'forest'] ?? PRESETS.forest;

// ---------- 서버 상태(메모리) ----------
let checkpoint: Checkpoint = preset.checkpoint;
const events = new Set(preset.events);
const items: Record<string, number> = { glowing_yarn_dust: Number(params.get('dust') ?? 0) };
const nubiHp = Number(params.get('nubiHp') ?? 30);
let room: RoomState | null = null;
let battle: { state: BattleState; key: string; settled: boolean } | null = null;
const log = (...a: unknown[]) => console.info('[ch01-preview]', ...a);

const snap = (): StorySnapshot => ({ checkpoint, events, objectives: new Map(), growthStage: events.has('forest_first_knot_equipped') ? 1 : 0 });
const playOf = (seg: string | null | undefined) => (seg ? { segmentId: seg, endAfter: SEGMENT_CHAIN_END[seg] ?? seg } : null);

function delivery() {
  for (const t of STORY_TRIGGERS) {
    if (!t.need || !t.event || events.has(t.event) || checkEvent(EVENT_BY_ID.get(t.event)!, snap())) continue;
    return { triggerId: t.id, itemCode: t.need.itemCode, have: items[t.need.itemCode] ?? 0, need: t.need.quantity };
  }
  return null;
}

// 서버 runEvent와 같은 규칙(체크포인트·선행 이벤트·소비·지급·도착 체크포인트). 이미 기록됐으면 효과 없음
function runEvent(id: string): { already: boolean } {
  const def = EVENT_BY_ID.get(id)!;
  if (events.has(id)) return { already: true };
  const fail = checkEvent(def, snap());
  if (fail) throw Object.assign(new Error('지금은 진행할 수 없는 이야기입니다.'), { code: fail.code });
  for (const c of def.consume ?? []) {
    if ((items[c.itemCode] ?? 0) < c.quantity) throw Object.assign(new Error('부족합니다.'), { code: 'STORY_PREREQUISITE_MISSING' });
  }
  for (const c of def.consume ?? []) items[c.itemCode] -= c.quantity;
  for (const g of def.grant ?? []) items[g.itemCode] = (items[g.itemCode] ?? 0) + g.quantity;
  events.add(id);
  for (const extra of def.alsoComplete ?? []) events.add(extra);
  checkpoint = nextCheckpoint(checkpoint, def.to) ?? checkpoint;
  log('event', id, '→', checkpoint, JSON.stringify(items));
  return { already: false };
}

function story() {
  const done = events.has('story_nubi_granted');
  return {
    checkpoint,
    chapterCode: 'ch01',
    resume: resumeOf(snap()),
    needsName: false,
    playerName: '하늘',
    completedEvents: [...events],
    objectives: {},
    storyNubi: { turbyId: '1', growthStage: 0 },
    storyNubiMissing: false,
    openingRequired: !done,
    openingAvailable: !done,
    openingStarted: true,
    origin: 'legacy_backfill',
    delivery: delivery(),
    stages: ['forest', 'lake', 'underground', 'ice', 'desert'].map((stageCode, i) => ({
      stageCode,
      order: i + 1,
      title: ['1장 — 숲', '2장 — 호수', '3장 — 지하', '4장 — 얼음', '5장 — 사막'][i],
      state: i === 0 ? 'current' : 'locked',
      canEnter: i === 0,
      canProgress: i === 0,
      lockedReason: i === 0 ? null : 'STAGE_LOCKED',
      hint: i === 0 ? null : '앞 장의 이야기를 마치면 열립니다',
      legacyTargetCode: null,
    })),
  };
}

// 서버 runTrigger와 같은 흐름(트리거 표 그대로). 위치 증거는 미리보기에서 "숲 맵 안"만 확인
function trigger(id: string) {
  const def = TRIGGER_BY_ID.get(id);
  if (!def) throw Object.assign(new Error('알 수 없는 이야기 지점입니다.'), { code: 'STORY_TRIGGER_UNKNOWN', status: 404 });
  if (def.evidence.kind === 'point') throw Object.assign(new Error('지역 스토리 데이터가 없습니다.'), { code: 'STORY_DATA_MISSING', status: 500 });
  const resume = () => {
    const seg = resumeOf(snap()).segmentId;
    return seg?.startsWith('ch01.') ? playOf(seg) : null;
  };
  const out = (play: ReturnType<typeof playOf>, shortage: unknown = null) => ({ triggerId: id, play, shortage, story: story() });
  if (!def.event) return out(null);
  if (events.has(def.event)) return out(def.play === 'resume' ? resume() : null);
  if (checkEvent(EVENT_BY_ID.get(def.event)!, snap())) return def.optionalEvent ? out(def.play === 'resume' ? resume() : null) : out(null);
  if (def.need && (items[def.need.itemCode] ?? 0) < def.need.quantity) return out(null, { itemCode: def.need.itemCode, have: items[def.need.itemCode] ?? 0, need: def.need.quantity });
  const r = runEvent(def.event);
  return out(def.play === 'resume' ? resume() : r.already ? null : playOf(def.play));
}

// ---------- REST(/player/*) ----------
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
const nubi = { id: '1', characterCode: 'nubi', characterName: '누비', acquiredVia: 'starter', locationType: 'bag', slotIndex: null, equipment: [], stats: { attack: 10, defense: 8, actionPower: 5, maxHp: nubiHp } };
const mujigae = { id: '2', characterCode: 'mujigae', characterName: '무지개', acquiredVia: 'wild_capture', locationType: 'bag', slotIndex: null, equipment: [], stats: { attack: 7, defense: 3, actionPower: 3, maxHp: 22 } };
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(BASE)) return realFetch(input, init);
  const path = url.slice(BASE.length);
  await new Promise((r) => setTimeout(r, 80));
  try {
    if (path === '/player/identify') return json(200, { playerId: ME, nickname: '하늘', tareBalance: 100, turbys: [nubi, mujigae], sessionToken: 'preview-session-token' });
    if (path === '/shop' || path === '/player/me/items') return json(200, []);
    if (path === '/player/me/story') return json(200, story());
    if (path === '/player/me/story/dialogue/opening') return json(200, opening);
    if (path === '/player/me/story/dialogue/ch01') return json(200, ch01);
    const tr = path.match(/^\/player\/me\/story\/triggers\/([a-z_]+)$/);
    if (tr) return json(200, trigger(tr[1]));
    const ev = path.match(/^\/player\/me\/story\/events\/([a-z_]+)\/complete$/);
    if (ev) {
      const def = EVENT_BY_ID.get(ev[1]);
      if (!def) return json(404, { code: 'STORY_EVENT_UNKNOWN', message: '알 수 없는 스토리 이벤트입니다.' });
      if (def.serverOnly) return json(403, { code: 'STORY_EVENT_SERVER_ONLY', message: '이 이벤트는 직접 완료할 수 없습니다.' });
      const r = runEvent(ev[1]);
      return json(200, { eventId: ev[1], alreadyCompleted: r.already, grants: [], consumed: [], story: story(), play: r.already ? null : playOf(SEGMENT_AFTER_EVENT[ev[1]]) });
    }
    return json(404, { code: 'PREVIEW_NOT_MOCKED', message: `미리보기에서 흉내 내지 않는 경로: ${path}` });
  } catch (e) {
    const err = e as { code?: string; status?: number; message: string };
    return json(err.status ?? 409, { code: err.code ?? 'ERROR', message: err.message });
  }
};

// ---------- 소켓(방·맵·스토리 전투) ----------
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 3, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const DEFS: Record<string, BattleDefinition> = { forest_stitchling_ambush: ambush as BattleDefinition, forest_giant_knot: knot as BattleDefinition };
const party = (ids: string[]) => [nubi, ...[mujigae].filter((t) => ids.includes(t.id))].map((t) => ({ turbyId: t.id, characterCode: t.characterCode, name: t.characterName, attack: t.stats.attack, defense: t.stats.defense, actionPower: t.stats.actionPower, maxHp: t.stats.maxHp }));

function settle() {
  if (!battle || battle.state.phase !== 'resolved' || battle.settled) return;
  if (battle.state.outcome === 'win') for (const e of ENCOUNTER_BY_KEY.get(battle.key)!.onWinEvents) runEvent(e); // 서버 경로(포획·야생 보상 없음)
  battle.settled = true;
}
const battleResponse = (events: unknown[]) => {
  settle();
  const s = battle!.state;
  return { version: s.version, events, snapshot: toSnapshot(s) as unknown as BattleSnapshot, ended: s.phase === 'resolved' ? { outcome: s.outcome, rewards: [], settled: true } : null };
};
const fail = (code: string, message: string): never => {
  throw new RoomApiError(code, message);
};

roomClient.playerId = ME;
roomClient.connect = async () => undefined;
roomClient.request = (async (event: string, body?: Record<string, unknown>) => {
  await new Promise((r) => setTimeout(r, 60));
  switch (event) {
    case 'room:leave':
      room = null;
      return {};
    case 'room:create':
      room = { code: 'PREVIEW', name: '미리보기', stageCode: String(body?.stageCode), maxPlayers: 1, visibility: 'private', phase: 'lobby', hostPlayerId: ME, members: [{ playerId: ME, nickname: '하늘', connected: true, inMap: false }] };
      return { room };
    case 'room:start':
      room = { ...room!, phase: 'playing' };
      return { room };
    case 'map:enter': {
      room!.members[0].inMap = true;
      const t = STORY_TRIGGERS.find((x) => x.play === 'resume' && x.stageCode === room!.stageCode);
      const res = t ? trigger(t.id) : null;
      return { self: { playerId: ME, nickname: '하늘', x: 0, y: 0, dir: 'down' }, players: [], wilds: [], story: res ? { play: res.play, delivery: res.story.delivery } : null };
    }
    case 'battle:story:start': {
      const key = String(body?.encounterKey);
      if (battle && battle.state.phase !== 'resolved') return battle.key === key ? { snapshot: toSnapshot(battle.state) } : fail('ALREADY_IN_BATTLE', '진행 중인 전투가 있습니다.');
      const def = ENCOUNTER_BY_KEY.get(key);
      if (!def) return fail('STORY_ENCOUNTER_UNKNOWN', '알 수 없는 스토리 전투입니다.');
      if (def.onWinEvents.every((e) => events.has(e))) return fail('STORY_ENCOUNTER_DONE', '이미 끝난 전투입니다.');
      if (!def.allowedAt.includes(checkpoint) || def.requires.some((r) => !events.has(r))) return fail('STORY_ENCOUNTER_NOT_AVAILABLE', '지금은 시작할 수 없는 전투입니다.');
      const state = createBattle({ battleId: `preview-${Date.now()}`, roomCode: 'PREVIEW', stageCode: 'forest', spawnIndex: -1, encounterPlayerId: ME, wild: { code: key, name: key, stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 1 } }, rules: RULES, participants: [{ playerId: ME, nickname: '하늘', slot: 1, connected: true }], definition: DEFS[key], story: { encounterKey: key } });
      battle = { state, key, settled: false };
      (window as unknown as { __battle?: unknown }).__battle = state;
      return { snapshot: toSnapshot(state) };
    }
    case 'battle:party':
    case 'battle:action':
    case 'battle:snapshot':
    case 'battle:leave': {
      if (!battle) return fail('BATTLE_EXPIRED', '전투가 없습니다.');
      try {
        if (event === 'battle:party') return battleResponse(submitParty(battle.state, ME, party((body?.turbyIds as string[]) ?? [])));
        if (event === 'battle:action') {
          const { type, unitId, targetCol, targetRow, targetUnitId } = body ?? {};
          return battleResponse(applyAction(battle.state, ME, { type, unitId, targetCol, targetRow, targetUnitId } as never));
        }
        if (event === 'battle:leave') {
          battle.state.phase = 'resolved';
          battle.state.outcome = 'cancelled';
        }
        return battleResponse([]);
      } catch (e) {
        if (e instanceof BattleError) throw new RoomApiError(e.code, e.message, toSnapshot(battle.state) as unknown as BattleSnapshot);
        throw e;
      }
    }
    default:
      return fail('PREVIEW_NOT_MOCKED', `미리보기에서 흉내 내지 않는 요청: ${event}`);
  }
}) as typeof roomClient.request;

// 새로고침 복원 재현용: 서버 hello가 내려주는 진행 중 전투 스냅샷(종료 전투는 null — 서버 activeSnapshotOf와 같음)
const activeSnapshot = () => (battle && battle.state.phase !== 'resolved' ? toSnapshot(battle.state) : null);
(window as unknown as { __preview?: unknown }).__preview = { story, items, events: () => [...events], activeSnapshot, room: roomClient };
if (!params.get('device')) {
  params.set('device', 'preview-ch01');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
// 미리보기 창이 숨겨져도 캡처 자동화가 멈추지 않게(개발용): 브라우저가 rAF를 멈추면 Phaser 루프도 멈추므로 타이머로 대신
window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
const { mountGame } = await import('../src/game');
(window as unknown as { __game?: unknown }).__game = await mountGame('app');
