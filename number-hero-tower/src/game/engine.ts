import type { EnemyChoice, PublicEnemyChoice, RouteWidth, ScoreUpdate } from './types';

export const STAGE_ONE = {
  id: 1,
  title: '장난감 탑의 입구',
  startPower: 12,
  floorCount: 6,
  dragonAttack: 49,
  dragonReward: 14,
  rewardMin: 4,
  rewardMax: 10,
  seed: 103_001,
} as const;

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function int(next: () => number, min: number, max: number) {
  return min + Math.floor(next() * (max - min + 1));
}

const ROUTES: RouteWidth[] = ['wide', 'general', 'tight'];
const ARCHETYPES: EnemyChoice['archetype'][] = ['block', 'robot', 'snack'];

export function choiceCountFor(routeWidth: RouteWidth, seedKey: string) {
  const next = random(hash(`route|${STAGE_ONE.seed}|${seedKey}`));
  if (routeWidth === 'wide') return int(next, 2, 3);
  if (routeWidth === 'tight') return int(next, 1, 2);
  return int(next, 1, 3);
}

export function createChoices(floor: number, path: string, count: number): EnemyChoice[] {
  const attackRandom = random(hash(`attack|${STAGE_ONE.seed}|${floor}|${path}`));
  const rewardRandom = random(hash(`reward|${STAGE_ONE.seed}|${floor}|${path}`));
  const badgeRandom = random(hash(`badge|${STAGE_ONE.seed}|${floor}|${path}`));
  const baseAttack = 3 + floor * 6;

  return Array.from({ length: count }, (_, index) => {
    const id = `${path}-${floor}-${index}`;
    const routeWidth = ROUTES[int(badgeRandom, 0, ROUTES.length - 1)];
    return {
      id,
      attack: int(attackRandom, Math.max(2, baseAttack - 6), baseAttack + 5),
      reward: int(rewardRandom, STAGE_ONE.rewardMin, STAGE_ONE.rewardMax),
      routeWidth,
      nextChoiceCount: choiceCountFor(routeWidth, id),
      archetype: ARCHETYPES[(floor + index) % ARCHETYPES.length],
    };
  }).sort((a, b) => a.attack - b.attack);
}

export function toPublicChoice(choice: EnemyChoice): PublicEnemyChoice {
  const { reward: _reward, nextChoiceCount: _nextChoiceCount, ...visible } = choice;
  return visible;
}

export function canDefeat(heroPower: number, enemyAttack: number) {
  return heroPower > enemyAttack;
}

export function createScoreUpdate(currentScore: number, floorsCleared: number, cleared = false): ScoreUpdate {
  return { stageId: STAGE_ONE.id, currentScore, floorsCleared, cleared };
}

export function newRunId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `hero-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}
