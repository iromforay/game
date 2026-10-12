// 개발용 스토리 전투 미리보기 — 서버 없이 BE의 실제 전투 엔진(battle-engine.ts)과 임시 전투 정의 JSON을 브라우저에서 돌려
// 전투 화면(PartySelect → Battle → 결과)의 스토리 전투 표시를 확인한다. 배포 번들에 들어가지 않는다(dev/).
// ?key=forest_stitchling_ambush|forest_giant_knot  &party=0|1(누비 외 추가 터비 수)
import Phaser from 'phaser';
import { applyAction, createBattle, submitParty, toSnapshot } from '../../BE/src/turby/battle/battle-engine';
import { BattleError } from '../../BE/src/turby/battle/battle-types';
import type { BattleDefinition, BattleRules, BattleState } from '../../BE/src/turby/battle/battle-types';
import ambush from '../../BE/story-data/save-a-turby/battles/forest_stitchling_ambush.json';
import knot from '../../BE/story-data/save-a-turby/battles/forest_giant_knot.json';
import { roomClient, RoomApiError } from '../src/net/roomClient';
import { inventory } from '../src/state/inventory';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../src/config/constants';
import { BattleScene } from '../src/scenes/BattleScene';
import { PartySelectScene } from '../src/scenes/PartySelectScene';
import type { BattleSnapshot } from '../src/net/battleTypes';

const params = new URLSearchParams(location.search);
const defs: Record<string, BattleDefinition> = { forest_stitchling_ambush: ambush as BattleDefinition, forest_giant_knot: knot as BattleDefinition };
const key = params.get('key') && defs[params.get('key')!] ? params.get('key')! : 'forest_stitchling_ambush';
const RULES: BattleRules = { gridCols: 12, gridRows: 8, maxAlliedUnits: 3, partyStartCol: 1, wildStartCol: 10, wildStartRow: 4, minDamage: 1, defenseDivisor: 2, wildHpMult: [0, 1, 1.5, 2, 2.5, 3] };
const ME = '1';

const state: BattleState = createBattle({ battleId: 'preview', roomCode: 'PREVIEW', stageCode: 'forest', spawnIndex: -1, encounterPlayerId: ME, wild: { code: key, name: key, stats: { attack: 0, defense: 0, actionPower: 0, maxHp: 1 } }, rules: RULES, participants: [{ playerId: ME, nickname: '하늘', slot: 1, connected: true }], definition: defs[key], story: { encounterKey: key } });

// 가방(추가 편성 후보) — 미리보기 전용 가짜 보유 터비
const bag = [{ id: '901', characterCode: 'mujigae', name: '무지개', attack: 7, defense: 3, actionPower: 3, maxHp: 22 }];
const NUBI = { turbyId: 'story-nubi', characterCode: 'nubi', name: '누비', attack: 8, defense: 4, actionPower: 4, maxHp: 30 };

const ended = () => (state.phase === 'resolved' ? { outcome: state.outcome!, rewards: [], settled: true } : null);
const respond = (events: unknown[]) => ({ ok: true, version: state.version, events, snapshot: toSnapshot(state) as unknown as BattleSnapshot, ended: ended() });
const run = (fn: () => unknown[]) => {
  try {
    return respond(fn());
  } catch (e) {
    if (e instanceof BattleError) throw new RoomApiError(e.code, e.message, toSnapshot(state) as unknown as BattleSnapshot);
    throw e;
  }
};

// 서버 소켓 대신 로컬 엔진으로 응답(서버 battle.service와 같은 규칙: 이야기 누비 자동 편성, 포획·보상 없음)
roomClient.playerId = ME;
roomClient.request = (async (event: string, body?: Record<string, unknown>) => {
  if (event === 'battle:party') {
    const ids = (body?.turbyIds as string[]) ?? [];
    const picked = bag.filter((t) => ids.includes(t.id)).map((t) => ({ turbyId: t.id, characterCode: t.characterCode, name: t.name, attack: t.attack, defense: t.defense, actionPower: t.actionPower, maxHp: t.maxHp }));
    return run(() => submitParty(state, ME, [NUBI, ...picked]));
  }
  if (event === 'battle:action') {
    const { type, unitId, targetCol, targetRow, targetUnitId } = body ?? {};
    return run(() => applyAction(state, ME, { type, unitId, targetCol, targetRow, targetUnitId } as never));
  }
  if (event === 'battle:snapshot' || event === 'battle:leave') return respond([]);
  throw new RoomApiError('UNSUPPORTED', `미리보기에서 지원하지 않는 요청: ${event}`);
}) as typeof roomClient.request;

// 파티 선택 화면이 읽는 가방
(inventory as unknown as { getBag: () => unknown[] }).getBag = () => (params.get('party') === '0' ? [] : bag.map((t) => ({ id: t.id, characterCode: t.characterCode, characterName: t.name, locationType: 'bag', slotIndex: null, equipment: [], stats: { attack: t.attack, defense: t.defense, actionPower: t.actionPower, maxHp: t.maxHp } })));

// 전투가 끝나면 돌아올 화면(실제로는 대화 진행기를 띄운 화면)
class PreviewEnd extends Phaser.Scene {
  constructor() {
    super('PreviewEnd');
  }
  create(data: { storyBattleEnd?: { encounterKey: string; outcome: string } }) {
    this.add.text(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, `돌아온 결과: ${JSON.stringify(data.storyBattleEnd ?? null)}`, { fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  backgroundColor: '#1a1030',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  fps: { forceSetTimeOut: true, target: 60 }, // 미리보기 창이 숨겨져 rAF가 멈춰도 전투 재생이 진행되도록(개발용)
  scene: [],
});
game.scene.add('PartySelect', PartySelectScene);
game.scene.add('Battle', BattleScene);
game.scene.add('PreviewEnd', PreviewEnd);
game.scene.start('Battle', { stageCode: 'forest', capturedIndices: [], removedIndices: [], snapshot: toSnapshot(state), returnTo: { scene: 'PreviewEnd' } });
(window as unknown as { __game?: unknown; __battle?: unknown }).__game = game;
(window as unknown as { __battle?: unknown }).__battle = state;
