import type { EnemyChoice, PublicEnemyChoice, RouteWidth, ScoreUpdate, StageConfig } from './types';

export const STAGES: StageConfig[] = [
  { id:1,title:'장난감 탑의 입구',theme:'BLOCK',bossName:'블록 드래곤',bossKind:'block',startPower:12,floorCount:6,bossAttack:49,bossReward:14,rewardMin:4,rewardMax:10,attackBase:3,attackStep:6,seed:103001,accent:'#f0bd4f' },
  { id:2,title:'태엽 장난감 공방',theme:'CLOCKWORK',bossName:'태엽 폭군',bossKind:'robot',startPower:14,floorCount:6,bossAttack:55,bossReward:16,rewardMin:4,rewardMax:11,attackBase:4,attackStep:7,seed:203011,accent:'#e36d54' },
  { id:3,title:'과자 가게 놀이',theme:'COOKIE TOY',bossName:'쿠키 킹 인형',bossKind:'snack',startPower:16,floorCount:6,bossAttack:61,bossReward:18,rewardMin:5,rewardMax:12,attackBase:5,attackStep:7,seed:303017,accent:'#e7ad58' },
  { id:4,title:'사탕 마법 장난감',theme:'CANDY TOY',bossName:'캔디 히드라 피규어',bossKind:'snack',startPower:18,floorCount:6,bossAttack:68,bossReward:20,rewardMin:5,rewardMax:13,attackBase:6,attackStep:8,seed:403031,accent:'#ef72b7' },
  { id:5,title:'로봇 장난감 공장',theme:'MECHA',bossName:'메카 티라노',bossKind:'robot',startPower:20,floorCount:6,bossAttack:75,bossReward:22,rewardMin:6,rewardMax:14,attackBase:7,attackStep:8,seed:503041,accent:'#63c7d8' },
  { id:6,title:'해적 장난감 요새',theme:'PIRATE',bossName:'블록 해적왕',bossKind:'block',startPower:22,floorCount:6,bossAttack:82,bossReward:24,rewardMin:6,rewardMax:15,attackBase:8,attackStep:9,seed:603043,accent:'#d68a48' },
  { id:7,title:'젤리 괴수 놀이',theme:'JELLY TOY',bossName:'젤리 크라켄 피규어',bossKind:'snack',startPower:24,floorCount:6,bossAttack:89,bossReward:26,rewardMin:7,rewardMax:16,attackBase:9,attackStep:9,seed:703057,accent:'#8d7be8' },
  { id:8,title:'고장 난 놀이공원',theme:'CHAOS',bossName:'폭주 회전목마',bossKind:'robot',startPower:26,floorCount:6,bossAttack:96,bossReward:28,rewardMin:7,rewardMax:17,attackBase:10,attackStep:10,seed:803069,accent:'#ed5f72' },
  { id:9,title:'황금 장난감 성채',theme:'GOLD',bossName:'황금 골렘',bossKind:'block',startPower:28,floorCount:6,bossAttack:103,bossReward:30,rewardMin:8,rewardMax:18,attackBase:11,attackStep:10,seed:903079,accent:'#ffd454' },
  { id:10,title:'장난감 왕의 방',theme:'TOY KING',bossName:'장난감 왕 드래곤',bossKind:'block',startPower:30,floorCount:6,bossAttack:112,bossReward:35,rewardMin:8,rewardMax:19,attackBase:12,attackStep:11,seed:1003091,accent:'#ff725f' },
];

export const STAGE_ONE = STAGES[0];

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

export function choiceCountFor(routeWidth: RouteWidth, seedKey: string, stage: StageConfig = STAGE_ONE) {
  const next = random(hash(`route|${stage.seed}|${seedKey}`));
  if (routeWidth === 'wide') return int(next, 2, 3);
  if (routeWidth === 'tight') return int(next, 1, 2);
  return int(next, 1, 3);
}

export function createChoices(floor: number, path: string, count: number, stage: StageConfig = STAGE_ONE): EnemyChoice[] {
  const attackRandom = random(hash(`attack|${stage.seed}|${floor}|${path}`));
  const rewardRandom = random(hash(`reward|${stage.seed}|${floor}|${path}`));
  const badgeRandom = random(hash(`badge|${stage.seed}|${floor}|${path}`));
  const baseAttack = stage.attackBase + floor * stage.attackStep;

  return Array.from({ length: count }, (_, index) => {
    const id = `${path}-${floor}-${index}`;
    const routeWidth = ROUTES[int(badgeRandom, 0, ROUTES.length - 1)];
    return {
      id,
      attack: int(attackRandom, Math.max(2, baseAttack - 6), baseAttack + 5),
      reward: int(rewardRandom, stage.rewardMin, stage.rewardMax),
      routeWidth,
      nextChoiceCount: choiceCountFor(routeWidth, id, stage),
      archetype: ARCHETYPES[(floor + index + stage.id) % ARCHETYPES.length],
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

export function createScoreUpdate(currentScore: number, floorsCleared: number, cleared = false, stageId = 1): ScoreUpdate {
  return { stageId, currentScore, floorsCleared, cleared };
}

export function newRunId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `hero-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}
