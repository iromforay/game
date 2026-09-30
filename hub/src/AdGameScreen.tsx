import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { mountGame as mountNumberGateRunner } from '../../number-gate-runner/src/game';
import type { AdGameId } from './adGames';

interface AdGameScreenProps {
  gameId: AdGameId;
  onExit: () => void;
}

export function AdGameScreen({ gameId, onExit }: AdGameScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameId !== 'number-gate-runner') return;
    const game = mountNumberGateRunner(containerRef.current);
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
  }, [gameId]);

  return (
    <div className="game-screen">
      <button type="button" className="exit-button" onClick={onExit}>
        ← 광고게임으로
      </button>
      <div className="game-canvas-wrapper ad-game-canvas-wrapper">
        <div ref={containerRef} className="game-canvas-container" />
      </div>
    </div>
  );
}
