import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { canDefeat, createChoices, createScoreUpdate, newRunId, STAGES } from './game/engine';
import { reportScoreUpdate } from './game/scoreReporter';
import type { EnemyChoice, HistoryEntry, RouteWidth, RunPhase, StageConfig } from './game/types';
import heroImage from './assets/number-hero-stage1.png';
import heroImage2 from './assets/number-hero-stage2.png';
import heroImage3 from './assets/number-hero-stage3.png';
import heroImage4 from './assets/number-hero-stage4.png';
import heroImage5 from './assets/number-hero-stage5.png';
import blockGolemImage from './assets/enemy-block-golem-stage1.png';
import clockworkKnightImage from './assets/enemy-clockwork-knight-stage1.png';
import snackGuardianImage from './assets/enemy-snack-guardian-stage1.png';
import boss01 from './assets/boss-01-block-dragon.png';
import boss02 from './assets/boss-02-clockwork-tyrant.png';
import boss03 from './assets/boss-03-cookie-king.png';
import boss04 from './assets/boss-04-candy-hydra.png';
import boss05 from './assets/boss-05-mecha-tirano.png';
import boss06 from './assets/boss-06-block-pirate-king.png';
import boss07 from './assets/boss-07-jelly-kraken.png';
import boss08 from './assets/boss-08-runaway-carousel.png';
import boss09 from './assets/boss-09-golden-golem.png';
import boss10 from './assets/boss-10-emperor-dragon.png';
import houseChapterMap from './assets/house-chapter-map.jpg';
import playroomMessy from './assets/playroom-messy.jpg';
import playroomClean from './assets/playroom-clean.jpg';
import './styles.css';

const BADGES: Record<RouteWidth, { mark: string; name: string; ko: string }> = {
  wide: { mark: '← WIDE →', name: 'WIDE', ko: '선택폭 넓음' },
  tight: { mark: '→ TIGHT ←', name: 'TIGHT', ko: '선택폭 좁음' },
  general: { mark: '— GENERAL —', name: 'GENERAL', ko: '선택폭 일반' },
};

const ENEMY_NAMES: Record<EnemyChoice['archetype'], string> = {
  block: '블록 골렘',
  robot: '태엽 기사',
  snack: '과자 수호자',
};

const ENEMY_IMAGES: Record<EnemyChoice['archetype'], string> = {
  block: blockGolemImage,
  robot: clockworkKnightImage,
  snack: snackGuardianImage,
};

const BOSS_IMAGES: Record<number, string> = {
  1: boss01, 2: boss02, 3: boss03, 4: boss04, 5: boss05,
  6: boss06, 7: boss07, 8: boss08, 9: boss09, 10: boss10,
};

const HERO_IMAGES = [heroImage, heroImage2, heroImage3, heroImage4, heroImage5];

const KITCHEN_STAGES = [
  ['2-1', '쿠키 조리대', '쿠키 병정', '🍪'], ['2-2', '식기 서랍', '포크 기사', '🍴'],
  ['2-3', '사탕 선반', '캔디 마법사', '🍬'], ['2-4', '싱크대 수로', '거품 슬라임', '🫧'],
  ['2-5', '토스터 협곡', '토스트 골렘', '🍞'], ['2-6', '냄비 화산', '수프 마녀', '🍲'],
  ['2-7', '냉장고 설원', '얼음 푸딩', '🧊'], ['2-8', '오븐 요새', '불꽃 셰프', '🔥'],
  ['2-9', '한밤의 식탁', '은식기 군단', '🥄'], ['2-10', '왕실 주방', '냉장고 대왕', '👑'],
] as const;

interface Props {
  onExit?: () => void;
}

export function NumberHeroTowerGame({ onExit }: Props) {
  const [screen, setScreen] = useState<'map' | 'stages' | 'cleanup'>('map');
  const [chapter, setChapter] = useState<1 | 2>(1);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [unlockedStage, setUnlockedStage] = useState(() => {
    if (typeof localStorage === 'undefined') return 1;
    return Math.min(10, Math.max(1, Number(localStorage.getItem('number-hero-tower:unlocked-stage') ?? 1)));
  });
  const [chapterOneCleared, setChapterOneCleared] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('number-hero-tower:chapter-1-cleared') === 'true' || Number(localStorage.getItem('number-hero-tower:stage-10:best') ?? 0) > 0;
  });

  const completeStage = (stageId: number) => {
    const nextUnlocked = Math.min(10, Math.max(unlockedStage, stageId + 1));
    setUnlockedStage(nextUnlocked);
    localStorage.setItem('number-hero-tower:unlocked-stage', String(nextUnlocked));
    if (stageId === 10) {
      setChapterOneCleared(true);
      localStorage.setItem('number-hero-tower:chapter-1-cleared', 'true');
    }
  };

  if (screen === 'map') {
    return <HouseMap chapterOneCleared={chapterOneCleared} onOpenChapter={(nextChapter) => { setChapter(nextChapter); setScreen('stages'); }} onExit={onExit} />;
  }

  if (screen === 'cleanup') {
    return <PlayroomCleanup onMap={() => setScreen('map')} onKitchen={() => { setChapter(2); setScreen('stages'); }} />;
  }

  if (selectedStageId === null) {
    return <StageSelect chapter={chapter} unlockedStage={unlockedStage} chapterOneCleared={chapterOneCleared} onSelect={setSelectedStageId} onMap={() => setScreen('map')} />;
  }

  const stage = STAGES[selectedStageId - 1];
  return (
    <StageRun
      key={`${selectedStageId}-${runKey}`}
      stage={stage}
      onExit={onExit}
      onComplete={() => completeStage(stage.id)}
      onRestart={() => setRunKey((value) => value + 1)}
      onSelectStage={() => setSelectedStageId(null)}
      onFinishChapter={stage.id === 10 ? () => setScreen('cleanup') : undefined}
      onNextStage={stage.id < STAGES.length ? () => { setSelectedStageId(stage.id + 1); setRunKey((value) => value + 1); } : undefined}
    />
  );
}

function HouseMap({ chapterOneCleared, onOpenChapter, onExit }: { chapterOneCleared: boolean; onOpenChapter: (chapter: 1 | 2) => void; onExit?: () => void }) {
  const clearedCount = STAGES.filter((stage) => Number(localStorage.getItem(`number-hero-tower:stage-${stage.id}:best`) ?? 0) > 0).length;
  return (
    <main className="number-hero-tower house-map-screen">
      <header className="map-header"><div><p>NUMBER HERO · HOME MAP</p><h1>집안 세계지도</h1><span>방을 되찾으면 집 안의 새로운 길이 열립니다.</span></div>{onExit && <button onClick={onExit}>광고게임 목록</button>}</header>
      <section className="house-map-board" style={{ backgroundImage: `linear-gradient(#07101b20,#07101b55),url(${houseChapterMap})` }}>
        <button className={`chapter-marker playroom ${chapterOneCleared ? 'complete' : ''}`} onClick={() => onOpenChapter(1)}><small>CHAPTER 1</small><strong>놀이방</strong><span>{chapterOneCleared ? '정리 완료' : `${clearedCount} / 10`}</span><b>{chapterOneCleared ? '다시 보기' : '입장'}</b></button>
        <button className={`chapter-marker kitchen ${chapterOneCleared ? 'open' : 'locked'}`} disabled={!chapterOneCleared} onClick={() => onOpenChapter(2)}><small>CHAPTER 2</small><strong>주방</strong><span>{chapterOneCleared ? '새로운 소동 발생' : '1장 클리어 필요'}</span><b>{chapterOneCleared ? '입장' : '🔒 잠김'}</b></button>
      </section>
      <section className="future-rooms" aria-label="아직 잠긴 공간"><div><i>🔒</i><span>3장</span><strong>욕실</strong></div><div><i>🔒</i><span>4장</span><strong>서재</strong></div><div><i>🔒</i><span>5장</span><strong>창고</strong></div><p>집 안에는 아직 열리지 않은 문이 남아 있습니다.</p></section>
    </main>
  );
}

function PlayroomCleanup({ onMap, onKitchen }: { onMap: () => void; onKitchen: () => void }) {
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setCleaned(true), 2700); return () => window.clearTimeout(timer); }, []);
  return (
    <main className={`number-hero-tower cleanup-screen ${cleaned ? 'cleaned' : 'cleaning'}`}>
      <img className="cleanup-before" src={playroomMessy} alt="장난감이 어지럽게 흩어진 놀이방" />
      <img className="cleanup-after" src={playroomClean} alt="깨끗하게 정리된 놀이방" />
      {!cleaned && <div className="cleanup-vortex" aria-hidden="true"><i/><i/><i/><span>◆</span></div>}
      <div className="cleanup-toys" aria-hidden="true"><i>▦</i><i>●</i><i>▲</i><i>◆</i><i>■</i><i>★</i></div>
      <section className="cleanup-copy"><p>CHAPTER 1 COMPLETE</p><h1>{cleaned ? '놀이방 정리 완료!' : '장난감이 제자리로 돌아갑니다'}</h1><span>{cleaned ? '복도 끝 주방에서 새로운 소동이 시작되었습니다.' : '숫자의 힘이 방 전체를 감싸고 있습니다.'}</span>{cleaned && <div><button onClick={onMap}>세계지도 보기</button><button className="kitchen-open" onClick={onKitchen}>2장 주방으로</button></div>}</section>
    </main>
  );
}

function StageSelect({ chapter, unlockedStage, chapterOneCleared, onSelect, onMap }: { chapter: 1 | 2; unlockedStage: number; chapterOneCleared: boolean; onSelect: (stageId: number) => void; onMap: () => void }) {
  if (chapter === 2) return (
    <main className="number-hero-tower stage-select-screen kitchen-stage-screen">
      <header className="stage-select-header"><div><p>CHAPTER 2 · KITCHEN</p><h1>주방</h1><span>다음 모험에서 도전할 스테이지를 고르세요</span></div><button type="button" onClick={onMap}>집안 세계지도</button></header>
      <section className="kitchen-stage-grid" aria-label="2장 주방 스테이지 선택">{KITCHEN_STAGES.map(([number,title,boss,icon],index)=><button key={number} className={index===0&&chapterOneCleared?'preview-open':'preview-locked'} disabled><span>{number}</span><i>{icon}</i><strong>{title}</strong><small>{boss}</small><b>{index===0?'다음 개발: 전투 준비':'LOCKED'}</b></button>)}</section>
      <footer className="stage-select-footer">2장 주방이 열렸습니다 · 현재는 스테이지 선택 지점까지 진행할 수 있습니다.</footer>
    </main>
  );
  return (
    <main className="number-hero-tower stage-select-screen">
      <header className="stage-select-header">
        <div><p>CHAPTER 1 · PLAYROOM</p><h1>놀이방</h1><span>도전할 장난감 탑을 선택하세요</span></div>
        <button type="button" onClick={onMap}>집안 세계지도</button>
      </header>
      <section className="stage-select-grid" aria-label="스테이지 선택">
        {STAGES.map((stage) => {
          const unlocked = stage.id <= unlockedStage;
          const best = typeof localStorage === 'undefined' ? 0 : Number(localStorage.getItem(`number-hero-tower:stage-${stage.id}:best`) ?? 0);
          return (
            <button key={stage.id} type="button" className={`stage-select-card theme-${stage.id} ${unlocked ? 'unlocked' : 'locked'} ${best > 0 ? 'cleared' : ''}`} disabled={!unlocked} onClick={() => onSelect(stage.id)} style={{ '--stage-accent': stage.accent } as CSSProperties}>
              <span className="stage-card-number">1-{stage.id}</span>
              <img src={BOSS_IMAGES[stage.id]} alt="" />
              <span className="stage-card-theme">{stage.theme}</span>
              <strong>{stage.title}</strong>
              <small>{stage.bossName}</small>
              {best > 0 && <span className="stage-clear-stamp"><em>클리어</em><span>최고 점수</span><strong>{best}</strong></span>}
              <b>{unlocked ? best > 0 ? '다시 도전' : '도전 가능' : 'LOCKED'}</b>
            </button>
          );
        })}
      </section>
      <footer className="stage-select-footer">1-10을 클리어하면 놀이방이 정리되고 2장 주방이 열립니다.</footer>
    </main>
  );
}

function StageRun({ stage, onExit, onRestart, onSelectStage, onNextStage, onFinishChapter, onComplete }: Props & { stage: StageConfig; onRestart: () => void; onSelectStage: () => void; onNextStage?: () => void; onFinishChapter?: () => void; onComplete: () => void }) {
  const runId = useRef(newRunId());
  const timers = useRef<number[]>([]);
  const [floor, setFloor] = useState(1);
  const [path, setPath] = useState('root');
  const [power, setPower] = useState<number>(stage.startPower);
  const [choiceCount, setChoiceCount] = useState(3);
  const [phase, setPhase] = useState<RunPhase>('traveling');
  const [selected, setSelected] = useState<EnemyChoice | null>(null);
  const [revealedReward, setRevealedReward] = useState<number | null>(null);
  const [battleHeroPower, setBattleHeroPower] = useState(power);
  const [battleEnemyPower, setBattleEnemyPower] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [syncText, setSyncText] = useState('첫 보상 합산 후 BE 기록 시작');
  const choices = useMemo(() => createChoices(floor, path, choiceCount, stage), [floor, path, choiceCount, stage]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  useEffect(() => {
    if (phase !== 'battling') return;
    const enemyPower = selected?.attack ?? stage.bossAttack;
    const startedAt = performance.now();
    const duration = 1250;
    setBattleHeroPower(power);
    setBattleEnemyPower(enemyPower);
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      setBattleHeroPower(Math.max(0, Math.round(power - enemyPower * progress)));
      setBattleEnemyPower(Math.max(0, Math.round(enemyPower - power * progress)));
      if (progress === 1) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [phase, power, selected, stage.bossAttack]);

  useEffect(() => {
    if (phase !== 'traveling') return;
    const timer = window.setTimeout(() => {
      setPhase(floor > stage.floorCount ? 'dragon' : 'choosing');
    }, 1750);
    return () => window.clearTimeout(timer);
  }, [floor, phase, stage.floorCount]);

  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  };

  const publish = (nextPower: number, floorsCleared: number, final = false) => {
    reportScoreUpdate(runId.current, createScoreUpdate(nextPower, floorsCleared, final, stage.id), final);
    setSyncText(final ? `최종 ${nextPower}점 BE 전송 완료` : `${nextPower}점 BE 전송`);
  };

  const finishFailed = (enemy: EnemyChoice | null) => {
    setSelected(enemy);
    setPhase('failed');
    publish(power, history.length, true);
  };

  const selectEnemy = (enemy: EnemyChoice) => {
    if (phase !== 'choosing') return;
    setSelected(enemy);
    setPhase('battling');
    setRevealedReward(null);

    later(() => {
      if (!canDefeat(power, enemy.attack)) {
        finishFailed(enemy);
        return;
      }

      setPhase('revealing');
      setRevealedReward(enemy.reward);
      later(() => {
        const nextPower = power + enemy.reward;
        const nextHistory = [
          ...history,
          { floor, attack: enemy.attack, reward: enemy.reward, routeWidth: enemy.routeWidth, heroPowerAfter: nextPower },
        ];
        setPower(nextPower);
        setHistory(nextHistory);
        publish(nextPower, nextHistory.length, false);

        later(() => {
          setSelected(null);
          setRevealedReward(null);
          setPath(`${path}.${enemy.id}`);
          setChoiceCount(enemy.nextChoiceCount);
          setFloor((value) => value + 1);
          setPhase('traveling');
        }, 900);
      }, 650);
    }, 1400);
  };

  const challengeDragon = () => {
    if (phase !== 'dragon') return;
    setPhase('battling');
    later(() => {
      if (!canDefeat(power, stage.bossAttack)) {
        finishFailed(null);
        return;
      }
      setPhase('revealing');
      setRevealedReward(stage.bossReward);
      later(() => {
        const finalPower = power + stage.bossReward;
        setPower(finalPower);
        setRevealedReward(null);
        setPhase('cleared');
        publish(finalPower, history.length, true);
        const bestKey = `number-hero-tower:stage-${stage.id}:best`;
        const best = Number(localStorage.getItem(bestKey) ?? 0);
        if (finalPower > best) localStorage.setItem(bestKey, String(finalPower));
        onComplete();
      }, 700);
    }, 1400);
  };

  const growth = Math.min(5, Math.max(1, Math.floor((power - stage.startPower) / 10) + 1));
  const currentHeroImage = HERO_IMAGES[growth - 1];
  const progress = floor > stage.floorCount || phase === 'dragon' || phase === 'cleared' ? stage.floorCount + 1 : floor;

  return (
    <main className={`number-hero-tower hero-tower-game stage-theme-${stage.id}`} style={{ '--stage-accent': stage.accent } as CSSProperties}>
      <header className="game-header">
        <div>
          <p className="eyebrow">CHAPTER 1 · STAGE 1-{stage.id}</p>
          <h1>{stage.title}</h1>
        </div>
        <div className="header-actions">
          <span className="sync-status"><i />{syncText}</span>
          <button className="text-button" onClick={onSelectStage}>스테이지 선택</button>
          {onExit && <button className="text-button" onClick={onExit}>광고게임 목록</button>}
        </div>
      </header>

      <section className="tower-shell">
        <aside className="floor-rail" aria-label="탑 진행도">
          <div className={`floor-step dragon-step ${progress === stage.floorCount + 1 ? 'active' : ''}`}><b>BOSS</b><span>최상층</span></div>
          {Array.from({ length: stage.floorCount }, (_, index) => stage.floorCount - index).map((value) => (
            <div key={value} className={`floor-step ${value === floor && progress < stage.floorCount + 1 ? 'active' : ''} ${value < floor ? 'done' : ''}`}>
              <b>{value}F</b><span>{value < floor ? '정복' : value === floor ? '현재' : '잠김'}</span>
            </div>
          ))}
        </aside>

        <section className="battle-stage">
          <div className="stage-depth-lines" aria-hidden="true" />
          {phase === 'choosing' && <div className="wall-reveal" key={`wall-${floor}`} aria-hidden="true"><i/><i/><b/></div>}
          <div className={`hero growth-${growth}`}>
            <div className="hero-score"><span>MY POWER</span><strong>{power}</strong></div>
            <div className="hero-aura" />
            <div className="hero-figure">
              <img key={growth} src={currentHeroImage} alt={`금빛 갑옷과 방패를 든 성장 ${growth}단계 숫자 용사`} />
            </div>
            <p>숫자 용사 · 성장 {growth}단계</p>
          </div>

          <div className="encounter-zone">
            {phase === 'traveling' && (
              <div className="tower-transition" style={{ '--floor-offset': `${(Math.min(floor, 7) - 4) * 58}px`, '--floor-mid-offset': `${(Math.min(floor, 7) - 4) * 26}px` } as CSSProperties}>
                <div className="tower-camera">
                  <div className="tower-roof">◆</div>
                  {[6, 5, 4, 3, 2, 1].map((level) => (
                    <div className={`tower-level ${level === floor ? 'target' : ''}`} key={level}>
                      <span>{level}F</span><i/><b/>
                    </div>
                  ))}
                  <div className="tower-base" />
                </div>
                <p>{floor > stage.floorCount ? '최상층으로 이동' : `${floor}층 진입`}</p>
              </div>
            )}
            {phase === 'choosing' && (
              <>
                <div className="choice-heading"><span>{floor}층</span><h2>상대를 선택하세요</h2><p>보상 숫자는 승리 후 공개됩니다.</p></div>
                <div className={`enemy-grid count-${choices.length}`}>
                  {choices.map((enemy, index) => {
                    const safe = canDefeat(power, enemy.attack);
                    const badge = BADGES[enemy.routeWidth];
                    return (
                      <button className={`enemy-card ${safe ? 'safe' : 'danger'}`} key={enemy.id} onClick={() => selectEnemy(enemy)}>
                        <span className="choice-letter">{String.fromCharCode(65 + index)}</span>
                        <span className={`enemy-toy ${enemy.archetype}`}>
                          <img src={ENEMY_IMAGES[enemy.archetype]} alt="" />
                        </span>
                        <span className="enemy-name">{ENEMY_NAMES[enemy.archetype]}</span>
                        <span className="attack-number"><small>ATTACK</small>{enemy.attack}</span>
                        <span className={`route-badge ${enemy.routeWidth}`}><b>{badge.mark}</b><small>{badge.ko}</small></span>
                        <span className="battle-readiness">{safe ? '승리 가능' : '패배 위험'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {(phase === 'battling' || phase === 'revealing') && (
              <div className={`resolution-panel ${phase}`}>
                <p>{phase === 'battling' ? 'POWER CHECK' : 'HIDDEN REWARD'}</p>
                {phase === 'battling' ? (
                  <div className="battle-arena">
                    <div className="battle-fighter hero-side">
                      <img src={currentHeroImage} alt={`성장 ${growth}단계 숫자 용사`} />
                      <span>MY POWER</span><strong>{battleHeroPower}</strong>
                    </div>
                    <div className="battle-impact"><b>VS</b><i>⚔</i></div>
                    <div className="battle-fighter enemy-side">
                      <img src={selected ? ENEMY_IMAGES[selected.archetype] : BOSS_IMAGES[stage.id]} alt={selected ? ENEMY_NAMES[selected.archetype] : stage.bossName} />
                      <span>{selected ? ENEMY_NAMES[selected.archetype] : stage.bossName}</span>
                      <strong>{battleEnemyPower}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="victory-reveal">
                    <h2>VICTORY</h2>
                    <img src={currentHeroImage} alt={`승리한 성장 ${growth}단계 숫자 용사`} />
                    <div className="victory-reward"><small>POWER UP</small><strong>+{revealedReward}</strong></div>
                  </div>
                )}
                {phase === 'battling' && <div className="battle-meter"><i /></div>}
              </div>
            )}

            {phase === 'dragon' && (
              <div className="dragon-panel">
                <img className="boss-figure" src={BOSS_IMAGES[stage.id]} alt={stage.bossName} />
                <p>TOP FLOOR · BOSS</p><h2>{stage.bossName}</h2>
                <div className="dragon-power"><small>ATTACK</small>{stage.bossAttack}</div>
                <button onClick={challengeDragon}>보스에 도전</button>
              </div>
            )}

            {(phase === 'cleared' || phase === 'failed') && (
              <div className={`result-panel ${phase}`}>
                <p>{phase === 'cleared' ? 'TOWER CLEARED' : 'RUN ENDED'}</p>
                <h2>{phase === 'cleared' ? `${stage.bossName} 격파!` : '힘이 부족합니다'}</h2>
                <div className="final-score"><small>저장된 최종 점수</small><strong>{power}</strong></div>
                <p className="result-note">합산될 때마다 같은 기록이 갱신되어<br/>중간에 종료해도 마지막 점수가 남습니다.</p>
                <div className="result-actions">
                  <button onClick={onRestart}>다시 도전</button>
                  <button onClick={onSelectStage}>스테이지 선택</button>
                  {phase === 'cleared' && onNextStage && <button className="next-stage" onClick={onNextStage}>다음 스테이지</button>}
                  {phase === 'cleared' && onFinishChapter && <button className="next-stage" onClick={onFinishChapter}>놀이방 정리하기</button>}
                </div>
              </div>
            )}
          </div>
        </section>
      </section>

      <footer className="run-footer">
        <div><span>진행</span><strong>{history.length} / {stage.floorCount}</strong></div>
        <div className="history-strip">
          {history.length === 0 ? <p>첫 상대를 선택하면 합산 기록이 여기에 표시됩니다.</p> : history.map((entry) => (
            <span key={entry.floor}><small>{entry.floor}F</small>{entry.attack}<i>+{entry.reward}</i><b>{entry.heroPowerAfter}</b></span>
          ))}
        </div>
      </footer>
    </main>
  );
}
