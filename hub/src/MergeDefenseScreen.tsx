import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import gruntUrl from '../../number-gate-runner/src/assets/enemies/clockwork-grunt.png';
import golemUrl from '../../number-hero-tower/src/assets/enemy-block-golem-stage1.png';
import knightUrl from '../../number-hero-tower/src/assets/enemy-clockwork-knight-stage1.png';
import bossUrl from '../../number-gate-runner/src/assets/bosses/boss-1-2-giant-teddy.png';
import mapUrl from '../../number-hero-tower/src/assets/house-chapter-map.jpg';
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
import './MergeDefenseScreen.css';
import './MergeDefenseGrid.css';

type Screen = 'map' | 'stages' | 'game';
type HeroClass = 'warrior' | 'archer' | 'spellblade';
type EnemyKind = 'swarm' | 'runner' | 'normal' | 'shield' | 'elite' | 'boss';

interface Hero {
  id: number;
  heroClass: HeroClass;
  grade: number;
  cooldown: number;
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

const HEROES: Record<HeroClass, Array<{ name: string; attack: number; speed: number; cost: number; icon: string; image: string }>> = {
  warrior: [
    { name: '수습 검사', attack: 5, speed: 0.8, cost: 5, icon: '🗡️', image: swordsmanUrl },
    { name: '방패 전사', attack: 12, speed: 0.8, cost: 8, icon: '🛡️', image: shieldWarriorUrl },
    { name: '기사', attack: 27, speed: 0.8, cost: 14, icon: '⚔️', image: knightHeroUrl },
    { name: '성기사', attack: 60, speed: 0.8, cost: 24, icon: '🌟', image: holyKnightUrl },
  ],
  archer: [
    { name: '견습 궁수', attack: 4, speed: 1.25, cost: 5, icon: '🏹', image: archerUrl },
    { name: '명사수', attack: 9, speed: 1.25, cost: 8, icon: '🎯', image: marksmanUrl },
    { name: '레인저', attack: 20, speed: 1.25, cost: 14, icon: '🪶', image: rangerUrl },
    { name: '신궁', attack: 44, speed: 1.25, cost: 24, icon: '✨', image: divineArcherUrl },
  ],
  spellblade: [
    { name: '마검사', attack: 6, speed: 1, cost: 7, icon: '🔮', image: spellbladeUrl },
    { name: '룬 검사', attack: 13, speed: 1, cost: 11, icon: '💠', image: spellbladeUrl },
    { name: '마도 기사', attack: 29, speed: 1, cost: 20, icon: '🌀', image: spellbladeUrl },
    { name: '아케인 블레이더', attack: 64, speed: 1, cost: 34, icon: '🌌', image: spellbladeUrl },
  ],
};

const CLASS_LABEL: Record<HeroClass, string> = { warrior: '검사', archer: '궁사', spellblade: '마검사' };
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

const bestKey = 'merge-defense:stage-1:best';
const introKey = 'merge-defense:intro-seen';

export function MergeDefenseScreen({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>('map');
  const [best, setBest] = useState(() => Number(window.localStorage.getItem(bestKey)) || 0);

  if (screen === 'game') {
    return <MergeBattle onLeave={() => setScreen('stages')} onScore={(score) => {
      const next = Math.max(best, score);
      setBest(next);
      window.localStorage.setItem(bestKey, String(next));
    }} />;
  }

  if (screen === 'stages') {
    return (
      <main className="merge-stage-screen">
        <header className="merge-select-header">
          <button type="button" onClick={() => setScreen('map')}>← 장난감 지도</button>
          <div><small>CHAPTER 1</small><h1>태엽 장난감 침공</h1><p>용사를 스폰하고 같은 직업을 합쳐 기지를 지키세요.</p></div>
          <b>1 / 10</b>
        </header>
        <section className="merge-stage-grid">
          <button type="button" className="available" onClick={() => setScreen('game')}>
            <span>1-1</span><i>⚙️</i><strong>세 갈래의 시작</strong><small>최고 등급 4 · 시작 25코인</small><em>보스 · 거대 태엽 곰</em><b>{best ? `최고 ${best.toLocaleString()}점` : '도전 가능'}</b>
          </button>
          {Array.from({ length: 9 }, (_, index) => (
            <button type="button" key={index} disabled className="locked"><span>1-{index + 2}</span><i>🔒</i><strong>준비 중</strong><small>스테이지 개발 예정</small></button>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="merge-world-screen">
      <header className="merge-map-header"><button type="button" onClick={onExit}>← 광고게임</button><div><small>MERGE DEFENSE</small><h1>용사의 전장 지도</h1></div><span>합치고 성장해 장난감 군단을 막으세요</span></header>
      <section className="merge-world-map" style={{ backgroundImage: `linear-gradient(180deg, rgba(12,22,48,.15), rgba(12,22,48,.75)), url(${mapUrl})` }}>
        <button type="button" className="merge-chapter" onClick={() => setScreen('stages')}><small>CHAPTER 1</small><strong>태엽 훈련장</strong><span>세 직군의 첫 방어전</span><b>1-1 도전하기</b></button>
        <div className="merge-future"><span>🔒 과자 성</span><span>🔒 용의 둥지</span><span>🔒 별빛 요새</span></div>
      </section>
    </main>
  );
}

function MergeBattle({ onLeave, onScore }: { onLeave: () => void; onScore: (score: number) => void }) {
  const [coins, setCoins] = useState(25);
  const [baseHp, setBaseHp] = useState(20);
  const [wave, setWave] = useState(0);
  const [waveRunning, setWaveRunning] = useState(false);
  const [heroes, setHeroes] = useState<Array<Hero | null>>(() => Array(GRID_SIZE * GRID_SIZE).fill(null));
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [discovered, setDiscovered] = useState<Record<HeroClass, number>>({ warrior: 1, archer: 1, spellblade: 1 });
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [message, setMessage] = useState('25코인으로 첫 용사를 스폰하세요!');
  const [newHero, setNewHero] = useState<{ heroClass: HeroClass; grade: number } | null>(null);
  const [finished, setFinished] = useState<'win' | 'lose' | null>(null);
  const [kills, setKills] = useState(0);
  const [killPoints, setKillPoints] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [showIntro, setShowIntro] = useState(() => window.localStorage.getItem(introKey) !== 'true');
  const nextId = useRef(1);
  const heroesRef = useRef(heroes);
  const waveRunningRef = useRef(waveRunning);
  const finishedRef = useRef(finished);
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
          target.hp -= data.attack;
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
  }, []);

  useEffect(() => {
    if (!waveRunning || enemies.length > 0 || finished) return;
    setWaveRunning(false);
    const reward = wave + 4;
    setCoins((value) => value + reward);
    if (wave >= WAVES.length) {
      setFinished('win');
      setMessage('거대 태엽 곰을 물리쳤습니다!');
    } else {
      setMessage(`${wave}웨이브 완료! +${reward}코인`);
    }
  }, [enemies.length, finished, wave, waveRunning]);

  useEffect(() => {
    if (!finished) return;
    onScore(score);
  }, [finished, onScore, score]);

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
    if (waveRunning || finished || wave >= WAVES.length) return;
    const kinds = WAVES[wave];
    setEnemies(kinds.map((kind, index) => {
      const data = ENEMY_DATA[kind];
      return { id: nextId.current++, kind, hp: data.hp, maxHp: data.hp, progress: -index * 7, speed: data.speed, hitFlash: 0 };
    }));
    setWave(wave + 1);
    setWaveRunning(true);
    setMessage(`${wave + 1}웨이브 시작!`);
  };

  const spawn = (heroClass: HeroClass, grade: number) => {
    const data = HEROES[heroClass][grade - 1];
    const freeSlots = heroes.reduce<number[]>((slots, hero, index) => {
      if (hero === null && !PATH_SET.has(index)) slots.push(index);
      return slots;
    }, []);
    if (freeSlots.length === 0) { setMessage('빈 격자 칸이 없습니다. 용사를 머지하세요.'); return; }
    if (coins < data.cost) { setMessage(`${data.cost - coins}코인이 더 필요합니다.`); return; }
    const slot = freeSlots[Math.floor(Math.random() * freeSlots.length)];
    const next = [...heroes];
    next[slot] = { id: nextId.current++, heroClass, grade, cooldown: 0 };
    setHeroes(next);
    setCoins((value) => value - data.cost);
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
    if (first.heroClass === hero.heroClass && first.grade === hero.grade) {
      if (hero.grade >= 4) { setMessage('스테이지 1의 최고 등급입니다.'); setSelectedSlot(null); return; }
      const grade = hero.grade + 1;
      next[selectedSlot] = null;
      next[index] = { id: nextId.current++, heroClass: hero.heroClass, grade, cooldown: 0 };
      if (grade > discovered[hero.heroClass]) {
        setDiscovered((value) => ({ ...value, [hero.heroClass]: grade }));
        setNewHero({ heroClass: hero.heroClass, grade });
      }
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
    setCoins(25); setBaseHp(20); setWave(0); setWaveRunning(false); setHeroes(Array(GRID_SIZE * GRID_SIZE).fill(null)); setEnemies([]);
    setDiscovered({ warrior: 1, archer: 1, spellblade: 1 }); setSelectedSlot(null); setFinished(null); setKills(0); setKillPoints(0); setElapsed(0); setMessage('25코인으로 첫 용사를 스폰하세요!');
  };

  const selectedHero = selectedSlot === null ? null : heroes[selectedSlot];

  return (
    <main className="merge-battle-screen">
      <header className="merge-battle-header"><button type="button" onClick={onLeave}>← 스테이지 선택</button><div><small>STAGE 1-1</small><strong>세 갈래의 시작</strong></div><div className="merge-stats"><span>❤️ {baseHp}</span><span>🪙 {coins}</span><span>⚔️ {wave}/10</span><span>🏆 {score.toLocaleString()}</span></div></header>
      <section className="merge-arena">
        <div className="merge-grid-map" style={{ '--battle-bg': `url(${trainingYardUrl})` } as CSSProperties} aria-label="6행 6열 전투 격자">
          {heroes.map((hero, index) => {
            const path = PATH_SET.has(index);
            const data = hero ? HEROES[hero.heroClass][hero.grade - 1] : null;
            const attackRange = selectedHero && selectedSlot !== null && isWithinRange(selectedSlot, index, HERO_RANGE[selectedHero.heroClass]);
            return (
              <button type="button" key={index} disabled={path} onClick={() => clickSlot(index)} className={`merge-grid-cell ${path ? 'path' : 'build'} ${hero ? hero.heroClass : ''} ${attackRange ? 'attack-range' : ''} ${selectedSlot === index ? 'selected' : ''} ${selectedSlot !== null && !hero && !path ? 'move-target' : ''}`}>
                {path && index === PATH_CELLS[0] && <span className="path-label">입구</span>}
                {path && index === PATH_CELLS[PATH_CELLS.length - 1] && <span className="grid-gate">🏰<small>기지</small></span>}
                {hero && data && <span className="grid-hero"><img src={data.image} alt={data.name} /><b>★{hero.grade}</b><small>{data.name}<br />공격 {data.attack}</small></span>}
              </button>
            );
          })}
          {enemies.map((enemy) => {
            const data = ENEMY_DATA[enemy.kind];
            return <div key={enemy.id} className={`merge-enemy ${enemy.kind} ${enemy.hitFlash > 0 ? 'hit' : ''}`} style={enemyGridPosition(enemy.progress)}><img src={data.image} alt={data.name} /><em>✦</em><div><i style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp * 100)}%` }} /><span>{Math.ceil(enemy.hp)}/{enemy.maxHp}</span></div></div>;
          })}
        </div>
        {selectedHero && <div className="merge-range-legend"><span className="move">■ 이동 가능</span><span className="attack">■ 공격 범위 · {HERO_RANGE[selectedHero.heroClass]}칸</span></div>}
        <div className="merge-wave-message">{message}</div>
        <button type="button" className="merge-wave-button" disabled={waveRunning || Boolean(finished)} onClick={startWave}>{waveRunning ? '전투 중' : wave >= 10 ? '최종 결과' : `${wave + 1}웨이브 시작`}</button>
      </section>
      <section className="merge-spawn-stacks">{CLASS_ORDER.map((heroClass) => <div key={heroClass} className={`merge-stack ${heroClass}`}><h3>{CLASS_LABEL[heroClass]} 스택</h3><div>{HEROES[heroClass].slice(0, discovered[heroClass]).map((hero, index) => <button type="button" key={hero.name} disabled={coins < hero.cost || !heroes.some((unit, slot) => unit === null && !PATH_SET.has(slot))} onClick={() => spawn(heroClass, index + 1)}><img src={hero.image} alt="" /><span><strong>{hero.name}</strong><small>공격 {hero.attack}</small></span><b>{hero.cost}🪙</b></button>)}</div></div>)}</section>
      {showIntro && <div className="merge-modal intro"><div><small>미래의 최종 전장</small><h2>창세검신 + 창세궁신</h2><div className="merge-fusion"><span>⚔️<b>창세검신</b></span><i>＋</i><span>🏹<b>창세궁신</b></span><i>→</i><span className="ultimate">🌌<b>창세마검신</b></span></div><p>두 영웅의 힘이 합쳐져 창세마검신이 탄생했습니다. 그 힘이 세 갈래 스폰 스택으로 이어집니다.</p><button type="button" onClick={() => { window.localStorage.setItem(introKey, 'true'); setShowIntro(false); }}>검사 · 궁사 · 마검사 스택 열기</button></div></div>}
      {newHero && <div className="merge-modal"><div><small>새로운 직업 등장!</small><div className="new-hero-icon"><img src={HEROES[newHero.heroClass][newHero.grade - 1].image} alt={HEROES[newHero.heroClass][newHero.grade - 1].name} /></div><h2>{HEROES[newHero.heroClass][newHero.grade - 1].name}</h2><p>공격력 {HEROES[newHero.heroClass][newHero.grade - 1].attack} · 이제 {CLASS_LABEL[newHero.heroClass]} 스택에서 직접 스폰할 수 있습니다.</p><button type="button" onClick={() => setNewHero(null)}>대기열에 추가</button></div></div>}
      {finished && <div className="merge-modal"><div><small>{finished === 'win' ? 'STAGE CLEAR' : 'DEFENSE FAILED'}</small><h2>{finished === 'win' ? '태엽 훈련장 방어 성공!' : '기지가 무너졌습니다'}</h2><p>처치 {kills} · 도달 웨이브 {wave} · 최종 점수 {score.toLocaleString()}</p><button type="button" onClick={restart}>다시 도전</button><button type="button" className="secondary" onClick={onLeave}>스테이지 선택</button></div></div>}
    </main>
  );
}
