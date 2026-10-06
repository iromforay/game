import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { reportGameResult } from 'tower-defense';
import gruntUrl from '../../number-gate-runner/src/assets/enemies/clockwork-grunt.png';
import golemUrl from '../../number-hero-tower/src/assets/enemy-block-golem-stage1.png';
import knightUrl from '../../number-hero-tower/src/assets/enemy-clockwork-knight-stage1.png';
import bossUrl from '../../number-gate-runner/src/assets/bosses/boss-1-2-giant-teddy.png';
import kitchenBackgroundUrl from '../../number-gate-runner/src/assets/backgrounds/kitchen-runner-v2.jpg';
import mapUrl from '../../number-hero-tower/src/assets/house-chapter-map.jpg';
import snackGuardianUrl from '../../number-hero-tower/src/assets/enemy-snack-guardian-stage1.png';
import cookieKingUrl from '../../number-hero-tower/src/assets/boss-03-cookie-king.png';
import candyHydraUrl from '../../number-hero-tower/src/assets/boss-04-candy-hydra.png';
import jellyKrakenUrl from '../../number-hero-tower/src/assets/boss-07-jelly-kraken.png';
import emperorDragonUrl from '../../number-hero-tower/src/assets/boss-10-emperor-dragon.png';
import swordsmanUrl from './assets/merge-defense/apprentice-swordsman.png';
import archerUrl from './assets/merge-defense/apprentice-archer.png';
import spellbladeUrl from './assets/merge-defense/novice-spellblade.png';
import shieldWarriorUrl from './assets/merge-defense/shield-warrior.png';
import knightHeroUrl from './assets/merge-defense/knight.png';
import holyKnightUrl from './assets/merge-defense/holy-knight.png';
import marksmanUrl from './assets/merge-defense/marksman.png';
import rangerUrl from './assets/merge-defense/ranger.png';
import divineArcherUrl from './assets/merge-defense/divine-archer.png';
import trainingYardUrl from './assets/merge-defense/training-yard-background.png';
import candyCastleBackgroundUrl from './assets/merge-defense/candy-castle-battlefield.png';
import { collectSilver, EMPTY_MERGE_PROFILE, fetchMergeProfile, purchaseMergeUpgrade, saveHeroDiscovery, saveMergeStageClear, unlockSpellbladeRecipe, upgradeCost, type MergeProfile, type MergeUpgrade } from './mergeDefenseEconomy';
import './MergeDefenseScreen.css';
import './MergeDefenseGrid.css';
import './MergeDefenseWorldMap.css';

type Screen = 'map' | 'stages' | 'shop' | 'game';
type HeroClass = 'warrior' | 'archer' | 'spellblade';
type EnemyKind = 'swarm' | 'runner' | 'normal' | 'shield' | 'elite' | 'boss';

interface Hero {
  id: number;
  heroClass: HeroClass;
  grade: number;
  cooldown: number;
  trial?: boolean;
}

interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  progress: number;
  speed: number;
  hitFlash: number;
}

interface SilverDrop { id: number; amount: number; left: string; top: string }

interface MergeStage {
  id: number;
  chapter: number;
  stageNumber: number;
  title: string;
  route: string;
  icon: string;
  bossName: string;
  startCharacters: string[];
  startCoins: number;
  baseHp: number;
  hpScale: number;
  speedScale: number;
  preset: 'balanced' | 'swarm' | 'runner' | 'armor' | 'elite';
  background: string;
  bossImage: string;
}

const HEROES: Record<HeroClass, Array<{ name: string; attack: number; speed: number; cost: number; icon: string; image: string }>> = {
  warrior: [
    { name: '수습 검사', attack: 5, speed: 0.8, cost: 5, icon: '🗡️', image: swordsmanUrl },
    { name: '방패 전사', attack: 12, speed: 0.8, cost: 10, icon: '🛡️', image: shieldWarriorUrl },
    { name: '기사', attack: 27, speed: 0.8, cost: 20, icon: '⚔️', image: knightHeroUrl },
    { name: '성기사', attack: 60, speed: 0.8, cost: 40, icon: '🌟', image: holyKnightUrl },
    { name: '왕실 검사', attack: 96, speed: 0.82, cost: 80, icon: '👑', image: knightHeroUrl },
    { name: '황금 기사', attack: 150, speed: 0.84, cost: 160, icon: '🟡', image: holyKnightUrl },
    { name: '룬 기사', attack: 235, speed: 0.86, cost: 320, icon: '💎', image: knightHeroUrl },
    { name: '천공 검사', attack: 365, speed: 0.88, cost: 640, icon: '☁️', image: holyKnightUrl },
    { name: '신화 기사', attack: 565, speed: 0.9, cost: 1280, icon: '🔥', image: knightHeroUrl },
    { name: '창세검신', attack: 880, speed: 0.92, cost: 2560, icon: '⚔️', image: holyKnightUrl },
  ],
  archer: [
    { name: '견습 궁수', attack: 4, speed: 1.25, cost: 5, icon: '🏹', image: archerUrl },
    { name: '명사수', attack: 9, speed: 1.25, cost: 10, icon: '🎯', image: marksmanUrl },
    { name: '레인저', attack: 20, speed: 1.25, cost: 20, icon: '🪶', image: rangerUrl },
    { name: '신궁', attack: 44, speed: 1.25, cost: 40, icon: '✨', image: divineArcherUrl },
    { name: '왕실 궁수', attack: 72, speed: 1.3, cost: 80, icon: '👑', image: rangerUrl },
    { name: '황금 저격수', attack: 112, speed: 1.35, cost: 160, icon: '🎯', image: divineArcherUrl },
    { name: '룬 사수', attack: 175, speed: 1.4, cost: 320, icon: '💎', image: rangerUrl },
    { name: '천공 사수', attack: 270, speed: 1.45, cost: 640, icon: '☁️', image: divineArcherUrl },
    { name: '신화 궁수', attack: 420, speed: 1.5, cost: 1280, icon: '🌠', image: rangerUrl },
    { name: '창세궁신', attack: 650, speed: 1.55, cost: 2560, icon: '🏹', image: divineArcherUrl },
  ],
  spellblade: [
    { name: '마검사', attack: 6, speed: 1, cost: 7, icon: '🔮', image: spellbladeUrl },
    { name: '룬 검사', attack: 13, speed: 1, cost: 14, icon: '💠', image: spellbladeUrl },
    { name: '마도 기사', attack: 29, speed: 1, cost: 28, icon: '🌀', image: spellbladeUrl },
    { name: '아케인 블레이더', attack: 64, speed: 1, cost: 56, icon: '🌌', image: spellbladeUrl },
    { name: '스펠 블레이더', attack: 102, speed: 1.03, cost: 112, icon: '🔯', image: spellbladeUrl },
    { name: '비전 마검사', attack: 160, speed: 1.06, cost: 224, icon: '📜', image: spellbladeUrl },
    { name: '성좌 기사', attack: 250, speed: 1.09, cost: 448, icon: '🌠', image: spellbladeUrl },
    { name: '천공 마검사', attack: 390, speed: 1.12, cost: 896, icon: '☄️', image: spellbladeUrl },
    { name: '신화 마검사', attack: 605, speed: 1.15, cost: 1792, icon: '🔥', image: spellbladeUrl },
    { name: '창세마검신', attack: 940, speed: 1.18, cost: 3584, icon: '🌌', image: spellbladeUrl },
  ],
};

const CLASS_LABEL: Record<HeroClass, string> = { warrior: '검사', archer: '궁사', spellblade: '마검사' };
const STANDARD_MAX_GRADE = 10;
const CLASS_ORDER: HeroClass[] = ['warrior', 'archer', 'spellblade'];
const HERO_RANGE: Record<HeroClass, number> = { warrior: 1.5, archer: 3.25, spellblade: 2.25 };
const ENEMY_DATA: Record<EnemyKind, { name: string; hp: number; speed: number; reward: number; points: number; image: string }> = {
  swarm: { name: '태엽 꼬마', hp: 24, speed: 4.6, reward: 1, points: 5, image: gruntUrl },
  runner: { name: '질주 태엽병', hp: 34, speed: 6.4, reward: 2, points: 20, image: gruntUrl },
  normal: { name: '태엽 병사', hp: 45, speed: 4, reward: 1, points: 10, image: gruntUrl },
  shield: { name: '블록 골렘', hp: 105, speed: 2.8, reward: 3, points: 30, image: golemUrl },
  elite: { name: '태엽 영웅', hp: 240, speed: 3.2, reward: 8, points: 100, image: knightUrl },
  boss: { name: '거대 태엽 곰', hp: 2500, speed: 1.45, reward: 50, points: 5000, image: bossUrl },
};

const WAVES: EnemyKind[][] = [
  ['normal', 'normal', 'normal'],
  ['swarm', 'swarm', 'swarm', 'swarm', 'swarm', 'swarm'],
  ['normal', 'normal', 'normal', 'normal', 'runner', 'runner'],
  ['swarm', 'swarm', 'swarm', 'swarm', 'runner', 'runner', 'runner'],
  ['shield', 'shield', 'normal', 'normal', 'normal'],
  ['swarm', 'swarm', 'swarm', 'swarm', 'swarm', 'shield', 'shield'],
  ['runner', 'runner', 'runner', 'runner', 'runner', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'shield', 'shield', 'runner', 'runner'],
  ['elite', 'elite', 'shield', 'shield', 'runner', 'runner'],
  ['boss', 'normal', 'normal', 'runner', 'runner'],
];

const STAGES: MergeStage[] = [
  { id: 1, chapter: 1, stageNumber: 1, title: '세 갈래의 시작', route: '기초 소환 훈련', icon: '⚙️', bossName: '거대 태엽 곰', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 25, baseHp: 20, hpScale: 1, speedScale: 1, preset: 'balanced', background: trainingYardUrl, bossImage: bossUrl },
  { id: 2, chapter: 1, stageNumber: 2, title: '태엽병의 행진', route: '보병 밀집 진격로', icon: '🪖', bossName: '태엽 대장', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 27, baseHp: 20, hpScale: 1.15, speedScale: 1.02, preset: 'swarm', background: trainingYardUrl, bossImage: bossUrl },
  { id: 3, chapter: 1, stageNumber: 3, title: '질주 장난감길', route: '고속 침투 경로', icon: '🏎️', bossName: '폭주 미니카', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 28, baseHp: 19, hpScale: 1.25, speedScale: 1.12, preset: 'runner', background: trainingYardUrl, bossImage: bossUrl },
  { id: 4, chapter: 1, stageNumber: 4, title: '블록 방벽', route: '중장갑 골렘 구역', icon: '🧱', bossName: '블록 성채 골렘', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 30, baseHp: 19, hpScale: 1.42, speedScale: 1.03, preset: 'armor', background: trainingYardUrl, bossImage: bossUrl },
  { id: 5, chapter: 1, stageNumber: 5, title: '뒤엉킨 기어', route: '혼합 군단 교차로', icon: '⚙️', bossName: '쌍기어 파괴자', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 31, baseHp: 18, hpScale: 1.58, speedScale: 1.08, preset: 'balanced', background: trainingYardUrl, bossImage: bossUrl },
  { id: 6, chapter: 1, stageNumber: 6, title: '정예 기사단', route: '태엽 영웅 주둔지', icon: '🛡️', bossName: '황동 기사단장', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 33, baseHp: 18, hpScale: 1.78, speedScale: 1.08, preset: 'elite', background: trainingYardUrl, bossImage: bossUrl },
  { id: 7, chapter: 1, stageNumber: 7, title: '장난감 대공세', route: '대규모 병력 집결지', icon: '🔥', bossName: '붉은 태엽 거인', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 35, baseHp: 17, hpScale: 2, speedScale: 1.12, preset: 'swarm', background: trainingYardUrl, bossImage: bossUrl },
  { id: 8, chapter: 1, stageNumber: 8, title: '철갑 회랑', route: '방패와 정예의 협공', icon: '🏰', bossName: '철갑 성문지기', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 37, baseHp: 17, hpScale: 2.25, speedScale: 1.1, preset: 'armor', background: trainingYardUrl, bossImage: bossUrl },
  { id: 9, chapter: 1, stageNumber: 9, title: '왕실 근위선', route: '최정예 장난감 방어선', icon: '👑', bossName: '황금 태엽 장군', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 39, baseHp: 16, hpScale: 2.55, speedScale: 1.14, preset: 'elite', background: trainingYardUrl, bossImage: bossUrl },
  { id: 10, chapter: 1, stageNumber: 10, title: '태엽 왕의 진격', route: '장난감 왕좌 최종전', icon: '🗼', bossName: '태엽 장난감 왕', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 42, baseHp: 15, hpScale: 3, speedScale: 1.16, preset: 'balanced', background: trainingYardUrl, bossImage: bossUrl },
  { id: 11, chapter: 2, stageNumber: 1, title: '식탁 아래의 소동', route: '부스러기 군단 진입로', icon: '🍞', bossName: '쿠키 대장', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 44, baseHp: 18, hpScale: 3.2, speedScale: 1.08, preset: 'swarm', background: kitchenBackgroundUrl, bossImage: cookieKingUrl },
  { id: 12, chapter: 2, stageNumber: 2, title: '칼꽂이 경계선', route: '날붙이 정예 방어선', icon: '🔪', bossName: '나이프 기사', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 46, baseHp: 18, hpScale: 3.45, speedScale: 1.1, preset: 'elite', background: kitchenBackgroundUrl, bossImage: snackGuardianUrl },
  { id: 13, chapter: 2, stageNumber: 3, title: '끓는 냄비길', route: '증기 가속 진격로', icon: '🍲', bossName: '증기 주전자', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 48, baseHp: 17, hpScale: 3.7, speedScale: 1.18, preset: 'runner', background: kitchenBackgroundUrl, bossImage: jellyKrakenUrl },
  { id: 14, chapter: 2, stageNumber: 4, title: '냉장고 문턱', route: '냉기 갑옷 수비대', icon: '🧊', bossName: '젤리 수호자', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 50, baseHp: 17, hpScale: 4, speedScale: 1.1, preset: 'armor', background: kitchenBackgroundUrl, bossImage: jellyKrakenUrl },
  { id: 15, chapter: 2, stageNumber: 5, title: '토스터 협곡', route: '불꽃과 중갑의 교차로', icon: '🍞', bossName: '탄 빵 골렘', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 52, baseHp: 16, hpScale: 4.3, speedScale: 1.14, preset: 'balanced', background: kitchenBackgroundUrl, bossImage: snackGuardianUrl },
  { id: 16, chapter: 2, stageNumber: 6, title: '싱크대 급류', route: '거품 군단 범람지', icon: '🫧', bossName: '거품 문어', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 54, baseHp: 16, hpScale: 4.65, speedScale: 1.2, preset: 'swarm', background: kitchenBackgroundUrl, bossImage: jellyKrakenUrl },
  { id: 17, chapter: 2, stageNumber: 7, title: '양념통 요새', route: '매운 정예병 주둔지', icon: '🌶️', bossName: '향신료 히드라', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 57, baseHp: 15, hpScale: 5, speedScale: 1.16, preset: 'elite', background: kitchenBackgroundUrl, bossImage: candyHydraUrl },
  { id: 18, chapter: 2, stageNumber: 8, title: '믹서기 회랑', route: '고속 회전 칼날 구역', icon: '🌀', bossName: '회전 칼날왕', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 60, baseHp: 15, hpScale: 5.4, speedScale: 1.24, preset: 'runner', background: kitchenBackgroundUrl, bossImage: candyHydraUrl },
  { id: 19, chapter: 2, stageNumber: 9, title: '셰프의 조리대', route: '왕실 음식 군단 방어선', icon: '👨‍🍳', bossName: '쿠키 왕', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 63, baseHp: 14, hpScale: 5.9, speedScale: 1.2, preset: 'armor', background: kitchenBackgroundUrl, bossImage: cookieKingUrl },
  { id: 20, chapter: 2, stageNumber: 10, title: '주방 왕좌', route: '황금 조리대 최종전', icon: '🐉', bossName: '황금 셰프 드래곤', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 66, baseHp: 14, hpScale: 6.5, speedScale: 1.22, preset: 'elite', background: kitchenBackgroundUrl, bossImage: emperorDragonUrl },
  { id: 21, chapter: 3, stageNumber: 1, title: '쿠키 성문', route: '비스킷 보병 진입로', icon: '🍪', bossName: '비스킷 문지기', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 70, baseHp: 17, hpScale: 6.9, speedScale: 1.14, preset: 'swarm', background: candyCastleBackgroundUrl, bossImage: cookieKingUrl },
  { id: 22, chapter: 3, stageNumber: 2, title: '젤리 해자', route: '탄성 돌격대 도약 구역', icon: '🍬', bossName: '젤리 기사', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 72, baseHp: 17, hpScale: 7.3, speedScale: 1.2, preset: 'runner', background: candyCastleBackgroundUrl, bossImage: jellyKrakenUrl },
  { id: 23, chapter: 3, stageNumber: 3, title: '캐러멜 회랑', route: '점착 중갑 방어선', icon: '🍮', bossName: '캐러멜 골렘', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 75, baseHp: 16, hpScale: 7.7, speedScale: 1.14, preset: 'armor', background: candyCastleBackgroundUrl, bossImage: snackGuardianUrl },
  { id: 24, chapter: 3, stageNumber: 4, title: '사탕수수 탑', route: '캔디 창병 정예 구역', icon: '🍭', bossName: '캔디 창병대장', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 78, baseHp: 16, hpScale: 8.1, speedScale: 1.18, preset: 'elite', background: candyCastleBackgroundUrl, bossImage: candyHydraUrl },
  { id: 25, chapter: 3, stageNumber: 5, title: '초콜릿 광장', route: '혼합 디저트 군단 집결지', icon: '🍫', bossName: '초코 성채', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 81, baseHp: 15, hpScale: 8.6, speedScale: 1.18, preset: 'balanced', background: candyCastleBackgroundUrl, bossImage: cookieKingUrl },
  { id: 26, chapter: 3, stageNumber: 6, title: '마시멜로 병영', route: '대규모 폭신 보병 숙영지', icon: '☁️', bossName: '마시멜로 장군', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 84, baseHp: 15, hpScale: 9.1, speedScale: 1.22, preset: 'swarm', background: candyCastleBackgroundUrl, bossImage: snackGuardianUrl },
  { id: 27, chapter: 3, stageNumber: 7, title: '롤리팝 정원', route: '회전 사탕 고속 진격로', icon: '🍭', bossName: '젤리 크라켄', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 87, baseHp: 14, hpScale: 9.7, speedScale: 1.28, preset: 'runner', background: candyCastleBackgroundUrl, bossImage: jellyKrakenUrl },
  { id: 28, chapter: 3, stageNumber: 8, title: '설탕 결정궁', route: '결정 갑옷 왕실 수비대', icon: '💎', bossName: '캔디 히드라', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 90, baseHp: 14, hpScale: 10.3, speedScale: 1.22, preset: 'armor', background: candyCastleBackgroundUrl, bossImage: candyHydraUrl },
  { id: 29, chapter: 3, stageNumber: 9, title: '왕실 제과실', route: '디저트 최정예 근위선', icon: '👑', bossName: '쿠키 왕', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 93, baseHp: 13, hpScale: 11, speedScale: 1.25, preset: 'elite', background: candyCastleBackgroundUrl, bossImage: cookieKingUrl },
  { id: 30, chapter: 3, stageNumber: 10, title: '과자 왕좌', route: '달콤한 왕국 최종 결전', icon: '🏰', bossName: '디저트 황제 드래곤', startCharacters: ['수습 검사', '견습 궁수'], startCoins: 96, baseHp: 13, hpScale: 12, speedScale: 1.28, preset: 'elite', background: candyCastleBackgroundUrl, bossImage: emperorDragonUrl },
];

function wavesFor(stage: MergeStage): EnemyKind[][] {
  let waves = WAVES.map((wave) => [...wave]);
  if (stage.preset === 'swarm') waves = WAVES.map((wave, index) => index < 8 ? [...wave, 'swarm', 'swarm'] : [...wave]);
  if (stage.preset === 'runner') waves = WAVES.map((wave, index) => index < 9 ? [...wave.filter((kind) => kind !== 'swarm'), 'runner', 'runner'] : [...wave]);
  if (stage.preset === 'armor') waves = WAVES.map((wave, index) => index >= 3 && index < 9 ? [...wave, 'shield'] : [...wave]);
  if (stage.preset === 'elite') waves = WAVES.map((wave, index) => index >= 4 && index < 9 ? [...wave, index >= 7 ? 'elite' : 'shield'] : [...wave]);
  if (stage.chapter === 2) waves = waves.map((wave, index) => [...wave, index < 5 ? 'normal' : 'shield', ...(index >= 6 && index < 9 ? ['elite' as EnemyKind] : [])]);
  if (stage.chapter === 3) waves = waves.map((wave, index) => [...wave, index < 4 ? 'swarm' : 'shield', ...(index >= 4 && index < 9 ? ['elite' as EnemyKind] : []), ...(index >= 7 && index < 9 ? ['runner' as EnemyKind] : [])]);
  return waves;
}

function initialDiscovery(): Record<HeroClass, number> {
  return { warrior: 1, archer: 1, spellblade: 0 };
}

function stageDeckSummary(profile: MergeProfile) {
  const classes = [`검사 1~${profile.warriorUnlocked}`, `궁사 1~${profile.archerUnlocked}`];
  if (profile.spellbladeUnlocked > 0) classes.push(`마검사 1~${profile.spellbladeUnlocked}`);
  return classes.join(' · ');
}

function stageStartCoins(stage: MergeStage, profile: MergeProfile) {
  return stage.startCoins + (profile.startCoinLevel ?? 0) * 5;
}

function waveClearReward(stage: MergeStage) {
  return 2 + (stage.chapter - 1) * 2 + Math.floor((stage.stageNumber - 1) / 3);
}

function stageLabel(stage: MergeStage) {
  return `${stage.chapter}-${stage.stageNumber}`;
}

function summonCost(baseCost: number, profile: MergeProfile) {
  return Math.max(1, Math.ceil(baseCost * (1 - (profile.summonDiscountLevel ?? 0) * 0.03)));
}

function silverDrop(kind: EnemyKind) {
  const config = kind === 'boss' ? [1, 15] : kind === 'elite' ? [.45, 5] : kind === 'shield' ? [.28, 2] : kind === 'runner' ? [.22, 1] : kind === 'swarm' ? [.14, 1] : [.18, 1];
  return Math.random() < config[0] ? config[1] : 0;
}

function newRunId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `merge-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
}

const GRID_SIZE = 6;
const PATH_CELLS = [0, 1, 2, 3, 4, 5, 11, 17, 23, 29, 35, 34, 33, 32, 31, 30];
const PATH_SET = new Set(PATH_CELLS);

function enemyGridCoordinates(progress: number) {
  const clamped = Math.max(0, Math.min(99.9, progress));
  const routePosition = clamped / 100 * (PATH_CELLS.length - 1);
  const fromIndex = Math.floor(routePosition);
  const fraction = routePosition - fromIndex;
  const from = PATH_CELLS[fromIndex];
  const to = PATH_CELLS[Math.min(PATH_CELLS.length - 1, fromIndex + 1)];
  const fromRow = Math.floor(from / GRID_SIZE);
  const fromCol = from % GRID_SIZE;
  const toRow = Math.floor(to / GRID_SIZE);
  const toCol = to % GRID_SIZE;
  return { row: fromRow + (toRow - fromRow) * fraction, col: fromCol + (toCol - fromCol) * fraction };
}

function enemyGridPosition(progress: number) {
  const { row, col } = enemyGridCoordinates(progress);
  return { left: `${(col + 0.5) / GRID_SIZE * 100}%`, top: `${(row + 0.5) / GRID_SIZE * 100}%` };
}

function isWithinRange(originIndex: number, targetIndex: number, range: number) {
  const originRow = Math.floor(originIndex / GRID_SIZE);
  const originCol = originIndex % GRID_SIZE;
  const targetRow = Math.floor(targetIndex / GRID_SIZE);
  const targetCol = targetIndex % GRID_SIZE;
  return Math.hypot(originRow - targetRow, originCol - targetCol) <= range;
}

const bestKey = (stageId: number) => `merge-defense:stage-${stageId}:best`;
const clearedKey = (stageId: number) => `merge-defense:stage-${stageId}:cleared`;
const unlockedKey = 'merge-defense:unlocked-stage';
const introKey = 'merge-defense:intro-seen';

export function MergeDefenseScreen({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>('map');
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [selectedStage, setSelectedStage] = useState(STAGES[0]);
  const [unlockedStage, setUnlockedStage] = useState(() => Math.max(1, Number(window.localStorage.getItem(unlockedKey)) || 1));
  const [bestScores, setBestScores] = useState<Record<number, number>>(() => Object.fromEntries(
    STAGES.map((stage) => [stage.id, Number(window.localStorage.getItem(bestKey(stage.id))) || 0]),
  ));
  const [clearedStages, setClearedStages] = useState<Record<number, boolean>>(() => Object.fromEntries(
    STAGES.map((stage) => [stage.id, window.localStorage.getItem(clearedKey(stage.id)) === 'true']),
  ));
  const [profile, setProfile] = useState<MergeProfile>(EMPTY_MERGE_PROFILE);
  const [shopMessage, setShopMessage] = useState('은화로 모든 전투에 적용되는 영구 강화를 구매하세요.');
  const chapterStages = STAGES.filter((stage) => stage.chapter === selectedChapter);
  const clearedCount = chapterStages.filter((stage) => clearedStages[stage.id]).length;
  const chapterOneCleared = profile.highestClearedStage >= 10 || Boolean(clearedStages[10]);
  const chapterTwoCleared = profile.highestClearedStage >= 20 || Boolean(clearedStages[20]);

  useEffect(() => {
    fetchMergeProfile().then(async (loadedProfile) => {
      const localClearedIds = STAGES.filter((stage) => window.localStorage.getItem(clearedKey(stage.id)) === 'true').map((stage) => stage.id);
      const localHighestCleared = Math.max(0, Math.min(STAGES.length, (Number(window.localStorage.getItem(unlockedKey)) || 1) - 1), ...localClearedIds);
      let nextProfile = loadedProfile;
      // DB 도입 전 브라우저에만 남아 있던 순차 진행도를 계정에 한 번 승계한다.
      for (let stageId = loadedProfile.highestClearedStage + 1; stageId <= localHighestCleared; stageId += 1) {
        nextProfile = await saveMergeStageClear(stageId);
      }
      setProfile(nextProfile);
      const restoredClears = Object.fromEntries(STAGES.map((stage) => [
        stage.id,
        stage.id <= nextProfile.highestClearedStage || window.localStorage.getItem(clearedKey(stage.id)) === 'true',
      ]));
      setClearedStages(restoredClears);
      STAGES.forEach((stage) => {
        if (restoredClears[stage.id]) window.localStorage.setItem(clearedKey(stage.id), 'true');
      });
      const nextUnlocked = Math.min(STAGES.length, nextProfile.highestClearedStage + 1);
      setUnlockedStage(nextUnlocked);
      window.localStorage.setItem(unlockedKey, String(nextUnlocked));
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!clearedStages[2] || profile.spellbladeRecipeUnlocked) return;
    unlockSpellbladeRecipe().then(setProfile).catch(() => undefined);
  }, [clearedStages, profile.spellbladeRecipeUnlocked]);

  if (screen === 'game') {
    return <MergeBattle stage={selectedStage} profile={profile} onLeave={() => setScreen('stages')} onDiscover={(heroClass, grade) => {
      return saveHeroDiscovery(heroClass, grade).then((nextProfile) => { setProfile(nextProfile); });
    }} onFinish={(score, won, silver, kills, runId, discovered) => {
      const next = Math.max(bestScores[selectedStage.id] ?? 0, score);
      setBestScores((current) => ({ ...current, [selectedStage.id]: next }));
      window.localStorage.setItem(bestKey(selectedStage.id), String(next));
      if (won) {
        setClearedStages((current) => ({ ...current, [selectedStage.id]: true }));
        window.localStorage.setItem(clearedKey(selectedStage.id), 'true');
        const nextUnlocked = Math.min(STAGES.length, Math.max(unlockedStage, selectedStage.id + 1));
        setUnlockedStage(nextUnlocked);
        window.localStorage.setItem(unlockedKey, String(nextUnlocked));
      }
      collectSilver(runId, selectedStage.id, silver, kills, discovered)
        .catch(() => profile)
        .then((nextProfile) => won ? saveMergeStageClear(selectedStage.id).catch(() => nextProfile) : nextProfile)
        .then((nextProfile) => won && selectedStage.id === 2 ? unlockSpellbladeRecipe() : nextProfile)
        .then((nextProfile) => {
          setProfile(nextProfile);
          if (won) {
            const nextUnlocked = Math.min(STAGES.length, nextProfile.highestClearedStage + 1);
            setUnlockedStage((current) => Math.max(current, nextUnlocked));
            window.localStorage.setItem(unlockedKey, String(nextUnlocked));
          }
        })
        .catch(() => undefined);
    }} />;
  }

  if (screen === 'shop') {
    const unlockedGradeFor = (heroClass: HeroClass) => heroClass === 'warrior' ? profile.warriorUnlocked : heroClass === 'archer' ? profile.archerUnlocked : profile.spellbladeUnlocked;
    const upgrades: Array<{ id: MergeUpgrade; title: string; detail: string; level: number }> = [
      { id: 'attack', title: '전체 공격력', detail: '모든 용사의 공격력 +1', level: profile.attackLevel },
      { id: 'startCoin', title: '시작 코인', detail: '모든 스테이지 시작 코인 +5', level: profile.startCoinLevel },
      { id: 'summonDiscount', title: '소환 할인', detail: '모든 용사 직접 호출 비용 -3%', level: profile.summonDiscountLevel },
    ];
    return (
      <main className="merge-stage-screen">
        <header className="merge-select-header"><button type="button" onClick={() => setScreen('map')}>← 전장 지도</button><div><small>MY ROOM</small><h1>나만의 침대 상점</h1><p>{shopMessage}</p></div><b>🥈 {profile.silver.toLocaleString()}</b></header>
        <section style={{ maxWidth: 1200, margin: '22px auto 0', padding: '0 24px' }}>
          <h2 style={{ margin: '0 0 12px' }}>보유 용사</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
            {CLASS_ORDER.map((heroClass) => {
              const unlockedGrade = unlockedGradeFor(heroClass);
              return <article key={heroClass} className={`merge-stack ${heroClass}`}><h3>{CLASS_LABEL[heroClass]} 도감 · 발견 {unlockedGrade}/10</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8 }}>{HEROES[heroClass].map((hero, index) => {
                const found = index < unlockedGrade;
                return <div key={hero.name} aria-label={found ? `${hero.name} 발견` : `${index + 1}단계 미발견`} style={{ textAlign: 'center', padding: 8, borderRadius: 12, background: '#ffffff0a', outline: '1px solid #ffffff12', opacity: found ? 1 : .42 }}><small>★{index + 1}{found ? ' · 발견' : ' · 미발견'}</small><img src={hero.image} alt="" style={{ display: 'block', width: '100%', height: 110, objectFit: 'contain', margin: '5px auto', filter: found ? 'none' : 'grayscale(1) brightness(.45)' }} /><strong>{found ? hero.name : '미발견 용사'}</strong><p>{found ? `공격 ${hero.attack + profile.attackLevel} · 호출 ${summonCost(hero.cost, profile)}` : '합성하여 해금'}</p></div>;
              })}</div></article>;
            })}
          </div>
          {!profile.spellbladeRecipeUnlocked && <p style={{ color: '#b8c2d9' }}>🔒 검사 10단계와 궁수 10단계를 합성하여 더 강력한 용사를 해금하세요.</p>}
          {profile.spellbladeRecipeUnlocked && profile.spellbladeUnlocked === 0 && <article className="merge-stack spellblade" style={{ marginTop: 14, padding: 16 }}><h3>🔮 마검사 융합식 해금</h3><p>창세검신 10단계 + 창세궁신 10단계를 머지하면 마검사가 탄생합니다.</p></article>}
          <h2 style={{ margin: '26px 0 0' }}>영구 강화</h2>
        </section>
        <section className="merge-stage-grid">
          {upgrades.map((upgrade) => {
            const cost = upgradeCost(profile, upgrade.id);
            return <button type="button" key={upgrade.id} className="available" disabled={cost === null || profile.silver < cost} onClick={() => purchaseMergeUpgrade(profile, upgrade.id).then((next) => { setProfile(next); setShopMessage(`${upgrade.title} 강화 완료!`); }).catch((error: unknown) => setShopMessage(error instanceof Error ? error.message : '강화에 실패했습니다'))}><span>LEVEL {upgrade.level}</span><i>{upgrade.id === 'attack' ? '⚔️' : upgrade.id === 'startCoin' ? '🪙' : '🏷️'}</i><strong>{upgrade.title}</strong><small>{upgrade.detail}</small><em>{cost === null ? '최대 단계' : `필요 은화 ${cost}`}</em><b>{cost === null ? '강화 완료' : '강화하기'}</b></button>;
          })}
        </section>
      </main>
    );
  }

  if (screen === 'stages') {
    const chapterTitle = selectedChapter === 1 ? '태엽 장난감 침공' : selectedChapter === 2 ? '주방 대소동' : '과자 성 공방전';
    return (
      <main className="merge-stage-screen">
        <header className="merge-select-header">
          <button type="button" onClick={() => setScreen('map')}>← 전장 지도</button>
          <div><small>CHAPTER {selectedChapter}</small><h1>{chapterTitle}</h1><p>{selectedChapter === 1 ? '용사를 합쳐 장난감 군단을 막으세요.' : selectedChapter === 2 ? '정리된 놀이방을 뒤로하고 주방의 음식 군단을 막으세요.' : '과자 성으로 밀려드는 군단을 막고 디저트 황제와 결전을 치르세요.'}</p></div>
          <b>🥈 {profile.silver.toLocaleString()} · {clearedCount} / 10</b>
        </header>
        <section className="merge-stage-grid">
          {chapterStages.map((stage) => {
            const locked = stage.id > unlockedStage;
            const best = bestScores[stage.id] ?? 0;
            return (
              <button
                type="button"
                key={stage.id}
                disabled={locked}
                className={locked ? 'locked' : `available ${clearedStages[stage.id] ? 'cleared' : ''}`}
                onClick={() => { setSelectedStage(stage); setScreen('game'); }}
              >
                <span>{stageLabel(stage)}</span><i>{locked ? '🔒' : stage.icon}</i><strong>{stage.title}</strong>
                <small className="merge-stage-details">
                  <span style={{ display: 'block' }}>{stage.route}</span>
                  <span style={{ display: 'block', marginTop: 8 }}>• 시작 코인 {stageStartCoins(stage, profile)}</span>
                  <span style={{ display: 'block' }}>• 등록 덱</span>
                  <span style={{ display: 'block', paddingLeft: 18 }}>
                    {stageDeckSummary(profile)}
                  </span>
                </small>
                <em>보스 · {stage.bossName}</em>
                <b>{locked ? '이전 스테이지 클리어 필요' : clearedStages[stage.id] ? `클리어 · 최고 ${best.toLocaleString()}점` : best ? `최고 ${best.toLocaleString()}점 · 재도전` : '도전 가능'}</b>
              </button>
            );
          })}
        </section>
      </main>
    );
  }

  return (
    <main className="merge-world-screen">
      <header className="merge-map-header"><button type="button" onClick={onExit}>← 광고게임</button><div><small>MERGE DEFENSE</small><h1>용사의 전장 지도</h1></div><span>합치고 성장해 장난감 군단을 막으세요</span></header>
      <section className="merge-world-map" style={{ backgroundImage: `linear-gradient(180deg, rgba(12,22,48,.15), rgba(12,22,48,.75)), url(${mapUrl})` }}>
        <div style={{ display: 'grid', gap: 16, width: 'min(430px,85vw)' }}>
          <button type="button" className="merge-chapter" style={{ width: '100%', background: 'linear-gradient(145deg,#355a72e8,#4f315fe8)' }} onClick={() => setScreen('shop')}><small>MY ROOM · 🥈 {profile.silver.toLocaleString()}</small><strong>나만의 침대</strong><span>용사를 영구 강화하는 전투 외 상점</span><b>상점 들어가기</b></button>
          <button type="button" className="merge-chapter" style={{ width: '100%' }} onClick={() => { setSelectedChapter(1); setScreen('stages'); }}><small>CHAPTER 1</small><strong>태엽 훈련장</strong><span>세 직군으로 10개 장난감 방어선을 돌파하세요</span><b>{STAGES.filter((stage) => stage.chapter === 1 && clearedStages[stage.id]).length === 10 ? '1장 방어 완료 · 다시 도전' : `${STAGES.filter((stage) => stage.chapter === 1 && clearedStages[stage.id]).length} / 10 방어`}</b></button>
          <button type="button" disabled={!chapterOneCleared} className={`merge-chapter ${chapterOneCleared ? '' : 'locked'}`} style={{ width: '100%', background: chapterOneCleared ? 'linear-gradient(145deg,#7c4d25e8,#763d25e8)' : undefined }} onClick={() => { setSelectedChapter(2); setScreen('stages'); }}><small>CHAPTER 2</small><strong>{chapterOneCleared ? '주방 대소동' : '🔒 주방'}</strong><span>쿠키·젤리·향신료 군단의 조리대를 방어하세요</span><b>{chapterOneCleared ? `${STAGES.filter((stage) => stage.chapter === 2 && clearedStages[stage.id]).length} / 10 방어 · 2-${Math.max(1, unlockedStage - 10)} 진입` : '1-10 클리어 시 해금'}</b></button>
          <button type="button" disabled={!chapterTwoCleared} className={`merge-chapter ${chapterTwoCleared ? '' : 'locked future'}`} style={{ width: '100%', background: chapterTwoCleared ? 'linear-gradient(145deg,#9a4d5ce8,#6c3b20e8)' : undefined }} onClick={() => { setSelectedChapter(3); setScreen('stages'); }}><small>CHAPTER 3</small><strong>{chapterTwoCleared ? '과자 성' : '🔒 과자 성'}</strong><span>쿠키 성벽 너머 달콤한 군단을 방어하세요</span><b>{chapterTwoCleared ? `${STAGES.filter((stage) => stage.chapter === 3 && clearedStages[stage.id]).length} / 10 방어 · 3-${Math.max(1, unlockedStage - 20)} 진입` : '2-10 클리어 시 해금'}</b></button>
          <button type="button" disabled className="merge-chapter locked future" style={{ width: '100%' }}><small>CHAPTER 4</small><strong>🔒 용의 둥지</strong><span>불꽃과 비늘로 뒤덮인 최상위 전장입니다</span><b>잠김 · 개발 예정</b></button>
          <button type="button" disabled className="merge-chapter locked future" style={{ width: '100%' }}><small>CHAPTER 5</small><strong>🔒 별빛 요새</strong><span>집 밖의 세계로 이어지는 마지막 관문입니다</span><b>잠김 · 개발 예정</b></button>
        </div>
      </section>
    </main>
  );
}

function MergeBattle({ stage, profile, onLeave, onDiscover, onFinish }: { stage: MergeStage; profile: MergeProfile; onLeave: () => void; onDiscover: (heroClass: HeroClass, grade: number) => Promise<void>; onFinish: (score: number, won: boolean, silver: number, kills: number, runId: string, discovered: Record<HeroClass, number>) => void }) {
  const stageWaves = useMemo(() => wavesFor(stage), [stage]);
  const startingCoins = stageStartCoins(stage, profile);
  const [coins, setCoins] = useState(startingCoins);
  const [baseHp, setBaseHp] = useState(stage.baseHp);
  const [wave, setWave] = useState(0);
  const [waveRunning, setWaveRunning] = useState(false);
  const [heroes, setHeroes] = useState<Array<Hero | null>>(() => Array(GRID_SIZE * GRID_SIZE).fill(null));
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [discovered, setDiscovered] = useState<Record<HeroClass, number>>(() => ({ ...initialDiscovery(), warrior: profile.warriorUnlocked, archer: profile.archerUnlocked, spellblade: profile.spellbladeUnlocked }));
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [message, setMessage] = useState(`${startingCoins}코인으로 첫 용사를 스폰하세요!`);
  const [newHero, setNewHero] = useState<{ heroClass: HeroClass; grade: number } | null>(null);
  const [finished, setFinished] = useState<'win' | 'lose' | null>(null);
  const [kills, setKills] = useState(0);
  const [killPoints, setKillPoints] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [stageSilver, setStageSilver] = useState(0);
  const [silverDrops, setSilverDrops] = useState<SilverDrop[]>([]);
  const [collectingSilver, setCollectingSilver] = useState(false);
  const [showIntro, setShowIntro] = useState(() => window.localStorage.getItem(introKey) !== 'true');
  const nextId = useRef(1);
  const heroesRef = useRef(heroes);
  const waveRunningRef = useRef(waveRunning);
  const finishedRef = useRef(finished);
  const finishReportedRef = useRef(false);
  const collectionStartedRef = useRef(false);
  const runIdRef = useRef(newRunId());
  heroesRef.current = heroes;
  waveRunningRef.current = waveRunning;
  finishedRef.current = finished;

  const score = useMemo(() => wave * 1000 + killPoints + baseHp * 100 + (finished === 'win' ? 5000 : 0) + Math.max(0, 3000 - Math.floor(elapsed) * 10), [wave, killPoints, baseHp, finished, elapsed]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!waveRunningRef.current || finishedRef.current) return;
      setElapsed((value) => value + 0.1);
      setEnemies((current) => {
        const next = current.map((enemy) => ({ ...enemy, progress: enemy.progress + enemy.speed * 0.1, hitFlash: Math.max(0, enemy.hitFlash - 0.1) }));
        const active = next.filter((enemy) => enemy.progress >= 0 && enemy.progress < 100 && enemy.hp > 0);
        const board = heroesRef.current.map((hero) => hero ? { ...hero, cooldown: Math.max(0, hero.cooldown - 0.1) } : null);
        board.forEach((hero, heroIndex) => {
          if (!hero || hero.cooldown > 0 || active.length === 0) return;
          const heroRow = Math.floor(heroIndex / GRID_SIZE);
          const heroCol = heroIndex % GRID_SIZE;
          const targetsInRange = active.filter((enemy) => {
            const position = enemyGridCoordinates(enemy.progress);
            return Math.hypot(heroRow - position.row, heroCol - position.col) <= HERO_RANGE[hero.heroClass];
          });
          if (targetsInRange.length === 0) return;
          const target = targetsInRange.reduce((bestEnemy, enemy) => enemy.progress > bestEnemy.progress ? enemy : bestEnemy);
          const data = HEROES[hero.heroClass][hero.grade - 1];
          target.hp -= data.attack + profile.attackLevel;
          target.hitFlash = 0.2;
          hero.cooldown = 1 / data.speed;
        });
        heroesRef.current = board;
        setHeroes(board);

        const dead = next.filter((enemy) => enemy.hp <= 0);
        if (dead.length) {
          setCoins((value) => value + dead.reduce((sum, enemy) => sum + ENEMY_DATA[enemy.kind].reward, 0));
          setKills((value) => value + dead.length);
          setKillPoints((value) => value + dead.reduce((sum, enemy) => sum + ENEMY_DATA[enemy.kind].points, 0));
          const drops = dead.flatMap((enemy) => {
            const amount = silverDrop(enemy.kind);
            if (!amount) return [];
            return [{ id: nextId.current++, amount, ...enemyGridPosition(enemy.progress) }];
          });
          if (drops.length) setSilverDrops((current) => [...current, ...drops]);
        }
        const escaped = next.filter((enemy) => enemy.progress >= 100 && enemy.hp > 0);
        if (escaped.length) {
          const damage = escaped.reduce((sum, enemy) => sum + (enemy.kind === 'boss' ? 10 : enemy.kind === 'elite' ? 2 : 1), 0);
          setBaseHp((value) => {
            const remaining = Math.max(0, value - damage);
            if (remaining === 0) setFinished('lose');
            return remaining;
          });
        }
        return next.filter((enemy) => enemy.hp > 0 && enemy.progress < 100);
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [profile.attackLevel]);

  useEffect(() => {
    if (!waveRunning || enemies.length > 0 || silverDrops.length > 0 || collectingSilver || finished) return;
    collectionStartedRef.current = false;
    setWaveRunning(false);
    const reward = waveClearReward(stage);
    setCoins((value) => value + reward);
    if (wave >= stageWaves.length) {
      setFinished('win');
      setMessage(`${stage.bossName}을(를) 물리쳤습니다!`);
    } else {
      setMessage(`${wave}웨이브 완료! +${reward}코인`);
    }
  }, [collectingSilver, enemies.length, finished, silverDrops.length, stage, stageWaves.length, wave, waveRunning]);

  useEffect(() => {
    const waveEnded = waveRunning && enemies.length === 0;
    if ((!waveEnded && !finished) || silverDrops.length === 0 || collectionStartedRef.current) return;
    collectionStartedRef.current = true;
    setCollectingSilver(true);
    setMessage(`${finished ? '전투' : `${wave}웨이브`} 전리품 은화 ${silverDrops.reduce((sum, drop) => sum + drop.amount, 0)}개를 회수합니다.`);
    const collected = silverDrops.reduce((sum, drop) => sum + drop.amount, 0);
    const timer = window.setTimeout(() => {
      setStageSilver((value) => value + collected);
      setSilverDrops([]);
      setCollectingSilver(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [enemies.length, finished, silverDrops, wave, waveRunning]);

  useEffect(() => {
    if (!finished || collectingSilver || silverDrops.length > 0 || finishReportedRef.current) return;
    finishReportedRef.current = true;
    reportGameResult({
      game: 'merge_defense',
      runId: runIdRef.current,
      final: true,
      stats: {
        stageId: stage.id,
        cleared: finished === 'win',
        wavesCleared: wave,
        kills,
        killPoints,
        baseHp,
        elapsedSeconds: Math.floor(elapsed),
      },
    });
    onFinish(score, finished === 'win', stageSilver, kills, runIdRef.current, discovered);
  }, [baseHp, collectingSilver, discovered, elapsed, finished, killPoints, kills, onFinish, score, silverDrops.length, stage.id, stageSilver, wave]);

  useEffect(() => {
    if (selectedSlot === null) return;
    const cancelSelectionOutsideGrid = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.merge-grid-cell')) return;
      setSelectedSlot(null);
      setMessage('용사 선택을 취소했습니다.');
    };
    document.addEventListener('pointerdown', cancelSelectionOutsideGrid);
    return () => document.removeEventListener('pointerdown', cancelSelectionOutsideGrid);
  }, [selectedSlot]);

  const startWave = () => {
    if (waveRunning || finished || wave >= stageWaves.length) return;
    const kinds = stageWaves[wave];
    setEnemies(kinds.map((kind, index) => {
      const data = ENEMY_DATA[kind];
      const hp = Math.round(data.hp * stage.hpScale);
      return { id: nextId.current++, kind, hp, maxHp: hp, progress: -index * 7, speed: data.speed * stage.speedScale, hitFlash: 0 };
    }));
    setWave(wave + 1);
    setWaveRunning(true);
    setMessage(`${wave + 1}웨이브 시작!`);
  };

  const spawn = (heroClass: HeroClass, grade: number) => {
    const data = HEROES[heroClass][grade - 1];
    const cost = summonCost(data.cost, profile);
    const freeSlots = heroes.reduce<number[]>((slots, hero, index) => {
      if (hero === null && !PATH_SET.has(index)) slots.push(index);
      return slots;
    }, []);
    if (freeSlots.length === 0) { setMessage('빈 격자 칸이 없습니다. 용사를 머지하세요.'); return; }
    if (coins < cost) { setMessage(`${cost - coins}코인이 더 필요합니다.`); return; }
    const slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
    const next = [...heroes];
    next[slot] = { id: nextId.current++, heroClass, grade, cooldown: 0 };
    setHeroes(next);
    setCoins((value) => value - cost);
    setSelectedSlot(null);
    setMessage(`${data.name}가 ${Math.floor(slot / GRID_SIZE) + 1}행 ${slot % GRID_SIZE + 1}열에 소환됐습니다. 용사를 선택한 뒤 빈 칸을 누르면 이동합니다.`);
  };

  const clickSlot = (index: number) => {
    const hero = heroes[index];
    if (PATH_SET.has(index)) { setMessage('적 이동 경로에는 용사를 배치할 수 없습니다.'); return; }
    if (!hero && selectedSlot !== null) {
      const selectedHero = heroes[selectedSlot];
      if (!selectedHero) { setSelectedSlot(null); return; }
      const next = [...heroes];
      next[selectedSlot] = null;
      next[index] = selectedHero;
      setHeroes(next);
      setSelectedSlot(null);
      setMessage(`${HEROES[selectedHero.heroClass][selectedHero.grade - 1].name}: ${Math.floor(index / GRID_SIZE) + 1}행 ${index % GRID_SIZE + 1}열로 이동했습니다.`);
      return;
    }
    if (!hero) { setSelectedSlot(null); return; }
    if (selectedSlot === null) {
      setSelectedSlot(index);
      setMessage(`${HEROES[hero.heroClass][hero.grade - 1].name} 선택: 빈 칸으로 이동하거나 동일한 용사와 머지하세요.`);
      return;
    }
    if (selectedSlot === index) { setSelectedSlot(null); setMessage('용사 선택을 취소했습니다.'); return; }
    const first = heroes[selectedSlot];
    if (!first) { setSelectedSlot(index); return; }
    const next = [...heroes];
    const createsSpellblade = profile.spellbladeRecipeUnlocked
      && first.grade === STANDARD_MAX_GRADE
      && hero.grade === STANDARD_MAX_GRADE
      && new Set([first.heroClass, hero.heroClass]).size === 2
      && [first.heroClass, hero.heroClass].every((heroClass) => heroClass === 'warrior' || heroClass === 'archer');
    if (createsSpellblade) {
      next[selectedSlot] = null;
      next[index] = { id: nextId.current++, heroClass: 'spellblade', grade: 1, cooldown: 0 };
      if (discovered.spellblade < 1) {
        setDiscovered((value) => ({ ...value, spellblade: 1 }));
        setNewHero({ heroClass: 'spellblade', grade: 1 });
      }
      void onDiscover('spellblade', 1).catch(() => setMessage('마검사는 탄생했지만 DB 저장에 실패했습니다. BE 연결을 확인하세요.'));
      setMessage('창세검신과 창세궁신이 융합해 마검사가 탄생했습니다!');
    } else if (first.heroClass === hero.heroClass && first.grade === hero.grade) {
      if (hero.grade >= HEROES[hero.heroClass].length) { setMessage('현재 계열의 최고 등급입니다.'); setSelectedSlot(null); return; }
      const grade = hero.grade + 1;
      next[selectedSlot] = null;
      next[index] = { id: nextId.current++, heroClass: hero.heroClass, grade, cooldown: 0 };
      if (grade > discovered[hero.heroClass]) {
        setDiscovered((value) => ({ ...value, [hero.heroClass]: grade }));
        setNewHero({ heroClass: hero.heroClass, grade });
      }
      void onDiscover(hero.heroClass, grade).catch(() => setMessage(`${HEROES[hero.heroClass][grade - 1].name} DB 저장에 실패했습니다. BE 연결을 확인하세요.`));
      setMessage(`${HEROES[hero.heroClass][grade - 1].name}(으)로 머지!`);
    } else {
      setSelectedSlot(index);
      setMessage(`${HEROES[hero.heroClass][hero.grade - 1].name}(으)로 선택을 전환했습니다.`);
      return;
    }
    setHeroes(next);
    setSelectedSlot(null);
  };

  const restart = () => {
    setCoins(startingCoins); setBaseHp(stage.baseHp); setWave(0); setWaveRunning(false); setHeroes(Array(GRID_SIZE * GRID_SIZE).fill(null)); setEnemies([]);
    finishReportedRef.current = false;
    collectionStartedRef.current = false;
    runIdRef.current = newRunId();
    setDiscovered({ ...initialDiscovery(), warrior: profile.warriorUnlocked, archer: profile.archerUnlocked, spellblade: profile.spellbladeUnlocked }); setSelectedSlot(null); setFinished(null); setKills(0); setKillPoints(0); setElapsed(0); setStageSilver(0); setSilverDrops([]); setCollectingSilver(false); setMessage(`${startingCoins}코인으로 첫 용사를 스폰하세요!`);
  };

  const startTutorial = () => {
    window.localStorage.setItem(introKey, 'true');
    setShowIntro(false);
    setHeroes((current) => {
      const slot = current.findIndex((hero, index) => hero === null && !PATH_SET.has(index));
      if (slot < 0) return current;
      const next = [...current];
      next[slot] = { id: nextId.current++, heroClass: 'spellblade', grade: 1, cooldown: 0, trial: true };
      return next;
    });
    setMessage('튜토리얼 체험용 마검사가 배치됐습니다. 이 용사는 도감에 저장되지 않습니다.');
  };

  const selectedHero = selectedSlot === null ? null : heroes[selectedSlot];

  return (
    <main className="merge-battle-screen">
      <header className="merge-battle-header"><button type="button" onClick={onLeave}>← 스테이지 선택</button><div><small>STAGE {stageLabel(stage)}</small><strong>{stage.title}</strong></div><div className="merge-stats"><span>❤️ {baseHp}</span><span>🪙 {coins}</span><span>🥈 {stageSilver > 0 ? `+${stageSilver}` : `전장 ${silverDrops.reduce((sum, drop) => sum + drop.amount, 0)}`}</span><span>⚔️ {wave}/{stageWaves.length}</span><span>🏆 {score.toLocaleString()}</span></div></header>
      <section className="merge-arena">
        <div className="merge-grid-map" style={{ '--battle-bg': `url(${stage.background})` } as CSSProperties} aria-label="6행 6열 전투 격자">
          {heroes.map((hero, index) => {
            const path = PATH_SET.has(index);
            const data = hero ? HEROES[hero.heroClass][hero.grade - 1] : null;
            const attackRange = selectedHero && selectedSlot !== null && isWithinRange(selectedSlot, index, HERO_RANGE[selectedHero.heroClass]);
            return (
              <button type="button" key={index} disabled={path} onClick={() => clickSlot(index)} className={`merge-grid-cell ${path ? 'path' : 'build'} ${hero ? hero.heroClass : ''} ${attackRange ? 'attack-range' : ''} ${selectedSlot === index ? 'selected' : ''} ${selectedSlot !== null && !hero && !path ? 'move-target' : ''}`}>
                {path && index === PATH_CELLS[0] && <span className="path-label">입구</span>}
                {path && index === PATH_CELLS[PATH_CELLS.length - 1] && <span className="grid-gate">🏰<small>기지</small></span>}
                {hero && data && <span className="grid-hero"><img src={data.image} alt={data.name} /><b>★{hero.grade}{hero.trial ? ' 체험' : ''}</b><small>{data.name}<br />공격 {data.attack + profile.attackLevel}</small></span>}
              </button>
            );
          })}
          {enemies.map((enemy) => {
            const data = ENEMY_DATA[enemy.kind];
            const enemyImage = enemy.kind === 'boss' ? stage.bossImage : stage.chapter >= 2 && (enemy.kind === 'normal' || enemy.kind === 'swarm') ? snackGuardianUrl : data.image;
            return <div key={enemy.id} className={`merge-enemy ${enemy.kind} ${enemy.hitFlash > 0 ? 'hit' : ''}`} style={enemyGridPosition(enemy.progress)}><img src={enemyImage} alt={enemy.kind === 'boss' ? stage.bossName : data.name} /><em>✦</em><div><i style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` }} /><span>{Math.ceil(enemy.hp)}/{enemy.maxHp}</span></div></div>;
          })}
          {silverDrops.map((drop) => <span key={drop.id} className={`merge-silver-drop ${collectingSilver ? 'collecting' : ''}`} style={{ left: drop.left, top: drop.top }}>🥈<b>+{drop.amount}</b></span>)}
        </div>
        {selectedHero && <div className="merge-range-legend"><span className="move">■ 이동 가능</span><span className="attack">■ 공격 범위 · {HERO_RANGE[selectedHero.heroClass]}칸</span></div>}
        <div className="merge-wave-message">{message}</div>
        <button type="button" className="merge-wave-button" disabled={waveRunning || Boolean(finished)} onClick={startWave}>{waveRunning ? '전투 중' : wave >= stageWaves.length ? '최종 결과' : `${wave + 1}웨이브 시작`}</button>
      </section>
      <section className="merge-spawn-stacks">{CLASS_ORDER.filter((heroClass) => discovered[heroClass] > 0).map((heroClass) => {
        return <div key={heroClass} className={`merge-stack ${heroClass}`}><h3>{CLASS_LABEL[heroClass]} 덱 · {discovered[heroClass]}/10 발견</h3><div>{HEROES[heroClass].slice(0, discovered[heroClass]).map((hero, index) => {
          const grade = index + 1;
          const cost = summonCost(hero.cost, profile);
          return <button type="button" key={hero.name} disabled={coins < cost || !heroes.some((unit, slot) => unit === null && !PATH_SET.has(slot))} onClick={() => spawn(heroClass, grade)}><img src={hero.image} alt="" /><span><strong>{hero.name}</strong><small>★{grade} · 공격 {hero.attack + profile.attackLevel}</small></span><b>{cost}🪙</b></button>;
        })}</div></div>;
      })}</section>
      {showIntro && <div className="merge-modal intro"><div><small>튜토리얼 체험 용사</small><h2>창세검신 + 창세궁신</h2><div className="merge-fusion"><span>⚔️<b>창세검신</b></span><i>＋</i><span>🏹<b>창세궁신</b></span><i>→</i><span className="ultimate">🔮<b>마검사</b></span></div><p>이번 튜토리얼에서만 마검사 1명을 미리 체험합니다. 정식 등록은 1-2 클리어 후 검사 10단계와 궁수 10단계를 합성해야 합니다.</p><button type="button" onClick={startTutorial}>마검사 체험하기</button></div></div>}
      {newHero && <div className="merge-modal"><div><small>새로운 직업 등장!</small><div className="new-hero-icon"><img src={HEROES[newHero.heroClass][newHero.grade - 1].image} alt={HEROES[newHero.heroClass][newHero.grade - 1].name} /></div><h2>{HEROES[newHero.heroClass][newHero.grade - 1].name}</h2><p>공격력 {HEROES[newHero.heroClass][newHero.grade - 1].attack} · 이제 {CLASS_LABEL[newHero.heroClass]} 스택에서 직접 스폰할 수 있습니다.</p><button type="button" onClick={() => setNewHero(null)}>대기열에 추가</button></div></div>}
      {finished && !collectingSilver && silverDrops.length === 0 && <div className="merge-modal"><div><small>{finished === 'win' ? 'STAGE CLEAR' : 'DEFENSE FAILED'}</small><h2>{finished === 'win' ? `${stage.bossName} 격파!` : '기지가 무너졌습니다'}</h2><p>{stageLabel(stage)} · 처치 {kills} · 도달 웨이브 {wave} · 최종 점수 {score.toLocaleString()} · 획득 은화 {stageSilver}</p><button type="button" onClick={restart}>다시 도전</button><button type="button" className="secondary" onClick={onLeave}>스테이지 선택</button></div></div>}
    </main>
  );
}
