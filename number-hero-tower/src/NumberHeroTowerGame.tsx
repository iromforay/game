import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { canDefeat, createChoices, createScoreUpdate, newRunId, STAGE_ONE } from './game/engine';
import { reportScoreUpdate } from './game/scoreReporter';
import type { EnemyChoice, HistoryEntry, RouteWidth, RunPhase } from './game/types';
import heroImage from './assets/number-hero-stage1.png';
import blockGolemImage from './assets/enemy-block-golem-stage1.png';
import clockworkKnightImage from './assets/enemy-clockwork-knight-stage1.png';
import snackGuardianImage from './assets/enemy-snack-guardian-stage1.png';
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

interface Props {
  onExit?: () => void;
}

export function NumberHeroTowerGame({ onExit }: Props) {
  const [runKey, setRunKey] = useState(0);
  return <StageOne key={runKey} onExit={onExit} onRestart={() => setRunKey((value) => value + 1)} />;
}

function StageOne({ onExit, onRestart }: Props & { onRestart: () => void }) {
  const runId = useRef(newRunId());
  const timers = useRef<number[]>([]);
  const [floor, setFloor] = useState(1);
  const [path, setPath] = useState('root');
  const [power, setPower] = useState<number>(STAGE_ONE.startPower);
  const [choiceCount, setChoiceCount] = useState(3);
  const [phase, setPhase] = useState<RunPhase>('traveling');
  const [selected, setSelected] = useState<EnemyChoice | null>(null);
  const [revealedReward, setRevealedReward] = useState<number | null>(null);
  const [battleHeroPower, setBattleHeroPower] = useState(power);
  const [battleEnemyPower, setBattleEnemyPower] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [syncText, setSyncText] = useState('첫 보상 합산 후 BE 기록 시작');
  const choices = useMemo(() => createChoices(floor, path, choiceCount), [floor, path, choiceCount]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  useEffect(() => {
    if (phase !== 'battling') return;
    const enemyPower = selected?.attack ?? STAGE_ONE.dragonAttack;
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
  }, [phase, power, selected]);

  useEffect(() => {
    if (phase !== 'traveling') return;
    const timer = window.setTimeout(() => {
      setPhase(floor > STAGE_ONE.floorCount ? 'dragon' : 'choosing');
    }, 1750);
    return () => window.clearTimeout(timer);
  }, [floor, phase]);

  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  };

  const publish = (nextPower: number, floorsCleared: number, final = false) => {
    reportScoreUpdate(runId.current, createScoreUpdate(nextPower, floorsCleared, final), final);
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
      if (!canDefeat(power, STAGE_ONE.dragonAttack)) {
        finishFailed(null);
        return;
      }
      setPhase('revealing');
      setRevealedReward(STAGE_ONE.dragonReward);
      later(() => {
        const finalPower = power + STAGE_ONE.dragonReward;
        setPower(finalPower);
        setRevealedReward(null);
        setPhase('cleared');
        publish(finalPower, history.length, true);
        const best = Number(localStorage.getItem('number-hero-tower:stage-1:best') ?? 0);
        if (finalPower > best) localStorage.setItem('number-hero-tower:stage-1:best', String(finalPower));
      }, 700);
    }, 1400);
  };

  const growth = Math.min(5, Math.max(1, Math.floor((power - STAGE_ONE.startPower) / 10) + 1));
  const progress = floor > STAGE_ONE.floorCount || phase === 'dragon' || phase === 'cleared' ? 7 : floor;

  return (
    <main className="hero-tower-game">
      <header className="game-header">
        <div>
          <p className="eyebrow">AD GAME 02 · STAGE 1</p>
          <h1>{STAGE_ONE.title}</h1>
        </div>
        <div className="header-actions">
          <span className="sync-status"><i />{syncText}</span>
          {onExit && <button className="text-button" onClick={onExit}>광고게임 목록</button>}
        </div>
      </header>

      <section className="tower-shell">
        <aside className="floor-rail" aria-label="탑 진행도">
          <div className={`floor-step dragon-step ${progress === 7 ? 'active' : ''}`}><b>DRAGON</b><span>최상층</span></div>
          {[6, 5, 4, 3, 2, 1].map((value) => (
            <div key={value} className={`floor-step ${value === floor && progress < 7 ? 'active' : ''} ${value < floor ? 'done' : ''}`}>
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
              <img src={heroImage} alt="금빛 갑옷과 방패를 든 숫자 용사" />
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
                <p>{floor > STAGE_ONE.floorCount ? '최상층으로 이동' : `${floor}층 진입`}</p>
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
                      <img src={heroImage} alt="숫자 용사" />
                      <span>MY POWER</span><strong>{battleHeroPower}</strong>
                    </div>
                    <div className="battle-impact"><b>VS</b><i>⚔</i></div>
                    <div className="battle-fighter enemy-side">
                      {selected ? <img src={ENEMY_IMAGES[selected.archetype]} alt={ENEMY_NAMES[selected.archetype]} /> : <div className="battle-dragon">◆</div>}
                      <span>{selected ? ENEMY_NAMES[selected.archetype] : '블록 드래곤'}</span>
                      <strong>{battleEnemyPower}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="victory-reveal">
                    <h2>VICTORY</h2>
                    <img src={heroImage} alt="승리한 숫자 용사" />
                    <div className="victory-reward"><small>POWER UP</small><strong>+{revealedReward}</strong></div>
                  </div>
                )}
                {phase === 'battling' && <div className="battle-meter"><i /></div>}
              </div>
            )}

            {phase === 'dragon' && (
              <div className="dragon-panel">
                <div className="dragon-figure"><span className="wing left"/><span className="wing right"/><span className="dragon-head">◆</span><span className="dragon-body"/></div>
                <p>TOP FLOOR · BOSS</p><h2>블록 드래곤</h2>
                <div className="dragon-power"><small>ATTACK</small>{STAGE_ONE.dragonAttack}</div>
                <button onClick={challengeDragon}>드래곤에 도전</button>
              </div>
            )}

            {(phase === 'cleared' || phase === 'failed') && (
              <div className={`result-panel ${phase}`}>
                <p>{phase === 'cleared' ? 'TOWER CLEARED' : 'RUN ENDED'}</p>
                <h2>{phase === 'cleared' ? '드래곤 격파!' : '힘이 부족합니다'}</h2>
                <div className="final-score"><small>저장된 최종 점수</small><strong>{power}</strong></div>
                <p className="result-note">합산될 때마다 같은 기록이 갱신되어<br/>중간에 종료해도 마지막 점수가 남습니다.</p>
                <button onClick={onRestart}>스테이지 1 다시 시작</button>
              </div>
            )}
          </div>
        </section>
      </section>

      <footer className="run-footer">
        <div><span>진행</span><strong>{history.length} / {STAGE_ONE.floorCount}</strong></div>
        <div className="history-strip">
          {history.length === 0 ? <p>첫 상대를 선택하면 합산 기록이 여기에 표시됩니다.</p> : history.map((entry) => (
            <span key={entry.floor}><small>{entry.floor}F</small>{entry.attack}<i>+{entry.reward}</i><b>{entry.heroPowerAfter}</b></span>
          ))}
        </div>
      </footer>
    </main>
  );
}
