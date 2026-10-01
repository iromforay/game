import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { mountGame } from '../../number-gate-runner/src/game';
import { RUNNER_CHAPTERS, RUNNER_STAGES, type RunnerStage } from '../../number-gate-runner/src/stages';
import houseMapUrl from '../../number-hero-tower/src/assets/house-chapter-map.jpg';
import './NumberGateRunnerScreen.css';

type Screen = 'map' | 'stages' | 'game';

const STAGE_ICONS = [
  '🧱', '🧸', '🚂', '🏎️', '🤖', '🏴‍☠️', '🦖', '🎠', '🏰', '🗼',
  '🍪', '🍴', '🍬', '🫧', '🍞', '🍲', '❄️', '🔥', '🕯️', '👑',
];

const unlockedKey = 'number-gate-runner:unlocked-stage';
const bestKey = (stageId: number) => `number-gate-runner:stage-${stageId}:best`;
const clearedKey = (stageId: number) => `number-gate-runner:stage-${stageId}:cleared`;

function readNumber(key: string, fallback = 0) {
  if (typeof window === 'undefined') return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

interface NumberGateRunnerScreenProps {
  onExit: () => void;
}

export function NumberGateRunnerScreen({ onExit }: NumberGateRunnerScreenProps) {
  const [screen, setScreen] = useState<Screen>('map');
  const [chapter, setChapter] = useState<1 | 2>(1);
  const [selectedStage, setSelectedStage] = useState<RunnerStage>(RUNNER_STAGES[0]);
  const [unlockedStage, setUnlockedStage] = useState(() => Math.max(1, readNumber(unlockedKey, 1)));
  const [bestScores, setBestScores] = useState<Record<number, number>>(() => Object.fromEntries(
    RUNNER_STAGES.map((stage) => [stage.id, readNumber(bestKey(stage.id))]),
  ));
  const [clearedStages, setClearedStages] = useState<Record<number, boolean>>(() => Object.fromEntries(
    RUNNER_STAGES.map((stage) => [
      stage.id,
      window.localStorage.getItem(clearedKey(stage.id)) === 'true'
        || (stage.id <= 10 && stage.id < readNumber(unlockedKey, 1)),
    ]),
  ));

  const chapterOneCleared = clearedStages[10] === true;
  const clearedInChapter = (chapterId: 1 | 2) => RUNNER_STAGES.filter(
    (stage) => stage.chapter === chapterId && clearedStages[stage.id],
  ).length;

  const openChapter = (nextChapter: 1 | 2) => {
    if (nextChapter === 2 && !chapterOneCleared) return;
    setChapter(nextChapter);
    setScreen('stages');
  };

  if (screen === 'game') {
    return (
      <RunnerCanvas
        stage={selectedStage}
        onLeave={() => setScreen('stages')}
        onComplete={(won, maxCount) => {
          const best = Math.max(bestScores[selectedStage.id] ?? 0, maxCount);
          window.localStorage.setItem(bestKey(selectedStage.id), String(best));
          setBestScores((current) => ({ ...current, [selectedStage.id]: best }));
          if (!won) return;
          window.localStorage.setItem(clearedKey(selectedStage.id), 'true');
          setClearedStages((current) => ({ ...current, [selectedStage.id]: true }));
          const nextUnlocked = Math.min(RUNNER_STAGES.length, Math.max(unlockedStage, selectedStage.id + 1));
          window.localStorage.setItem(unlockedKey, String(nextUnlocked));
          setUnlockedStage(nextUnlocked);
        }}
      />
    );
  }

  if (screen === 'stages') {
    const stages = RUNNER_STAGES.filter((stage) => stage.chapter === chapter);
    return (
      <main className={`runner-stage-screen chapter-${chapter}`}>
        <header className="runner-select-header">
          <button type="button" onClick={() => setScreen('map')}>← 집안 지도</button>
          <div>
            <small>CHAPTER {chapter}</small>
            <h1>{RUNNER_CHAPTERS[chapter - 1].title} 진격로</h1>
            <p>스테이지 제목에 맞는 길을 돌파하고 탑 입구까지 전진하세요.</p>
          </div>
          <b>{clearedInChapter(chapter)} / 10</b>
        </header>
        <section className="runner-stage-grid" aria-label={`${chapter}장 스테이지 선택`}>
          {stages.map((stage) => {
            const locked = stage.id > unlockedStage;
            const best = bestScores[stage.id] ?? 0;
            const cleared = clearedStages[stage.id] === true;
            return (
              <button
                type="button"
                key={stage.id}
                className={`${cleared ? 'cleared' : ''} ${locked ? 'locked' : ''}`}
                disabled={locked}
                onClick={() => { setSelectedStage(stage); setScreen('game'); }}
              >
                <span className="runner-stage-number">{chapter}-{stage.stage}</span>
                <i aria-hidden="true">{STAGE_ICONS[stage.id - 1]}</i>
                <strong>{stage.title}</strong>
                <small>{stage.route}</small>
                <em>{stage.bossName}</em>
                {locked ? <b>🔒 잠김</b> : cleared ? <b>클리어 · 최고 {best.toLocaleString('ko-KR')}명</b> : best > 0 ? <b>최고 {best.toLocaleString('ko-KR')}명 · 재도전</b> : <b>도전 가능</b>}
              </button>
            );
          })}
        </section>
      </main>
    );
  }

  return (
    <main className="runner-world-screen">
      <header className="runner-map-header">
        <button type="button" onClick={onExit}>← 광고게임</button>
        <div><small>NUMBER GATE RUNNER</small><h1>집안 진격 지도</h1></div>
        <span>방을 돌파해 숫자의 탑 입구를 여세요</span>
      </header>
      <section className="runner-house-map" style={{ backgroundImage: `url(${houseMapUrl})` }}>
        <button type="button" className={`runner-chapter playroom ${chapterOneCleared ? 'complete' : ''}`} onClick={() => openChapter(1)}>
          <small>CHAPTER 1</small><strong>놀이방</strong><span>장난감 탑 진격로</span><b>{chapterOneCleared ? '정리 완료 · 다시 진격' : `${clearedInChapter(1)} / 10 돌파`}</b>
        </button>
        <button type="button" className={`runner-chapter kitchen ${chapterOneCleared ? 'open' : 'locked'}`} disabled={!chapterOneCleared} onClick={() => openChapter(2)}>
          <small>CHAPTER 2</small><strong>주방</strong><span>주방 탑 진격로</span><b>{chapterOneCleared ? `${clearedInChapter(2)} / 10 돌파` : '🔒 놀이방 완료 필요'}</b>
        </button>
        <div className="runner-future-rooms" aria-label="추후 공개 지역">
          <span>🔒 욕실</span><span>🔒 서재</span><span>🔒 창고</span>
        </div>
      </section>
    </main>
  );
}

function RunnerCanvas({ stage, onLeave, onComplete }: { stage: RunnerStage; onLeave: () => void; onComplete: (won: boolean, maxCount: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const callbacks = useRef({ onLeave, onComplete });
  callbacks.current = { onLeave, onComplete };

  useEffect(() => {
    if (!containerRef.current) return;
    const game = mountGame(containerRef.current, {
      stage,
      onLeave: () => callbacks.current.onLeave(),
      onComplete: (result) => callbacks.current.onComplete(result.won, result.maxCount),
    });
    gameRef.current = game;
    const refresh = () => game.scale.refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      game.destroy(true);
      gameRef.current = null;
    };
  }, [stage]);

  return (
    <div className="game-screen runner-game-screen">
      <button type="button" className="exit-button" onClick={onLeave}>← 스테이지 선택</button>
      <div className="game-canvas-wrapper ad-game-canvas-wrapper runner-cropped-game-wrapper"><div ref={containerRef} className="game-canvas-container runner-cropped-game-canvas" /></div>
    </div>
  );
}
